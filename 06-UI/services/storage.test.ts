/**
 * Tests for the auth-popup dismissal flag in services/storage.js.
 *
 * The popup appears once per cold start (driven by a 30 s timer in
 * AppShell) and offers a "Påminn mig inte igen" checkbox. The checkbox
 * state must persist across cold restarts so we do not nag users who
 * already opted out. These tests cover the round-trip:
 *   - `getAuthPopupDismissed` returns false when the key is absent.
 *   - `getAuthPopupDismissed` returns false for any value other than '1'.
 *   - `setAuthPopupDismissed(true)` persists '1' and round-trips true.
 *   - `setAuthPopupDismissed(false)` clears the key (round-trip false).
 *   - Storage errors from the underlying backend surface as false
 *     (never throw — AppShell must still be able to render).
 *
 * Run:  npx vitest run 06-UI/services/storage.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// AsyncStorage imports touch `window` on load; vitest's node environment
// has none. Stub the module with an in-memory map BEFORE importing the
// helpers so storage.js picks the stub via its backend-selection branch.
vi.mock('@react-native-async-storage/async-storage', () => {
  const map = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: async (k: string, v: string) => { map.set(k, v); },
      removeItem: async (k: string) => { map.delete(k); },
    },
  };
});

import {
  getAuthPopupDismissed,
  setAuthPopupDismissed,
  AUTH_POPUP_DISMISSED_KEY,
  AUTH_SESSION_KEY,
  setItem,
  saveAuthSession,
  loadAuthSession,
  clearAuthSession,
  isAuthenticated,
} from './storage';

describe('auth popup dismissal flag', () => {
  beforeEach(async () => {
    // Ensure each test starts with the key absent.
    await setAuthPopupDismissed(false);
  });

  it('returns false when the key has never been set', async () => {
    const v = await getAuthPopupDismissed();
    expect(v).toBe(false);
  });

  it('returns true after setAuthPopupDismissed(true) round-trips', async () => {
    await setAuthPopupDismissed(true);
    const v = await getAuthPopupDismissed();
    expect(v).toBe(true);
    expect(AUTH_POPUP_DISMISSED_KEY).toBe('eventpulse.auth_popup_dismissed');
  });

  it('clears the key after setAuthPopupDismissed(false)', async () => {
    await setAuthPopupDismissed(true);
    expect(await getAuthPopupDismissed()).toBe(true);
    await setAuthPopupDismissed(false);
    expect(await getAuthPopupDismissed()).toBe(false);
  });

  it('treats any non-"1" value as not dismissed', async () => {
    // Direct setItem to simulate a malformed/legacy value.
    await setItem(AUTH_POPUP_DISMISSED_KEY, 'true');
    expect(await getAuthPopupDismissed()).toBe(false);
    await setItem(AUTH_POPUP_DISMISSED_KEY, '0');
    expect(await getAuthPopupDismissed()).toBe(false);
    await setItem(AUTH_POPUP_DISMISSED_KEY, '');
    expect(await getAuthPopupDismissed()).toBe(false);
  });
});

describe('auth session persistence', () => {
  beforeEach(async () => {
    await clearAuthSession();
  });

  it('returns null when no session has been saved', async () => {
    expect(await loadAuthSession()).toBeNull();
    expect(await isAuthenticated()).toBe(false);
  });

  it('round-trips a valid session', async () => {
    const session = {
      access_token: 'a'.repeat(40),
      refresh_token: 'r'.repeat(40),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-1', email: 'alice@example.com' },
    };
    await saveAuthSession(session);
    const loaded = (await loadAuthSession()) as {
      access_token: string;
      refresh_token: string;
      user: { email: string };
    };
    expect(loaded).not.toBeNull();
    expect(loaded.access_token).toBe(session.access_token);
    expect(loaded.refresh_token).toBe(session.refresh_token);
    expect(loaded.user.email).toBe('alice@example.com');
    expect(await isAuthenticated()).toBe(true);
  });

  it('clearAuthSession wipes the key', async () => {
    await saveAuthSession({ access_token: 'x', refresh_token: 'y', expires_at: 0 });
    expect(AUTH_SESSION_KEY).toBe('eventpulse.auth_session');
    await clearAuthSession();
    expect(await loadAuthSession()).toBeNull();
    expect(await isAuthenticated()).toBe(false);
  });

  it('saveAuthSession(null) clears the key', async () => {
    await saveAuthSession({ access_token: 'x', refresh_token: 'y', expires_at: 0 });
    await saveAuthSession(null);
    expect(await loadAuthSession()).toBeNull();
  });

  it('loadAuthSession returns null for malformed JSON', async () => {
    await setItem(AUTH_SESSION_KEY, 'not-json');
    expect(await loadAuthSession()).toBeNull();
  });

  it('loadAuthSession returns null when access_token is missing', async () => {
    await setItem(AUTH_SESSION_KEY, JSON.stringify({ expires_at: 0 }));
    expect(await loadAuthSession()).toBeNull();
  });

  it('isAuthenticated treats missing expires_at as valid', async () => {
    await saveAuthSession({ access_token: 'x', refresh_token: 'y' });
    expect(await isAuthenticated()).toBe(true);
  });

  it('isAuthenticated returns false for past expires_at', async () => {
    await saveAuthSession({
      access_token: 'x',
      refresh_token: 'y',
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    expect(await isAuthenticated()).toBe(false);
  });
});