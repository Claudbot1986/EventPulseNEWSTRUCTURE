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
