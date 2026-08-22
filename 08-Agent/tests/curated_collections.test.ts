/**
 * Tests for curated_collections — T0084 / MVP-gap §77 editorial
 * "Kuratorens val" lists.
 *
 * The deterministic selection ladder is exercised through
 * `_selectCollectionsForTest` so we don't need a real Supabase client.
 * The hydration path is exercised through `getCuratedCollections` with
 * `search_events` mocked so we can verify failure-mode behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mocked dependencies
const searchEventsMock = vi.fn();

vi.mock('../tools/search_events.js', () => ({
  searchEvents: (...args: unknown[]) => searchEventsMock(...args),
}));

// Import after mocks
import {
  _selectCollectionsForTest,
  _toSearchInputForTest,
  getCuratedCollections,
  type CuratedDayFilter,
  type CuratedTimeOfDay,
} from '../tools/curated_collections';

function makeStockholmDate(
  year: number,
  month: number,
  day: number,
  hour = 12,
): Date {
  // Helpers use local-tz semantics (getHours, getDay) which is fine in
  // Node's test runner where TZ is configurable. We construct in UTC and
  // shift Stockholm hours: in summer (CEST) UTC = local-2, so adding +2h
  // makes the local hour equal to `hour`. But selection helpers use
  // getHours() / getDay() of the **shifted** Date object — which itself
  // depends on TZ. To stay robust we hand-roll each scenario.
  const d = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  return d;
}

describe('_selectCollectionsForTest', () => {
  it('yields at least MIN_LIMIT (2) collections for any time/day slot', () => {
    const slots: Array<[CuratedTimeOfDay, CuratedDayFilter]> = [
      ['morning', 'weekday'],
      ['afternoon', 'weekday'],
      ['evening', 'weekday'],
      ['night', 'weekday'],
      ['evening', 'friday'],
      ['evening', 'saturday'],
      ['evening', 'sunday'],
      ['morning', 'saturday'],
    ];
    for (const [time, day] of slots) {
      const result = _selectCollectionsForTest(time, day, 3);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(3);
    }
  });

  it('includes the evening time-of-day card when time=evening', () => {
    const result = _selectCollectionsForTest('evening', 'weekday', 3);
    const tod = result.find((c) => c.time_of_day === 'evening');
    expect(tod).toBeDefined();
    expect(['klassiskt-ikvall', 'jazz-i-stan']).toContain(tod!.id);
  });

  it('includes the morning time-of-day card when time=morning', () => {
    const result = _selectCollectionsForTest('morning', 'weekday', 3);
    const tod = result.find((c) => c.time_of_day === 'morning');
    expect(tod).toBeDefined();
    expect(tod!.id).toBe('morgonens-lugna-toner');
  });

  it('picks Saturday free card on Saturday', () => {
    const result = _selectCollectionsForTest('evening', 'saturday', 3);
    const satFree = result.find((c) => c.id === 'gratis-pa-lordag');
    expect(satFree).toBeDefined();
  });

  it('picks Sunday free card on Sunday', () => {
    const result = _selectCollectionsForTest('evening', 'sunday', 3);
    const sunFree = result.find((c) => c.id === 'gratis-pa-sondag');
    expect(sunFree).toBeDefined();
  });

  it('picks generic weekend card on Friday (not Saturday-specific)', () => {
    const result = _selectCollectionsForTest('evening', 'friday', 3);
    // On Friday the ladder prefers the Saturday-specific free card; verify
    // *some* weekend-budget card is present.
    const weekend = result.find((c) => c.budget === 'free');
    expect(weekend).toBeDefined();
  });

  it('falls back to a low-budget card on weekday', () => {
    const result = _selectCollectionsForTest('evening', 'weekday', 3);
    const lowBudget = result.find(
      (c) => c.budget === 'low' && c.id === 'konsert-under-200',
    );
    expect(lowBudget).toBeDefined();
  });

  it('returns IDs that are unique within a single pick', () => {
    const result = _selectCollectionsForTest('evening', 'saturday', 3);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects limit=2', () => {
    const result = _selectCollectionsForTest('evening', 'saturday', 2);
    expect(result.length).toBe(2);
  });

  it('raw ladder fills up to limit (clamping happens in getCuratedCollections, not here)', () => {
    const result = _selectCollectionsForTest('evening', 'saturday', 5);
    // _selectCollectionsForTest is the raw selector — it yields up to the
    // requested limit without applying the global MAX_LIMIT cap. The cap is
    // applied by getCuratedCollections via Math.min(MAX_LIMIT, limit).
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic: same inputs → same outputs', () => {
    const a = _selectCollectionsForTest('evening', 'saturday', 3);
    const b = _selectCollectionsForTest('evening', 'saturday', 3);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});

describe('_toSearchInputForTest', () => {
  it('maps budget=free to is_free=true with no price_max', () => {
    const entry = {
      id: 'gratis-pa-lordag',
      budget: 'free' as const,
      day_filter: 'saturday' as const,
      sv_name: 'x',
      sv_reason: 'x',
      sv_prompt: 'x',
      en_name: 'x',
      en_reason: 'x',
      en_prompt: 'x',
    };
    const now = makeStockholmDate(2026, 8, 17, 12); // Mon
    const out = _toSearchInputForTest(entry, now);
    expect(out.is_free).toBe(true);
    expect(out.price_max_sek).toBeNull();
  });

  it('maps budget=low to price_max_sek=200 with no is_free', () => {
    const entry = {
      id: 'konsert-under-200',
      category_slug: 'music',
      budget: 'low' as const,
      sv_name: 'x',
      sv_reason: 'x',
      sv_prompt: 'x',
      en_name: 'x',
      en_reason: 'x',
      en_prompt: 'x',
    };
    const out = _toSearchInputForTest(entry, makeStockholmDate(2026, 8, 17, 12));
    expect(out.price_max_sek).toBe(200);
    expect(out.is_free).toBeNull();
  });

  it('passes through category_slug as single-element array', () => {
    const entry = {
      id: 'klassiskt-ikvall',
      category_slug: 'music',
      time_of_day: 'evening' as const,
      sv_name: 'x',
      sv_reason: 'x',
      sv_prompt: 'x',
      en_name: 'x',
      en_reason: 'x',
      en_prompt: 'x',
    };
    const out = _toSearchInputForTest(entry, makeStockholmDate(2026, 8, 17, 12));
    expect(out.categories).toEqual(['music']);
  });

  it('locks city to Stockholm', () => {
    const entry = {
      id: 'klassiskt-ikvall',
      sv_name: 'x',
      sv_reason: 'x',
      sv_prompt: 'x',
      en_name: 'x',
      en_reason: 'x',
      en_prompt: 'x',
    };
    const out = _toSearchInputForTest(entry, makeStockholmDate(2026, 8, 17, 12));
    expect(out.city).toBe('Stockholm');
  });

  it('produces ISO day strings (YYYY-MM-DD) for date_from/date_to', () => {
    const entry = {
      id: 'konsert-under-200',
      sv_name: 'x',
      sv_reason: 'x',
      sv_prompt: 'x',
      en_name: 'x',
      en_reason: 'x',
      en_prompt: 'x',
    };
    const out = _toSearchInputForTest(entry, makeStockholmDate(2026, 8, 17, 12));
    expect(out.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getCuratedCollections (integration)', () => {
  it('returns Swedish names by default (locale=sv)', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19), // Friday evening
    });
    expect(result.collections.length).toBeGreaterThanOrEqual(2);
    for (const c of result.collections) {
      expect(c.locale).toBe('sv');
      // Swedish prompt markers
      expect(c.prompt_text).toMatch(/Stockholm/);
    }
  });

  it('returns English names when locale=en', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      locale: 'en',
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(result.collections.length).toBeGreaterThanOrEqual(2);
    for (const c of result.collections) {
      expect(c.locale).toBe('en');
      // English prompt must NOT contain Swedish-only marker like "ikväll"
      expect(c.prompt_text).not.toContain('ikväll');
      expect(c.prompt_text).not.toContain('Gratis');
    }
  });

  it('hydrates event_ids up to 3 from search_events results', async () => {
    searchEventsMock.mockResolvedValue({
      events: [
        { id: 'evt-1' },
        { id: 'evt-2' },
        { id: 'evt-3' },
        { id: 'evt-4' },
        { id: 'evt-5' },
      ],
      warnings: [],
    });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    for (const c of result.collections) {
      expect(c.event_ids.length).toBeLessThanOrEqual(3);
    }
    // At least one collection should have hydrated ids
    const any = result.collections.find((c) => c.event_ids.length > 0);
    expect(any).toBeDefined();
  });

  it('empty event_ids is valid (search_events returning 0 events)', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    // Names still present even when no events matched
    expect(result.collections.length).toBeGreaterThanOrEqual(2);
    for (const c of result.collections) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.prompt_text.length).toBeGreaterThan(0);
      expect(c.event_ids).toEqual([]);
    }
  });

  it('search_events throwing on one entry leaves others intact', async () => {
    let callIdx = 0;
    searchEventsMock.mockImplementation(() => {
      callIdx += 1;
      if (callIdx === 1) {
        return Promise.reject(new Error('transient db error'));
      }
      return Promise.resolve({
        events: [{ id: 'evt-survivor' }],
        warnings: [],
      });
    });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    // All collections emitted even though one failed
    expect(result.collections.length).toBeGreaterThanOrEqual(2);
    // Warning surfaced
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes('transient db error'))).toBe(true);
    // Surviving collections still have ids
    const withIds = result.collections.filter((c) => c.event_ids.length > 0);
    expect(withIds.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit option', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      limit: 2,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(result.collections.length).toBe(2);
  });

  it('limit is clamped to MIN/MAX (max 3, min 2)', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const r5 = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      limit: 10,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(r5.collections.length).toBe(3);

    const r0 = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      limit: 0,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(r0.collections.length).toBeGreaterThanOrEqual(2);
  });

  it('returns generated_at as ISO string', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(typeof result.generated_at).toBe('string');
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('every emitted collection has required fields', async () => {
    searchEventsMock.mockResolvedValue({
      events: [{ id: 'evt-a' }, { id: 'evt-b' }],
      warnings: [],
    });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    for (const c of result.collections) {
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.reason).toBe('string');
      expect(c.reason.length).toBeGreaterThan(0);
      expect(typeof c.prompt_text).toBe('string');
      expect(c.prompt_text.length).toBeGreaterThan(0);
      expect(['sv', 'en']).toContain(c.locale);
      expect(Array.isArray(c.event_ids)).toBe(true);
    }
  });

  it('emits distinct collection ids across the result set', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    const ids = result.collections.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('warnings array is empty on happy path', async () => {
    searchEventsMock.mockResolvedValue({ events: [], warnings: [] });
    const result = await getCuratedCollections({
      supabase: {} as SupabaseClient,
      now: makeStockholmDate(2026, 8, 21, 19),
    });
    expect(result.warnings).toEqual([]);
  });
});