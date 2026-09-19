/**
 * EventPulse — durable storage abstraction.
 *
 * Wraps AsyncStorage (native + Expo) and falls back to an in-memory map on
 * platforms where AsyncStorage is unavailable (e.g. some test harnesses or
 * SSR). All operations are async so the agent's identity is resolved
 * deterministically before the first /agent/chat request — no races.
 *
 * Storage layout:
 *   - 'eventpulse.anon_user_id' : string (RFC4122 v4). Survives cold restarts.
 *
 * Adding more keys is fine; keep namespaced ('eventpulse.*').
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const memoryFallback = (() => {
  const map = new Map();
  return {
    getItem: async (key) => (map.has(key) ? map.get(key) : null),
    setItem: async (key, value) => {
      map.set(key, String(value));
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
})();

const backend =
  AsyncStorage && typeof AsyncStorage.getItem === 'function'
    ? AsyncStorage
    : memoryFallback;

export const ANON_USER_ID_KEY = 'eventpulse.anon_user_id';
/** HomeScreen chip tap → App.js explore prompt. Lives here so App.js
 *  does not import AppShell (that cycle left AppShell exports
 *  uninitialized on Expo Go). */
export const PENDING_AGENT_MESSAGE_KEY = 'eventpulse.pending_agent_message';
/** User dismissed the "register your email" reminder popup with the
 *  "Påminn mig inte igen" checkbox. Stored as '1' once opted-out; absence
 *  or any other value means the reminder may still show after 30s. */
export const AUTH_POPUP_DISMISSED_KEY = 'eventpulse.auth_popup_dismissed';
/** JSON-encoded Supabase auth session ({access_token, refresh_token,
 *  expires_at, user}). Absent when the user has never completed a magic
 *  link OR has signed out. The presence of this key is the single
 *  source of truth for "is this user authenticated?". */
export const AUTH_SESSION_KEY = 'eventpulse.auth_session';

/**
 * Persist a Supabase auth session. Caller passes whatever supabase-js
 * returns from `verifyOtp` / `setSession` — we only normalize the fields
 * that AppShell + agentClient actually need. Stored as JSON.
 *
 * @param {object|null} session
 * @returns {Promise<void>}
 */
export async function saveAuthSession(session) {
  if (!session) {
    await removeItem(AUTH_SESSION_KEY);
    return;
  }
  const normalized = {
    access_token: session.access_token,
    refresh_token: session.refresh_token || null,
    expires_at: session.expires_at || 0,
    user: session.user
      ? { id: session.user.id, email: session.user.email || null }
      : null,
  };
  await setItem(AUTH_SESSION_KEY, JSON.stringify(normalized));
}

/**
 * Load the persisted Supabase auth session, or null when missing or
 * malformed. Never throws — storage failures surface as null so the
 * caller can treat the user as anonymous.
 *
 * @returns {Promise<object|null>}
 */
export async function loadAuthSession() {
  try {
    const raw = await getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      return null;
    }
    return parsed;
  } catch (_err) {
    return null;
  }
}

/**
 * Clear the persisted session. Called from logout / signOut flows.
 *
 * @returns {Promise<void>}
 */
export async function clearAuthSession() {
  await removeItem(AUTH_SESSION_KEY);
}

/**
 * True iff the persisted session has an access_token and is not past
 * its `expires_at`. `expires_at` is seconds since epoch per Supabase
 * convention; missing or 0 means "no expiry tracked" → treat as valid.
 *
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  const session = await loadAuthSession();
  if (!session || !session.access_token) return false;
  if (!session.expires_at) return true;
  const expiresAtMs = session.expires_at * 1000;
  // 30s clock-skew grace so we don't bounce users right at the boundary.
  return Date.now() < expiresAtMs - 30 * 1000;
}

/**
 * Read whether the user has permanently dismissed the auth reminder popup.
 * Returns true iff the storage key holds the literal '1'.
 *
 * @returns {Promise<boolean>}
 */
export async function getAuthPopupDismissed() {
  try {
    const v = await getItem(AUTH_POPUP_DISMISSED_KEY);
    return v === '1';
  } catch (_err) {
    return false;
  }
}

/**
 * Persist the user's "don't remind me again" choice.
 *
 * @param {boolean} dismissed
 * @returns {Promise<void>}
 */
export async function setAuthPopupDismissed(dismissed) {
  if (dismissed) {
    await setItem(AUTH_POPUP_DISMISSED_KEY, '1');
  } else {
    await removeItem(AUTH_POPUP_DISMISSED_KEY);
  }
}

/**
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getItem(key) {
  return backend.getItem(key);
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function setItem(key, value) {
  return backend.setItem(key, value);
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removeItem(key) {
  return backend.removeItem(key);
}

/**
 * RFC4122-ish v4 — sufficient for the anonymous client_user_id.
 * Does not require crypto; safe for non-secure contexts.
 *
 * @returns {string}
 */
export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Reads the anon user id from storage, or creates + persists a new one.
 * Resolves before the first request so idempotency is true across cold starts.
 *
 * @param {{ key?: string, generator?: () => string }} [opts]
 * @returns {Promise<string>}
 */
export async function getOrCreateAnonUserId(opts = {}) {
  const key = opts.key ?? ANON_USER_ID_KEY;
  const generator = opts.generator ?? uuidv4;
  try {
    const existing = await getItem(key);
    if (existing && typeof existing === 'string' && existing.length > 0) {
      return existing;
    }
    const fresh = generator();
    await setItem(key, fresh);
    return fresh;
  } catch (_err) {
    // Storage threw — emit an ephemeral id so the request still goes through.
    return generator();
  }
}
