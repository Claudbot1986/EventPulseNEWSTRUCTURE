/**
 * Tests for live_now — T0083 / MVP-gap §77 (Phase 1 retention).
 *
 * Run with:  npx vitest run 08-Agent/tests/live_now.test.ts
 *
 * Coverage:
 *   - filterLiveRows pure filter: started/not-started, grace, null end_time
 *   - sortLiveRows pure sort: start_time ASC
 *   - liveEvents IO: rowToCard mapping, limit cap, error handling, time-window
 */

import { describe, expect, it, vi } from 'vitest';
import {
  liveEvents,
  filterLiveRows,
  sortLiveRows,
  LIVE_NOW_GRACE_MINUTES,
  LIVE_NOW_MAX_EVENTS,
  LIVE_NOW_DEFAULT_LIMIT,
  type LiveNowResult,
} from '../tools/live_now';

type Chain = {
  select: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (
    resolve: (v: { data: unknown[] | null; error: unknown }) => unknown,
    reject: (e: unknown) => unknown
  ) => Promise<unknown>;
};

function makeChain(rows: unknown[], error: { message: string } | null = null): Chain {
  const chain = {} as Chain;
  const passthrough = () => chain;
  chain.select = vi.fn(passthrough);
  chain.gte = vi.fn(passthrough);
  chain.lte = vi.fn(passthrough);
  chain.order = vi.fn(passthrough);
  chain.limit = vi.fn(passthrough);
  chain.then = (resolve, reject) =>
    Promise.resolve({ data: rows, error }).then(
      resolve as (v: { data: unknown[] | null; error: unknown }) => unknown,
      reject,
    );
  return chain;
}

function mockSupabase(rows: unknown[]) {
  return {
    from: (_table: string) => makeChain(rows),
  };
}

const NOW = new Date('2026-08-22T20:00:00Z');

const baseLiveRow = {
  id: 'e1',
  title_sv: 'En Konsert',
  title_en: 'A Concert',
  start_time: '2026-08-22T19:00:00Z',
  end_time:   '2026-08-22T22:00:00Z',
  venue_id: null,
  is_free: false,
  price_min_sek: 100,
  price_max_sek: 200,
  ticket_url: 'https://example.com',
  image_url: null,
  category_slug: 'music',
  source: 'test',
  venues: null,
};

describe('live_now — constants (T0083)', () => {
  it('uses 30-minute grace by default', () => {
    expect(LIVE_NOW_GRACE_MINUTES).toBe(30);
  });

  it('caps at 3 events max', () => {
    expect(LIVE_NOW_MAX_EVENTS).toBe(3);
    expect(LIVE_NOW_DEFAULT_LIMIT).toBe(3);
  });
});

describe('filterLiveRows — pure time-window logic', () => {
  it('keeps an event whose start_time <= now <= end_time', () => {
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T19:00:00Z', end_time: '2026-08-22T22:00:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(1);
  });

  it('drops an event whose start_time is in the future', () => {
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T21:00:00Z', end_time: '2026-08-22T23:00:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(0);
  });

  it('keeps an event whose end_time is in the past within the 30-min grace', () => {
    // end_time = 19:45, now = 20:00 -> ended 15 minutes ago, within 30-min grace
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T18:00:00Z', end_time: '2026-08-22T19:45:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(1);
  });

  it('drops an event whose end_time is past the grace window', () => {
    // end_time = 19:00, now = 20:00 -> ended 60 minutes ago, beyond 30-min grace
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T18:00:00Z', end_time: '2026-08-22T19:00:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(0);
  });

  it('keeps events with NULL end_time (defensive: treat as live)', () => {
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T19:00:00Z', end_time: null },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(1);
  });

  it('drops rows with an unparseable start_time', () => {
    const rows = [
      { ...baseLiveRow, start_time: 'not-a-date', end_time: '2026-08-22T22:00:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(0);
  });

  it('treats unparseable end_time as live (defensive)', () => {
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T19:00:00Z', end_time: 'not-a-date' },
    ];
    expect(filterLiveRows(rows as any, NOW, 30)).toHaveLength(1);
  });

  it('respects custom grace window overrides', () => {
    // end_time = 19:00, now = 20:00 -> ended 60 minutes ago.
    // With grace=0, drop; with grace=120, keep.
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T18:00:00Z', end_time: '2026-08-22T19:00:00Z' },
    ];
    expect(filterLiveRows(rows as any, NOW, 0)).toHaveLength(0);
    expect(filterLiveRows(rows as any, NOW, 120)).toHaveLength(1);
  });
});

describe('sortLiveRows — pure ASC sort', () => {
  it('orders by start_time ASC (earliest first)', () => {
    const rows = [
      { ...baseLiveRow, id: 'e-late',   start_time: '2026-08-22T19:30:00Z' },
      { ...baseLiveRow, id: 'e-early',  start_time: '2026-08-22T18:00:00Z' },
      { ...baseLiveRow, id: 'e-middle', start_time: '2026-08-22T19:00:00Z' },
    ];
    const sorted = sortLiveRows(rows as any);
    expect(sorted.map((r) => r.id)).toEqual(['e-early', 'e-middle', 'e-late']);
  });

  it('does not mutate the input array', () => {
    const rows = [
      { ...baseLiveRow, id: 'e2', start_time: '2026-08-22T19:30:00Z' },
      { ...baseLiveRow, id: 'e1', start_time: '2026-08-22T18:00:00Z' },
    ];
    const original = [...rows];
    sortLiveRows(rows as any);
    expect(rows).toEqual(original);
  });
});

