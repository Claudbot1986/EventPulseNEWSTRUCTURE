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
type AuthResult = { data: unknown; error: unknown };

const authMock = vi.hoisted(() => ({
  signInWithOtp: vi.fn(async (): Promise<AuthResult> => ({ data: null, error: null })),
  verifyOtp: vi.fn(async (): Promise<AuthResult> => ({ data: null, error: null })),
  setSession: vi.fn(async (): Promise<AuthResult> => ({ data: null, error: null })),
  signInAnonymously: vi.fn(),
  refreshSession: vi.fn(),
  updateUser: vi.fn(async (): Promise<AuthResult> => ({ data: { user: null }, error: null })),
  linkIdentity: vi.fn(async (): Promise<AuthResult> => ({ data: { session: null, user: null }, error: null })),
  // bootstrapSession's identity-heal asks the server for the current user.
  // Default = failure shape so pre-heal tests behave exactly as before
  // (stale snapshot kept); the heal tests stub explicit outcomes.
  getUser: vi.fn(async (): Promise<AuthResult> => ({ data: { user: null }, error: { message: 'not stubbed' } })),
}));

// signInWithApple (NOW#3 link branch) drives expo-apple-authentication; the
// hoisted shape lets individual tests steer availability, cancellation and
// the returned identityToken. fetch is stubbed per-test for the server path.
const appleMock = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  signInAsync: vi.fn(),
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
vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: appleMock.isAvailableAsync,
  signInAsync: appleMock.signInAsync,
  AppleAuthenticationScope: { FULL_NAME: 2, EMAIL: 1 },
}));

// authRedirectTo() läser expo-constants (hostUri/appOwnership) för att känna
// igen Expo Go. Standardmocken beter sig som en standalone/prod-build
// (appOwnership null, ingen hostUri) → AUTH_WEB_REDIRECT (den riktiga
// HTTPS-bekräftelsesidan) väljs. Dev-tester muterar de hoistade fälten direkt.
const constantsMock = vi.hoisted(() => ({
  appOwnership: null as string | null,
  hostUri: null as string | null,
}));
vi.mock('expo-constants', () => ({
  default: {
    get appOwnership() { return constantsMock.appOwnership; },
    get expoConfig() {
      return constantsMock.hostUri ? { hostUri: constantsMock.hostUri } : null;
    },
  },
}));

