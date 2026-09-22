/**
 * analyticsClient.js — Expo client for the optional analytics backend.
 *
 * Posts user-activity events to `$EXPO_PUBLIC_ANALYTICS_URL/api/events`
 * (the 10-Analytics ingestion API). The endpoint accepts any
 * device_id_hash matching /^[a-f0-9]{64}$/.
 *
 * Disabled-when-unset: if EXPO_PUBLIC_ANALYTICS_URL is not baked into the
 * build (the TestFlight production profile deliberately omits it), every
 * entry point is a no-op — no fetch, no queue growth, no retry storm
 * against a dead localhost.
 *
 * Identity model:
 * - Legacy test profiles were removed with UserPickerScreen (guest mode
 *   2026-09-19). Whatever active_user key an older build left in storage
 *   keeps working for identity hashing; new installs have no active user
 *   → track() drops events until a consent + identity UI exists.
 * - The username is hashed (djb2 + pad) to a 64-hex device_id_hash and
 *   stored in AsyncStorage. Same user → same hash forever.
 * - session_id is a random token generated per app launch.
 *
 * GDPR consent gate:
 * - Until `setConsent(true)` is called, every track() call is dropped silently.
 *   This guarantees we never emit an event before the user has consented.
 * - `setOptOut()` flips consent off, persists an opt-out flag, and POSTs
 *   `device_id_hash` to /api/gdpr/opt-out so the backend can mark the
 *   device in its Phase 2 stop-list.
 *
 * Events emitted (all conform to 10-Analytics/analytics.ts schema enums):
 *   - session_start       on login / restored session
 *   - section_impression  when HomeScreen / DetailsScreen mount
 *   - event_view          when an event card is opened (Details screen)
 *   - event_click         when an external-link CTA is tapped
 *   - event_save          when the user saves / unsaves an event
 *   - event_dismiss       when the user dismisses an event
 *
 * Transport:
 * - fetch POST to /api/events with a { events: [...] } batch.
 * - Fire-and-forget: errors are logged but never block the UI.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ANALYTICS_URL = process.env.EXPO_PUBLIC_ANALYTICS_URL || null;
const ANALYTICS_EVENTS_PATH = '/api/events';
const ANALYTICS_OPT_OUT_PATH = '/api/gdpr/opt-out';

const STORAGE_USER_KEY = 'analytics.active_user';
const STORAGE_HASH_KEY = 'analytics.device_id_hash';
const STORAGE_SESSION_KEY = 'analytics.session_id';
const STORAGE_CONSENT_KEY = 'analytics.consent';

const PAGE_LABELS = {
  app: 'app',
  home: 'home',
  details: 'details',
  profile: 'profile',
};

// Schema-aligned enums (mirror 10-Analytics/analytics.ts).
const SECTION_KEYS = ['tonight', 'weekend', 'free', 'recommendations'];
const CLICK_TARGETS = ['card', 'save', 'dismiss', 'external'];
const SAVE_VALUES = ['save', 'unsave'];

/**
 * Deterministic 64-hex device_id_hash from a username.
 * Uses djb2 hash repeated — not cryptographically secure, but
 * stable and meets the schema (^[a-f0-9]{64}$).
 */
function hashToHex64(input) {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 * 33) ^ c) >>> 0;
  }
  const seed = `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  let out = '';
  let s = seed;
  while (out.length < 64) {
    let acc = 0;
    for (let i = 0; i < s.length; i++) {
      acc = ((acc << 5) - acc + s.charCodeAt(i)) >>> 0;
    }
    out += acc.toString(16).padStart(8, '0');
    s = `${acc}${s}`;
  }
  return out.slice(0, 64);
}

function randomSessionId() {
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function getOrInitSession() {
  const existing = await AsyncStorage.getItem(STORAGE_SESSION_KEY);
  if (existing) return existing;
  const sid = randomSessionId();
  await AsyncStorage.setItem(STORAGE_SESSION_KEY, sid);
  return sid;
}

async function getOrInitDeviceHash(userId) {
  const stored = await AsyncStorage.getItem(STORAGE_HASH_KEY);
  if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
  const hash = hashToHex64(`eventpulse-user:${userId}:v1`);
  await AsyncStorage.setItem(STORAGE_HASH_KEY, hash);
  return hash;
}

async function getActiveUser() {
  return AsyncStorage.getItem(STORAGE_USER_KEY);
}

async function clearActiveUser() {
  await AsyncStorage.multiRemove([
    STORAGE_USER_KEY,
    STORAGE_HASH_KEY,
    STORAGE_SESSION_KEY,
    STORAGE_CONSENT_KEY,
  ]);
}

/**
 * Log out (user portal). KEEPS the GDPR consent — consent is device-level.
 * Queued events are drained before identity keys are cleared (each event
 * already carries its own device_id_hash + session_id, so an in-flight
 * POST is never affected).
 */
async function logout() {
  await flush(); // drain the queue now — don't lose buffered events
  stopFlushLoop(); // stop the interval; its final flush is a no-op now
  await AsyncStorage.multiRemove([
    STORAGE_USER_KEY,
    STORAGE_HASH_KEY,
    STORAGE_SESSION_KEY,
  ]);
}

/**
 * GDPR consent. Until consent === true, all track() calls are dropped.
 * The flag is independent of the user pick: a user can be picked without
 * consent (we just won't emit anything until they accept).
 */
async function getConsent() {
  const raw = await AsyncStorage.getItem(STORAGE_CONSENT_KEY);
  return raw === '1';
}

async function setConsent(granted) {
  await AsyncStorage.setItem(STORAGE_CONSENT_KEY, granted ? '1' : '0');
  if (!granted) {
    // Flush any pending events on the way out — they were queued under
    // a previous consent grant and should still reach the backend.
    void flush();
  }
}

const queue = [];
let flushing = false;

async function flush() {
  if (!ANALYTICS_URL) {
    // No backend configured in this build — drop the queue rather than
    // buffering forever against a dead endpoint.
    queue.length = 0;
    return;
  }
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(`${ANALYTICS_URL}${ANALYTICS_EVENTS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch (err) {
    queue.unshift(...batch);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[analytics] flush failed', err?.message || err);
    }
  } finally {
    flushing = false;
  }
}

