/**
 * supabaseAuthClient — Phase 1 email-link (magic link) auth wrapper.
 *
 * Why:
 *   Phase 1 launch replaces the anonymous client_user_id contract with a
 *   Supabase-verified identity so that:
 *     - We can persist user-scoped state (saved events, follows,
 *       preferences) to a stable, GDPR-radiable user row.
 *     - DEPLOY.md §8 "Authentication for /agent/chat" is closed before
 *       any external user touches the deployed endpoint.
 *     - Spammers cannot burn the Anthropic-backed /agent/chat budget
 *       without going through the Supabase rate-limited email flow.
 *
 * Design:
 *   - Single shared Supabase client, configured with `persistSession`
 *     disabled (AsyncStorage is the source of truth — see storage.js).
 *   - Magic-link via `signInWithOtp({ email })` — Supabase default
 *     template is acceptable for Phase 1 (see BACKLOG Pre-launch note).
 *   - Apple Sign In via `expo-apple-authentication` (Fas 2.5). The
 *     identity_token is forwarded to the agent's POST /agent/auth/apple
 *     endpoint, which delegates JWT verification + user upsert to
 *     Supabase's `signInWithIdToken({ provider: 'apple' })`. The resolved
 *     session comes back in the same wire shape as magic-link, so the
 *     client persists + reuses it identically.
 *   - Deep-link callback is `eventpulse://auth/callback` (scheme is
 *     already configured in app.json:8). Supabase appends the OTP tokens
 *     to the query string.
 *   - Session shape is `{ access_token, refresh_token, expires_at, user }`
 *     stored under `eventpulse.auth_session` in AsyncStorage. We store
 *     the JSON-encoded blob ourselves rather than handing the keys to
 *     supabase-js's session manager, because supabase-js expects Web
 *     LockManager / Capacitor Preferences, which are flaky in Expo Go.
 *
 * Out of scope (Phase 2):
 *   - Token refresh (handled implicitly via re-running signInWithOtp when
 *     the server returns 401; see agentClient.js wire migration in
 *     Fas 3 of the launch plan).
 *   - OAuth providers (Google, Facebook).
 *   - SecureStore / Keychain storage.
 */

import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://bsllkpvkowwndhhxtlln.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_ANON_KEY) {
  // Warn loudly but do not throw — Expo bundling may strip process.env in
  // some configurations; the actual call to Supabase will fail with a
  // clearer error if the key really is missing.
  // eslint-disable-next-line no-console
  console.warn('[supabaseAuthClient] EXPO_PUBLIC_SUPABASE_ANON_KEY is not set; signInWithOtp will fail.');
}

export const AUTH_DEEP_LINK_SCHEME = 'eventpulse';
export const AUTH_DEEP_LINK_PATH = 'auth/callback';
export const AUTH_DEEP_LINK = `${AUTH_DEEP_LINK_SCHEME}://${AUTH_DEEP_LINK_PATH}`;

export const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // we own persistence via storage.js
    autoRefreshToken: false, // we handle refresh in the wire migration
    detectSessionInUrl: false, // we parse the deep link ourselves
  },
});

// One-shot self-check at module-load time so a broken auth runtime shows
// up immediately rather than as "signInWithOtp is not a function" later.
// Runs only in dev (Metro injects __DEV__); zero overhead in production
// builds because the if-branch is dead-code-eliminated.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseAuthClient] auth surface:',
    'signInWithOtp=' + typeof supabaseAuth?.auth?.signInWithOtp,
    'signInWithIdToken=' + typeof supabaseAuth?.auth?.signInWithIdToken,
    'verifyOtp=' + typeof supabaseAuth?.auth?.verifyOtp
  );
}