import { parseAuthDeepLink, AUTH_DEEP_LINK, AUTH_WEB_REDIRECT, bootstrapSession, signInWithEmail, signInWithApple, verifyEmailOtpCode, normalizeEmailCode, verifyOtpToken } from './supabaseAuthClient';
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

  // ─── NOW#3 redirect-kedja (fix efter localhost-incidenten 2026-09-20) ────

  it('parses fragment-delimited tokens (implicit flow #access_token=…)', () => {
    const url = 'eventpulse://auth/callback#access_token=AT&refresh_token=RT';
    expect(parseAuthDeepLink(url)).toEqual({ access_token: 'AT', refresh_token: 'RT' });
  });

  it('parses an Expo Go dev URL (exp:// host /--/auth/callback)', () => {
    const url = 'exp://192.168.1.9:8081/--/auth/callback?token_hash=th&type=email_change';
    expect(parseAuthDeepLink(url)).toEqual({ token_hash: 'th', type: 'email_change' });
  });

  it('parses Expo Go dev URL with fragment tokens', () => {
    const url = 'exp://192.168.1.9:8081/--/auth/callback#access_token=AT&refresh_token=RT';
    expect(parseAuthDeepLink(url)).toEqual({ access_token: 'AT', refresh_token: 'RT' });
  });

  it('query params win over fragment when both are present', () => {
    const url = 'eventpulse://auth/callback?token_hash=th&type=magiclink#access_token=IGNORED&refresh_token=IGNORED';
    expect(parseAuthDeepLink(url)).toEqual({ token_hash: 'th', type: 'magiclink' });
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
//   2. Valid persisted session → reused; one best-effort getUser() heals a
//      stale is_anonymous snapshot (account converted while the device missed
//      the deep link — the 2026-09-20 incident). Heal failure → persisted
//      snapshot kept (offline-safe).
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

  it('valid anonymous session → reused, no re-login, guest (heal is a no-op)', async () => {
    await saveAuthSession(anonSession());
    authMock.getUser.mockResolvedValue({
      data: { user: { id: 'u-anon-1', is_anonymous: true } },
      error: null,
    });

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(authMock.refreshSession).not.toHaveBeenCalled();
    expect(authMock.getUser).toHaveBeenCalledWith('anon-access');
    expect(result.state).toBe('guest');
    expect(bootSessionOf(result)?.access_token).toBe('anon-access');
  });

  it('valid permanent session → logged_in, no re-login', async () => {
    await saveAuthSession({
      access_token: 'perm-access',
      refresh_token: 'perm-refresh',
      expires_at: FUTURE,
      user: { id: 'u-perm', email: 'alice@example.com' },
    });
    authMock.getUser.mockResolvedValue({
      data: { user: { id: 'u-perm', email: 'alice@example.com', is_anonymous: false } },
      error: null,
    });

    const result = await bootstrapSession();

    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    expect(result.state).toBe('logged_in');
    expect(bootSessionOf(result)?.user?.email).toBe('alice@example.com');
  });

  it('stale anon blob, server says the account converted → blob healed + state flips to logged_in', async () => {
    // The 2026-09-20 incident: the account got its email confirmed while the
    // device never saw the deep link (redirect died on localhost), so the
    // persisted snapshot kept claiming is_anonymous=true forever.
    await saveAuthSession(anonSession());
    authMock.getUser.mockResolvedValue({
      data: { user: { id: 'u-anon-1', email: 'alice@example.com', is_anonymous: false } },
      error: null,
    });

    const result = await bootstrapSession();

    expect(result.state).toBe('logged_in');
    expect(authMock.signInAnonymously).not.toHaveBeenCalled();
    const persisted = await persistedSession();
    expect(persisted?.access_token).toBe('anon-access'); // tokens untouched
    expect(persisted?.refresh_token).toBe('anon-refresh');
    expect(persisted?.user?.is_anonymous).toBe(false);
    expect(persisted?.user?.email).toBe('alice@example.com');
  });

  it('heal sees a matching snapshot → storage left byte-identical (no write churn)', async () => {
    await saveAuthSession(anonSession());
    const before = await loadAuthSession();
    authMock.getUser.mockResolvedValue({
      data: { user: { id: 'u-anon-1', is_anonymous: true } },
      error: null,
    });

    const result = await bootstrapSession();

    expect(result.state).toBe('guest');
    expect(await loadAuthSession()).toEqual(before);
  });

  it('heal fails (offline / revoked) → stale snapshot kept, never throws', async () => {
    await saveAuthSession(anonSession());
    const before = await loadAuthSession();
    authMock.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'offline' } });

    const result = await bootstrapSession();

    expect(result.state).toBe('guest');
    expect(bootSessionOf(result)?.access_token).toBe('anon-access');
    expect(await loadAuthSession()).toEqual(before);
  });

  it('heal throws (socket hole) → stale snapshot kept, never throws', async () => {
    await saveAuthSession(anonSession());
    authMock.getUser.mockRejectedValue(new Error('socket closed'));

    const result = await bootstrapSession();

    expect(result.state).toBe('guest');
    const persisted = await persistedSession();
    expect(persisted?.user?.is_anonymous).toBe(true);
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

// ─── NOW#3 — anon→auth identity linking ─────────────────────────────────────
//
// Contract under test (BACKLOG NOW#3: linkIdentity/updateUser på anonym
// session — SAMMA auth.users.id före och efter, ingen data-migration):
//
//   E-post (guest):
//     - signInWithEmail detekterar anonym session → hydrerar klienten med
//       sessionen via setSession → auth.updateUser({email}) skickar
//       bekräftelselänk → verifyOtp(type:'email_change') returnerar samma
//       user.id med e-post kopplad. signInWithOtp får ALDRIG användas här
//       (den skapar en NY user — smaken skulle fastna i gästkontot).
//   E-post (icke-gäst):
//     - Ingen/fristående permanent session → oförändrat signInWithOtp-flöde.
//   Apple (guest):
//     - Efter native credential: linkIdentity({provider:'apple', token})
//       istället för serverns /agent/auth/apple (som upsertar en NY user).
//   Apple (icke-gäst):
//     - Oförändrat server-flöde (postAppleAuth via fetch).

const LINK_EMAIL = 'ny@example.com';

describe('NOW#3 — signInWithEmail identity linking', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAuthSession();
  });

  it('anonym session → link-läge: setSession hydrerar, updateUser skickar länk, signInWithOtp rörs ej', async () => {
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });
    authMock.updateUser.mockResolvedValue({ data: { user: { id: 'u-anon-1' } }, error: null });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result).toEqual({ error: null, mode: 'link' });
    expect(authMock.setSession).toHaveBeenCalledWith({
      access_token: 'anon-access',
      refresh_token: 'anon-refresh',
    });
    expect(authMock.updateUser).toHaveBeenCalledWith(
      { email: LINK_EMAIL },
      { emailRedirectTo: AUTH_WEB_REDIRECT },
    );
    expect(authMock.signInWithOtp).not.toHaveBeenCalled();
  });

  it('ingen session → signin-läge: signInWithOtp via .auth, updateUser rörs ej', async () => {
    const result = await signInWithEmail(LINK_EMAIL);

    expect(result).toEqual({ error: null, mode: 'signin' });
    expect(authMock.signInWithOtp).toHaveBeenCalledWith({
      email: LINK_EMAIL,
      options: { emailRedirectTo: AUTH_WEB_REDIRECT, shouldCreateUser: true },
    });
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('permanent session → signin-läge (inte link), updateUser rörs ej', async () => {
    await saveAuthSession({
      access_token: 'perm-access',
      refresh_token: 'perm-refresh',
      expires_at: FUTURE,
      user: { id: 'u-perm', email: 'old@example.com' },
    });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result.mode).toBe('signin');
    expect(authMock.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('gäst + adress som redan är registrerad (422 email_exists) → fallback: magic link in i befintligt konto', async () => {
    // Bevisat mot live-GoTrue 2026-09-20: updateUser mot en tagen adress
    // svarar 422 'A user with this email address has already been registered'.
    // Länkning är omöjlig — användarens RIKTIGA konto är det som äger
    // adressen, så gästen ska i stället få en klassisk inloggningslänk
    // (den anonyma identiteten överges; den bär ingenting värt att rädda
    // jämfört med att strandning av det permanenta kontot).
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });
    authMock.updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' },
    });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result).toEqual({ error: null, mode: 'signin' });
    expect(authMock.signInWithOtp).toHaveBeenCalledWith({
      email: LINK_EMAIL,
      options: { emailRedirectTo: AUTH_WEB_REDIRECT, shouldCreateUser: false },
    });
  });

  it('updateUser-fel bubblar upp som { error } med mode link', async () => {
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });
    authMock.updateUser.mockResolvedValue({ data: { user: null }, error: { message: 'rate limited' } });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result.mode).toBe('link');
    expect(result.error).toBe('rate limited');
    expect(authMock.signInWithOtp).not.toHaveBeenCalled(); // bara 422 email_exists faller över till signin
  });

  it('setSession misslyckas i link-läge → fel sätts, updateUser anropas aldrig', async () => {
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: null }, error: { message: 'session gone' } });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result.mode).toBe('link');
    expect(result.error).toBe('session gone');
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('Expo Go-dev: återlänken blir exp://host/--/auth/callback så telefonen öppnar appen', async () => {
    vi.stubGlobal('__DEV__', true);
    constantsMock.appOwnership = 'expo';
    constantsMock.hostUri = '192.168.1.9:8081';
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result.mode).toBe('link');
    expect(authMock.updateUser).toHaveBeenCalledWith(
      { email: LINK_EMAIL },
      { emailRedirectTo: 'exp://192.168.1.9:8081/--/auth/callback' },
    );

    vi.unstubAllGlobals();
    constantsMock.appOwnership = null;
    constantsMock.hostUri = null;
  });

  it('standalone/prod: återlänken är den riktiga HTTPS-bekräftelsesidan', async () => {
    constantsMock.appOwnership = 'standalone';
    constantsMock.hostUri = null;

    const result = await signInWithEmail(LINK_EMAIL);

    expect(result.mode).toBe('signin');
    expect(authMock.signInWithOtp).toHaveBeenCalledWith({
      email: LINK_EMAIL,
      options: { emailRedirectTo: AUTH_WEB_REDIRECT, shouldCreateUser: true },
    });
    // Pin the default: the page lives on the agent server and is what
    // Supabase must have allow-listed (uri_allow_list).
    expect(AUTH_WEB_REDIRECT).toBe('https://eventpulse-agent.fly.dev/auth/callback');

    constantsMock.appOwnership = null;
  });
});

