/**
 * Tests for supabaseAuthClient — specifically the URL parsing logic
 * that drives MagicLinkHandlerScreen. The Supabase SDK calls themselves
 * (signInWithOtp / verifyOtp / setSession) are not unit-tested; they
 * are integration-tested manually in Expo Go per launch-plan §Fas 2.
 *
 * Run:  npx vitest run 06-UI/services/supabaseAuthClient.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// supabase-js reads from `window.localStorage` at module init in some
// configurations; vitest's node env has none. Stub the client itself so
// we can import the pure parser without touching the network.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async () => ({ data: null, error: null }),
      verifyOtp: async () => ({ data: null, error: null }),
      setSession: async () => ({ data: null, error: null }),
    },
  }),
}));

import { parseAuthDeepLink, AUTH_DEEP_LINK } from './supabaseAuthClient';

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