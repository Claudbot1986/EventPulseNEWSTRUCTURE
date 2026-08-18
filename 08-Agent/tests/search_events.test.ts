/**
 * Tests for searchEvents — uses a mock SupabaseClient.
 *
 * Run with:  npx vitest run 08-Agent/tests
 */

import { describe, expect, it, vi } from 'vitest';
import { searchEvents, SEARCH_EVENTS_DEFAULT_LIMIT, SEARCH_EVENTS_MAX_LIMIT } from '../tools/search_events';

function mockSupabase(rows: any[]): any {
  const chain: any = {
    select: vi.fn(() => chain),
    eq:    vi.fn(() => chain),
    gt:    vi.fn(() => chain),
    gte:   vi.fn(() => chain),
    lte:   vi.fn(() => chain),
    in:    vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: any, reject: any) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return { from: () => chain };
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
    const { events, warnings } = await searchEvents(sb, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('En Konsert');
    expect(warnings).toEqual([]);
  });

  it('returns empty list when no rows', async () => {
    const sb = mockSupabase([]);
    const { events } = await searchEvents(sb, { limit: 10 });
    expect(events).toEqual([]);
  });

  it('caps limit at SEARCH_EVENTS_MAX_LIMIT', async () => {
    const sb = mockSupabase([]);
    await searchEvents(sb, { limit: 9999 });
    expect(sb.from().limit).toHaveBeenCalled();
  });

  it('uses default limit when none provided', () => {
    expect(SEARCH_EVENTS_DEFAULT_LIMIT).toBe(25);
    expect(SEARCH_EVENTS_MAX_LIMIT).toBe(50);
  });

  it('warns when confidence_score is missing', async () => {
    const row = { ...baseRow, confidence_score: null };
    const sb = mockSupabase([row]);
    const { warnings } = await searchEvents(sb, { limit: 10 });
    expect(warnings.some((w) => w.includes('no confidence_score'))).toBe(true);
  });

  it('warns when confidence_score is low', async () => {
    const row = { ...baseRow, confidence_score: 10 };
    const sb = mockSupabase([row]);
    const { warnings } = await searchEvents(sb, { limit: 10 });
    expect(warnings.some((w) => w.includes('low confidence'))).toBe(true);
  });

  it('filters out exclude_categories post-hoc', async () => {
    const sb = mockSupabase([
      baseRow,
      { ...baseRow, id: 'e2', category_slug: 'theater' },
    ]);
    const { events } = await searchEvents(sb, { exclude_categories: ['theater'], limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('e1');
  });

  it('returns warnings when supabase errors', async () => {
    const chain: any = {
      select: () => chain,
      eq:    () => chain,
      gt:    () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve),
    };
    const sb = { from: () => chain };
    const { events, warnings } = await searchEvents(sb, { limit: 10 });
    expect(events).toEqual([]);
    expect(warnings[0]).toContain('boom');
  });
});
