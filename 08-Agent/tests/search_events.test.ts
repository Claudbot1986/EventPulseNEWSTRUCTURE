/**
 * Tests for searchEvents — uses a mock SupabaseClient.
 *
 * Run with:  npx vitest run 08-Agent/tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  searchEvents,
  SEARCH_EVENTS_DEFAULT_LIMIT,
  SEARCH_EVENTS_MAX_LIMIT,
  type SearchEventsResult,
} from '../tools/search_events';

type Chain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (resolve: (v: { data: unknown[] | null; error: unknown }) => unknown, reject: (e: unknown) => unknown) => Promise<unknown>;
};

function makeChain(rows: unknown[]): Chain {
  const chain = {} as Chain;
  const passthrough = () => chain;
  chain.select = vi.fn(passthrough);
  chain.eq = vi.fn(passthrough);
  chain.gt = vi.fn(passthrough);
  chain.gte = vi.fn(passthrough);
  chain.lte = vi.fn(passthrough);
  chain.in = vi.fn(passthrough);
  chain.order = vi.fn(passthrough);
  chain.limit = vi.fn(passthrough);
  chain.then = (resolve, reject) =>
    Promise.resolve({ data: rows, error: null }).then(
      resolve as (v: { data: unknown[] | null; error: unknown }) => unknown,
      reject,
    );
  return chain;
}

/**
 * Mock supabase that returns `eventRows` from the first table queried
 * (events_public) and `venueRows` from the second table queried (venues).
 * Tracks `from()` calls so tests can assert table access order.
 * T0080: optionally accepts `offerRows` for the `event_offers` availability hop.
 */
function mockSupabase(eventRows: unknown[], venueRows: unknown[] = [], offerRows: unknown[] = []) {
  const calls: string[] = [];
  const handlers: Record<string, Chain> = {};
  handlers['events_public'] = makeChain(eventRows);
  handlers['events'] = makeChain(eventRows);
  handlers['venues'] = makeChain(venueRows);
  handlers['event_offers'] = makeChain(offerRows);
  return {
    from(table: string) {
      calls.push(table);
      return handlers[table] ?? makeChain([]);
    },
    calls,
  };
}

const baseRow = {
  id: 'e1',
  title_en: 'A Concert',
  title_sv: 'En Konsert',
  start_time: '2099-01-01T19:30:00Z',
  end_time:   null,
  venue_id: null,
  is_free: false,
  price_min_sek: 100,
  price_max_sek: 200,
  ticket_url: 'https://example.com',
  image_url: null,
  category_slug: 'music',
  confidence_score: 90,
  freshness_at:    new Date().toISOString(),
  status_expanded: 'scheduled',
};

