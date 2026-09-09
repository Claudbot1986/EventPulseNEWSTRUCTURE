/**
 * Wire test for /agent/follow (POST + GET) — T0050 / MVP-gap §77.
 *
 * Wires buildApp() to a free local port with a mocked Supabase client so
 * the new route handlers run end-to-end without touching the network.
 *
 * Focus: wire contract (uuid validation, action enum, status codes).
 * The detailed data-flow logic (followVenue, unfollowVenue,
 * loadFollowedVenues) is covered in follow_entity.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const VENUE_A = '11111111-1111-1111-1111-111111111111';
const VENUE_B = '22222222-2222-2222-2222-222222222222';

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

function makeMockSupabase(): SupabaseClient {
  const state: { preferences: Record<string, unknown> | null; upserts: unknown[] } = {
    preferences: null,
    upserts: [],
  };
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

describe('POST /agent/follow', () => {
  it('returns 401 on missing Bearer token (Phase 1 auth gate)', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: VENUE_A, action: 'follow' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on bad venue_id', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: 'bad', action: 'follow' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on unknown action', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_A, action: 'like' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with added:true on first follow', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_A, action: 'follow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('follow');
    expect(body.added).toBe(true);
    expect(body.count).toBe(1);
  });

  it('returns 200 with added:false when the venue is already followed (idempotent)', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_A, action: 'follow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.added).toBe(false);
    expect(body.count).toBe(1);
  });

  it('returns 200 with removed:true on unfollow', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_A, action: 'unfollow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('unfollow');
    expect(body.removed).toBe(true);
    expect(body.count).toBe(0);
  });

  it('returns 200 with removed:false when the venue is not followed (idempotent)', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_B, action: 'unfollow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(false);
    expect(body.count).toBe(0);
  });
});

describe('GET /agent/follow', () => {
  it('returns 401 on missing Bearer token (Phase 1 auth gate)', async () => {
    const res = await fetch(`${baseUrl}/agent/follow`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with the followed venue ids', async () => {
    await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_A, action: 'follow' }),
    });
    await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ venue_id: VENUE_B, action: 'follow' }),
    });
    const res = await fetch(`${baseUrl}/agent/follow`, {
      headers: bearerHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.counts.venues).toBe(2);
    expect(body.counts.total).toBe(2);
    expect(new Set(body.venue_ids)).toEqual(new Set([VENUE_A, VENUE_B]));
  });
});
