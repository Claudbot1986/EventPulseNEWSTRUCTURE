/**
 * Cross-user isolation test — Fas 4 / Phase 1 auth.
 *
 * Goal: prove that GET /agent/saved (and by extension every user-scoped
 * endpoint that derives the user from `req.user.id`) cannot leak data
 * across users. The Supabase RLS policies are in place (see
 * 05-Supabase/migrations/20260818-0001-agent-event-graph.sql lines 154-167,
 * 194-202, 221-227 + every per-table policy in 20260821/22-xx); this test
 * exercises the *application-level* contract that backs those policies:
 * the user id passed into the data layer is always the JWT-verified one,
 * never a client-supplied body/query field.
 *
 * Method:
 *   - Two simulated users, A and B.
 *   - The mock Supabase client records the `client_user_id` filter it
 *     receives on every `user_interactions` query, AND seeds a saved
 *     event for A only.
 *   - User A's Bearer token → /agent/saved returns A's event, and the
 *     recorded filter equals A's id.
 *   - User B's Bearer token → /agent/saved returns [] (empty), and the
 *     recorded filter equals B's id (not A's). Even if the client
 *     appended `?client_user_id=<A>` to the URL, the server ignores it.
 *   - Missing/invalid Bearer → 401 (no leak possible).
 *
 * No real Supabase — this is the application contract test. Real RLS
 * isolation is verified by the SQL policies plus a manual staging
 * exercise (run after deploy with two real test users and the anon key).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT_A_ONLY = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

const TEST_BEARER_A = 'jwt-a';
const TEST_BEARER_B = 'jwt-b';
const bearerFor = (userId: string): string => (userId === USER_A ? TEST_BEARER_A : TEST_BEARER_B);

const bearerHeaders = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
  ...extra,
  Authorization: `Bearer ${token}`,
});

const testVerify = async (token: string) => {
  if (token === TEST_BEARER_A) return { id: USER_A, email: 'a@example.com' };
  if (token === TEST_BEARER_B) return { id: USER_B, email: 'b@example.com' };
  return null;
};

/**
 * Mock Supabase that simulates the RLS-relevant slice of the data layer:
 *   - `user_interactions` SELECT: filters by the supplied `client_user_id`
 *     and returns rows seeded for that exact user only. Other users get [].
 *   - records every received filter so the test can assert what the server
 *     actually queried.
 *   - everything else: empty success.
 */
function makeIsolationMock(): { supabase: SupabaseClient; recordedFilters: { table: string; clientUserId: string | null }[] } {
  const recordedFilters: { table: string; clientUserId: string | null }[] = [];

  // user_interactions rows seeded for USER_A only.
  const aRows: unknown[] = [
    {
      id: 'interaction-1',
      created_at: '2099-01-01T00:00:00Z',
      events: {
        id: EVENT_A_ONLY,
        title_sv: 'A:s konsert',
        title_en: "A's concert",
        start_time: '2099-02-01T19:30:00Z',
        end_time: null,
        venue_id: 'dddddddd-dddd-dddd-dddd-dddddddddd01',
        category_slug: 'music',
        is_free: false,
        price_min_sek: 100,
        price_max_sek: 200,
        ticket_url: 'https://example.com/a',
        image_url: null,
        source: 'test',
        venues: { name: 'Scen A', city: 'Stockholm' },
      },
    },
  ];

  // Chain that tracks every .eq('client_user_id', X) call.
  const makeChain = (table: string) => {
    let pendingClientUserId: string | null = null;

    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'client_user_id' && typeof val === 'string') {
          pendingClientUserId = val;
        }
        return chain;
      },
      gte: () => chain,
      lte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        // Record on terminal read.
        recordedFilters.push({ table, clientUserId: pendingClientUserId });
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        recordedFilters.push({ table, clientUserId: pendingClientUserId });
        return Promise.resolve({ data: null, error: null });
      },
      then: (
        resolve: (v: { data: unknown[]; error: null }) => void,
        _reject: (e: unknown) => void
      ) => {
        recordedFilters.push({ table, clientUserId: pendingClientUserId });

        let payload: unknown[] = [];
        if (table === 'user_interactions') {
          // RLS-style filter: only USER_A's seeded rows are visible, and
          // ONLY when the queried user_id equals USER_A. This is exactly
          // what Supabase RLS gives us in production — the test exercises
          // that contract at the mock level.
          payload = pendingClientUserId === USER_A ? aRows : [];
        }
        resolve({ data: payload, error: null });
      },
    };
    return chain;
  };

  const from = (table: string) => {
    if (table === 'user_interactions' || table === 'outbound_clicks' || table === 'notifications') {
      // user_interactions has the read path; the others only insert.
      if (table === 'user_interactions') return makeChain(table);
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    }
    return makeChain(table);
  };

  return {
    supabase: { from } as unknown as SupabaseClient,
    recordedFilters,
  };
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;
let recordedFilters: { table: string; clientUserId: string | null }[] = [];

