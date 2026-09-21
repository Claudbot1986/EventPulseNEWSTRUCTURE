/**
 * Chip SIMULATION (2026-09-20 — the user's "varenda knapp gör vad den lovar"
 * demand, proven at the closest level possible without a device):
 *
 *   chip → resolvePromptIntent → pinned-day resolution (same code path as
 *   App.js) → applyBrowseFilters over a fixture feed with REAL feed slugs
 *   (art-exhibitions, theatre-comedy, barn + family, food-drink …) → assert
 *   the EXACT set of events that survive.
 *
 * "now" is Wednesday 2026-09-23 15:00 for every simulation so results are
 * deterministic: next Saturday = 2026-09-26, next Sunday = 2026-09-27.
 *
 * Run:  npx vitest run 06-UI/utils/chipSimulation.test.ts
 */

import { describe, it, expect } from 'vitest';

import { resolvePromptIntent } from './promptIntent';
import { applyBrowseFilters } from './browseFilters';
import { nextLocalWeekdayIso } from '../screens/home/happeningNow';
import type { ChipCase } from './chipCatalog.testkit';

const NOW = new Date(2026, 8, 23, 15, 0); // Wed 23 Sep 2026 15:00
const WED = '2026-09-23'; // today
const THU = '2026-09-24';
const FRI = '2026-09-25';
const SAT = '2026-09-26'; // next Saturday
const SUN = '2026-09-27'; // next Sunday

/** Fixture feed — deliberately ugly slug/price shapes matching the real feed. */
const EVENTS = [
  { id: 'today-past-event', title: 'Frukostföreläsning', date: WED, time: '09:00', category: 'culture', is_free: true },
  { id: 'today-evening-classical', title: 'Klassisk afton i Konserthuset', date: WED, time: '18:00', category: 'culture', price_min_sek: 180 },
  { id: 'today-evening-jazz', title: 'Jazz på Fasching', date: WED, time: '19:00', category: 'music', price_min_sek: 250 },
  { id: 'today-tonight-music', title: 'Housekväll', date: WED, time: '22:00', category: 'nightlife' },
  { id: 'thu-talk', title: 'Författarsamtal', date: THU, time: '18:00', category: 'culture' },
  { id: 'fri-free-theatre', title: 'Gratis teaterkväll', date: FRI, time: '19:00', category: 'theatre-comedy', is_free: true },
  { id: 'sat-free-music', title: 'Gratis konsert', date: SAT, time: '18:00', category: 'music', is_free: true },
  { id: 'sat-paid-music-300', title: 'Rockkväll', date: SAT, time: '20:00', category: 'music', price_min_sek: 300 },
  { id: 'sat-cheap-music-150', title: 'Indiespelning', date: SAT, time: '19:00', category: 'music', price_min_sek: 150, price_max_sek: 250 },
  { id: 'sat-family', title: 'Barnteater', date: SAT, time: '14:00', category: 'barn', is_free: true },
  { id: 'sat-family-slug', title: 'Familjekonsert', date: SAT, time: '13:00', category: 'family' },
  { id: 'sat-metal-180', title: 'Metal Night: Hårdrock live', date: SAT, time: '21:00', category: 'nightlife', price_min_sek: 180 },
  { id: 'sat-metal-250', title: 'Metalfest', date: SAT, time: '22:00', category: 'music', price_min_sek: 250 },
  { id: 'sun-free-music', title: 'Gratis söndagskonsert', date: SUN, time: '18:00', category: 'music', is_free: true },
  { id: 'sun-art-exhib', title: 'Fotoutställning', date: SUN, time: '11:00', category: 'art-exhibitions' },
  { id: 'sun-sport', title: 'Fotboll: derby', date: SUN, time: '15:00', category: 'sports' },
  { id: 'mon-event', title: 'Måndagsyoga', date: '2026-09-28', time: '10:00', category: 'sports' },
  { id: 'wed-art', title: 'Konstvisning', date: '2026-09-30', time: '12:00', category: 'art' },
];

/** Mirrors the App.js apply flow exactly: intent → pinned ISO → filter chain. */
function simulateChip(chip: ChipCase, now: Date = NOW) {
  const input: Record<string, unknown> = { text: chip.text, ...(chip.hints || {}) };
  const intent = resolvePromptIntent(input);
  const pinnedDateIso = intent.anchor === 'pinned' && intent.pinnedDow != null
    ? nextLocalWeekdayIso(now, intent.pinnedDow)
    : null;
  const survivors = applyBrowseFilters(EVENTS, {
    timeFilter: intent.timeFilter,
    priceFilter: intent.priceFilter,
    selectedCategories: intent.categories || [],
    pinnedDateIso,
    queryTerms: intent.queryTerms || undefined,
  }, now);
  return { intent, pinnedDateIso, survivors: survivors.map((e) => e.id) };
}

