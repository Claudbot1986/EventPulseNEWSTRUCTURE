/**
 * Tests for feed_events — browse-window reader for the default-browse UI.
 *
 * Mocks the Supabase client. Validates date arithmetic, window bounds, the
 * +1 sentinel for has_more detection, and the canonical `total` count that
 * the UI header binds to.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { feedEvents, addDays, todayIso } from '../tools/feed_events';

function makeChain(rows: any[]) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: any[]; error: null }) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function makeCountChain(count: number) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    then: (resolve: (v: { count: number; data: null; error: null }) => void) =>
      Promise.resolve({ count, data: null, error: null }).then(resolve),
  };
  return chain;
}

/**
 * Two-call mock: feed_events issues a data query first, then a count query
 * (`head: true`). The first .from() call returns the data chain, the second
 * returns the count chain.
 */
function mockSupabase(rows: any[], totalCount: number): SupabaseClient {
  let call = 0;
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    return call === 1 ? makeChain(rows) : makeCountChain(totalCount);
  });
  return { from } as unknown as SupabaseClient;
}

/**
 * Backward-compat shim: existing tests that don't care about the count can
 * keep using `mockSupabaseWithRows(rows)`. The count defaults to 0 so a test
 * that also asserts `result.total === 0` will pass; new tests that need a
 * specific count should call `mockSupabase(rows, totalCount)` directly.
 */
function mockSupabaseWithRows(rows: any[]): SupabaseClient {
  return mockSupabase(rows, 0);
}

describe('addDays', () => {
  it('adds days correctly across months', () => {
    expect(addDays('2026-08-18', 7)).toBe('2026-08-25');
    expect(addDays('2026-08-30', 7)).toBe('2026-09-06');
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
  });
  it('returns input unchanged for invalid date', () => {
    expect(addDays('not-a-date', 7)).toBe('not-a-date');
  });
});

describe('todayIso', () => {
  it('returns YYYY-MM-DD shape', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('feedEvents', () => {
  const baseRow = (over: any = {}) => ({
    id: '11111111-1111-1111-1111-111111111111',
    title_sv: 'Testevent',
    title_en: 'Test Event',
    start_time: '2026-08-20T17:00:00+00:00',
    end_time: null,
    venue_id: '22222222-2222-2222-2222-222222222222',
    category_slug: 'music',
    is_free: false,
    price_min_sek: 100,
    price_max_sek: 200,
    ticket_url: null,
    image_url: null,
    venues: { name: 'Konserthuset', city: 'Stockholm' },
    ...over,
  });

  it('returns events within [from, from+days)', async () => {
    const sb = mockSupabaseWithRows([baseRow()]);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.from).toBe('2026-08-18');
    expect(result.to).toBe('2026-08-25');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].venue_name).toBe('Konserthuset');
    expect(result.events[0].city).toBe('Stockholm');
  });

  it('sets has_more when result is one row beyond limit', async () => {
    const rows = Array.from({ length: 51 }, () => baseRow());
    const sb = mockSupabaseWithRows(rows);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 50 });
    expect(result.events).toHaveLength(50);
    expect(result.has_more).toBe(true);
  });

  it('clears has_more when result fits within limit', async () => {
    const rows = Array.from({ length: 30 }, () => baseRow());
    const sb = mockSupabaseWithRows(rows);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 50 });
    expect(result.events).toHaveLength(30);
    expect(result.has_more).toBe(false);
  });

  it('throws on supabase error so a schema miss cannot look like an empty city', async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
        Promise.resolve({ data: null, error: { message: 'mock error' } }).then(resolve),
    };
    const sb = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    await expect(feedEvents(sb, { from: '2026-08-18', days: 7 })).rejects.toThrow(/feed_events: mock error/);
  });

  it('filters out rows whose venue city is null when caller passed a city', async () => {
    const sb = mockSupabaseWithRows([baseRow({ venues: { name: 'X', city: null } })]);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7, city: 'Göteborg' });
    expect(result.events).toEqual([]);
  });

  it('uses caller-supplied city as default in the card when venue city is null and no city filter', async () => {
    const sb = mockSupabaseWithRows([baseRow({ venues: { name: 'X', city: null } })]);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.events[0].city).toBe('Stockholm');
  });

  it('uses sv title when present, en as fallback', async () => {
    const sb = mockSupabaseWithRows([
      baseRow({ title_sv: 'På svenska', title_en: 'In English' }),
      baseRow({ title_sv: null, title_en: 'English only' }),
    ]);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.events[0].title).toBe('På svenska');
    expect(result.events[1].title).toBe('English only');
  });

  it('returns canonical total from supabase, independent of page size', async () => {
    // 51 rows in the page, but the count query (head: true) reports 7943.
    // The header must bind to the count, not the page length — otherwise the
    // UI's "X riktiga event att upptäcka" drifts up as the user scrolls.
    const rows = Array.from({ length: 51 }, () => baseRow());
    const sb = mockSupabase(rows, 7943);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 50 });
    expect(result.events).toHaveLength(50);
    expect(result.has_more).toBe(true);
    expect(result.total).toBe(7943);
  });

  it('returns total even when window has no rows', async () => {
    const sb = mockSupabase([], 0);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.has_more).toBe(false);
  });

  it('total matches page length when page fits within limit', async () => {
    const rows = Array.from({ length: 30 }, () => baseRow());
    const sb = mockSupabase(rows, 30);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 50 });
    expect(result.events).toHaveLength(30);
    expect(result.has_more).toBe(false);
    expect(result.total).toBe(30);
  });

  it('throws on count query error so a missing count does not silently pass as 0', async () => {
    let call = 0;
    const sb = {
      from: vi.fn().mockImplementation(() => {
        call += 1;
        if (call === 1) {
          // Data query succeeds.
          return makeChain([baseRow()]);
        }
        // Count query fails.
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          then: (resolve: (v: { count: null; data: null; error: { message: string } }) => void) =>
            Promise.resolve({ count: null, data: null, error: { message: 'count failed' } }).then(resolve),
        };
        return chain;
      }),
    } as unknown as SupabaseClient;
    await expect(feedEvents(sb, { from: '2026-08-18', days: 7 })).rejects.toThrow(/feed_events_count: count failed/);
  });
});
