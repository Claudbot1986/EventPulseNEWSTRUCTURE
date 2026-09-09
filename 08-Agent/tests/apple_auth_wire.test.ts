/**
 * Wire test for POST /agent/auth/apple (Fas 2.5 / App Store §4.8).
 *
 * Verifies the public Apple Sign In endpoint:
 *   - 400 missing identity_token
 *   - 401 invalid identity_token (mock returns error)
 *   - 200 with session-shape on valid identity_token
 *
 * The route delegates token verification to Supabase's
 * `auth.signInWithIdToken({ provider: 'apple', token })`. The SDK fetches
 * Apple's JWKS, verifies the JWT signature, expiry, and `aud=…`,
 * then upserts an auth.users row (mapped from `sub`) and returns the
 * resolved session. We stub the SDK call so the test does not need a
 * real Supabase project.
 *
 * Run with: npx vitest run 08-Agent/tests/apple_auth_wire.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const VALID_TOKEN = 'apple.jwt.token.AAAA.BBBB.CCCC';

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

interface AppleCall {
  provider: string;
  token: string;
}

interface MockSupabaseAuth {
  signInWithIdToken: (args: { provider: string; token: string }) => Promise<{
    data: { session: unknown } | null;
    error: { message: string } | null;
  }>;
}

let appleCalls: AppleCall[] = [];
let nextResult:
  | { kind: 'ok'; session: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'throw'; message: string }
  = {
  kind: 'ok',
  session: {
    access_token: 'fake-apple-access-token',
    refresh_token: 'fake-apple-refresh-token',
    expires_at: 1893456000,
    user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'tomor@example.com' },
  },
};

function makeMockSupabase(): unknown {
  appleCalls = [];
  const auth: MockSupabaseAuth = {
    signInWithIdToken: async (args) => {
      appleCalls.push({ provider: args.provider, token: args.token });
      const next = nextResult;
      if (next.kind === 'ok') {
        return { data: { session: next.session }, error: null };
      }
      if (next.kind === 'error') {
        return { data: null, error: { message: next.message } };
      }
      throw new Error(next.message);
    },
  };
  // The route uses only `client.auth.signInWithIdToken` — `from` is not
  // called by this endpoint, but other tests in the suite need it; supply
  // a chain that returns empty so accidental future calls don't throw.
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    auth,
    from: () => chain,
  };
}

beforeAll(async () => {
  const app = buildApp({
    supabase: makeMockSupabase() as never,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => {
  // Each test starts with a clean call log and a default OK session so
  // tests that override `nextResult` are isolated from prior state.
  appleCalls = [];
  nextResult = {
    kind: 'ok',
    session: {
      access_token: 'fake-apple-access-token',
      refresh_token: 'fake-apple-refresh-token',
      expires_at: 1893456000,
      user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'tomor@example.com' },
    },
  };
});

const postApple = (body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/agent/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /agent/auth/apple', () => {
  it('returns 400 when identity_token is missing', async () => {
    const res = await postApple({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('identity_token required');
    expect(appleCalls).toEqual([]);
  });

  it('returns 400 when identity_token is an empty string', async () => {
    const res = await postApple({ identity_token: '' });
    expect(res.status).toBe(400);
    expect(appleCalls).toEqual([]);
  });

  it('returns 400 when identity_token is not a string', async () => {
    const res = await postApple({ identity_token: 12345 });
    expect(res.status).toBe(400);
    expect(appleCalls).toEqual([]);
  });

  it('returns 401 when Supabase rejects the identity_token', async () => {
    nextResult = { kind: 'error', message: 'invalid signature' };
    const res = await postApple({ identity_token: VALID_TOKEN });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_identity_token');
    expect(body.message).toBe('invalid signature');
    expect(appleCalls).toEqual([{ provider: 'apple', token: VALID_TOKEN }]);
  });

  it('returns 200 with the session shape on a valid identity_token', async () => {
    nextResult = {
      kind: 'ok',
      session: {
        access_token: 'apple-access-xyz',
        refresh_token: 'apple-refresh-xyz',
        expires_at: 1893456000,
        user: { id: '11111111-2222-3333-4444-555555555555', email: 'tomor@example.com' },
      },
    };
    const res = await postApple({ identity_token: VALID_TOKEN, full_name: 'Tomor Gashi' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe('apple-access-xyz');
    expect(body.refresh_token).toBe('apple-refresh-xyz');
    expect(body.expires_at).toBe(1893456000);
    expect(body.user).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      email: 'tomor@example.com',
    });
    // Forwards the token to Supabase with provider='apple' — that's the
    // whole point: we never validate the JWT ourselves, Supabase does.
    expect(appleCalls).toEqual([{ provider: 'apple', token: VALID_TOKEN }]);
  });

  it('returns 200 even when session.user is missing (edge case)', async () => {
    nextResult = {
      kind: 'ok',
      session: {
        access_token: 'a',
        refresh_token: 'r',
        expires_at: 0,
        user: null,
      },
    };
    const res = await postApple({ identity_token: VALID_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe('a');
    expect(body.user).toBeNull();
  });

  it('returns 500 when Supabase throws unexpectedly', async () => {
    nextResult = { kind: 'throw', message: 'network down' };
    const res = await postApple({ identity_token: VALID_TOKEN });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('apple_auth_failed');
    expect(body.message).toBe('network down');
  });

  it('does not require an Authorization header (public endpoint)', async () => {
    nextResult = {
      kind: 'ok',
      session: {
        access_token: 'public-access',
        refresh_token: 'public-refresh',
        expires_at: 1,
        user: { id: '00000000-0000-0000-0000-000000000099', email: null },
      },
    };
    // No Authorization header — should still 200, not 401.
    const res = await postApple({ identity_token: VALID_TOKEN });
    expect(res.status).toBe(200);
  });
});