describe('Email-OTP — normalizeEmailCode + verifyEmailOtpCode', () => {
  const OTP_SESSION = {
    access_token: 'otp-access',
    refresh_token: 'otp-refresh',
    expires_at: FUTURE,
    user: { id: 'u-otp-1' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAuthSession();
    authMock.verifyOtp.mockResolvedValue({ data: { session: OTP_SESSION }, error: null });
  });

  it('signin-läge: verifyOtp via .auth med type "email" och normaliserad kod', async () => {
    const result = await verifyEmailOtpCode('a@example.com', '482 913', 'signin');

    expect(authMock.verifyOtp).toHaveBeenCalledWith({
      email: 'a@example.com',
      token: '482913',
      type: 'email',
    });
    expect(result).toEqual({ session: OTP_SESSION, error: null });
  });

  it('link-läge (gäst kopplar adress): type blir "email_change"', async () => {
    const result = await verifyEmailOtpCode('a@example.com', '482913', 'link');

    expect(authMock.verifyOtp).toHaveBeenCalledWith({
      email: 'a@example.com',
      token: '482913',
      type: 'email_change',
    });
    expect(result.error).toBeNull();
  });

  it('ogiltig kod (färre än 6 siffror) kortsluter utan nätverksanrop', async () => {
    const result = await verifyEmailOtpCode('a@example.com', '123', 'signin');

    expect(result).toEqual({ session: null, error: 'invalid_code' });
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it('saknad/email utan innehåll kortsluter utan nätverksanrop', async () => {
    const result = await verifyEmailOtpCode('', '482913', 'signin');

    expect(result).toEqual({ session: null, error: 'email_required' });
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it('60s-resend-fönstret från GoTrue mappas till rate_limited', async () => {
    authMock.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'For security purposes, you can only request this once every 60 seconds' },
    });

    const result = await verifyEmailOtpCode('a@example.com', '482913', 'signin');

    expect(result.error).toBe('rate_limited');
  });

  it('utgången/felaktig kod från GoTrue mappas till expired_or_invalid_code', async () => {
    authMock.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Token has expired or is invalid' },
    });

    const result = await verifyEmailOtpCode('a@example.com', '482913', 'signin');

    expect(result.error).toBe('expired_or_invalid_code');
  });

  it('svar utan session → no_session_returned', async () => {
    authMock.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });

    const result = await verifyEmailOtpCode('a@example.com', '482913', 'signin');

    expect(result.error).toBe('no_session_returned');
  });

  it('hängt anrop → timeout vinner racen', async () => {
    authMock.verifyOtp.mockImplementation(() => new Promise(() => {}));

    const result = await verifyEmailOtpCode('a@example.com', '482913', 'signin', { timeoutMs: 50 });

    expect(result.error).toBe('timeout');
  });

  it('normalizeEmailCode: rensar icke-siffror och kapar till 6', () => {
    expect(normalizeEmailCode('482 913')).toBe('482913');
    expect(normalizeEmailCode('482-913')).toBe('482913');
    expect(normalizeEmailCode('  482913  ')).toBe('482913');
    expect(normalizeEmailCode('48291300')).toBe('482913');
    expect(normalizeEmailCode('abc')).toBe('');
    expect(normalizeEmailCode(null as unknown as string)).toBe('');
  });

  it('REGRESSION: verifyOtpToken anropar klientens .auth-yta (inte toppnivån)', async () => {
    const result = await verifyOtpToken({ email: 'a@example.com', token: '482913' });

    expect(authMock.verifyOtp).toHaveBeenCalledWith({
      email: 'a@example.com',
      token: '482913',
      type: 'magiclink',
    });
    expect(result).toEqual({ session: OTP_SESSION, error: null });
  });
});