describe('liveEvents — IO + EventCard mapping', () => {
  it('returns at most 3 live events sorted by start_time ASC', async () => {
    const rows = [
      { ...baseLiveRow, id: 'e-late',   start_time: '2026-08-22T19:45:00Z', end_time: '2026-08-22T22:00:00Z' },
      { ...baseLiveRow, id: 'e-early',  start_time: '2026-08-22T18:00:00Z', end_time: '2026-08-22T21:00:00Z' },
      { ...baseLiveRow, id: 'e-middle', start_time: '2026-08-22T19:00:00Z', end_time: '2026-08-22T22:00:00Z' },
      { ...baseLiveRow, id: 'e-extras', start_time: '2026-08-22T17:00:00Z', end_time: '2026-08-22T23:00:00Z' },
    ];
    const sb = mockSupabase(rows);
    const result: LiveNowResult = await liveEvents(sb as any, { now: NOW });
    expect(result.events).toHaveLength(3);
    // Sorted ASC by start_time, then capped at limit=3:
    //   e-extras (17:00), e-early (18:00), e-middle (19:00), e-late (19:45)
    // The 3 earliest-starting live rows are kept; e-late is dropped.
    expect(result.events.map((e) => e.id)).toEqual(['e-extras', 'e-early', 'e-middle']);
  });

  it('maps title_sv to title and falls back to title_en', async () => {
    const rows = [
      { ...baseLiveRow, id: 'e-sv', title_sv: 'På Svenska', title_en: 'In English' },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events[0].title).toBe('På Svenska');
  });

  it('falls back to title_en when title_sv is null', async () => {
    const rows = [
      { ...baseLiveRow, id: 'e-en', title_sv: null, title_en: 'In English' },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events[0].title).toBe('In English');
  });

  it('falls back to Untitled when both titles are null', async () => {
    const rows = [
      { ...baseLiveRow, id: 'e-no-title', title_sv: null, title_en: null },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events[0].title).toBe('Untitled');
  });

  it('populates venue_name from venues embedded join', async () => {
    const rows = [
      {
        ...baseLiveRow,
        id: 'e-with-venue',
        venue_id: 'v-1',
        venues: { name: 'Konserthuset', city: 'Stockholm' },
      },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events[0].venue_name).toBe('Konserthuset');
    expect(result.events[0].city).toBe('Stockholm');
    expect(result.events[0].venue_id).toBe('v-1');
  });

  it('returns empty venue_name when venue_id is null (honest)', async () => {
    const rows = [
      { ...baseLiveRow, venue_id: null, venues: null },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events[0].venue_name).toBe('');
  });

  it('echoes computed_at and grace_minutes on success', async () => {
    const sb = mockSupabase([baseLiveRow]);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.computed_at).toBe(NOW.toISOString());
    expect(result.grace_minutes).toBe(30);
  });

  it('honors custom graceMinutes input', async () => {
    const rows = [
      { ...baseLiveRow, start_time: '2026-08-22T18:00:00Z', end_time: '2026-08-22T19:00:00Z' },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW, graceMinutes: 0 });
    expect(result.events).toHaveLength(0);
    expect(result.grace_minutes).toBe(0);
  });

  it('honors custom limit input (capped at LIVE_NOW_MAX_EVENTS)', async () => {
    const rows = [
      { ...baseLiveRow, id: 'e1', start_time: '2026-08-22T18:00:00Z' },
      { ...baseLiveRow, id: 'e2', start_time: '2026-08-22T19:00:00Z' },
      { ...baseLiveRow, id: 'e3', start_time: '2026-08-22T19:30:00Z' },
    ];
    const sb = mockSupabase(rows);
    // limit=2 should override the default of 3
    const result = await liveEvents(sb as any, { now: NOW, limit: 2 });
    expect(result.events).toHaveLength(2);
    // limit=999 should still cap at LIVE_NOW_MAX_EVENTS = 3
    const capped = await liveEvents(sb as any, { now: NOW, limit: 999 });
    expect(capped.events.length).toBeLessThanOrEqual(LIVE_NOW_MAX_EVENTS);
  });

  it('returns empty list + warning on Supabase error', async () => {
    const errorChain = makeChain([], { message: 'boom' });
    const sb = { from: () => errorChain };
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toContain('boom');
    expect(result.warnings[0]).toContain('live_now');
  });

  it('drops future-start rows before the slice (defensive)', async () => {
    const rows = [
      { ...baseLiveRow, id: 'future', start_time: '2026-08-22T23:00:00Z', end_time: '2026-08-23T01:00:00Z' },
      { ...baseLiveRow, id: 'live',   start_time: '2026-08-22T19:00:00Z', end_time: '2026-08-22T22:00:00Z' },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events.map((e) => e.id)).toEqual(['live']);
  });

  it('drops past-end rows beyond the grace window', async () => {
    const rows = [
      { ...baseLiveRow, id: 'old', start_time: '2026-08-22T15:00:00Z', end_time: '2026-08-22T18:00:00Z' },
      { ...baseLiveRow, id: 'live', start_time: '2026-08-22T19:00:00Z', end_time: '2026-08-22T22:00:00Z' },
    ];
    const sb = mockSupabase(rows);
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events.map((e) => e.id)).toEqual(['live']);
  });

  it('does not throw when the supabase call returns null data', async () => {
    const nullChain: Chain = {
      select: vi.fn(() => nullChain),
      gte:    vi.fn(() => nullChain),
      lte:    vi.fn(() => nullChain),
      order:  vi.fn(() => nullChain),
      limit:  vi.fn(() => nullChain),
      then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve as any),
    };
    const sb = { from: () => nullChain };
    const result = await liveEvents(sb as any, { now: NOW });
    expect(result.events).toEqual([]);
  });
});