beforeAll(async () => {
  const mock = makeIsolationMock();
  recordedFilters = mock.recordedFilters;
  const app = buildApp({ supabase: mock.supabase, verify: testVerify });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('GET /agent/saved — cross-user isolation (Fas 4)', () => {
  it('returns 401 on missing Bearer — no data leaked before auth', async () => {
    recordedFilters.length = 0;
    const res = await fetch(`${baseUrl}/agent/saved`);
    expect(res.status).toBe(401);
    // The handler must NOT have queried the data layer.
    expect(recordedFilters).toEqual([]);
  });

  it('returns 401 on an unknown Bearer — same guarantee', async () => {
    recordedFilters.length = 0;
    const res = await fetch(`${baseUrl}/agent/saved`, {
      headers: bearerHeaders('jwt-nobody'),
    });
    expect(res.status).toBe(401);
    expect(recordedFilters).toEqual([]);
  });

  it("returns USER_A's saved events when A presents their Bearer", async () => {
    recordedFilters.length = 0;
    const res = await fetch(`${baseUrl}/agent/saved`, {
      headers: bearerHeaders(bearerFor(USER_A)),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(1);
    expect(body.events[0].id).toBe(EVENT_A_ONLY);

    // The data layer was queried with USER_A's id — proving the filter
    // matches the verified JWT identity.
    const uiQuery = recordedFilters.find((f) => f.table === 'user_interactions');
    expect(uiQuery).toBeDefined();
    expect(uiQuery?.clientUserId).toBe(USER_A);
  });

  it("returns empty events when USER_B presents their Bearer — even though A has saved events", async () => {
    recordedFilters.length = 0;
    const res = await fetch(`${baseUrl}/agent/saved`, {
      headers: bearerHeaders(bearerFor(USER_B)),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    // RLS / mock filter: USER_B sees nothing — A's rows are filtered out.
    expect(body.events.length).toBe(0);

    // And the recorded filter MUST be USER_B — not USER_A from any client
    // input. If the server had trusted a body/query field instead of
    // req.user.id, the recorded clientUserId would be USER_A.
    const uiQuery = recordedFilters.find((f) => f.table === 'user_interactions');
    expect(uiQuery).toBeDefined();
    expect(uiQuery?.clientUserId).toBe(USER_B);
    expect(uiQuery?.clientUserId).not.toBe(USER_A);
  });

  it('ignores a query-string client_user_id — only the JWT-verified id is used', async () => {
    recordedFilters.length = 0;
    // A tries to read USER_A's events by appending ?client_user_id=<USER_A>.
    // The server must still query the data layer with USER_B's id (the
    // verified JWT), so USER_B sees their (empty) result, not A's data.
    const url = `${baseUrl}/agent/saved?client_user_id=${USER_A}`;
    const res = await fetch(url, {
      headers: bearerHeaders(bearerFor(USER_B)),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(0);

    const uiQuery = recordedFilters.find((f) => f.table === 'user_interactions');
    expect(uiQuery?.clientUserId).toBe(USER_B);
  });
});