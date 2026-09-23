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
import {
  _setDbForTests,
  collectAnalyticsEvents,
  collectUserInteractions,
  summarizeUserInteractions,
  summarizeTileTaps,
  type AnalyticsEventRow,
  type UserInteractionRow,
} from './db';
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

// ── Fas E: user_interactions (08-Agent feedback-API) + KPI summaries ────────

function irow(partial: Partial<UserInteractionRow> = {}): UserInteractionRow {
  return {
    interaction: 'impression',
    client_user_id: 'u1',
    query_text: null,
    metadata: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

const H = 3600_000;

function hoursAgo(now: Date, h: number): string {
  return new Date(now.getTime() - h * H).toISOString();
}

describe('collectUserInteractions — errors-as-data (Fas E)', () => {
  it('unconfigured Supabase → []', async () => {
    expect(await collectUserInteractions()).toEqual([]);
  });

  it('happy path → rows ordered by created_at', async () => {
    const fake = makeFakeSupabase();
    fake.__interactionRows.push(
      { ...irow({ created_at: '2026-09-22T09:00:00.000Z' }), id: 1 },
      { ...irow({ interaction: 'save', created_at: '2026-09-21T09:00:00.000Z' }), id: 2 },
    );
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    const rows = await collectUserInteractions();
    expect(rows.map((r) => r.interaction)).toEqual(['save', 'impression']); // ascending by created_at
  });

  it('select failure → []', async () => {
    const fake = makeFakeSupabase({ failSelect: true });
    fake.__interactionRows.push({ ...irow(), id: 1 });
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    expect(await collectUserInteractions()).toEqual([]);
  });

  it('paginates past the PostgREST 1000-row cap', async () => {
    const fake = makeFakeSupabase();
    const base = Date.UTC(2026, 8, 22);
    for (let i = 0; i < 1002; i++) {
      fake.__interactionRows.push({
        ...irow({ created_at: new Date(base + i * 1000).toISOString() }),
        id: i + 1,
      });
    }
    // Cross-package fake (10-Analytics ships its own supabase-js) — the
    // cast is nominal-only; the shape is checked by the tests themselves.
    _setDbForTests(fake as unknown as SupabaseClient);
    const rows = await collectUserInteractions();
    expect(rows).toHaveLength(1002);
  });
});

describe('summarizeUserInteractions — pure KPI aggregation (Fas E)', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  // Machine-TZ-independent "now" for the local-date series test.
  const nowLocal = new Date();

  it('activeUsers7d counts distinct client_user_id within 7 days only', () => {
    const rows = [
      irow({ client_user_id: 'u1', created_at: hoursAgo(now, 1) }),
      irow({ client_user_id: 'u2', interaction: 'save', created_at: hoursAgo(now, 24) }),
      irow({ client_user_id: 'u3', created_at: hoursAgo(now, 24 * 8) }), // 8 days ago: outside
      irow({ client_user_id: null, created_at: hoursAgo(now, 1) }), // no id: never counted
    ];
    const s = summarizeUserInteractions(rows, now);
    expect(s.activeUsers7d).toBe(2);
    expect(s.totalRows).toBe(4);
  });

  it('byType counts interactions within the 30-day window only', () => {
    const rows = [
      irow({ created_at: hoursAgo(now, 1) }),
      irow({ interaction: 'save', created_at: hoursAgo(now, 2) }),
      irow({ interaction: 'outbound', created_at: hoursAgo(now, 24 * 31) }), // outside
    ];
    const s = summarizeUserInteractions(rows, now);
    expect(s.byType).toEqual({ impression: 1, save: 1 });
    expect(s.totalRows).toBe(3);
  });

  it('dwellBySource groups metadata.source; missing source → unset', () => {
    const rows = [
      irow({ interaction: 'dwell', metadata: { source: 'card_hold' }, created_at: hoursAgo(now, 1) }),
      irow({ interaction: 'dwell', metadata: { source: 'card_hold' }, created_at: hoursAgo(now, 2) }),
      irow({ interaction: 'dwell', metadata: { source: 'list_view' }, created_at: hoursAgo(now, 3) }),
      irow({ interaction: 'dwell', metadata: null, created_at: hoursAgo(now, 4) }),
      irow({ interaction: 'dwell', metadata: { source: 'card_hold' }, created_at: hoursAgo(now, 24 * 31) }),
    ];
    const s = summarizeUserInteractions(rows, now);
    expect(s.dwellBySource).toEqual({ card_hold: 2, list_view: 1, unset: 1 });
  });

  it('chatQueriesDaily = distinct (local day, user, query) groups, 30 entries', () => {
    // Anchor rows to real local midnights so grouping holds in any timezone.
    const todayMidnight = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
    const yesterday23 = new Date(todayMidnight.getTime() - H); // yesterday 23:00 local
    const rows = [
      irow({ client_user_id: 'u1', query_text: 'jazz ikväll?', created_at: todayMidnight.toISOString() }),
      irow({ client_user_id: 'u1', query_text: 'jazz ikväll?', created_at: new Date(todayMidnight.getTime() + H).toISOString() }),
      irow({ client_user_id: 'u2', query_text: 'jazz ikväll?', created_at: new Date(todayMidnight.getTime() + 2 * H).toISOString() }),
      irow({ client_user_id: 'u1', query_text: 'konserter?', created_at: new Date(todayMidnight.getTime() + 3 * H).toISOString() }),
      irow({ client_user_id: 'u1', query_text: 'gratis i helgen?', created_at: yesterday23.toISOString() }),
      irow({ client_user_id: 'u1', query_text: null, created_at: todayMidnight.toISOString() }), // no query
      irow({ interaction: 'click', client_user_id: 'u1', query_text: 'klick?', created_at: todayMidnight.toISOString() }), // not impression
    ];
    const s = summarizeUserInteractions(rows, nowLocal);
    expect(s.chatQueriesDaily).toHaveLength(30);
    expect(s.chatQueriesDaily[29].queries).toBe(3); // today: (u1,jazz) (u2,jazz) (u1,konserter)
    expect(s.chatQueriesDaily[28].queries).toBe(1); // yesterday: (u1,gratis)
  });

  it('rows with malformed created_at count toward totalRows only', () => {
    const rows = [irow({ created_at: 'not-a-date' }), irow({ created_at: hoursAgo(now, 1) })];
    const s = summarizeUserInteractions(rows, now);
    expect(s.totalRows).toBe(2);
    expect(s.byType).toEqual({ impression: 1 });
    expect(s.activeUsers7d).toBe(1);
    expect(s.chatQueriesDaily.every((d) => d.queries === 0)).toBe(true);
  });

  it('empty rows → zeroed summary with a flat 30-day series', () => {
    const s = summarizeUserInteractions([], now);
    expect(s.totalRows).toBe(0);
    expect(s.activeUsers7d).toBe(0);
    expect(s.byType).toEqual({});
    expect(s.dwellBySource).toEqual({});
    expect(s.chatQueriesDaily).toHaveLength(30);
    expect(s.chatQueriesDaily.every((d) => d.queries === 0)).toBe(true);
  });
});

describe('summarizeTileTaps — Utforska-tile-tryck per ord (Fas E)', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('counts tile_tap payload.word within the 30-day window', () => {
    const rows = [
      row({ event_type: 'tile_tap', payload: { word: 'helg' }, ts: hoursAgo(now, 1), received_at: hoursAgo(now, 1) }),
      row({ event_type: 'tile_tap', payload: { word: 'helg' }, ts: hoursAgo(now, 2), received_at: hoursAgo(now, 2) }),
      row({ event_type: 'tile_tap', payload: { word: 'skratt' }, ts: hoursAgo(now, 3), received_at: hoursAgo(now, 3) }),
      row({ event_type: 'tile_tap', payload: { word: 'gammal' }, ts: hoursAgo(now, 24 * 31), received_at: hoursAgo(now, 24 * 31) }),
    ];
    expect(summarizeTileTaps(rows, now)).toEqual({ helg: 2, skratt: 1 });
  });

  it('ignores other event types and tile_tap rows without a usable word', () => {
    const rows = [
      row({ event_type: 'event_save', payload: { word: 'helg' }, ts: hoursAgo(now, 1), received_at: hoursAgo(now, 1) }),
      row({ event_type: 'tile_tap', payload: undefined, ts: hoursAgo(now, 1), received_at: hoursAgo(now, 1) }),
      row({ event_type: 'tile_tap', payload: {}, ts: hoursAgo(now, 1), received_at: hoursAgo(now, 1) }),
      row({ event_type: 'tile_tap', payload: { word: '   ' }, ts: hoursAgo(now, 1), received_at: hoursAgo(now, 1) }),
    ];
    expect(summarizeTileTaps(rows, now)).toEqual({});
  });
});