/**
 * Tests for supabaseAuthClient — specifically the URL parsing logic
 * that drives MagicLinkHandlerScreen. The Supabase SDK calls themselves
 * (signInWithOtp / verifyOtp / setSession) are not unit-tested; they
 * are integration-tested manually in Expo Go per launch-plan §Fas 2.
 *
 * Run:  npx vitest run 06-UI/services/supabaseAuthClient.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// supabase-js reads from `window.localStorage` at module init in some
// configurations; vitest's node env has none. Stub the client itself so
// we can import the pure parser + bootstrap without touching the network.
// The auth surface lives on a hoisted mock so individual tests can steer
// signInAnonymously / refreshSession outcomes per case.
const authMock = vi.hoisted(() => ({
  signInWithOtp: vi.fn(async () => ({ data: null, error: null })),
  verifyOtp: vi.fn(async () => ({ data: null, error: null })),
  setSession: vi.fn(async () => ({ data: null, error: null })),
  signInAnonymously: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: authMock }),
}));

// bootstrapSession persists via storage.js — run the REAL storage module
// against an in-memory AsyncStorage stub (same pattern as storage.test.ts)
// so the round-trip we verify is the one the app executes.
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

// supabaseAuthClient imports Platform from 'react-native' (guest-mode commit
// 34828f4) and expo-apple-authentication — react-native's entry is Flow-typed
// and does not parse under vitest/rolldown. parseAuthDeepLink (the unit under
// test) does not touch either module; stub minimally so the import succeeds.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o?.ios ?? o?.default },
}));
vi.mock('expo-apple-authentication', () => ({}));

import { parseAuthDeepLink, AUTH_DEEP_LINK, bootstrapSession } from './supabaseAuthClient';
import { clearAuthSession, saveAuthSession, loadAuthSession } from './storage';

describe('parseAuthDeepLink', () => {
  it('returns null for non-string input', () => {
    expect(parseAuthDeepLink(null as unknown as string)).toBeNull();
    expect(parseAuthDeepLink(undefined as unknown as string)).toBeNull();
    expect(parseAuthDeepLink(42 as unknown as string)).toBeNull();
  });

  it('returns null for empty / non-URL input', () => {
    expect(parseAuthDeepLink('')).toBeNull();
    expect(parseAuthDeepLink('eventpulse://auth/callback')).toBeNull();
  });

  it('parses PKCE-style token_hash + type', () => {
    const url = 'eventpulse://auth/callback?token_hash=abc123&type=magiclink';
    expect(parseAuthDeepLink(url)).toEqual({
      token_hash: 'abc123',
      type: 'magiclink',
    });
  });

  it('defaults missing type to "magiclink" for PKCE flow', () => {
    const url = 'eventpulse://auth/callback?token_hash=abc';
    expect(parseAuthDeepLink(url)).toEqual({
      token_hash: 'abc',
      type: 'magiclink',
    });
  });

  it('parses implicit-flow access_token + refresh_token', () => {
    const url =
      'eventpulse://auth/callback?access_token=ACCESS&refresh_token=REFRESH';
    expect(parseAuthDeepLink(url)).toEqual({
      access_token: 'ACCESS',
      refresh_token: 'REFRESH',
    });
  });

  it('parses legacy email + token shape', () => {
    const url =
      'eventpulse://auth/callback?email=alice%40example.com&token=123456';
    expect(parseAuthDeepLink(url)).toEqual({
      email: 'alice@example.com',
      token: '123456',
    });
  });

  it('decodes percent-encoded values correctly', () => {
    const url =
      'eventpulse://auth/callback?token_hash=a%20b%2Bc&type=magiclink';
    expect(parseAuthDeepLink(url)).toEqual({
      token_hash: 'a b+c',
      type: 'magiclink',
    });
  });

  it('returns null when only an unknown param is present', () => {
    expect(parseAuthDeepLink('eventpulse://auth/callback?error=access_denied')).toBeNull();
  });
});

describe('AUTH_DEEP_LINK constant', () => {
  it('matches the scheme + path declared in app.json', () => {
    // app.json sets "scheme": "eventpulse"; the path is the in-app
    // auth callback. If app.json ever change, update this constant.
    expect(AUTH_DEEP_LINK).toBe('eventpulse://auth/callback');
  });
});

// ─── bootstrapSession (NOW#2 — anonymous-first identity) ─────────────────────
//
// Contract under test:
//   1. No persisted session → signInAnonymously() once, session persisted,
//      state 'guest' — taste can start accumulating from first launch.
//   2. Valid persisted session → ZERO network calls, state derived from
//      user.is_anonymous (true → 'guest', absent/false → 'logged_in').
//   3. Expired session + refresh_token → refreshSession() keeps the SAME
//      user id (taste survives across days), refreshed session persisted.
//   4. Expired + refresh rejected (revoked) → stale creds cleared, then a
//      fresh anonymous session — never a dead-token guest.
//   5. Supabase down/error on the anonymous call → { session: null,
//      state: 'guest' } and NOTHING persisted — the app opens on the
//      public surface instead of crashing on first launch.

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 600;

interface BootSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id?: string; email?: string | null; is_anonymous?: boolean } | null;
}

const bootSessionOf = (result: { session: object | null }): BootSession | null =>
  result.session as BootSession | null;

const persistedSession = async (): Promise<BootSession | null> =>
  (await loadAuthSession()) as BootSession | null;

const anonSession = (over: Record<string, unknown> = {}) => ({
  access_token: 'anon-access',
  refresh_token: 'anon-refresh',
  expires_at: FUTURE,
  user: { id: 'u-anon-1', is_anonymous: true },
  ...over,
});

describe('bootstrapSession', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAuthSession();
  });

  it('cold start: no session → signInAnonymously once + persist + guest', async () => {
    authMock.signInAnonymously.mockResolvedValue({ data: { session: anonSession() }, error: null });

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(authMock.refreshSession).not.toHaveBeenCalled();
    expect(result.state).toBe('guest');
    expect(bootSessionOf(result)?.user?.id).toBe('u-anon-1');
    const persisted = await persistedSession();
    expect(persisted?.access_token).toBe('anon-access');
    expect(persisted?.user?.is_anonymous).toBe(true);
  });

  it('valid anonymous session → reused as-is, zero auth calls, guest', async () => {
    await saveAuthSession(anonSession());

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(authMock.refreshSession).not.toHaveBeenCalled();
    expect(result.state).toBe('guest');
    expect(bootSessionOf(result)?.access_token).toBe('anon-access');
  });

  it('valid permanent session → logged_in, zero auth calls', async () => {
    await saveAuthSession({
      access_token: 'perm-access',
      refresh_token: 'perm-refresh',
      expires_at: FUTURE,
      user: { id: 'u-perm', email: 'alice@example.com' },
    });

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(result.state).toBe('logged_in');
    expect(bootSessionOf(result)?.user?.email).toBe('alice@example.com');
  });

  it('expired anonymous session → refresh keeps the SAME user id, persists', async () => {
    await saveAuthSession(anonSession({ expires_at: PAST, access_token: 'stale-access' }));
    authMock.refreshSession.mockResolvedValue({
      data: { session: anonSession({ access_token: 'fresh-access' }) },
      error: null,
    });

    const result = await bootstrapSession();

    expect(authMock.refreshSession).toHaveBeenCalledTimes(1);
    expect(authMock.refreshSession).toHaveBeenCalledWith({ refresh_token: 'anon-refresh' });
    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(bootSessionOf(result)?.user?.id).toBe('u-anon-1');
    expect(bootSessionOf(result)?.access_token).toBe('fresh-access');
    const persisted = await persistedSession();
    expect(persisted?.access_token).toBe('fresh-access');
    expect(persisted?.user?.id).toBe('u-anon-1');
  });

  it('refresh rejected (revoked) → stale creds cleared + fresh anonymous session', async () => {
    await saveAuthSession(anonSession({ expires_at: PAST }));
    authMock.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'refresh_token_not_found' } });
    authMock.signInAnonymously.mockResolvedValue({
      data: { session: anonSession({ access_token: 'second-life', user: { id: 'u-anon-2', is_anonymous: true } }) },
      error: null,
    });

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('guest');
    expect(bootSessionOf(result)?.user?.id).toBe('u-anon-2');
    const persisted = await persistedSession();
    expect(persisted?.access_token).toBe('second-life');
    expect(persisted?.user?.id).toBe('u-anon-2');
  });

  it('expired PERMANENT session → refresh attempted first; anon only as last resort', async () => {
    await saveAuthSession({
      access_token: 'perm-stale',
      refresh_token: 'perm-refresh',
      expires_at: PAST,
      user: { id: 'u-perm', email: 'alice@example.com' },
    });
    authMock.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'perm-fresh', refresh_token: 'perm-refresh-2', expires_at: FUTURE, user: { id: 'u-perm', email: 'alice@example.com' } } },
      error: null,
    });

    const result = await bootstrapSession();

    expect(authMock.refreshSession).toHaveBeenCalledWith({ refresh_token: 'perm-refresh' });
    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(result.state).toBe('logged_in');
    expect(bootSessionOf(result)?.access_token).toBe('perm-fresh');
  });

  it('Supabase error on anonymous sign-in → guest with null session, nothing persisted', async () => {
    authMock.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'network down' } });

    const result = await bootstrapSession();

    expect(result).toEqual({ session: null, state: 'guest' });
    expect(await loadAuthSession()).toBeNull();
  });

  it('anonymous sign-in throwing → guest with null session (never throws)', async () => {
    authMock.signInAnonymously.mockRejectedValue(new Error('socket closed'));

    const result = await bootstrapSession();

    expect(result).toEqual({ session: null, state: 'guest' });
    expect(await loadAuthSession()).toBeNull();
  });
});