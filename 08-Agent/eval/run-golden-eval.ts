/**
 * Golden eval runner — anti-hallucination regression for Phase 1.
 *
 * Drives a deterministic pipeline for each entry in
 * `./golden-queries.stockholm.json`:
 *   parseIntentDeterministic(query)
 *   -> mock search_events (returns a fixed fixture of toolCards)
 *   -> rankEvents
 *   -> assert no card in the ranked output has an id, title, venue, or
 *      price that did not come out of the tool.
 *
 * Masterplan §15: hallucination count MUST be 0. This stub does NOT call the
 * live `/agent/chat` endpoint; it runs the deterministic pipeline that the
 * live LLM-driven path MUST shadow. When Phase 1 lights up the LLM router,
 * add a second mode that wraps the live response and runs the same checks.
 *
 * Usage:
 *   npx tsx 08-Agent/eval/run-golden-eval.ts
 *
 * Exit code:
 *   0  all queries pass
 *   1  one or more hallucinations or intent mismatches
 */

import golden from './golden-queries.stockholm.json' with { type: 'json' };
import { parseIntentDeterministic } from '../tools/parse_intent';
import { rankEvents } from '../tools/rank_events';
import type { EventCard, IntentBrief, RankedEvent } from '../types';

// Pinned "now" so date-range expectations stay stable across runs.
const NOW = new Date('2026-08-21T17:00:00Z'); // Friday evening, the magic-slice anchor.

// Toy Stockholm fixture: 15 plausible events. Mirrors the structure used in
// `08-Agent/tests/golden-eval.test.ts` so this runner is a CLI counterpart,
// not a replacement.
const fixtureCards: EventCard[] = [
  { id: 'm1', title: 'Jazz kväll',         start_time: '2026-08-21T20:00:00Z', end_time: null, venue_name: 'Konserthuset',   city: 'Stockholm', category_slug: 'music',   price_min_sek: 150, price_max_sek: 250, is_free: false, ticket_url: null, image_url: null },
  { id: 'm2', title: 'Klassisk konsert',   start_time: '2026-08-22T19:00:00Z', end_time: null, venue_name: 'Konserthuset',   city: 'Stockholm', category_slug: 'music',   price_min_sek: 200, price_max_sek: 400, is_free: false, ticket_url: null, image_url: null },
  { id: 'm3', title: 'Indie konsert',      start_time: '2026-08-22T21:00:00Z', end_time: null, venue_name: 'Debaser',         city: 'Stockholm', category_slug: 'music',   price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'm4', title: 'Rock ikväll',        start_time: '2026-08-21T22:00:00Z', end_time: null, venue_name: 'Fryshuset',       city: 'Stockholm', category_slug: 'music',   price_min_sek: 250, price_max_sek: 350, is_free: false, ticket_url: null, image_url: null },
  { id: 't1', title: 'Hamlet',             start_time: '2026-08-22T19:00:00Z', end_time: null, venue_name: 'Dramaten',        city: 'Stockholm', category_slug: 'theater', price_min_sek: 200, price_max_sek: 500, is_free: false, ticket_url: null, image_url: null },
  { id: 't2', title: 'Trollflöjten',       start_time: '2026-08-23T15:00:00Z', end_time: null, venue_name: 'Operan',          city: 'Stockholm', category_slug: 'theater', price_min_sek: 150, price_max_sek: 400, is_free: false, ticket_url: null, image_url: null },
  { id: 'd1', title: 'Balett',             start_time: '2026-08-21T19:00:00Z', end_time: null, venue_name: 'Operan',          city: 'Stockholm', category_slug: 'dance',   price_min_sek: 180, price_max_sek: 380, is_free: false, ticket_url: null, image_url: null },
  { id: 'f1', title: 'Premiär bio',        start_time: '2026-08-21T19:30:00Z', end_time: null, venue_name: 'Skandia',         city: 'Stockholm', category_slug: 'film',    price_min_sek: 120, price_max_sek: 120, is_free: false, ticket_url: null, image_url: null },
  { id: 'a1', title: 'Fotografiska',       start_time: '2026-08-22T11:00:00Z', end_time: null, venue_name: 'Fotografiska',    city: 'Stockholm', category_slug: 'art',     price_min_sek: 0,   price_max_sek: 0,   is_free: false, ticket_url: null, image_url: null },
  { id: 'a2', title: 'Moderna museet',     start_time: '2026-08-23T11:00:00Z', end_time: null, venue_name: 'Moderna',         city: 'Stockholm', category_slug: 'art',     price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fa1',title: 'Barnteater',         start_time: '2026-08-22T14:00:00Z', end_time: null, venue_name: 'Kulturhuset',     city: 'Stockholm', category_slug: 'family',  price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fa2',title: 'Familjekonsert',     start_time: '2026-08-23T14:00:00Z', end_time: null, venue_name: 'GöteborgsOperan', city: 'Stockholm', category_slug: 'family',  price_min_sek: 100, price_max_sek: 200, is_free: false, ticket_url: null, image_url: null },
  { id: 'l1', title: 'Föreläsning',        start_time: '2026-08-22T18:00:00Z', end_time: null, venue_name: 'Bokmässan',       city: 'Stockholm', category_slug: 'lecture', price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fo1',title: 'Street food market', start_time: '2026-08-22T12:00:00Z', end_time: null, venue_name: 'Slakthusplan',    city: 'Stockholm', category_slug: 'food',    price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
  { id: 'fo2',title: 'Matfestival',        start_time: '2026-08-23T12:00:00Z', end_time: null, venue_name: 'Skansen',         city: 'Stockholm', category_slug: 'food',    price_min_sek: 0,   price_max_sek: 0,   is_free: true,  ticket_url: null, image_url: null },
];

// "tool result" — same filter the real search_events applies.
const toolCards: EventCard[] = fixtureCards.filter(
  (c) => c.city === 'Stockholm' && new Date(c.start_time).getTime() > NOW.getTime()
);
const toolCardIndex = new Map(toolCards.map((c) => [c.id, c]));
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
  notes?: string;
}