/**
 * Apple Sign In (Fas 2.5 / App Store §4.8).
 *
 * Flow on iOS:
 *   1. Call AppleAuthentication.signInAsync with FULL_NAME + EMAIL scopes.
 *   2. Receive `identityToken` (a JWT signed by Apple) and optional full_name.
 *   3. POST both to the agent's `/agent/auth/apple` endpoint, which delegates
 *      token verification + auth.users upsert to Supabase's
 *      `signInWithIdToken({ provider: 'apple' })`.
 *   4. Server returns the resolved session in the magic-link wire shape.
 *
 * Returns:
 *   - non-iOS platforms: `{ session: null, error: 'apple_sign_in_ios_only' }`
 *     so callers (LoginScreen) can decide whether to even render the button.
 *   - Apple Sign In unavailable (e.g. simulator): `{ session: null, error: 'apple_sign_in_unavailable' }`
 *   - User cancelled: `{ session: null, error: null }` — cancellation is not
 *     an error condition; the screen simply stays put.
 *   - Server rejected the identity_token: `{ session: null, error: 'invalid_identity_token' }`
 *
 * The returned session shape mirrors magic-link exactly, so `saveAuthSession`
 * stores it without any transformation.
 *
 * @returns {Promise<{ session: object|null, error: string|null, user_cancelled?: boolean }>}
 */
export async function signInWithApple() {
  if (Platform.OS !== 'ios') {
    return { session: null, error: 'apple_sign_in_ios_only' };
  }
  try {
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      return { session: null, error: 'apple_sign_in_unavailable' };
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      return { session: null, error: 'no_identity_token' };
    }
    const session = await postAppleAuth({
      identity_token: credential.identityToken,
      full_name: credential.fullName
        ? [
            credential.fullName.givenName,
            credential.fullName.middleName,
            credential.fullName.familyName,
          ].filter(Boolean).join(' ').trim() || undefined
        : undefined,
    });
    return { session, error: null };
  } catch (err) {
    // expo-apple-authentication throws a typed error when the user cancels
    // (code ERR_CANCELED / ERR_REQUEST_CANCELED). We treat cancellation as
    // a non-error so the UI does not flash a misleading red banner.
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err).code;
      if (code === 'ERR_CANCELED' || code === 'ERR_REQUEST_CANCELED') {
        return { session: null, error: null, user_cancelled: true };
      }
    }
    const msg = err && typeof err === 'object' && 'message' in err
      ? String((err).message)
      : 'apple_sign_in_failed';
    return { session: null, error: msg };
  }
}

/**
 * Internal: POST the Apple identity_token to the agent's auth endpoint.
 * Same env-var resolution as agentClient.js — keeps the surface tiny
 * without pulling in the entire client just to read its base URL.
 *
 * @param {{ identity_token: string, full_name?: string }} body
 * @returns {Promise<object|null>}
 */