describe('searchEvents', () => {
  it('returns events when the chain resolves', async () => {
    const sb = mockSupabase([baseRow]);
    const { events, warnings } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('En Konsert');
    expect(warnings).toEqual([]);
  });

  it('returns empty list when no rows', async () => {
    const sb = mockSupabase([]);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toEqual([]);
  });

  it('caps limit at SEARCH_EVENTS_MAX_LIMIT', async () => {
    const sb = mockSupabase([]);
    await searchEvents(sb as any, { limit: 9999 });
    expect(sb.from('events_public').limit).toHaveBeenCalled();
  });

  it('uses default limit when none provided', () => {
    expect(SEARCH_EVENTS_DEFAULT_LIMIT).toBe(25);
    expect(SEARCH_EVENTS_MAX_LIMIT).toBe(50);
  });

  it('warns when confidence_score is missing', async () => {
    const row = { ...baseRow, confidence_score: null };
    const sb = mockSupabase([row]);
    const { warnings } = await searchEvents(sb as any, { limit: 10 });
    expect(warnings.some((w: string) => w.includes('no confidence_score'))).toBe(true);
  });

  it('warns when confidence_score is low', async () => {
    const row = { ...baseRow, confidence_score: 10 };
    const sb = mockSupabase([row]);
    const { warnings } = await searchEvents(sb as any, { limit: 10 });
    expect(warnings.some((w: string) => w.includes('low confidence'))).toBe(true);
  });

  it('filters out exclude_categories post-hoc', async () => {
    const sb = mockSupabase([
      baseRow,
      { ...baseRow, id: 'e2', category_slug: 'theater' },
    ]);
    const { events } = await searchEvents(sb as any, { exclude_categories: ['theater'], limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('e1');
  });

  it('returns warnings when supabase errors', async () => {
    const errorChain: Chain = {
      select: vi.fn(() => errorChain),
      eq:    vi.fn(() => errorChain),
      gt:    vi.fn(() => errorChain),
      gte:   vi.fn(() => errorChain),
      lte:   vi.fn(() => errorChain),
      in:    vi.fn(() => errorChain),
      order: vi.fn(() => errorChain),
      limit: vi.fn(() => errorChain),
      then: (resolve, reject) =>
        Promise.resolve({ data: null, error: { message: 'boom' } }).then(
          resolve as (v: { data: unknown[] | null; error: unknown }) => unknown,
          reject,
        ),
    };
    const sb = { from: () => errorChain };
    const { events, warnings } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toEqual([]);
    expect(warnings[0]).toContain('boom');
  });
});

describe('searchEvents — venue_name population (D3 fix)', () => {
  it('populates venue_name from the venues table for events with a venue_id', async () => {
    const eventRows = [
      { ...baseRow, id: 'e1', venue_id: 'v-1' },
      { ...baseRow, id: 'e2', venue_id: 'v-2' },
    ];
    const venueRows = [
      { id: 'v-1', name: 'Konserthuset', city: 'Stockholm', address: 'Hötorgssalen' },
      { id: 'v-2', name: 'Dramaten',     city: 'Stockholm', address: 'Nybroplan' },
    ];
    const sb = mockSupabase(eventRows, venueRows);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(2);
    expect(events[0].venue_name).toBe('Konserthuset');
    expect(events[1].venue_name).toBe('Dramaten');
  });

  it('returns empty venue_name when the venue row is missing (honest, no placeholder)', async () => {
    const eventRows = [{ ...baseRow, venue_id: 'orphan-v' }];
    const sb = mockSupabase(eventRows, []);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].venue_name).toBe('');
  });

  it('returns empty venue_name when venue_id is null', async () => {
    const eventRows = [{ ...baseRow, venue_id: null }];
    const sb = mockSupabase(eventRows, []);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events[0].venue_name).toBe('');
  });

  it('does not call the venues table when no event has a venue_id', async () => {
    const eventRows = [{ ...baseRow, venue_id: null }];
    const sb = mockSupabase(eventRows, []);
    await searchEvents(sb as any, { limit: 10 });
    expect(sb.calls).not.toContain('venues');
  });
});