interface QueryResult {
  id: string;
  query: string;
  intent_ok: boolean;
  intent_errors: string[];
  ranked_ids: string[];
  tool_ids_used: string[];
  hallucinations: string[];
  empty_ok: boolean;
}

function filterByIntent(cards: EventCard[], intent: IntentBrief): EventCard[] {
  let out = cards;
  if (intent.categories.length > 0) {
    out = out.filter((c) => intent.categories.includes(c.category_slug));
  }
  if (intent.exclude_categories.length > 0) {
    const ex = new Set(intent.exclude_categories);
    out = out.filter((c) => !ex.has(c.category_slug));
  }
  if (intent.budget === 'free') {
    out = out.filter((c) => c.is_free);
  }
  return out;
}

function evaluate(tc: GoldenCase): QueryResult {
  const errors: string[] = [];
  const hallucinations: string[] = [];

  const intent = parseIntentDeterministic(tc.query, NOW);

  if (tc.expected_language && intent.language !== tc.expected_language) {
    errors.push(`language: got ${intent.language}, expected ${tc.expected_language}`);
  }
  if (tc.expected_time_of_day && intent.time_of_day !== tc.expected_time_of_day) {
    errors.push(`time_of_day: got ${intent.time_of_day}, expected ${tc.expected_time_of_day}`);
  }
  if (tc.expected_city && intent.city !== tc.expected_city) {
    errors.push(`city: got ${intent.city}, expected ${tc.expected_city}`);
  }
  if (tc.expected_budget && intent.budget !== tc.expected_budget) {
    errors.push(`budget: got ${intent.budget}, expected ${tc.expected_budget}`);
  }
  if (tc.expected_party && intent.party !== tc.expected_party) {
    errors.push(`party: got ${intent.party}, expected ${tc.expected_party}`);
  }
  if (tc.expected_categories && JSON.stringify(intent.categories) !== JSON.stringify(tc.expected_categories)) {
    errors.push(`categories: got ${JSON.stringify(intent.categories)}, expected ${JSON.stringify(tc.expected_categories)}`);
  }
  if (tc.expected_exclude_categories && JSON.stringify(intent.exclude_categories) !== JSON.stringify(tc.expected_exclude_categories)) {
    errors.push(`exclude_categories: got ${JSON.stringify(intent.exclude_categories)}, expected ${JSON.stringify(tc.expected_exclude_categories)}`);
  }
  if (tc.expected_date_range === 'today') {
    if (intent.date_from !== '2026-08-21' || intent.date_to !== '2026-08-21') {
      errors.push(`date_range=today: got ${intent.date_from}..${intent.date_to}`);
    }
  } else if (tc.expected_date_range === 'this_weekend') {
    if (intent.date_from !== '2026-08-22' || intent.date_to !== '2026-08-23') {
      errors.push(`date_range=this_weekend: got ${intent.date_from}..${intent.date_to}`);
    }
  } else if (tc.expected_date_range === 'next_week') {
    if (intent.date_from !== '2026-08-24' || intent.date_to !== '2026-08-30') {
      errors.push(`date_range=next_week: got ${intent.date_from}..${intent.date_to}`);
    }
  }

  const filtered = filterByIntent(toolCards, intent);
  const ranked: RankedEvent[] = rankEvents(filtered, intent, { now: NOW, topN: 5 });

  for (const r of ranked) {
    if (!toolIdSet.has(r.card.id)) {
      hallucinations.push(`ranked card ${r.card.id} ("${r.card.title}") not in tool result`);
    }
    const toolCard = toolCardIndex.get(r.card.id);
    if (toolCard) {
      if (r.card.venue_name !== toolCard.venue_name) {
        hallucinations.push(`venue mismatch for ${r.card.id}: ranked="${r.card.venue_name}" tool="${toolCard.venue_name}"`);
      }
      if (r.card.start_time !== toolCard.start_time) {
        hallucinations.push(`start_time mismatch for ${r.card.id}`);
      }
      if (r.card.price_min_sek !== toolCard.price_min_sek) {
        hallucinations.push(`price mismatch for ${r.card.id}`);
      }
    }
  }

  // empty-when-contradicting: if filtered tool result is empty but intent
  // expects categories, ranking MUST also be empty (no fabrication).
  const empty_ok = !(filtered.length === 0 && ranked.length > 0);

  return {
    id: tc.id,
    query: tc.query,
    intent_ok: errors.length === 0,
    intent_errors: errors,
    ranked_ids: ranked.map((r) => r.card.id),
    tool_ids_used: filtered.map((c) => c.id),
    hallucinations,
    empty_ok,
  };
}