async function postAppleAuth(body) {
  const baseUrl = pickAgentBaseUrl();
  const res = await fetch(`${baseUrl}/agent/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Surface the server's error code so the UI can show it directly.
    let parsed = null;
    try { parsed = await res.json(); } catch { /* ignore */ }
    const err = new Error(parsed?.message || parsed?.error || `apple_auth_${res.status}`);
    err.code = parsed?.error || `apple_auth_${res.status}`;
    throw err;
  }
  const session = await res.json();
  if (!session || typeof session.access_token !== 'string') {
    throw new Error('apple_auth_invalid_response');
  }
  return session;
}

/**
 * Resolve the agent API base URL from env vars. Mirrors agentClient.js so
 * the Apple flow lands on the same reachable host (Tailscale or LAN). No
 * health-check probe here — apple-auth is a cold-start path where the
 * agent server must be reachable; the LoginScreen shows the user a
 * generic "kunde inte logga in" message if the network is down.
 *
 * @returns {string}
 */
function pickAgentBaseUrl() {
  const candidates = [
    process.env.EXPO_PUBLIC_AGENT_URL,
    process.env.EXPO_PUBLIC_AGENT_URL_LAN,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim()) {
      return raw.replace(/\/+$/, '');
    }
  }
  throw new Error('EXPO_PUBLIC_AGENT_URL is not set');
}

/**
 * Request a magic-link email from Supabase.
 *
 * @param {string} email
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ error: string|null }>}
 */
export async function signInWithEmail(email, { timeoutMs = 15_000 } = {}) {
  if (typeof email !== 'string' || email.length === 0) {
    return { error: 'email_required' };
  }
  // Hard timeout — without this, a hung DNS / CORS-blocked fetch leaves the
  // "Skicka magic link" spinner running indefinitely. 15s is generous: a
  // healthy Supabase round-trip is <2s in dev.
  let timeoutHandle = null;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs);
  });
  const sendPromise = (async () => {
    try {
      const { error } = await supabaseAuth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: AUTH_DEEP_LINK,
          shouldCreateUser: true,
        },
      });
      if (error) return { error: error.message || 'signin_failed' };
      return { error: null };
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String(err.message)
        : 'signin_failed';
      return { error: msg };
    }
  })();
  const result = await Promise.race([sendPromise, timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return result;
}

/**
 * Verify a Supabase OTP token. Two call shapes are supported depending
 * on how the deep link arrives:
 *   - `{ token_hash, type }` — the modern PKCE flow.
 *   - `{ email, token }` — the legacy flow some Supabase templates still emit.
 *
 * Either way the function returns the resolved session (or null) plus
 * any error message so the caller can persist + route.
 *
 * @param {{ token_hash?: string, type?: string, email?: string, token?: string }} args
 * @returns {Promise<{ session: object|null, error: string|null }>}
 */
export async function verifyOtpToken(args) {
  if (!args || typeof args !== 'object') {
    return { session: null, error: 'invalid_args' };
  }
  let result;
  if (args.token_hash && args.type) {
    result = await supabaseAuth.verifyOtp({
      token_hash: args.token_hash,
      type: args.type,
    });
  } else if (args.email && args.token) {
    result = await supabaseAuth.verifyOtp({
      email: args.email,
      token: args.token,
      type: 'magiclink',
    });
  } else {
    return { session: null, error: 'missing_token_or_hash' };
  }
  const { data, error } = result;
  if (error) {
    return { session: null, error: error.message || 'verify_failed' };
  }
  if (!data?.session) {
    return { session: null, error: 'no_session_returned' };
  }
  return { session: data.session, error: null };
}

/**
 * Parse a magic-link URL of shape
 *   eventpulse://auth/callback?token_hash=...&type=magiclink
 *   eventpulse://auth/callback?access_token=...&refresh_token=...
 *
 * The first shape is the modern Supabase PKCE flow (verifyOtp).
 * The second shape is the older implicit flow where Supabase hands us
 * the access/refresh tokens directly (signInWithSession).
 *
 * @param {string|null|undefined} url
 * @returns {{ token_hash?: string, type?: string, email?: string, token?: string, access_token?: string, refresh_token?: string }|null}
 */
export function parseAuthDeepLink(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  // Strip the scheme/host and split off the query.
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return null;
  const query = url.slice(qIdx + 1);
  const params = Object.fromEntries(
    query.split('&').filter(Boolean).map((kv) => {
      const [k, v = ''] = kv.split('=');
      return [decodeURIComponent(k), decodeURIComponent(v)];
    })
  );
  if (params.access_token) {
    return {
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    };
  }
  if (params.token_hash) {
    return { token_hash: params.token_hash, type: params.type || 'magiclink' };
  }
  if (params.token) {
    return { email: params.email || '', token: params.token };
  }
  return null;
}

/**
 * Exchange an `access_token` + `refresh_token` pair for a full Supabase
 * session. Used when the deep link carries tokens directly (implicit
 * flow) rather than a token_hash.
 *
 * @param {string} access_token
 * @param {string} refresh_token
 * @returns {Promise<{ session: object|null, error: string|null }>}
 */
export async function setSessionFromTokens(access_token, refresh_token) {
  if (typeof access_token !== 'string' || access_token.length === 0) {
    return { session: null, error: 'missing_access_token' };
  }
  const { data, error } = await supabaseAuth.setSession({
    access_token,
    refresh_token: refresh_token || '',
  });
  if (error) {
    return { session: null, error: error.message || 'set_session_failed' };
  }
  return { session: data?.session || null, error: null };
}