describe('chip simulation — curated chips keep their promises', () => {
  it('Klassiskt ikväll: tonight + klassisk/classical titles only', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Klassisk konsert ikväll i Stockholm?', hints: { category_slug: 'music', time_of_day: 'evening' }, expected: {} as never });
    expect(survivors).toEqual(['today-evening-classical']);
  });

  it('Jazz i stan: tonight + jazz titles only (NOT all music)', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Jazz ikväll i Stockholm?', hints: { category_slug: 'music', time_of_day: 'evening' }, expected: {} as never });
    expect(survivors).toEqual(['today-evening-jazz']);
  });

  it('Morgonens lugna toner: all music, no time filter (morning passed at 15:00)', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Lugn musik eller frukostevenemang i Stockholm?', hints: { category_slug: 'music', time_of_day: 'morning' }, expected: {} as never });
    expect(survivors).toEqual([
      'today-evening-jazz', 'sat-free-music', 'sat-paid-music-300',
      'sat-cheap-music-150', 'sat-metal-250', 'sun-free-music',
    ]);
  });

  it('Gratis på lördag: ONLY free events next Saturday', () => {
    const { survivors, pinnedDateIso } = simulateChip({ id: 'x', text: 'Gratis evenemang i Stockholm på lördag?', hints: { budget: 'free', day_filter: 'saturday' }, expected: {} as never });
    expect(pinnedDateIso).toBe(SAT);
    expect(survivors).toEqual(['sat-free-music', 'sat-family']);
  });

  it('Gratis på lördag tapped ON a Saturday → pins NEXT Saturday (server semantics)', () => {
    const saturdayNight = new Date(2026, 8, 26, 23, 0);
    const { pinnedDateIso } = simulateChip(
      { id: 'x', text: 'Gratis evenemang i Stockholm på lördag?', hints: { budget: 'free', day_filter: 'saturday' }, expected: {} as never },
      saturdayNight,
    );
    expect(pinnedDateIso).toBe('2026-10-03');
  });

  it('Gratis på söndag: ONLY free events next Sunday', () => {
    const { survivors, pinnedDateIso } = simulateChip({ id: 'x', text: 'Gratis evenemang i Stockholm på söndag?', hints: { budget: 'free', day_filter: 'sunday' }, expected: {} as never });
    expect(pinnedDateIso).toBe(SUN);
    expect(survivors).toEqual(['sun-free-music']);
  });

  it('Gratis i helgen: free events any Sat/Sun (never Friday)', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Gratis evenemang i Stockholm i helgen?', hints: { budget: 'free', day_filter: 'weekend' }, expected: {} as never });
    expect(survivors).toEqual(['sat-free-music', 'sat-family', 'sun-free-music']);
  });

  it('Konsert under 200 kr: music, free counts, 150≤200 keeps, 250/300 drop', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Konserter i Stockholm under 200 kronor?', hints: { category_slug: 'music', budget: 'low' }, expected: {} as never });
    expect(survivors).toEqual(['sat-free-music', 'sat-cheap-music-150', 'sun-free-music']);
  });

  it('Metal under 200 kr: metal/hårdrock titles ≤200 — even when category is nightlife', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Metal- eller hårdrockskonserter i Stockholm under 200 kronor?', hints: { category_slug: 'music', budget: 'low' }, expected: {} as never });
    expect(survivors).toEqual(['sat-metal-180']); // sat-metal-250 dies on price
  });

  it('Barnens helg: weekend events under barn OR family slugs', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Familjevänliga evenemang i Stockholm i helgen?', hints: { category_slug: 'family', day_filter: 'weekend' }, expected: {} as never });
    expect(survivors).toEqual(['sat-family', 'sat-family-slug']);
  });

  it('Utställningar i helgen: weekend culture/art/art-exhibitions rows', () => {
    const { survivors } = simulateChip({ id: 'x', text: 'Utställningar i Stockholm öppna i helgen?', hints: { category_slug: 'art', day_filter: 'weekend' }, expected: {} as never });
    expect(survivors).toEqual(['sun-art-exhib']);
  });
});

describe('chip simulation — suggested prompts keep their promises', () => {
  const cases: [string, Record<string, unknown>, string[]][] = [
    ['Något intressant i dag?', {}, ['today-evening-classical', 'today-evening-jazz', 'today-tonight-music']],
    ['Konserter i Stockholm i helgen?', { category: 'konserter' }, ['sat-free-music', 'sat-paid-music-300', 'sat-cheap-music-150', 'sat-metal-250', 'sun-free-music']],
    ['Vad ska jag göra ikväll?', {}, ['today-evening-classical', 'today-evening-jazz', 'today-tonight-music']],
    ['Gratis events i helgen?', {}, ['sat-free-music', 'sat-family', 'sun-free-music']],
    ['Konsert ikväll i Stockholm?', { category: 'konserter' }, ['today-evening-jazz']],
    ['Något gratis ikväll?', {}, []], // tonight + free: today's evening fixtures are all paid → honest empty
    ['Vad händer i helgen?', {}, ['sat-free-music', 'sat-paid-music-300', 'sat-cheap-music-150', 'sat-family', 'sat-family-slug', 'sat-metal-180', 'sat-metal-250', 'sun-free-music', 'sun-art-exhib', 'sun-sport']],
    ['Planera för i morgon', {}, ['thu-talk']],
    ['Sport i helgen?', { category: 'sport' }, ['sun-sport']],
    ['Fotbollsmatcher i Stockholm?', { category: 'sport' }, ['sun-sport', 'mon-event']],
    ['Jazz i Stockholm?', { category: 'jazz' }, ['today-evening-jazz']],
    ['Gratis utställningar?', { category: 'utställningar' }, ['today-past-event']], // free + culture-group fixture
    ['Vad händer i stan?', {}, EVENTS.map((e) => e.id)], // no intent → everything survives
  ];

  for (const [text, hints, expectedIds] of cases) {
    it(`"${text}" → [${expectedIds.join(', ')}]`, () => {
      const { survivors } = simulateChip({ id: text, text, hints, expected: {} as never });
      expect(survivors).toEqual(expectedIds);
    });
  }
});
