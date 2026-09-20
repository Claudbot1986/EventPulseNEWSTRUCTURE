/**
 * Wire test for POST /agent/push-token — storage of the Expo push token and
 * the per-user push toggles (`follow_push_enabled`, `din_helg_push_enabled`).
 *
 * Wires buildApp() to a free local port with a mocked Supabase client so the
 * route handler runs end-to-end without touching the network. Focus: wire
 * contract (field presence, boolean validation, read-modify-write merge that
 * preserves existing preference keys).
 *
 * S5 (2026-09-20): the body was extended with `din_helg_push_enabled` for the
 * weekly Din helg push.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const USER_ID = '00000000-0000-0000-0000-000000000001';

// Phase 1 auth: identity comes from the Bearer header. The test verifier
// resolves `test-jwt` to USER_ID; missing/wrong Bearer → 401.
const TEST_BEARER = 'test-jwt';
const bearerHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...extra,
  Authorization: `Bearer ${TEST_BEARER}`,
});
const testVerify = async (token: string) => (token === TEST_BEARER
  ? { id: USER_ID, email: 'test@example.com' }
  : null);

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

const state: {
  preferences: Record<string, unknown> | null;
  upserts: Array<{ preferences: Record<string, unknown> }>;
} = { preferences: null, upserts: [] };

function makeMockSupabase(): SupabaseClient {
  const handlers: any = {
    select: () => handlers,
    eq: () => handlers,
    maybeSingle: async () => {
      if (state.preferences === null) return { data: null, error: null };
      return { data: { preferences: state.preferences }, error: null };
    },
    upsert: async (payload: any) => {
      state.upserts.push(payload);
      state.preferences = payload.preferences;
      return { data: null, error: null };
    },
    then: undefined,
  };
  return {
    from: () => handlers,
  } as unknown as SupabaseClient;
}

const postPushToken = (body: unknown, withAuth = true) =>
  fetch(`${baseUrl}/agent/push-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(withAuth ? bearerHeaders() : {}),
    },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const app = buildApp({ supabase: makeMockSupabase(), verify: testVerify });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('POST /agent/push-token', () => {
  it('returns 401 on missing Bearer token (Phase 1 auth gate)', async () => {
    const res = await postPushToken({ push_token: 'ExponentPushToken[abc]' }, false);
    expect(res.status).toBe(401);
  });

  it('returns 400 when no known field is present', async () => {
    const res = await postPushToken({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('returns 400 when din_helg_push_enabled is not a boolean', async () => {
    const res = await postPushToken({ din_helg_push_enabled: 'yes' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('din_helg_push_enabled');
  });

  it('returns 400 when follow_push_enabled is not a boolean', async () => {
    const res = await postPushToken({ follow_push_enabled: 1 });
    expect(res.status).toBe(400);
  });

  it('stores the token + din_helg opt-in and reports both in `stored`', async () => {
    const res = await postPushToken({
      push_token: 'ExponentPushToken[abc123]',
      din_helg_push_enabled: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stored.has_push_token).toBe(true);
    expect(body.stored.din_helg_push_enabled).toBe(true);
    expect(body.stored.follow_push_enabled).toBe(false);

    const last = state.upserts.at(-1)!;
    expect(last.preferences.push_token).toBe('ExponentPushToken[abc123]');
    expect(last.preferences.din_helg_push_enabled).toBe(true);
    expect(last.preferences.updated_at_kind).toBe('push-token');
  });

  it('merges: toggling follow_push_enabled preserves din_helg + token', async () => {
    const res = await postPushToken({ follow_push_enabled: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored.follow_push_enabled).toBe(true);
    expect(body.stored.din_helg_push_enabled).toBe(true);
    expect(body.stored.has_push_token).toBe(true);

    const last = state.upserts.at(-1)!;
    expect(last.preferences.push_token).toBe('ExponentPushToken[abc123]');
    expect(last.preferences.din_helg_push_enabled).toBe(true);
    expect(last.preferences.follow_push_enabled).toBe(true);
  });

  it('treats an empty push_token string as null (token cleared)', async () => {
    const res = await postPushToken({ push_token: '   ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored.has_push_token).toBe(false);
    const last = state.upserts.at(-1)!;
    expect(last.preferences.push_token).toBeNull();
  });
});
