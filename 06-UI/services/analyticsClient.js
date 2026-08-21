/**
 * analyticsClient.js — Expo client for the local analytics backend (port 7778).
 *
 * Posts user-activity events to `http://localhost:7778/api/events`.
 * The endpoint accepts any device_id_hash matching /^[a-f0-9]{64}$/.
 *
 * Identity model:
 * - On first launch, the user picks one of three fictitious test accounts
 *   (tomorg1, tomorg2, tomorg3) via UserPickerScreen.
 * - The chosen username is hashed (djb2 + pad) to a 64-hex device_id_hash
 *   and stored in AsyncStorage. Same user → same hash forever.
 * - session_id is a random token generated per app launch.
 *
 * GDPR consent gate:
 * - Until `setConsent(true)` is called, every track() call is dropped silently.
 *   This guarantees we never emit an event before the user has consented.
 * - `setOptOut()` flips consent off, persists an opt-out flag, and POSTs
 *   `device_id_hash` to `http://localhost:7778/api/gdpr/opt-out` so the
 *   backend can mark the device in its Phase 2 stop-list.
 *
 * Events emitted (all conform to 10-Analytics/analytics.ts schema enums):
 *   - session_start       on consent + login (UserPickerScreen)
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

const ANALYTICS_URL =
  process.env.EXPO_PUBLIC_ANALYTICS_URL || 'http://localhost:7778';
const ANALYTICS_EVENTS_PATH = '/api/events';
const ANALYTICS_OPT_OUT_PATH = '/api/gdpr/opt-out';

const STORAGE_USER_KEY = 'analytics.active_user';
const STORAGE_HASH_KEY = 'analytics.device_id_hash';
const STORAGE_SESSION_KEY = 'analytics.session_id';
const STORAGE_CONSENT_KEY = 'analytics.consent';

const TEST_USERS = [
  { id: 'tomorg1', label: 'Tomor G. — Alpha',  sub: 'Power-user, bläddrar mycket' },
  { id: 'tomorg2', label: 'Tomor G. — Beta',   sub: 'Sparar ofta, kollar kvällar' },
  { id: 'tomorg3', label: 'Tomor G. — Gamma',  sub: 'Sporadisk användare' },
];

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

async function setActiveUser(userId) {
  if (!TEST_USERS.find((u) => u.id === userId)) {
    throw new Error(`unknown test user: ${userId}`);
  }
  await AsyncStorage.setItem(STORAGE_USER_KEY, userId);
  await AsyncStorage.setItem(STORAGE_HASH_KEY, hashToHex64(`eventpulse-user:${userId}:v1`));
  await AsyncStorage.removeItem(STORAGE_SESSION_KEY);
  const sid = await getOrInitSession();
  return {
    userId,
    deviceIdHash: await getOrInitDeviceHash(userId),
    sessionId: sid,
  };
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
  TEST_USERS,
  SECTION_KEYS,
  CLICK_TARGETS,
  sessionStart,
  sectionImpression,
  eventView,
  eventClick,
  eventSave,
  eventDismiss,
  searchQuery,
  filterChange,
  startFlushLoop,
  stopFlushLoop,
  getActiveUser,
  setActiveUser,
  clearActiveUser,
  getConsent,
  setConsent,
  setOptOut,
  hashToHex64,
  // Exposed for tests / debugging — never call from app code.
  _flush: flush,
  _reset: () => {
    queue.length = 0;
  },
};