async function postOptOut(deviceIdHash) {
  if (!ANALYTICS_URL) return;
  try {
    await fetch(`${ANALYTICS_URL}${ANALYTICS_OPT_OUT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id_hash: deviceIdHash }),
    });
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[analytics] opt-out post failed', err?.message || err);
    }
  }
}

async function track(eventType, page, payload = {}) {
  // No backend configured in this build → analytics disabled entirely.
  if (!ANALYTICS_URL) return;
  // Hard GDPR gate: never emit anything before consent.
  if (!(await getConsent())) return;
  const user = await getActiveUser();
  if (!user) return;
  const hash = await getOrInitDeviceHash(user);
  const sid = await getOrInitSession();
  queue.push({
    event_type: eventType,
    page: PAGE_LABELS[page] || page || 'unknown',
    payload,
    device_id_hash: hash,
    session_id: sid,
  });
  if (queue.length >= 10) {
    void flush();
  }
}

let flushTimer = null;
function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
  }, 2000);
}

function stopFlushLoop() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void flush();
}

async function sessionStart(platform) {
  await track('session_start', 'app', {
    app_version: '1.0.0',
    platform,
  });
}

async function sectionImpression(section) {
  const safe = SECTION_KEYS.includes(section) ? section : 'recommendations';
  await track('section_impression', 'home', { section: safe });
}

async function eventView(eventId, sourceSlug, categorySlug) {
  await track('event_view', 'home', {
    event_id: eventId,
    source_slug: sourceSlug,
    category_slug: categorySlug,
  });
}

async function eventClick(eventId, target) {
  const safe = CLICK_TARGETS.includes(target) ? target : 'card';
  await track('event_click', 'details', { event_id: eventId, target: safe });
}

async function eventSave(eventId, value) {
  const safe = SAVE_VALUES.includes(value) ? value : 'save';
  await track('event_save', 'details', { event_id: eventId, value: safe });
}

async function eventDismiss(eventId) {
  await track('event_dismiss', 'details', { event_id: eventId });
}

async function searchQuery(queryLength, hasFilters) {
  await track('search_query', 'home', {
    query_len: queryLength,
    has_filters: !!hasFilters,
  });
}

async function filterChange(filter) {
  const allowed = ['category', 'price', 'date'];
  const safe = allowed.includes(filter) ? filter : 'category';
  await track('filter_change', 'home', { filter: safe });
}

// Utforska tile presses (Fas B, 2026-09-22). The word is the tile's stable
// id (never the localized label) — dashboard 7777 reports per-word taps.
const TILE_WORDS = ['gratis', 'live', 'skratt', 'stamning', 'helg', 'imorgon'];

async function tileTap(word) {
  const safe = TILE_WORDS.includes(word) ? word : 'unknown';
  await track('tile_tap', 'home', { word: safe });
}

/**
 * Mark the current user as opted out of analytics. Flushes the in-memory
 * queue (so already-buffered events reach the server), then POSTs the
 * device_id_hash to /api/gdpr/opt-out so the backend can record the flag.
 *
 * After this call, every track() will silently drop until the user
 * re-consents via setConsent(true).
 */
async function setOptOut() {
  const user = await getActiveUser();
  if (user) {
    const hash = await getOrInitDeviceHash(user);
    await setConsent(false);
    await flush();
    await postOptOut(hash);
  } else {
    await setConsent(false);
  }
}

export const analyticsClient = {
  SECTION_KEYS,
  CLICK_TARGETS,
  TILE_WORDS,
  sessionStart,
  sectionImpression,
  eventView,
  eventClick,
  eventSave,
  eventDismiss,
  searchQuery,
  filterChange,
  tileTap,
  startFlushLoop,
  stopFlushLoop,
  clearActiveUser,
  logout,
  getConsent,
  setConsent,
  setOptOut,
  // Exposed for tests / debugging — never call from app code.
  _flush: flush,
  _reset: () => {
    queue.length = 0;
  },
};