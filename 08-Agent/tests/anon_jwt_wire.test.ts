/**
 * Anonymous-JWT wire test — NOW#1 (guest taste-first, server side).
 *
 * Context: Supabase anonymous sign-ins are enabled (2026-09-20, verified by
 * scripts/smoke-anon-signin.mjs). An anonymous sign-in produces a REAL
 * auth.users.id + a Bearer JWT (is_anonymous claim). `requireUser` verifies
 * via supabase.auth.getUser(token) and makes no anon/permanent distinction,
 * so all five guest-relevant endpoints already accept the anon JWT as-is.
 *
 * This suite proves that contract at the wire level for the five endpoints
 * NOW#1 names: /agent/feedback, /agent/preferences, /agent/saved,
 * /agent/recommended, /agent/cached-recommendations.
 *
 * Method (mirrors rls_isolation_wire.test.ts):
 *   - testVerify maps 'anon-jwt' → a guest user id shaped like an anonymous
 *     sign-in (email null).
 *   - The mock Supabase records every client_user_id filter AND every
 *     insert/upsert payload, so the test can assert identity propagation:
 *     the guest's auth.users.id is what flows into the data layer — never a
 *     client-supplied body/query field.
 *   - Round-trip realism: rows the guest inserts via /agent/feedback become
 *     the rows /agent/saved and buildUserSignal (via /agent/recommended)
 *     read back — the mock only serves them to the same client_user_id.
 *
 * Real-DB RLS proof of the same pattern: scripts/verify-user-preferences-rls.mjs
 * (live, run 2026-09-20, 7/7 PASS) + migration 20260920-0001.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const GUEST_UUID = '56e3db22-0000-4000-8000-000000000001'; // anonymous sign-in shape
const ANON_BEARER = 'anon-jwt';

const bearerHeaders = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
  ...extra,
  Authorization: `Bearer ${token}`,
});

const testVerify = async (token: string) =>
  token === ANON_BEARER ? { id: GUEST_UUID, email: null } : null; // anonymous users have no email

type RecordedWrite = { table: string; op: 'insert' | 'upsert'; row: Record<string, unknown>; opts?: Record<string, unknown> };
type RecordedFilter = { table: string; clientUserId: string | null };

const FUTURE = '2099-02-01T19:30:00Z';
const eventFixture = (i: number) => ({
  id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa${i.toString(16).padStart(2, '0')}`,
  title_sv: `Konsert ${i + 1}`,
  title_en: `Concert ${i + 1}`,
  description_sv: 'Musik i Stockholm.',
  description_en: 'Live music in Stockholm.',
  start_time: FUTURE,
  end_time: null,
  venue_id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
  is_free: false,
  price_min_sek: 200,
  price_max_sek: 300,
  ticket_url: `https://example.com/event-${i}`,
  image_url: null,
  image_license: null,
  image_attribution: null,
  image_source_url: null,
  category_slug: 'music',
  confidence_score: 85,
  freshness_at: new Date().toISOString(),
  status_expanded: 'scheduled',
  source: 'test',
});
const venueFixture = (i: number) => ({
  id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
  name: `Scen ${i + 1}`,
  city: 'Stockholm',
  address: 'Stockholm',
});

function makeGuestMock(opts: { cachedRow?: Record<string, unknown> | null } = {}) {
  const recordedWrites: RecordedWrite[] = [];
  const recordedFilters: RecordedFilter[] = [];
  const eventRows = [0, 1, 2].map(eventFixture);
  const venueRows = [0, 1, 2].map(venueFixture);

  const makeChain = (table: string) => {
    let pendingClientUserId: string | null = null;

    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'client_user_id' && typeof val === 'string') pendingClientUserId = val;
        return chain;
      },
      gt: () => chain,
      gte: () => chain,
      lte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (row: Record<string, unknown>) => {
        recordedWrites.push({ table, op: 'insert', row });
        return Promise.resolve({ error: null });
      },
      upsert: (row: Record<string, unknown>, upsertOpts?: Record<string, unknown>) => {
        recordedWrites.push({ table, op: 'upsert', row, opts: upsertOpts });
        return Promise.resolve({ error: null });
      },
      single: () => {
        recordedFilters.push({ table, clientUserId: pendingClientUserId });
        return Promise.resolve({ data: singleRowFor(table, pendingClientUserId), error: null });
      },
      maybeSingle: () => {
        recordedFilters.push({ table, clientUserId: pendingClientUserId });
        return Promise.resolve({ data: singleRowFor(table, pendingClientUserId), error: null });
      },
      then: (
        resolve: (v: { data: unknown[]; error: null }) => void,
        _reject: (e: unknown) => void
      ) => {
        recordedFilters.push({ table, clientUserId: pendingClientUserId });
        resolve({ data: listRowsFor(table, pendingClientUserId), error: null });
      },
    };
    return chain;
  };

  // The guest's own preference row appears only after their upsert, and only
  // to THEIR id — mirroring the owner-only RLS now on user_preferences.
  const guestPrefsRow = (uid: string | null) =>
    recordedWrites.find(
      (w) => w.table === 'user_preferences' && w.row.client_user_id === uid
    )?.row ?? null;

  const singleRowFor = (table: string, uid: string | null): unknown => {
    if (table === 'user_preferences') return guestPrefsRow(uid);
    if (table === 'cached_recommendations') {
      if (!opts.cachedRow) return null;
      if (opts.cachedRow.client_user_id !== uid) return null;
      return opts.cachedRow;
    }
    if (table === 'venues') return venueRows[0] ?? null;
    if (table === 'events' || table === 'events_public') return eventRows[0] ?? null;
    return null; // user_signal_weights, event_artists, ...
  };

  const listRowsFor = (table: string, uid: string | null): unknown[] => {
    if (table === 'user_interactions') {
      // Round-trip: only saves the SAME user wrote earlier are visible.
      return recordedWrites
        .filter(
          (w) =>
            w.table === 'user_interactions' &&
            w.row.client_user_id === uid &&
            w.row.interaction === 'save'
        )
        .map((w, i) => ({
          id: `interaction-${i}`,
          created_at: FUTURE,
          event_id: w.row.event_id,
          interaction: 'save',
          events: { ...eventRows[0], venues: { name: 'Scen 1', city: 'Stockholm' } },
        }));
    }
    if (table === 'user_preferences') {
      const row = guestPrefsRow(uid);
      return row ? [row] : [];
    }
    if (table === 'venues') return venueRows;
    if (table === 'events' || table === 'events_public') return eventRows;
    return [];
  };

  const from = (table: string) => makeChain(table);
  return { supabase: { from } as unknown as SupabaseClient, recordedWrites, recordedFilters };
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;
let recordedWrites: RecordedWrite[] = [];
let recordedFilters: RecordedFilter[] = [];

beforeAll(async () => {
  const mock = makeGuestMock({
    cachedRow: {
      client_user_id: GUEST_UUID,
      slot_1_title: 'I helgen',
      slot_1_card_1: { event_id: eventFixture(0).id },
      slot_1_card_2: { event_id: eventFixture(1).id },
      slot_2_title: 'Gratis',
      slot_2_card_1: { event_id: eventFixture(2).id },
      slot_2_card_2: null,
      slot_3_title: null,
      slot_3_card_1: null,
      slot_3_card_2: null,
      generated_at: FUTURE,
    },
  });
  recordedWrites = mock.recordedWrites;
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

describe('anonymous JWT — NOW#1 guest endpoints', () => {
  it('401 on missing Bearer for all five endpoints — zero data-layer calls', async () => {
    recordedWrites.length = 0;
    recordedFilters.length = 0;
    const targets: [string, string][] = [
      ['POST', '/agent/feedback'],
      ['POST', '/agent/preferences'],
      ['GET', '/agent/saved'],
      ['GET', '/agent/recommended'],
      ['GET', '/agent/cached-recommendations'],
    ];
    for (const [method, path] of targets) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status).toBe(401);
    }
    expect(recordedWrites).toEqual([]);
    expect(recordedFilters).toEqual([]);
  });

  it('401 on an unknown Bearer — guest data unreachable without a verified JWT', async () => {
    recordedWrites.length = 0;
    recordedFilters.length = 0;
    const res = await fetch(`${baseUrl}/agent/saved`, { headers: bearerHeaders('jwt-nobody') });
    expect(res.status).toBe(401);
    expect(recordedWrites).toEqual([]);
    expect(recordedFilters).toEqual([]);
  });

  it('POST /agent/feedback: guest save persists under the anon auth.users.id', async () => {
    const res = await fetch(`${baseUrl}/agent/feedback`, {
      method: 'POST',
      headers: bearerHeaders(ANON_BEARER, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        client_user_id: 'client-supplied-garbage-must-be-ignored',
        event_id: eventFixture(0).id,
        interaction: 'save',
      }),
    });
    expect(res.status).toBe(200);
    const write = recordedWrites.find((w) => w.table === 'user_interactions' && w.row.interaction === 'save');
    expect(write).toBeDefined();
    expect(write?.row.client_user_id).toBe(GUEST_UUID);
  });

  it('POST /agent/preferences: guest categories upsert keyed on the anon auth.users.id', async () => {
    const res = await fetch(`${baseUrl}/agent/preferences`, {
      method: 'POST',
      headers: bearerHeaders(ANON_BEARER, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ categories: ['music', 'art'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const write = recordedWrites.find((w) => w.table === 'user_preferences' && w.op === 'upsert');
    expect(write).toBeDefined();
    expect(write?.row.client_user_id).toBe(GUEST_UUID);
    expect(write?.opts?.onConflict).toBe('client_user_id');
  });

  it('GET /agent/saved: guest reads back exactly their own saves', async () => {
    const res = await fetch(`${baseUrl}/agent/saved`, { headers: bearerHeaders(ANON_BEARER) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(1); // the save from the feedback step
    expect(body.events[0].id).toBe(eventFixture(0).id);
    const read = recordedFilters.filter((f) => f.table === 'user_interactions').pop();
    expect(read?.clientUserId).toBe(GUEST_UUID);
  });

  it('GET /agent/recommended: guest with signal gets 200 + events (non-cold path exercised)', async () => {
    const res = await fetch(`${baseUrl}/agent/recommended`, { headers: bearerHeaders(ANON_BEARER) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    const signalReads = recordedFilters.filter((f) => f.table === 'user_interactions');
    expect(signalReads.some((f) => f.clientUserId === GUEST_UUID)).toBe(true);
  });

  it('GET /agent/cached-recommendations: guest with a cached row gets 200', async () => {
    const res = await fetch(`${baseUrl}/agent/cached-recommendations`, { headers: bearerHeaders(ANON_BEARER) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.slots)).toBe(true);
    const read = recordedFilters.filter((f) => f.table === 'cached_recommendations').pop();
    expect(read?.clientUserId).toBe(GUEST_UUID);
  });

  it('GET /agent/cached-recommendations: 404 when the guest has no cached row', async () => {
    const noCache = makeGuestMock({ cachedRow: null });
    const app = buildApp({ supabase: noCache.supabase, verify: testVerify });
    const srv = await new Promise<ReturnType<ReturnType<typeof buildApp>['listen']>>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    const addr = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/agent/cached-recommendations`, {
      headers: bearerHeaders(ANON_BEARER),
    });
    expect(res.status).toBe(404);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
