/**
 * Tests for get_saved_events — T0054 / MVP-gap §77.
 *
 * Mocks the Supabase client. Validates:
 *   - returns events newest-first (created_at DESC)
 *   - filters by client_user_id + interaction='save'
 *   - respects explicit limit, capped at MAX_LIMIT=100
 *   - default limit is 50
 *   - returns empty events array on DB error
 *   - filters out null event rows from join
 *   - maps event fields to EventCard shape correctly
 *   - venue/city fallbacks when join is null
 *   - image_license and attribution fields preserved
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSavedEvents,
  GET_SAVED_EVENTS_MAX_LIMIT,
  GET_SAVED_EVENTS_DEFAULT_LIMIT,
} from '../tools/get_saved_events';

const USER_ID = '00000000-0000-0000-0000-000000000001';

interface MockState {
  rows: any[];
  selectError?: { message: string };
}

function makeChain(rows: any[], opts: { selectError?: { message: string } } = {}) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: any[]; error: null | { message: string } }) => void) => {
      if (opts.selectError) {
        Promise.resolve({ data: null, error: opts.selectError }).then(resolve);
      } else {
        Promise.resolve({ data: rows, error: null }).then(resolve);
      }
    },
  };
  return chain;
}

function mockSupabase(state: MockState): SupabaseClient {
  const from = vi.fn().mockReturnValue(makeChain(state.rows, { selectError: state.selectError }));
  return { from } as unknown as SupabaseClient;
}

const baseEventRow = (over: any = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  title_sv: 'Konsert i Konserthuset',
  title_en: 'Concert at Konserthuset',
  start_time: '2026-08-26T19:00:00+00:00',
  end_time: '2026-08-26T21:00:00+00:00',
  venue_id: '22222222-2222-2222-2222-222222222222',
  category_slug: 'music',
  is_free: false,
  price_min_sek: 200,
  price_max_sek: 400,
  ticket_url: 'https://tickets.example/123',
  image_url: 'https://cdn.example/img.jpg',
  image_license: 'cc-by',
  image_attribution: 'Fotograf / CC-BY',
  image_source_url: 'https://original.example/img.jpg',
  source: 'ticketmaster',
  venues: { name: 'Konserthuset', city: 'Stockholm' },
  ...over,
});

const baseInteractionRow = (over: any = {}) => ({
  id: 'aaaaaa00-0000-0000-0000-000000000001',
  created_at: '2026-08-20T10:00:00+00:00',
  events: baseEventRow(),
  ...over,
});

describe('getSavedEvents', () => {
  it('returns events newest-first (created_at DESC)', async () => {
    const rows = [
      baseInteractionRow({ created_at: '2026-08-21T10:00:00+00:00', events: baseEventRow({ id: 'newest-id', title_sv: 'Newest Event' }) }),
      baseInteractionRow({ created_at: '2026-08-19T10:00:00+00:00', events: baseEventRow({ id: 'oldest-id', title_sv: 'Oldest Event' }) }),
    ];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].id).toBe('newest-id');
    expect(result.events[1].id).toBe('oldest-id');
  });

  it('filters by client_user_id and interaction=save', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    const sb = { from } as unknown as SupabaseClient;
    await getSavedEvents(sb, { client_user_id: USER_ID });
    // eq() is called twice: client_user_id + interaction
    const eqCalls = from().eq.mock.calls;
    expect(eqCalls[0][0]).toBe('client_user_id');
    expect(eqCalls[0][1]).toBe(USER_ID);
    expect(eqCalls[1][0]).toBe('interaction');
    expect(eqCalls[1][1]).toBe('save');
  });

  it('respects explicit limit', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    const sb = { from } as unknown as SupabaseClient;
    await getSavedEvents(sb, { client_user_id: USER_ID, limit: 25 });
    const limitCall = from().limit.mock.calls[0][0];
    expect(limitCall).toBe(25);
  });

  it('caps limit at GET_SAVED_EVENTS_MAX_LIMIT (100)', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    const sb = { from } as unknown as SupabaseClient;
    await getSavedEvents(sb, { client_user_id: USER_ID, limit: 9999 });
    const limitCall = from().limit.mock.calls[0][0];
    expect(limitCall).toBe(GET_SAVED_EVENTS_MAX_LIMIT);
  });

  it('uses default limit of 50 when none specified', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    const sb = { from } as unknown as SupabaseClient;
    await getSavedEvents(sb, { client_user_id: USER_ID });
    const limitCall = from().limit.mock.calls[0][0];
    expect(limitCall).toBe(GET_SAVED_EVENTS_DEFAULT_LIMIT);
    expect(GET_SAVED_EVENTS_DEFAULT_LIMIT).toBe(50);
  });

  it('returns empty events array on DB error', async () => {
    const sb = mockSupabase({ rows: [], selectError: { message: 'connection refused' } });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events).toEqual([]);
  });

  it('filters out null event rows from join', async () => {
    const rows = [
      baseInteractionRow({ id: 'row-with-event', events: baseEventRow({ id: 'real-id', title_sv: 'Real Event' }) }),
      baseInteractionRow({ id: 'row-without-event', events: null }),
    ];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('real-id');
  });

  it('maps event fields to EventCard shape correctly', async () => {
    const rows = [baseInteractionRow()];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events).toHaveLength(1);
    const card = result.events[0];
    expect(card.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(card.title).toBe('Konsert i Konserthuset');
    expect(card.start_time).toBe('2026-08-26T19:00:00+00:00');
    expect(card.end_time).toBe('2026-08-26T21:00:00+00:00');
    expect(card.venue_name).toBe('Konserthuset');
    expect(card.venue_id).toBe('22222222-2222-2222-2222-222222222222');
    expect(card.city).toBe('Stockholm');
    expect(card.category_slug).toBe('music');
    expect(card.is_free).toBe(false);
    expect(card.price_min_sek).toBe(200);
    expect(card.price_max_sek).toBe(400);
    expect(card.ticket_url).toBe('https://tickets.example/123');
    expect(card.image_url).toBe('https://cdn.example/img.jpg');
    expect(card.image_license).toBe('cc-by');
    expect(card.image_attribution).toBe('Fotograf / CC-BY');
    expect(card.image_source_url).toBe('https://original.example/img.jpg');
    expect(card.source).toBe('ticketmaster');
  });

  it('falls back to title_en when title_sv is missing', async () => {
    const rows = [baseInteractionRow({ events: baseEventRow({ title_sv: null, title_en: 'English Title' }) })];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events[0].title).toBe('English Title');
  });

  it('falls back to Untitled when both titles are missing', async () => {
    const rows = [baseInteractionRow({ events: baseEventRow({ title_sv: null, title_en: null }) })];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events[0].title).toBe('Untitled');
  });

  it('defaults venue_name and city when venues join is null', async () => {
    const rows = [baseInteractionRow({ events: baseEventRow({ venues: null }) })];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events[0].venue_name).toBe('');
    expect(result.events[0].city).toBe('Stockholm');
  });

  it('defaults null numeric fields correctly', async () => {
    const rows = [baseInteractionRow({ events: baseEventRow({ is_free: null, price_min_sek: null, price_max_sek: null }) })];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events[0].is_free).toBe(false);
    expect(result.events[0].price_min_sek).toBeNull();
    expect(result.events[0].price_max_sek).toBeNull();
  });

  it('maps null optional string fields to null', async () => {
    const rows = [baseInteractionRow({ events: baseEventRow({ ticket_url: null, image_url: null, source: null }) })];
    const sb = mockSupabase({ rows });
    const result = await getSavedEvents(sb, { client_user_id: USER_ID });
    expect(result.events[0].ticket_url).toBeNull();
    expect(result.events[0].image_url).toBeNull();
    expect(result.events[0].source).toBeNull();
  });

  it('enforces minimum limit of 1', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    const sb = { from } as unknown as SupabaseClient;
    await getSavedEvents(sb, { client_user_id: USER_ID, limit: -5 });
    const limitCall = from().limit.mock.calls[0][0];
    expect(limitCall).toBeGreaterThanOrEqual(1);
  });
});
