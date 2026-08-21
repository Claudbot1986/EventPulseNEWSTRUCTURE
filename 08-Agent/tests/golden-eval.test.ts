/**
 * Golden eval harness — anti-hallucination regression.
 *
 * Drives the deterministic parse → search (mock) → rank → top-5 pipeline
 * for each entry in ./golden-eval.json and asserts:
 *   - parseIntent output matches expected_* fields.
 *   - every returned card id is one that came out of the (mocked) tool.
 *   - if expected_min_results > 0, the top-5 must contain a card in the
 *     expected categories (when categories are requested).
 *
 * No LLM is involved. The harness exists so that when Phase 1 introduces the
 * model router, we can re-run it and prove the model layer does not invent or
 * re-rank events.
 *
 * Run with:  npx vitest run 08-Agent/tests/golden-eval.test.ts
 */

import { describe, expect, it } from 'vitest';
import { deterministicReply } from '../llmRouter';
import golden from './golden-eval.json';
import { parseIntentDeterministic } from '../tools/parse_intent';
import { rankEvents } from '../tools/rank_events';
import type { EventCard, IntentBrief, RankReason } from '../types';

const TODAY = new Date('2026-08-17T10:00:00Z');

// Toy Stockholm fixture: 15 plausible events across categories.
const fixtureCards: EventCard[] = [
  { id: 'm1', title: 'Jazz kväll',         start_time: '2026-08-17T20:00:00Z', end_time: null, venue_name: 'Konserthuset',   city: 'Stockholm', category_slug: 'music',   price_min_sek: 150, price_max_sek: 250, is_free: false, ticket_url: null, image_url: null },
  { id: 'm2', title: 'Klassisk konsert',   start_time: '2026-08-18T19:00:00Z', end_time: null, venue_name: 'Konserthuset',   city: 'Stockholm', category_slug: 'music',   price_min_sek: 200, price_max_sek: 400, is_free: false, ticket_url: null, image_url: null },
  { id: 'm3', title: 'Indie konsert',      start_time: '2026-08-19T21:00:00Z', end_time: null, venue_name: 'Debaser',         city: 'Stockholm', category_slug: 'music',   price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'm4', title: 'Rock ikväll',        start_time: '2026-08-17T22:00:00Z', end_time: null, venue_name: 'Fryshuset',       city: 'Stockholm', category_slug: 'music',   price_min_sek: 250, price_max_sek: 350, is_free: false, ticket_url: null, image_url: null },
  { id: 't1', title: 'Hamlet',             start_time: '2026-08-22T19:00:00Z', end_time: null, venue_name: 'Dramaten',        city: 'Stockholm', category_slug: 'theater', price_min_sek: 200, price_max_sek: 500, is_free: false, ticket_url: null, image_url: null },
  { id: 't2', title: 'Trollflöjten',       start_time: '2026-08-23T15:00:00Z', end_time: null, venue_name: 'Operan',          city: 'Stockholm', category_slug: 'theater', price_min_sek: 150, price_max_sek: 400, is_free: false, ticket_url: null, image_url: null },
  { id: 'd1', title: 'Balett',             start_time: '2026-08-17T19:00:00Z', end_time: null, venue_name: 'Operan',          city: 'Stockholm', category_slug: 'dance',   price_min_sek: 180, price_max_sek: 380, is_free: false, ticket_url: null, image_url: null },
  { id: 'f1', title: 'Premiär bio',        start_time: '2026-08-17T19:30:00Z', end_time: null, venue_name: 'Skandia',         city: 'Stockholm', category_slug: 'film',    price_min_sek: 120, price_max_sek: 120, is_free: false, ticket_url: null, image_url: null },
  { id: 'a1', title: 'Fotografiska',       start_time: '2026-08-22T11:00:00Z', end_time: null, venue_name: 'Fotografiska',    city: 'Stockholm', category_slug: 'art',     price_min_sek: 0,   price_max_sek: 0,   is_free: false, ticket_url: null, image_url: null },
  { id: 'a2', title: 'Moderna museet',     start_time: '2026-08-23T11:00:00Z', end_time: null, venue_name: 'Moderna',         city: 'Stockholm', category_slug: 'art',     price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fa1',title: 'Barnteater',         start_time: '2026-08-22T14:00:00Z', end_time: null, venue_name: 'Kulturhuset',     city: 'Stockholm', category_slug: 'family',  price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fa2',title: 'Familjekonsert',     start_time: '2026-08-23T14:00:00Z', end_time: null, venue_name: 'GöteborgsOperan', city: 'Stockholm', category_slug: 'family',  price_min_sek: 100, price_max_sek: 200, is_free: false, ticket_url: null, image_url: null },
  { id: 'l1', title: 'Föreläsning',        start_time: '2026-08-22T18:00:00Z', end_time: null, venue_name: 'Bokmässan',       city: 'Stockholm', category_slug: 'lecture', price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fo1',title: 'Street food market', start_time: '2026-08-22T12:00:00Z', end_time: null, venue_name: 'Slakthusplan',    city: 'Stockholm', category_slug: 'food',    price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fo2',title: 'Matfestival',        start_time: '2026-08-23T12:00:00Z', end_time: null, venue_name: 'Skansen',         city: 'Stockholm', category_slug: 'food',    price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  // ── Evening-local Stockholm cards on 2026-08-17 ──────────────────────────
  // rank_events reads the *local* hour (Europe/Stockholm, CEST = UTC+2 in
  // August) when classifying morning/afternoon/evening/night. UTC 18:00 in
  // August → local 20:00 → evening bucket. These cards exist so that
  // date-filtered queries like "konsert ikväll" still find an evening-match
  // card after the 2026-08-17 hard filter.
  { id: 'm5', title: 'Jazz afton',         start_time: '2026-08-17T18:00:00Z', end_time: null, venue_name: 'Fasching',        city: 'Stockholm', category_slug: 'music',   price_min_sek: 180, price_max_sek: 280, is_free: false, ticket_url: null, image_url: null },
  { id: 't3', title: 'Improviserad afton', start_time: '2026-08-17T18:30:00Z', end_time: null, venue_name: 'Stadsteatern',    city: 'Stockholm', category_slug: 'theater', price_min_sek: 150, price_max_sek: 350, is_free: false, ticket_url: null, image_url: null },
  { id: 'fo3',title: 'Kvällsmat på torget',start_time: '2026-08-17T17:00:00Z', end_time: null, venue_name: 'Östermalmstorg',  city: 'Stockholm', category_slug: 'food',    price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
];

// The "tool result" — what search_events would return if it ran against
// the real DB. We pre-filter by city=Stockholm + future-only as the real
// tool does, then run the ranker on top.
const toolCards: EventCard[] = fixtureCards.filter(
  (c) => c.city === 'Stockholm' && new Date(c.start_time).getTime() > TODAY.getTime()
);
const toolIdSet = new Set(toolCards.map((c) => c.id));

interface GoldenCase {
  id: string;
  query: string;
  expected_language?: 'sv' | 'en';
  expected_time_of_day?: IntentBrief['time_of_day'];
  expected_city?: string;
  expected_categories?: string[];
  expected_exclude_categories?: string[];
  expected_budget?: IntentBrief['budget'];
  expected_party?: IntentBrief['party'];
  expected_date_range?: 'today' | 'this_weekend' | 'next_week';
  expected_min_results?: number;
  expected_reasons_must_contain?: RankReason[];
  expected_reasons_must_not_contain?: RankReason[];
}

function filterByIntent(cards: EventCard[], intent: IntentBrief): EventCard[] {
  let out = cards;
  // Date range — applied as a hard filter. parse_intent emits YYYY-MM-DD
  // boundaries, so expand to day endpoints (matches search_events.ts logic).
  if (intent.date_from) {
    const f = new Date(`${intent.date_from}T00:00:00.000Z`).getTime();
    out = out.filter((c) => new Date(c.start_time).getTime() >= f);
  }
  if (intent.date_to) {
    const t = new Date(`${intent.date_to}T23:59:59.999Z`).getTime();
    out = out.filter((c) => new Date(c.start_time).getTime() <= t);
  }
  if (intent.categories.length > 0) {
    out = out.filter((c) => intent.categories.includes(c.category_slug));
  }
  if (intent.exclude_categories.length > 0) {
    const ex = new Set(intent.exclude_categories);
    out = out.filter((c) => !ex.has(c.category_slug));
  }
  return out;
}

describe('golden eval (anti-hallucination)', () => {
  for (const tc of golden as GoldenCase[]) {
    it(`${tc.id} — ${tc.query}`, () => {
      const intent = parseIntentDeterministic(tc.query, TODAY);

      // intent assertions
      if (tc.expected_language)         expect(intent.language).toBe(tc.expected_language);
      if (tc.expected_time_of_day)      expect(intent.time_of_day).toBe(tc.expected_time_of_day);
      if (tc.expected_city)             expect(intent.city).toBe(tc.expected_city);
      if (tc.expected_budget)           expect(intent.budget).toBe(tc.expected_budget);
      if (tc.expected_party)            expect(intent.party).toBe(tc.expected_party);
      if (tc.expected_categories)       expect(intent.categories).toEqual(tc.expected_categories);
      if (tc.expected_exclude_categories) expect(intent.exclude_categories).toEqual(tc.expected_exclude_categories);

      // date range expectations
      if (tc.expected_date_range === 'today') {
        expect(intent.date_from).toBe('2026-08-17');
        expect(intent.date_to).toBe('2026-08-17');
      } else if (tc.expected_date_range === 'this_weekend') {
        expect(intent.date_from).toBe('2026-08-22');
        expect(intent.date_to).toBe('2026-08-23');
      } else if (tc.expected_date_range === 'next_week') {
        expect(intent.date_from).toBe('2026-08-24');
        expect(intent.date_to).toBe('2026-08-30');
      }

      // pipeline: mock tool → rank
      const toolResult = filterByIntent(toolCards, intent);
      const ranked = rankEvents(toolResult, intent, { now: TODAY, topN: 5 });

      // anti-hallucination: every returned id MUST come from the tool result
      for (const r of ranked) {
        expect(toolIdSet.has(r.card.id)).toBe(true);
      }

      // category-must-be-in-top if expected_categories was requested and min_results > 0
      if (tc.expected_min_results && tc.expected_min_results > 0 &&
          tc.expected_categories && tc.expected_categories.length > 0) {
        const anyInTop = ranked.some((r) =>
          tc.expected_categories!.includes(r.card.category_slug)
        );
        expect(anyInTop).toBe(true);
      }

      // reasons[] assertions (Phase 1). Only meaningful when there ARE top results.
      if (ranked.length > 0) {
        if (tc.expected_reasons_must_contain && tc.expected_reasons_must_contain.length > 0) {
          const cardWithAllReasons = ranked.find((r) =>
            tc.expected_reasons_must_contain!.every((reason) => r.reasons.includes(reason))
          );
          expect(cardWithAllReasons, `${tc.id}: no top-5 card has all of [${tc.expected_reasons_must_contain.join(', ')}]`).toBeDefined();
        }
        if (tc.expected_reasons_must_not_contain && tc.expected_reasons_must_not_contain.length > 0) {
          for (const r of ranked) {
            for (const forbidden of tc.expected_reasons_must_not_contain) {
              expect(r.reasons, `${tc.id}: top-5 card ${r.card.id} unexpectedly has '${forbidden}'`).not.toContain(forbidden);
            }
          }
        }
      }
    });
  }
});

describe('anti-hallucination: empty queries must return empty (no fabrication)', () => {
  it('returns empty for nonsense queries', () => {
    const intent = parseIntentDeterministic('zzzzzzzzz qqqqqqqq', TODAY);
    const ranked = rankEvents([], intent, { now: TODAY });
    expect(ranked).toEqual([]);
  });
});

describe('filterByIntent date range (regression: date filter must be enforced)', () => {
  it('"nästa vecka" returns only events in 2026-08-24..2026-08-30', () => {
    const intent = parseIntentDeterministic('nästa vecka', TODAY);
    expect(intent.date_from).toBe('2026-08-24');
    expect(intent.date_to).toBe('2026-08-30');
    const out = filterByIntent(toolCards, intent);
    for (const c of out) {
      const t = new Date(c.start_time).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date('2026-08-24T00:00:00Z').getTime());
      expect(t).toBeLessThanOrEqual(new Date('2026-08-30T23:59:59Z').getTime());
    }
  });

  it('"ikväll" returns only events on 2026-08-17 (no weekend/week-after leak)', () => {
    const intent = parseIntentDeterministic('ikväll', TODAY);
    expect(intent.date_from).toBe('2026-08-17');
    expect(intent.date_to).toBe('2026-08-17');
    const out = filterByIntent(toolCards, intent);
    for (const c of out) {
      const t = new Date(c.start_time).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date('2026-08-17T00:00:00Z').getTime());
      expect(t).toBeLessThanOrEqual(new Date('2026-08-17T23:59:59Z').getTime());
    }
  });
});
describe('deterministicReply relaxation copy (T0049 — zero-result broaden)', () => {
  // The golden-eval fixture covers the parse→rank pipeline. This section
  // tests that the composer correctly labels the relaxation in the reply
  // when relaxed_constraint is set (MASTERPLAN §18.2 decision 4).
  const intent = { language: 'sv' as const, raw_query: 'test', city: 'Stockholm',
    time_of_day: undefined, party: undefined, budget: undefined,
    categories: [], date_from: '2026-08-17', date_to: '2026-08-17' };

  it('adds date_window suffix when relaxed_constraint=date_window', () => {
    const result = deterministicReply({ intent, cards: [{ id: 'x', title: 'Test' } as any], warnings: [], relaxed_constraint: 'date_window' });
    expect(result.reply).toMatch(/bredare urval/);
    expect(result.reply).toMatch(/Hittade inget/);
  });

  it('adds category suffix when relaxed_constraint=category', () => {
    const result = deterministicReply({ intent, cards: [{ id: 'x', title: 'Test' } as any], warnings: [], relaxed_constraint: 'category' });
    expect(result.reply).toMatch(/kategorin/);
    expect(result.reply).toMatch(/andra förslag/);
  });

  it('adds no suffix when relaxed_constraint=null', () => {
    const result = deterministicReply({ intent, cards: [{ id: 'x', title: 'Test' } as any], warnings: [], relaxed_constraint: null });
    expect(result.reply).not.toMatch(/bredare|andra|inget/);
  });

  it('adds date_window suffix in English when language=en', () => {
    const enIntent = { ...intent, language: 'en' as const };
    const result = deterministicReply({ intent: enIntent, cards: [{ id: 'x', title: 'Test' } as any], warnings: [], relaxed_constraint: 'date_window' });
    expect(result.reply).toMatch(/wider selection/);
  });

  it('returns honest empty-state reply with suffix when cards=[] and date_window relaxed', () => {
    const result = deterministicReply({ intent, cards: [], warnings: [], relaxed_constraint: 'date_window' });
    expect(result.reply).toMatch(/Hittade inget/);
    expect(result.reply).toMatch(/bredare urval/);
    expect(result.highlightedIds).toEqual([]);
  });
});

