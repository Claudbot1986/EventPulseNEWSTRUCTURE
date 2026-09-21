/**
 * Pins the Utforska browse-filter chain (utils/browseFilters.js) against the
 * REAL feed category slugs and price shapes (2026-09-20). The user demand:
 * every Home chip must actually filter to what its text promises — these
 * tests are the fixture-level proof for the filter half (promptIntent covers
 * the intent half; the per-chip simulation combines both).
 *
 * Run:  npx vitest run 06-UI/utils/browseFilters.test.ts
 */

import { describe, it, expect } from 'vitest';

import {
  normalizeSearchText,
  CATEGORY_GROUPS,
  matchesCategoryWithGroups,
  filterEventsByTime,
  matchesPriceFilter,
  matchesPinnedDate,
  matchesQuery,
  applyBrowseFilters,
} from './browseFilters';

/** Local Date shorthand: at(2026, 9, 20, 18, 30) = 20 Sep 2026 18:30. */
function at(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm);
}

const SAT = '2026-09-26'; // Saturday
const SUN = '2026-09-27'; // Sunday
const MON = '2026-09-21'; // Monday

describe('normalizeSearchText', () => {
  it('strips case and accents so "cafe" matches "Café"', () => {
    expect(normalizeSearchText('Café')).toBe('cafe');
    expect(normalizeSearchText(' SÖDER ')).toBe(' soder '); // Ö → O + diaeresis stripped, spaces kept
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(undefined)).toBe('');
  });
});

describe('matchesCategoryWithGroups — real feed slugs', () => {
  it('culture pill matches culture, art AND art-exhibitions', () => {
    expect(matchesCategoryWithGroups({ category: 'culture' }, ['culture'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'art' }, ['culture'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'art-exhibitions' }, ['culture'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'music' }, ['culture'])).toBe(false);
  });

  it('barn pill matches both barn and family slugs', () => {
    expect(matchesCategoryWithGroups({ category: 'barn' }, ['barn'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'family' }, ['barn'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'music' }, ['barn'])).toBe(false);
  });

  it('theatre pill matches theatre-comedy rows', () => {
    expect(matchesCategoryWithGroups({ category: 'theatre' }, ['theatre'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'theatre-comedy' }, ['theatre'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'nightlife' }, ['theatre'])).toBe(false);
  });

  it('food pill matches food-drink rows', () => {
    expect(matchesCategoryWithGroups({ category: 'food' }, ['food'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'food-drink' }, ['food'])).toBe(true);
  });

  it('ungrouped pills pass through exactly (music/sports/nightlife)', () => {
    expect('music' in CATEGORY_GROUPS).toBe(false);
    expect(matchesCategoryWithGroups({ category: 'music' }, ['music'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'music' }, ['sports'])).toBe(false);
  });

  it('multiple selected pills = OR across groups', () => {
    expect(matchesCategoryWithGroups({ category: 'art-exhibitions' }, ['music', 'culture'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'food-drink' }, ['music', 'culture'])).toBe(false);
  });

  it('empty selection = no constraint; missing category never matches a selection', () => {
    expect(matchesCategoryWithGroups({ category: 'music' }, [])).toBe(true);
    expect(matchesCategoryWithGroups({}, ['music'])).toBe(false);
    expect(matchesCategoryWithGroups(null, ['music'])).toBe(false);
  });
});

