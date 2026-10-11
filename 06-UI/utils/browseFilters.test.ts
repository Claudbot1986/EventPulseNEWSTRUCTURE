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
const FRI = '2026-09-25'; // Friday
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

  it('all 18 UI-pills are now explicit groups (2026-10-11 — 100 % coverage)', () => {
    // 2026-10-11: music / sports / nightlife lades till i CATEGORY_GROUPS
    // för att täcka musiksubslags (MusicBrainz) och svenska/engelska
    // sport-varianter. Tidigare var dessa pass-through — men pass-through
    // matchar INTE subslags, så coverage-gap kvarstod för 410 events.
    for (const pill of ['music', 'opera', 'theatre-comedy', 'theatre-drama', 'dance',
                        'circus', 'exhibition', 'flea-market', 'food', 'wine-tasting',
                        'kids', 'family', 'film', 'talks-lectures', 'workshop',
                        'sports', 'nightlife', 'community']) {
      expect(pill in CATEGORY_GROUPS).toBe(true);
      expect(CATEGORY_GROUPS[pill as keyof typeof CATEGORY_GROUPS].length).toBeGreaterThan(0);
    }
    expect(matchesCategoryWithGroups({ category: 'music' }, ['sports'])).toBe(false);
    expect(matchesCategoryWithGroups({ category: 'music' }, ['opera'])).toBe(false);
  });

  // 2026-10-11 — pin 100 % coverage. Verifierat mot 11 889 framtida events i
  // Supabase: 0 events vars category_slug inte täcks av någon UI-pill.
  // Varje entry motsvarar en slug som emitterades av adapter/MusicBrainz/
  // normalizer men som INTE var UI-mappad innan denna ändring.
  it('music pill covers MusicBrainz genre subslugs (pass-through)', () => {
    for (const slug of ['music', 'classical', 'jazz', 'rock', 'pop', 'electronic', 'hip-hop']) {
      expect(matchesCategoryWithGroups({ category: slug }, ['music'])).toBe(true);
    }
    expect(matchesCategoryWithGroups({ category: 'opera' }, ['music'])).toBe(false);
  });

  it('theatre-comedy pill covers standup, humor, comedy', () => {
    for (const slug of ['theatre-comedy', 'standup', 'humor', 'comedy']) {
      expect(matchesCategoryWithGroups({ category: slug }, ['theatre-comedy'])).toBe(true);
    }
    expect(matchesCategoryWithGroups({ category: 'theatre-drama' }, ['theatre-comedy'])).toBe(false);
  });

  it('theatre-drama pill covers musical, musikal, musical-theatre, theater', () => {
    for (const slug of ['theatre-drama', 'musical', 'musikal', 'musical-theatre', 'theater']) {
      expect(matchesCategoryWithGroups({ category: slug }, ['theatre-drama'])).toBe(true);
    }
    expect(matchesCategoryWithGroups({ category: 'theatre-comedy' }, ['theatre-drama'])).toBe(false);
  });

  it('dance pill covers dans (svensk form)', () => {
    expect(matchesCategoryWithGroups({ category: 'dance' }, ['dance'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'dans' }, ['dance'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'musical-theatre' }, ['dance'])).toBe(false);
  });

  it('sports pill covers sport (svensk form)', () => {
    expect(matchesCategoryWithGroups({ category: 'sports' }, ['sports'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'sport' }, ['sports'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'football' }, ['sports'])).toBe(false);
  });

  it('family pill covers barn-familj', () => {
    expect(matchesCategoryWithGroups({ category: 'family' }, ['family'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'barn-familj' }, ['family'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'kids' }, ['family'])).toBe(false);
  });

  it('community pill covers festival, festivals, ovrigt', () => {
    for (const slug of ['community', 'festival', 'festivals', 'ovrigt']) {
      expect(matchesCategoryWithGroups({ category: slug }, ['community'])).toBe(true);
    }
    expect(matchesCategoryWithGroups({ category: 'music' }, ['community'])).toBe(false);
  });

  it('regression: barn still in barn group (legacy key preserved)', () => {
    expect(matchesCategoryWithGroups({ category: 'barn' }, ['barn'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'family' }, ['barn'])).toBe(true);
  });

  it('regression: food-drink still in food group (legacy key preserved)', () => {
    expect(matchesCategoryWithGroups({ category: 'food' }, ['food'])).toBe(true);
    expect(matchesCategoryWithGroups({ category: 'food-drink' }, ['food'])).toBe(true);
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
    { date: FRI, time: '12:00', title: 'friday' },
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

  it('helgen: Friday/Saturday/Sunday — helgen börjar på fredag (user 2026-09-22)', () => {
    // 2026-09-20 IS a Sunday, so today's rows are weekend rows too.
    const out = filterEventsByTime(events, 'helgen', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual(['today-late', 'today-past', 'friday', 'saturday', 'sunday']);
  });

  it('denna_vecka: today through +7 days', () => {
    const out = filterEventsByTime(events, 'denna_vecka', at(2026, 9, 20, 15, 0));
    expect(out.map((e: { title: string }) => e.title)).toEqual([
      'today-late', 'today-past', 'monday', 'friday', 'saturday', 'sunday',
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

  // 2026-10-02 (Utforska sök): description lades till i sök-haystacken
  // så fritext-sök matchar mot event-beskrivningen också.
  it('matches against description field', () => {
    const evWithDesc = {
      title: 'Krogshow',
      venue_name: 'Norra Latin',
      description: 'En magisk kväll med standup och levande musik.',
    };
    expect(matchesQuery(evWithDesc, ['standup'])).toBe(true);
    expect(matchesQuery(evWithDesc, ['magisk'])).toBe(true);
    expect(matchesQuery(evWithDesc, ['opera'])).toBe(false);
  });

  it('falls back to description_sv / description_en when description is missing', () => {
    const evWithSv = {
      title: 'Krogshow',
      venue_name: 'Norra Latin',
      description_sv: 'Standup och levande musik.',
    };
    expect(matchesQuery(evWithSv, ['standup'])).toBe(true);
    const evWithEn = {
      title: 'Krogshow',
      venue_name: 'Norra Latin',
      description_en: 'Standup and live music.',
    };
    expect(matchesQuery(evWithEn, ['live'])).toBe(true);
  });

  it('description search is accent- and case-insensitive', () => {
    const ev = {
      title: 'Foo',
      description: 'Café Spécialité',
    };
    expect(matchesQuery(ev, ['cafe'])).toBe(true);
    expect(matchesQuery(ev, ['SPECIALITE'])).toBe(true);
  });

  it('still returns true when description is empty but title matches', () => {
    const ev = { title: 'Jazzkväll', venue_name: 'Fasching' };
    expect(matchesQuery(ev, ['jazz'])).toBe(true);
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
