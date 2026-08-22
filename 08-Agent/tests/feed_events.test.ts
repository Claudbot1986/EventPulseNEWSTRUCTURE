/**
 * Tests for feed_events — browse-window reader for the default-browse UI.
 *
 * Mocks the Supabase client. Validates date arithmetic, window bounds, and
 * the +1 sentinel for has_more detection.
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

function mockSupabaseWithRows(rows: any[]): SupabaseClient {
  const from = vi.fn().mockReturnValue(makeChain(rows));
  return { from } as unknown as SupabaseClient;
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
});
