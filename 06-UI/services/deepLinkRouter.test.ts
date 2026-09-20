/**
 * Tests for the shared deep-link classifier (06-UI/services/deepLinkRouter.js).
 *
 * The classifier decides which surface owns an incoming eventpulse:// URL:
 *   - isAuthDeepLink  → AppShell / MagicLinkHandlerScreen
 *   - isShareDeepLink → App.js / fetchSharedSession + DetailsScreen
 *
 * Both surfaces register Linking listeners. Without this single source
 * of truth the auth and share regexes drift apart over time and one
 * surface accidentally claims the other's URLs. These tests pin both
 * shapes so a future regression (e.g. someone tightening the auth regex
 * to require `type=magiclink`) is caught at CI time, not in production.
 *
 * Run:  npx vitest run 06-UI/services/deepLinkRouter.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// deepLinkRouter transitively imports supabaseAuthClient which initializes
// a real Supabase client on module load. Stub the SDK so importing the
// pure classifier is safe under vitest's node environment (matches the
// pattern in supabaseAuthClient.test.ts).
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async () => ({ data: null, error: null }),
      verifyOtp: async () => ({ data: null, error: null }),
      setSession: async () => ({ data: null, error: null }),
    },
  }),
}));

// deepLinkRouter → supabaseAuthClient imports Platform from 'react-native'
// (via guest-mode commit 34828f4) and expo-apple-authentication. react-native's
// entry is Flow-typed and does not parse under vitest/rolldown; the apple module
// pulls react-native transitively. The classifier logic under test is pure
// URL-matching, so stub both modules minimally.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o?.ios ?? o?.default },
}));
vi.mock('expo-apple-authentication', () => ({}));
// supabaseAuthClient reads expo-constants at call time (authRedirectTo's
// Expo Go detection). Under vitest the real module pulls expo-modules-core,
// which crashes on the missing __DEV__ global — the classifier under test
// never calls it, so a shape-only stub suffices (standalone/prod default).
vi.mock('expo-constants', () => ({
  default: { appOwnership: null, expoConfig: null },
}));

import {
  isEventPulseUrl,
  isAuthDeepLink,
  isShareDeepLink,
  isDinHelgDeepLink,
  DEEP_LINK_PATHS,
  AUTH_URL_PREFIX,
} from './deepLinkRouter';

describe('isAuthDeepLink', () => {
  it('matches a magic-link callback with token_hash', () => {
    expect(
      isAuthDeepLink('eventpulse://auth/callback?token_hash=abc&type=magiclink')
    ).toBe(true);
  });

  it('matches a magic-link callback with implicit-flow access_token', () => {
    expect(
      isAuthDeepLink('eventpulse://auth/callback?access_token=X&refresh_token=Y')
    ).toBe(true);
  });

  it('matches the bare callback path (no query)', () => {
    expect(isAuthDeepLink('eventpulse://auth/callback')).toBe(true);
  });

  it('does NOT match a share URL (different path)', () => {
    expect(isAuthDeepLink('eventpulse://s/abc1234')).toBe(false);
  });

  it('does NOT match a non-eventpulse scheme', () => {
    expect(isAuthDeepLink('https://example.com/auth/callback?token=abc')).toBe(false);
  });

  it('does NOT match an auth-like path under a different scheme', () => {
    // Same string but with myapp:// — a different scheme. Must reject.
    expect(isAuthDeepLink('myapp://auth/callback?token=abc')).toBe(false);
  });

  it('matches an Expo Go dev callback (exp:// host /--/auth/callback)', () => {
    expect(
      isAuthDeepLink('exp://192.168.1.9:8081/--/auth/callback?token_hash=abc&type=email_change')
    ).toBe(true);
  });

  it('matches an Expo Go dev callback carrying tokens in the fragment', () => {
    expect(
      isAuthDeepLink('exp://192.168.1.9:8081/--/auth/callback#access_token=AT&refresh_token=RT')
    ).toBe(true);
  });

  it('does NOT match an Expo Go URL pointing at the share path', () => {
    expect(isAuthDeepLink('exp://192.168.1.9:8081/--/s/abc123')).toBe(false);
  });

  it('rejects null, undefined, and non-string inputs', () => {
    expect(isAuthDeepLink(null as unknown as string)).toBe(false);
    expect(isAuthDeepLink(undefined as unknown as string)).toBe(false);
    expect(isAuthDeepLink(42 as unknown as string)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAuthDeepLink('')).toBe(false);
  });
});

describe('isShareDeepLink', () => {
  it('matches a /s/<hash> URL with a valid lowercase hash', () => {
    expect(isShareDeepLink('eventpulse://s/abc1234')).toBe(true);
  });

  it('matches a /s/<hash> URL with a valid uppercase hash (case-insensitive)', () => {
    expect(isShareDeepLink('eventpulse://s/ABC1234')).toBe(true);
  });

  it('does NOT match the auth callback path', () => {
    expect(isShareDeepLink('eventpulse://auth/callback?token_hash=x')).toBe(false);
  });

  it('does NOT match an https share URL', () => {
    expect(isShareDeepLink('https://example.com/s/abc1234')).toBe(false);
  });

  it('rejects null / undefined / empty', () => {
    expect(isShareDeepLink(null as unknown as string)).toBe(false);
    expect(isShareDeepLink(undefined as unknown as string)).toBe(false);
    expect(isShareDeepLink('')).toBe(false);
  });
});

describe('isEventPulseUrl', () => {
  it('matches any eventpulse:// URL', () => {
    expect(isEventPulseUrl('eventpulse://auth/callback')).toBe(true);
    expect(isEventPulseUrl('eventpulse://s/abc1234')).toBe(true);
  });

  it('rejects https / other schemes', () => {
    expect(isEventPulseUrl('https://example.com')).toBe(false);
  });

  it('rejects null / undefined / empty', () => {
    expect(isEventPulseUrl(null as unknown as string)).toBe(false);
    expect(isEventPulseUrl(undefined as unknown as string)).toBe(false);
    expect(isEventPulseUrl('')).toBe(false);
  });
});

describe('isDinHelgDeepLink (S6 weekly push payload)', () => {
  it('matches the push payload URL verbatim', () => {
    expect(isDinHelgDeepLink('eventpulse://home/din-helg')).toBe(true);
  });

  it('accepts trailing query / fragment (future tracking params)', () => {
    expect(isDinHelgDeepLink('eventpulse://home/din-helg?src=push')).toBe(true);
    expect(isDinHelgDeepLink('eventpulse://home/din-helg#top')).toBe(true);
  });

  it('rejects similar-but-wrong paths', () => {
    expect(isDinHelgDeepLink('eventpulse://home/din-helg-extra')).toBe(false);
    expect(isDinHelgDeepLink('eventpulse://din-helg')).toBe(false);
    expect(isDinHelgDeepLink('https://example.com/home/din-helg')).toBe(false);
  });

  it('rejects auth + share URLs (mutual exclusivity)', () => {
    expect(isDinHelgDeepLink('eventpulse://auth/callback?token_hash=abc')).toBe(false);
    expect(isDinHelgDeepLink('eventpulse://s/abc1234')).toBe(false);
  });

  it('is neither auth nor share from the other classifiers view', () => {
    const url = 'eventpulse://home/din-helg';
    expect(isAuthDeepLink(url)).toBe(false);
    expect(isShareDeepLink(url)).toBe(false);
    expect(isEventPulseUrl(url)).toBe(true);
  });

  it('rejects null / undefined / non-string', () => {
    expect(isDinHelgDeepLink(null as unknown as string)).toBe(false);
    expect(isDinHelgDeepLink(undefined as unknown as string)).toBe(false);
    expect(isDinHelgDeepLink('')).toBe(false);
  });
});

describe('mutual exclusivity (routing correctness)', () => {
  it('classifies an auth callback as auth, NOT share', () => {
    const url = 'eventpulse://auth/callback?token_hash=abc&type=magiclink';
    expect(isAuthDeepLink(url)).toBe(true);
    expect(isShareDeepLink(url)).toBe(false);
  });

  it('classifies a share URL as share, NOT auth', () => {
    const url = 'eventpulse://s/abc1234';
    expect(isAuthDeepLink(url)).toBe(false);
    expect(isShareDeepLink(url)).toBe(true);
  });
});

describe('exported constants', () => {
  it('exposes the auth callback path and prefix', () => {
    expect(DEEP_LINK_PATHS.AUTH).toBe('auth/callback');
    expect(DEEP_LINK_PATHS.SHARE).toBe('s');
    expect(DEEP_LINK_PATHS.DIN_HELG).toBe('home/din-helg');
    expect(AUTH_URL_PREFIX).toBe('eventpulse://auth/callback');
  });
});