describe('filterEventsByTime — verbatim move from App.js', () => {
  const events = [
    { date: '2026-09-20', time: '20:00', title: 'today-late' },
    { date: '2026-09-20', time: '10:00', title: 'today-past' },
    { date: MON, time: '10:00', title: 'monday' },
    { date: SAT, time: '12:00', title: 'saturday' },
    { date: SUN, time: '12:00', title: 'sunday' },
    { date: '2026-10-15', time: '12:00', title: 'far-future' },
  ];

  it('ikvall: today after now only', () => {
    const out = filterEventsByTime(events, 'ikvall', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual(['today-late']);
  });

  it('imorgon: exactly tomorrow', () => {
    const out = filterEventsByTime(events, 'imorgon', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual(['monday']);
  });

  it('helgen: every Saturday/Sunday in the window — a Sunday "now" includes today', () => {
    // 2026-09-20 IS a Sunday, so today's rows are weekend rows too.
    const out = filterEventsByTime(events, 'helgen', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual(['today-late', 'today-past', 'saturday', 'sunday']);
  });

  it('denna_vecka: today through +7 days', () => {
    const out = filterEventsByTime(events, 'denna_vecka', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual([
      'today-late', 'today-past', 'monday', 'saturday', 'sunday',
    ]);
  });

  it('null filter returns input unchanged; bad date rows are dropped', () => {
    expect(filterEventsByTime(events, null, at(2026, 9, 20))).toBe(events);
    expect(filterEventsByTime([{ title: 'no-date' }], 'helgen', at(2026, 9, 20))).toEqual([]);
  });
});

describe('matchesPriceFilter', () => {
  it('free: only explicitly-free events', () => {
    expect(matchesPriceFilter({ is_free: true }, 'free')).toBe(true);
    expect(matchesPriceFilter({ isFree: true }, 'free')).toBe(true);
    expect(matchesPriceFilter({ is_free: false, price_min_sek: 0 }, 'free')).toBe(false);
    expect(matchesPriceFilter({}, 'free')).toBe(false);
  });

  it('under_200: free events count', () => {
    expect(matchesPriceFilter({ is_free: true }, 'under_200')).toBe(true);
    expect(matchesPriceFilter({ isFree: true }, 'under_200')).toBe(true);
  });

  it('under_200: price_min_sek ≤ 200 counts (both camel and snake shapes)', () => {
    expect(matchesPriceFilter({ price_min_sek: 150, price_max_sek: 400 }, 'under_200')).toBe(true);
    expect(matchesPriceFilter({ priceMin: 200, priceMax: 400 }, 'under_200')).toBe(true);
    expect(matchesPriceFilter({ price_min_sek: 250 }, 'under_200')).toBe(false);
  });

  it('under_200: missing min falls back to price_max ≤ 200', () => {
    expect(matchesPriceFilter({ price_min_sek: null, price_max_sek: 200 }, 'under_200')).toBe(true);
    expect(matchesPriceFilter({ price_min_sek: null, price_max_sek: 500 }, 'under_200')).toBe(false);
  });

  it('under_200: no price info at all does NOT match', () => {
    expect(matchesPriceFilter({}, 'under_200')).toBe(false);
    expect(matchesPriceFilter({ price_min_sek: null, price_max_sek: null }, 'under_200')).toBe(false);
    expect(matchesPriceFilter(null, 'under_200')).toBe(false);
  });

  it('null key = no constraint', () => {
    expect(matchesPriceFilter({ price_min_sek: 9999 }, null)).toBe(true);
  });
});

describe('matchesPinnedDate', () => {
  it('matches exactly the pinned day', () => {
    expect(matchesPinnedDate({ date: SAT }, SAT)).toBe(true);
    expect(matchesPinnedDate({ date: SUN }, SAT)).toBe(false);
  });

  it('tolerates datetime-shaped dates by comparing the day part', () => {
    expect(matchesPinnedDate({ date: `${SAT}T19:00:00` }, SAT)).toBe(true);
  });

  it('null pin = no constraint', () => {
    expect(matchesPinnedDate({ date: SAT }, null)).toBe(true);
  });
});

describe('matchesQuery — genre prefill terms', () => {
  const ev = { title: 'Klassisk konsert', venue_name: 'Konserthuset' };

  it('any-match: one of several terms is enough', () => {
    expect(matchesQuery(ev, ['klassisk', 'classical'])).toBe(true);
    expect(matchesQuery({ title: 'Classical evening', venue_name: '' }, ['klassisk', 'classical'])).toBe(true);
    expect(matchesQuery(ev, ['metal', 'hårdrock'])).toBe(false);
  });

  it('matches venue too, accent-insensitively', () => {
    expect(matchesQuery({ title: 'Fika', venue: 'Café Saturnus' }, ['cafe'])).toBe(true);
  });

  it('empty terms = no constraint', () => {
    expect(matchesQuery(ev, [])).toBe(true);
    expect(matchesQuery(ev, undefined)).toBe(true);
  });
});

describe('applyBrowseFilters — the full chain', () => {
  const now = at(2026, 9, 20, 15, 0); // Sunday 15:00

  const events = [
    { title: 'Gratis jazz lördag', date: SAT, time: '18:00', category: 'music', is_free: true },
    { title: 'Betald jazz lördag', date: SAT, time: '20:00', category: 'music', price_min_sek: 300 },
    { title: 'Gratis utställning lördag', date: SAT, time: '11:00', category: 'art-exhibitions', is_free: true },
    { title: 'Gratis jazz söndag', date: SUN, time: '18:00', category: 'music', is_free: true },
    { title: 'Okänt pris jazz lördag', date: SAT, time: '21:00', category: 'music' },
  ];

  it('gratis + pinned Saturday keeps ONLY free Saturday events', () => {
    const out = applyBrowseFilters(events, { priceFilter: 'free', pinnedDateIso: SAT }, now);
    expect(out.map((e) => e.title)).toEqual(['Gratis jazz lördag', 'Gratis utställning lördag']);
  });

  it('culture group + helgen keeps art-exhibitions on the weekend', () => {
    const out = applyBrowseFilters(events, { selectedCategories: ['culture'], timeFilter: 'helgen' }, now);
    expect(out.map((e) => e.title)).toEqual(['Gratis utställning lördag']);
  });

  it('genre queryTerms narrow inside the weekend', () => {
    const out = applyBrowseFilters(events, { timeFilter: 'helgen', queryTerms: ['jazz'] }, now);
    expect(out.map((e) => e.title)).toEqual([
      'Gratis jazz lördag', 'Betald jazz lördag', 'Gratis jazz söndag', 'Okänt pris jazz lördag',
    ]);
  });

  it('queryTerms take precedence over a conflicting searchText', () => {
    const out = applyBrowseFilters(events, { queryTerms: ['utställning'], searchText: 'jazz' }, now);
    expect(out.map((e) => e.title)).toEqual(['Gratis utställning lördag']);
  });

  it('no filters returns everything; non-array input becomes empty', () => {
    expect(applyBrowseFilters(events, {}, now)).toHaveLength(5);
    expect(applyBrowseFilters(null as unknown as any[], {}, now)).toEqual([]);
  });
});
