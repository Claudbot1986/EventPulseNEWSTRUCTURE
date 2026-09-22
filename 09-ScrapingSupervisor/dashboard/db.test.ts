/**
 * db.test.ts — collectAnalyticsEvents (Fas B: EN databas).
 *
 * The dashboard reads 10-Analytics' Supabase `analytics_events` table as
 * the PRIMARY source for the user-activity panel; runtime/events.jsonl is
 * the fallback. Contract under test (errors-as-data):
 *   - unconfigured Supabase     → []
 *   - query failure             → [] (caller's JSONL fallback stands)
 *   - happy path                → rows ordered by ts
 *   - >1000 rows                → paginated past the PostgREST cap
 *
 * Client injected via _setDbForTests (env-derived db() may point at the
 * real database in local dev — tests must never depend on it).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { _setDbForTests, collectAnalyticsEvents, type AnalyticsEventRow } from './db';
import { makeFakeSupabase, type FakeRow } from '../../10-Analytics/tests/fakeSupabase.js';

function row(partial: Partial<FakeRow> = {}): FakeRow {
  return {
    event_type: 'session_start',
    page: 'app',
    payload: {},
    device_id_hash: 'a'.repeat(64),
    session_id: 's1',
    ts: '2026-09-22T10:00:00.000Z',
    received_at: '2026-09-22T10:00:00.000Z',
    ...partial,
  };
}

beforeEach(() => {
  // Reset between tests; every test injects its own client before calling.
  _setDbForTests(null);
});

describe('collectAnalyticsEvents — errors-as-data', () => {
  it('unconfigured Supabase → []', async () => {
    expect(await collectAnalyticsEvents()).toEqual([]);
  });

  it('happy path → rows ordered by ts', async () => {
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...row({ event_type: 'tile_tap', ts: '2026-09-22T09:00:00.000Z' }), id: 1 },
      { ...row({ event_type: 'event_save', ts: '2026-09-21T09:00:00.000Z' }), id: 2 },
    );
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    const rows = await collectAnalyticsEvents();
    expect(rows.map((r) => r.event_type)).toEqual(['event_save', 'tile_tap']);
  });

  it('select failure → [] so the JSONL fallback stands', async () => {
    const fake = makeFakeSupabase({ failSelect: true });
    fake.__rows.push({ ...row(), id: 1 });
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    expect(await collectAnalyticsEvents()).toEqual([]);
  });

  it('paginates past the PostgREST 1000-row cap', async () => {
    const fake = makeFakeSupabase();
    const base = Date.UTC(2026, 8, 22);
    for (let i = 0; i < 1002; i++) {
      fake.__rows.push({
        ...row({ ts: new Date(base + i * 1000).toISOString() }),
        id: i + 1,
      });
    }
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    const rows = await collectAnalyticsEvents();
    expect(rows).toHaveLength(1002);
  });
});