function main(): void {
  const results: QueryResult[] = [];
  for (const tc of golden as GoldenCase[]) {
    results.push(evaluate(tc));
  }

  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const ok = r.intent_ok && r.hallucinations.length === 0 && r.empty_ok;
    if (ok) pass++; else fail++;
    const status = ok ? 'PASS' : 'FAIL';
    const details: string[] = [];
    if (!r.intent_ok) details.push(`intent=${r.intent_errors.join('; ')}`);
    if (!r.empty_ok) details.push('empty-fabrication');
    if (r.hallucinations.length > 0) details.push(`hallucinations=${r.hallucinations.length}`);
    console.log(`[${status}] ${r.id}  ${r.query}`);
    if (details.length > 0) console.log(`        ${details.join(' | ')}`);
    console.log(`        ranked=${r.ranked_ids.length === 0 ? '[]' : r.ranked_ids.join(',')}`);
  }

  console.log('---');
  console.log(`Queries: ${results.length}  Pass: ${pass}  Fail: ${fail}`);
  console.log(`Total hallucinations: ${results.reduce((s, r) => s + r.hallucinations.length, 0)}`);

  if (fail > 0) {
    process.exit(1);
  }
}

// Run only when invoked as the entrypoint, so vitest can import without side effects.
const isMain = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return true; // Best-effort: treat as main when URL construction fails (tsx).
  }
})();

if (isMain) {
  main();
}

export { evaluate, type GoldenCase, type QueryResult };