describe('NOW#3 — signInWithApple identity linking', () => {
  const APPLE_CRED = {
    identityToken: 'apple-identity-jwt',
    fullName: { givenName: 'Ada', middleName: null, familyName: 'Lovelace' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAuthSession();
    appleMock.signInAsync.mockResolvedValue(APPLE_CRED);
  });

  it('anonym session → linkIdentity(apple, token) mot SAMMA user, server-fetch rörs ej', async () => {
    await saveAuthSession(anonSession());
    const linkedSession = {
      access_token: 'linked-access',
      refresh_token: 'linked-refresh',
      expires_at: FUTURE,
      user: { id: 'u-anon-1', email: 'ada@privaterelay.appleid.com', is_anonymous: false },
    };
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });
    authMock.linkIdentity.mockResolvedValue({ data: { session: linkedSession, user: linkedSession.user }, error: null });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await signInWithApple();

    expect(result).toEqual({ session: linkedSession, error: null });
    expect(authMock.linkIdentity).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-identity-jwt',
    });
    expect(authMock.setSession).toHaveBeenCalledWith({
      access_token: 'anon-access',
      refresh_token: 'anon-refresh',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('ingen session → oförändrat server-flöde via /agent/auth/apple, linkIdentity rörs ej', async () => {
    const serverSession = {
      access_token: 'server-access',
      refresh_token: 'server-refresh',
      expires_at: FUTURE,
      user: { id: 'u-apple-new', email: 'ada@example.com' },
    };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => serverSession,
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    const prevAgentUrl = process.env.EXPO_PUBLIC_AGENT_URL;
    process.env.EXPO_PUBLIC_AGENT_URL = 'https://agent.test';

    const result = await signInWithApple();

    expect(result.error).toBeNull();
    expect(authMock.linkIdentity).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toMatch(/\/agent\/auth\/apple$/);
    expect(JSON.parse(init.body).identity_token).toBe('apple-identity-jwt');
    vi.unstubAllGlobals();
    if (prevAgentUrl === undefined) delete process.env.EXPO_PUBLIC_AGENT_URL;
    else process.env.EXPO_PUBLIC_AGENT_URL = prevAgentUrl;
  });

  it('linkIdentity-fel → { session: null, error }, server-fetch rörs ej', async () => {
    await saveAuthSession(anonSession());
    authMock.setSession.mockResolvedValue({ data: { session: anonSession() }, error: null });
    authMock.linkIdentity.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'manual linking disabled' } });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await signInWithApple();

    expect(result.session).toBeNull();
    expect(result.error).toBe('manual linking disabled');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});