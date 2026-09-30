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
    range: vi.fn().mockReturnThis(),
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
    // .eq lades till count-chain 2026-10-01 när feed_events lade till
    // kategori-filter på total-frågan. Måste returnera this så att en kedja
    // fortfarande är awaitable.
    eq: vi.fn().mockReturnThis(),
    // .lte lades till count-chain 2026-10-01 (iteration 2) så count-frågan
    // matchar data-frågans [from, to)-fönster. Utan denna övre gräns blev
    // total = "alla events från from och framåt" (för "imorgon": 1181
    // istället för 3).
    lte: vi.fn().mockReturnThis(),
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
 * Two-call mock for mood path: data + mood-count. feed_events skips the
 * normal head:true count when input.mood is set and instead issues a
 * row-fetching mood count. The 2nd call returns moodRows; feed_events
 * applies matchMood internally and counts only matches.
 *
 * 2026-10-01 (stamning consistency): tidigare användes head:true för
 * count, men mood-filtret är en JS-lexikon som PostgREST inte kan uttrycka
 * i SELECT — därför krävs en faktisk row-fetch som filtreras i feed_events.
 * Så feed_events gör 2 .from()-anrop istället för 3 när mood är satt.
 */
function mockSupabaseWithMood(rows: any[], moodRows: any[]): SupabaseClient {
  let call = 0;
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    if (call === 1) return makeChain(rows);
    // 2nd call: mood count (full rows, NOT head:true).
    return makeChain(moodRows);
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
      range: vi.fn().mockReturnThis(),
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
          lte: vi.fn().mockReturnThis(),
          then: (resolve: (v: { count: null; data: null; error: { message: string } }) => void) =>
            Promise.resolve({ count: null, data: null, error: { message: 'count failed' } }).then(resolve),
        };
        return chain;
      }),
    } as unknown as SupabaseClient;
    await expect(feedEvents(sb, { from: '2026-08-18', days: 7 })).rejects.toThrow(/feed_events_count: count failed/);
  });

  // ── Fas C (2026-09-23): ranker fields + artist hop ──────────────────────

  /**
   * Table-aware mock: unlike the call-order mock above, this dispatches on
   * the table name so a third read (event_artists) can coexist with the
   * data + count queries on events_public.
   */
  function makeTableMock(
    tables: Record<string, any>,
    eventsPublicRows: any[],
    totalCount: number
  ): SupabaseClient {
    let eventsPublicCalls = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'events_public') {
        eventsPublicCalls += 1;
        return eventsPublicCalls % 2 === 1
          ? makeChain(eventsPublicRows)
          : makeCountChain(totalCount);
      }
      if (table in tables) return tables[table];
      return makeChain([]);
    });
    return { from } as unknown as SupabaseClient;
  }

  it('maps ranker fields (description, confidence, freshness, venue lat/lng) onto cards', async () => {
    const row = baseRow({
      description_sv: 'En pjäs på scenen.',
      description_en: 'A play on stage.',
      confidence_score: 85,
      freshness_at: '2026-08-19T09:00:00Z',
      lat: 59.3294,
      lng: 18.0686,
    });
    const sb = makeTableMock({}, [row], 1);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    const card = result.events[0];
    expect(card.description).toBe('En pjäs på scenen.');
    expect(card.confidence_score).toBe(85);
    expect(card.freshness_at).toBe('2026-08-19T09:00:00Z');
    expect(card.venue_lat).toBe(59.3294);
    expect(card.venue_lng).toBe(18.0686);
  });

  it('falls back to English description when Swedish is null', async () => {
    const row = baseRow({
      description_sv: null,
      description_en: 'English description.',
    });
    const sb = makeTableMock({}, [row], 1);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.events[0].description).toBe('English description.');
  });

  it('skips the event_artists read when withArtistSlugs is not requested', async () => {
    const failIfTouched: any = {
      select: vi.fn(() => {
        throw new Error('event_artists must not be read without withArtistSlugs');
      }),
    };
    const sb = makeTableMock({ event_artists: failIfTouched }, [baseRow()], 1);
    const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].artist_slugs).toBeUndefined();
  });

  it('attaches lowercased artist_slugs when withArtistSlugs is true', async () => {
    const artistChain: any = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({
          data: [
            {
              event_id: '11111111-1111-1111-1111-111111111111',
              artists: { slug: 'First-Aid-Kit' },
            },
            {
              event_id: '11111111-1111-1111-1111-111111111111',
              artists: { slug: 'Robyn' },
            },
          ],
          error: null,
        }).then(resolve),
    };
    const sb = makeTableMock({ event_artists: artistChain }, [baseRow()], 1);
    const result = await feedEvents(sb, {
      from: '2026-08-18',
      days: 7,
      withArtistSlugs: true,
    });
    expect(result.events[0].artist_slugs).toEqual(['first-aid-kit', 'robyn']);
  });

  it('keeps artist_slugs undefined for events with no artist rows', async () => {
    const artistChain: any = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: any[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const sb = makeTableMock({ event_artists: artistChain }, [baseRow()], 1);
    const result = await feedEvents(sb, {
      from: '2026-08-18',
      days: 7,
      withArtistSlugs: true,
    });
    expect(result.events[0].artist_slugs).toBeUndefined();
  });

  // 2026-09-28: Utforska infinite scroll — offset/limit-paginering.
  describe('offset/limit pagination', () => {
    it('sends offset=0..limit as .range when no offset supplied', async () => {
      const chain = makeChain([]);
      const sb = { from: vi.fn().mockReturnValueOnce(chain).mockReturnValueOnce(makeCountChain(0)) } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 15 });
      expect(chain.range).toHaveBeenCalledWith(0, 15);
    });

    it('uses explicit offset in .range when provided', async () => {
      const chain = makeChain([]);
      const sb = { from: vi.fn().mockReturnValueOnce(chain).mockReturnValueOnce(makeCountChain(0)) } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 15, offset: 30 });
      expect(chain.range).toHaveBeenCalledWith(30, 45);
    });

    it('clamps negative offset to 0', async () => {
      const chain = makeChain([]);
      const sb = { from: vi.fn().mockReturnValueOnce(chain).mockReturnValueOnce(makeCountChain(0)) } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 15, offset: -5 });
      expect(chain.range).toHaveBeenCalledWith(0, 15);
    });

    it('sets has_more when next page is still available (range returns limit+1 rows)', async () => {
      // offset=0, limit=15 → range(0, 15) returns 16 rows. has_more=true.
      const rows = Array.from({ length: 16 }, (_, i) => baseRow({ id: `id-${i}` }));
      const sb = mockSupabaseWithRows(rows);
      const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 15, offset: 0 });
      expect(result.events).toHaveLength(15);
      expect(result.has_more).toBe(true);
    });

    it('clears has_more on last page (range returns exactly limit rows)', async () => {
      const rows = Array.from({ length: 15 }, (_, i) => baseRow({ id: `id-${i}` }));
      const sb = mockSupabaseWithRows(rows);
      const result = await feedEvents(sb, { from: '2026-08-18', days: 7, limit: 15, offset: 30 });
      expect(result.events).toHaveLength(15);
      expect(result.has_more).toBe(false);
    });
  });

  // 2026-10-01: Utforska-tiles visar kategorispecifikt antal ("opera visar 8
  // events i DB") istället för det lokalt renderade sidans längd. Count-frågan
  // måste därför applicera samma kategori-filter som data-frågan — annars
  // headern visar t.ex. 1181 events för musik när användaren klickade opera
  // (där bara 8 finns).
  describe('total reflects category filter', () => {
    it('passes category filter to the count query so total matches the user-visible scope', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(8);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 7,
        category: 'opera',
      });
      expect(result.total).toBe(8);
      expect(countChain.eq).toHaveBeenCalledWith('category_slug', 'opera');
    });

    it('does not call .eq on the count chain when no category filter is set', async () => {
      // HomeScreen-vyn har ingen category — count ska inte smyga in ett filter.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(7943);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, { from: '2026-08-18', days: 7 });
      expect(result.total).toBe(7943);
      expect(countChain.eq).not.toHaveBeenCalled();
    });

    it('count query stays head:true (cheap count-only, no row bodies)', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(12);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 7, category: 'music' });
      expect(countChain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    });
  });

  // 2026-10-01 (iteration 3, användarens förtydligande): count-frågan ska INTE
  // begränsas av `toIso`. Användaren vill se "samtliga framtida opera-events
  // i DB" för opera-knappen, inte "opera-events inom 14-dagarsfönstret".
  // Total = alla framtida events som matchar kategori/lower-bound, oavsett
  // hur långt in i framtiden de ligger. Regression-skydd: om någon lägger
  // tillbaka `.lte(toIso)` ska testet nedan fånga det.
  describe('total is NOT window-bounded (full future DB total per category)', () => {
    it('does NOT call .lte on the count chain so total includes all future events', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(1200);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      // Opera-routen: from=today, days=14, category='opera'. Data-frågan
      // returnerar 14 dagars opera-events, men total ska vara ALLA framtida
      // opera-events i DB (1200 i detta mock-exempel) oavsett fönster.
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        category: 'opera',
      });
      expect(result.total).toBe(1200);
      expect(countChain.lte).not.toHaveBeenCalled();
    });

    it('keeps .gt(now) so past events are excluded from the total', async () => {
      // Regression-skydd: användaren sa "bara framtia events" — .gt(now)
      // måste vara kvar även när övre gränsen är borta.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(500);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 7 });
      expect(countChain.gt).toHaveBeenCalledWith(
        'start_time',
        expect.any(String), // new Date().toISOString() vid test-tid
      );
    });

    it('keeps .gte(fromIso) so "imorgon" counts from tomorrow onward (not today)', async () => {
      // Imorgon-routen: fromIso = imorgon. Total ska vara "från imorgon och
      // framåt" — inte dagens events som redan ligger före imorgon i tiden.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(1181);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, { from: '2026-08-19', days: 1 });
      expect(result.total).toBe(1181); // alla events från 2026-08-19 och framåt
      expect(countChain.gte).toHaveBeenCalledWith(
        'start_time',
        expect.stringMatching(/^2026-08-19/),
      );
    });

    it('category routes count ALL future events in that category, not just the window slice', async () => {
      // Användarens önskemål: opera-knappen visar "1200 EVENEMANG" för ALLA
      // framtida opera-events, inte "47 EVENEMANG" för bara 14-dagarsfönstret.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(1200);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        category: 'opera',
      });
      expect(result.total).toBe(1200);
      expect(countChain.eq).toHaveBeenCalledWith('category_slug', 'opera');
      // Säkerställ att inget lte smyger sig in — vi vill ha obegränsad framtid.
      expect(countChain.lte).not.toHaveBeenCalled();
    });
  });

  // 2026-10-01 (gratis-tile consistency): isFree=true lägger till
  // .eq('is_free', true) på både data- och count-query så count matchar
  // antalet events användaren faktiskt ser. Utan detta skulle headern
  // visa hela fönstrets antal medan bara en bråkdel var gratis.
  describe('isFree filter (gratis tile)', () => {
    it('passes isFree=true to .eq on the data chain', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(42);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 14, isFree: true });
      expect(dataChain.eq).toHaveBeenCalledWith('is_free', true);
    });

    it('passes isFree=true to .eq on the count chain so total is filtered', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(42);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        isFree: true,
      });
      expect(result.total).toBe(42);
      expect(countChain.eq).toHaveBeenCalledWith('is_free', true);
    });

    it('does NOT call .eq(is_free) when isFree is undefined or false', async () => {
      // Använd en enkel mock som returnerar samma chains oavsett antal
      // feedEvents-anrop. Här bryr vi oss bara om eq(mock)-anrop, inte
      // antalet from()-anrop.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(500);
      const sb = {
        from: vi.fn().mockReturnValue(dataChain),
      } as unknown as SupabaseClient;
      // För count-chain: ersätt dataChain med countChain via mockImplementation
      // som håller koll på samtal. Håller det enkelt: vi bryr oss bara om
      // eq-anropen, så vi kan låta båda anrop returnera samma kedja.
      // undefined
      await feedEvents(sb, { from: '2026-08-18', days: 7 });
      // false
      await feedEvents(sb, { from: '2026-08-18', days: 7, isFree: false });
      // Viktigt: is_free ska INTE vara med i eq-anropen. Andra eq-anrop
      // (category etc.) är okej — vi filtrerar med toHaveBeenCalledWith.
      const eqCalls = (dataChain.eq as any).mock.calls;
      const isFreeEqCalls = eqCalls.filter(
        (c: any[]) => c[0] === 'is_free' && c[1] === true,
      );
      expect(isFreeEqCalls).toHaveLength(0);
    });
  });

  // 2026-10-01: count är fönster-bundet BY DEFAULT så att headern
  // speglar data-frågans [from, to)-fönster. RENA kategori-queries
  // (bara category, inga andra filter) behåller dock full-future count
  // eftersom användaren bad om "samtliga framtida <kategori>-events".
  describe('total is window-bounded by default (matches data window)', () => {
    it('adds .lte(toIso) to count chain when no category set', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(47);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      const result = await feedEvents(sb, { from: '2026-08-18', days: 14 });
      expect(result.total).toBe(47);
      expect(countChain.lte).toHaveBeenCalledWith(
        'start_time',
        expect.stringMatching(/^2026-09-01/), // 2026-08-18 + 14 = 2026-09-01
      );
    });

    it('adds .lte(toIso) to count chain when isFree is set (not pure category)', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(12);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        category: 'music',
        isFree: true,
      });
      // isFree=true gör att queryn inte är "ren kategori" — count måste
      // vara window-bounded så headern visar "12 gratis musik-events i
      // fönstret" inte "alla gratis musik-events i alla tider".
      expect(countChain.lte).toHaveBeenCalled();
    });
  });

  // 2026-10-01 (stamning-tile consistency): mood i feed_events flyttar
  // både data- och count-filtret in i feed_events så de är konsekventa.
  // PostgREST kan inte uttrycka mood-lexikonet i SQL, så count-queryn
  // gör en 3:e fetch (inte head:true) som filtreras i JS via matchMood.
  describe('mood filter (stamning tile) — count consistency', () => {
    it('issues a mood-aware count query to events_public when mood is set', async () => {
      // Stamning-routen: input.mood='stamningsfullt'. feed_events gör
      // data + mood-count (inte head:true count eftersom mood-lexikonet
      // inte kan uttryckas i SQL). 2 anrop totalt: data, sedan mood-count
      // som ersätter den vanliga head:true-counten.
      const dataChain = makeChain([]);
      const moodChain = makeChain([]);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(moodChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        mood: 'stamningsfullt',
      });
      expect(sb.from).toHaveBeenCalledTimes(2);
      // Säkerställ att mood-chainen INTE använder head:true (mood-count
      // behöver rader för matchMood, inte bara en siffra).
      const moodSelectCalls = (moodChain.select as any).mock.calls;
      const headSelect = moodSelectCalls.find(
        (c: any[]) => c[1]?.head === true,
      );
      expect(headSelect).toBeUndefined();
    });

    it('does NOT issue the 3rd mood query when mood is unset', async () => {
      // Regression-skydd: om någon sätter mood som default ska testet
      // fånga att vi inte längre betalar mood-count-kostnaden för varje
      // feed-anrop.
      const dataChain = makeChain([]);
      const countChain = makeCountChain(500);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      await feedEvents(sb, { from: '2026-08-18', days: 14 });
      expect(sb.from).toHaveBeenCalledTimes(2);
    });

    it('counts only mood-matching rows when mood is set (mood-aware count path)', async () => {
      // Stamningsfullt = "stämningsfull" / "intim" / etc. + opera/dance.
      // Mock innehåller 5 events varav 3 matchar (opera-anchor, magisk,
      // intim). feed_events ska returnera total=3 efter matchMood-filter.
      const dataRows = [
        { id: '1', title_sv: 'La Bohème', description_sv: '', category_slug: 'opera' },
        { id: '2', title_sv: 'Magisk afton', description_sv: 'stämningsfull kväll', category_slug: 'music' },
        { id: '3', title_sv: 'Hockeymatch', description_sv: '', category_slug: 'sports' },
        { id: '4', title_sv: 'Ståupp', description_sv: '', category_slug: 'theatre-comedy' },
        { id: '5', title_sv: 'Intim konsert', description_sv: '', category_slug: 'music' },
      ];
      const sb = mockSupabaseWithMood([], dataRows) as any;
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        mood: 'stamningsfullt',
      });
      expect(result.total).toBe(3);
    });

    it('filters events array by mood so returned events match total', async () => {
      // Data-frågan returnerar 3 rader varav 1 matchar mood. Headern
      // visar total = 1 (från mood-count), events-listan har 1 rad.
      const dataRows = [
        { id: '1', title_sv: 'La Bohème', description_sv: '', category_slug: 'opera' },
        { id: '2', title_sv: 'Hockey', description_sv: '', category_slug: 'sports' },
        { id: '3', title_sv: 'Ståupp', description_sv: '', category_slug: 'theatre-comedy' },
      ];
      // moodRows = samma som dataRows (data returneras också i mood-count)
      const sb = mockSupabaseWithMood(dataRows, dataRows) as any;
      const result = await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        mood: 'stamningsfullt',
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('1');
      expect(result.total).toBe(1);
    });

    it('silently ignores unknown mood ids (no 3rd query, no filter)', async () => {
      const dataChain = makeChain([]);
      const countChain = makeCountChain(500);
      const sb = {
        from: vi.fn()
          .mockReturnValueOnce(dataChain)
          .mockReturnValueOnce(countChain),
      } as unknown as SupabaseClient;
      // 'made-up-mood' finns inte i MOOD_IDS → ignoreras.
      await feedEvents(sb, {
        from: '2026-08-18',
        days: 14,
        mood: 'made-up-mood',
      });
      expect(sb.from).toHaveBeenCalledTimes(2); // ingen 3:e
    });
  });
});