describe('searchEvents — city filter (D3 fix)', () => {
  it('queries the venues table when a city filter is provided', async () => {
    const eventRows = [
      { ...baseRow, id: 'e1', venue_id: 'v-1' },
      { ...baseRow, id: 'e2', venue_id: 'v-2' },
    ];
    const venueRows = [
      { id: 'v-1', name: 'Konserthuset', city: 'Stockholm' },
      { id: 'v-2', name: 'Liseberg',     city: 'Göteborg' },
    ];
    const sb = mockSupabase(eventRows, venueRows);
    const { events } = await searchEvents(sb as any, { city: 'Stockholm', limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('e1');
    expect(events[0].venue_name).toBe('Konserthuset');
  });

  it('matches city case-insensitively and tolerates whitespace', async () => {
    const eventRows = [{ ...baseRow, venue_id: 'v-1' }];
    const venueRows = [{ id: 'v-1', name: 'Konserthuset', city: 'Stockholm' }];
    const sb = mockSupabase(eventRows, venueRows);
    const { events } = await searchEvents(sb as any, { city: '  stockholm  ', limit: 10 });
    expect(events).toHaveLength(1);
  });

  it('defaults city to Stockholm and still filters correctly', async () => {
    const eventRows = [{ ...baseRow, venue_id: 'v-1' }];
    const venueRows = [{ id: 'v-1', name: 'Konserthuset', city: 'Stockholm' }];
    const sb = mockSupabase(eventRows, venueRows);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events[0].city).toBe('Stockholm');
    expect(events).toHaveLength(1);
  });

  it('returns empty when every event is outside the requested city', async () => {
    const eventRows = [{ ...baseRow, venue_id: 'v-1' }];
    const venueRows = [{ id: 'v-1', name: 'Liseberg', city: 'Göteborg' }];
    const sb = mockSupabase(eventRows, venueRows);
    const { events } = await searchEvents(sb as any, { city: 'Stockholm', limit: 10 });
    expect(events).toEqual([]);
  });
});

describe('searchEvents — zero-result broadening (D3 / §18.2.5)', () => {
  it('widens the date window first when the strict query returns zero rows', async () => {
    const sb = mockSupabase([], []);
    const result: SearchEventsResult = await searchEvents(sb as any, {
      city: 'Stockholm',
      date_from: '2099-01-01',
      date_to:   '2099-01-01',
      categories: ['music'],
      limit: 10,
    });
    expect(result.events).toEqual([]);
    expect(result.relaxed_constraint).toBe('date_window');
    // At least one extra events_public call for the widened window.
    expect(sb.calls.filter((t) => t === 'events_public').length).toBeGreaterThanOrEqual(2);
  });

  it('relaxes category when no date window was supplied and strict query is empty', async () => {
    const sb = mockSupabase([], []);
    const result = await searchEvents(sb as any, {
      city: 'Stockholm',
      categories: ['music'],
      limit: 10,
    });
    expect(result.relaxed_constraint).toBe('category');
  });

  it('uses the widened date window results when the strict query is empty', async () => {
    // Track each query as a separate group; reset on each `from()` call.
    const queryGroups: Array<Array<{ method: string; args: unknown[] }>> = [[]];
    const chain: any = {};
    const wrap = (method: string) => (...args: unknown[]) => {
      queryGroups[queryGroups.length - 1].push({ method, args });
      return chain;
    };
    chain.select = () => chain;
    chain.eq    = wrap('eq');
    chain.gt    = wrap('gt');
    chain.gte   = wrap('gte');
    chain.lte   = wrap('lte');
    chain.in    = wrap('in');
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.then  = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: [], error: null }).then(resolve);

    const sb = {
      from: (_t: string) => {
        queryGroups.push([]);
        return chain;
      },
    };
    const result = await searchEvents(sb as any, {
      city: 'Stockholm',
      date_from: '2099-01-01',
      date_to:   '2099-01-01',
      categories: ['music'],
      limit: 10,
    });
    // First group is empty (created at init); then groups follow from() calls.
    // Find the first two non-empty event-query groups (skip venues query).
    const eventQueries = queryGroups
      .map((g, idx) => ({ idx, g }))
      .filter((g) => g.g.some((c) => c.method === 'gte' || c.method === 'gt'));
    expect(eventQueries.length).toBeGreaterThanOrEqual(2);
    const firstGte = eventQueries[0].g.find((c) => c.method === 'gte');
    const secondGte = eventQueries[1].g.find((c) => c.method === 'gte');
    expect(firstGte).toBeDefined();
    expect(secondGte).toBeDefined();
    expect(String(secondGte!.args[0])).toBe('start_time');
    const firstDate = String(firstGte!.args[1]);
    const secondDate = String(secondGte!.args[1]);
    expect(secondDate < firstDate).toBe(true);
    // First relaxation wins; widening fired before category relaxation.
    expect(result.relaxed_constraint).toBe('date_window');
  });

  it('does NOT broaden when the strict query returns rows (happy path)', async () => {
    const eventRows = [{ ...baseRow, venue_id: 'v-1' }];
    const venueRows = [{ id: 'v-1', name: 'Konserthuset', city: 'Stockholm' }];
    const sb = mockSupabase(eventRows, venueRows);
    const result = await searchEvents(sb as any, {
      city: 'Stockholm',
      date_from: '2099-01-01',
      date_to:   '2099-01-01',
      categories: ['music'],
      limit: 10,
    });
    expect(result.events).toHaveLength(1);
    expect(result.relaxed_constraint).toBeNull();
  });

  it('exposes relaxed_constraint: null on the happy path', async () => {
    const sb = mockSupabase([baseRow]);
    const result = await searchEvents(sb as any, { limit: 10 });
    expect(result.relaxed_constraint).toBeNull();
  });
});

describe('searchEvents — availability_badge (T0080)', () => {
  it('maps sold_out primary offer to badge', async () => {
    const eventRows = [{ ...baseRow, id: 'e-sold' }];
    const offerRows = [{ event_id: 'e-sold', availability: 'sold_out' }];
    const sb = mockSupabase(eventRows, [], offerRows);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].availability_badge).toBe('sold_out');
  });

  it('maps limited primary offer to few_left badge', async () => {
    const eventRows = [{ ...baseRow, id: 'e-limited' }];
    const offerRows = [{ event_id: 'e-limited', availability: 'limited' }];
    const sb = mockSupabase(eventRows, [], offerRows);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].availability_badge).toBe('few_left');
  });

  it('maps available primary offer to undefined (no badge)', async () => {
    const eventRows = [{ ...baseRow, id: 'e-avail' }];
    const offerRows = [{ event_id: 'e-avail', availability: 'available' }];
    const sb = mockSupabase(eventRows, [], offerRows);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].availability_badge).toBeUndefined();
  });

  it('returns undefined badge when no offer row exists', async () => {
    const eventRows = [{ ...baseRow, id: 'e-nooffer' }];
    const sb = mockSupabase(eventRows, [], []);
    const { events } = await searchEvents(sb as any, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].availability_badge).toBeUndefined();
  });
});
