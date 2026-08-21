/**
 * Integration test: GET /agent/recommended wire format (T0056).
 *
 * Verifies:
 *   - Returns 200 with an events array when given a valid client_user_id
 *   - Returns 400 when client_user_id is missing or not a UUID
 *   - limit parameter caps the returned events
 *   - Returns 500 on DB error (catch block exercised)
 *
 * Run with: npx vitest run 08-Agent/tests/recommended_wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const TEST_UUID = 'c1c2c3c4-c5c6-c7c8-c9c0-c1c2c3c4c5c6';

function makeMockSupabase(opts: { eventCount?: number } = {}): SupabaseClient {
  const count = opts.eventCount ?? 5;
  const futureIso = '2099-01-01T19:30:00Z';

  const eventRows = Array.from({ length: count }).map((_, i) => ({
    id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${i.toString(16).padStart(2, '0')}`,
    title_sv: `Konsert ${i + 1}`,
    title_en: `Concert ${i + 1}`,
    description_sv: 'Musik i Stockholm.',
    description_en: 'Live music in Stockholm.',
    start_time: futureIso,
    end_time: null,
    venue_id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
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
  }));

  const venueRows = eventRows.map((_, i) => ({
    id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
    name: `Scen ${i + 1}`,
    city: 'Stockholm',
    address: 'Stockholm',
  }));

  let tableForCurrentChain: string | null = null;

  const chain: any = {
    select: (_cols: string) => chain,
    eq: (_col: string, _val: unknown) => chain,
    gt: (_col: string, _val: unknown) => chain,
    gte: (_col: string, _val: unknown) => chain,
    lte: (_col: string, _val: unknown) => chain,
    in: (_col: string, _vals: readonly unknown[]) => chain,
    order: (_col: string, _opts?: { ascending?: boolean }) => chain,
    limit: (_n: number) => chain,
    single: () => {
      // Single-row read: return first row of the current table (or null).
      let payload: unknown = null;
      if (tableForCurrentChain === 'venues') payload = venueRows[0] ?? null;
      else if (tableForCurrentChain === 'event_artists') payload = null;
      else if (
        tableForCurrentChain === 'user_preferences' ||
        tableForCurrentChain === 'user_interactions'
      ) {
        payload = null; // cold personalization
      } else if (tableForCurrentChain === 'events') {
        payload = eventRows[0] ?? null;
      }
      return new Promise<{ data: unknown; error: null }>((res) => {
        res({ data: payload, error: null });
      });
    },
    maybeSingle: () => {
      // Maybe-single: same as single but no error if no rows.
      let payload: unknown = null;
      if (tableForCurrentChain === 'venues') payload = venueRows[0] ?? null;
      else if (tableForCurrentChain === 'event_artists') payload = null;
      else if (
        tableForCurrentChain === 'user_preferences' ||
        tableForCurrentChain === 'user_interactions'
      ) {
        payload = null; // cold personalization
      } else if (tableForCurrentChain === 'events') {
        payload = eventRows[0] ?? null;
      }
      return new Promise<{ data: unknown; error: null }>((res) => {
        res({ data: payload, error: null });
      });
    },
    then: (
      resolve: (v: { data: unknown[]; error: null }) => void,
      _reject: (e: unknown) => void
    ) => {
      let payload: unknown[] = [];
      if (tableForCurrentChain === 'venues') payload = venueRows;
      else if (tableForCurrentChain === 'event_artists') payload = [];
      else if (
        tableForCurrentChain === 'user_preferences' ||
        tableForCurrentChain === 'user_interactions'
      ) {
        payload = []; // empty = cold personalization
      } else {
        payload = eventRows;
      }
      // NOTE: must CALL resolve — returning Promise.resolve here is a
      // Promise/A+ anti-pattern that hangs await (verified empirically).
      resolve({ data: payload, error: null });
    },
  };

  const insert = () => Promise.resolve({ error: null });

  const from = (table: string) => {
    tableForCurrentChain = table;
    if (
      table === 'user_interactions' ||
      table === 'outbound_clicks' ||
      table === 'notifications'
    ) {
      return { insert };
    }
    return chain;
  };

  return { from } as unknown as SupabaseClient;
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

beforeAll(async () => {
  const app = buildApp({ supabase: makeMockSupabase() });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('GET /agent/recommended — T0056', () => {
  it('returns 200 with an events array for a valid client_user_id', async () => {
    const res = await fetch(`${baseUrl}/agent/recommended?client_user_id=${TEST_UUID}`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('returns 400 when client_user_id is missing', async () => {
    const res = await fetch(`${baseUrl}/agent/recommended`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when client_user_id is not a UUID', async () => {
    const res = await fetch(`${baseUrl}/agent/recommended?client_user_id=not-a-uuid`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('client_user_id must be a uuid');
  });

  it('respects the limit parameter (default 10, max 20)', async () => {
    const res = await fetch(
      `${baseUrl}/agent/recommended?client_user_id=${TEST_UUID}&limit=3`
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.events.length).toBeLessThanOrEqual(3);
  });

  it('caps limit at 20', async () => {
    const res = await fetch(
      `${baseUrl}/agent/recommended?client_user_id=${TEST_UUID}&limit=999`
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.events.length).toBeLessThanOrEqual(20);
  });

  it('returns 500 on a DB error', async () => {
    const brokenApp = buildApp({
      supabase: {
        from: () => ({
          select: () => ({
            then: (_: any, reject: (e: any) => void) => reject(new Error('db error')),
          }),
        }),
      } as unknown as SupabaseClient,
    });
    const srv = await new Promise<ReturnType<ReturnType<typeof buildApp>['listen']>>((resolve, reject) => {
      const s = brokenApp.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    const addr = srv.address() as AddressInfo;
    const res = await fetch(
      `http://127.0.0.1:${addr.port}/agent/recommended?client_user_id=${TEST_UUID}`
    );
    expect(res.status).toBe(500);
    await new Promise<void>((r) => srv.close(r));
  });
});
