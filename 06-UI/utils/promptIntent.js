/**
 * resolvePromptIntent — turn a Home chip (curated or suggested) into the
 * concrete Utforska filters its TEXT promises (2026-09-20, user demand:
 * every button must do what its label says).
 *
 * The server already sends STRUCTURED intent on curated chips
 * (category_slug / budget / day_filter / time_of_day) and a `category` slug
 * on suggested prompts — the client used to drop all of it and keep only
 * prompt_text. Structured hints are authoritative; the chip's own text is
 * the fallback (and the only input for free-text prompts from recent
 * searches / deep links).
 *
 * Pure module (no React / no fetch) — every chip in the catalog is pinned in
 * promptIntent.test.ts.
 *
 * @param {{ text?: unknown, category?: unknown, categorySlug?: unknown,
 *           category_slug?: unknown, budget?: unknown, dayFilter?: unknown,
 *           day_filter?: unknown, timeOfDay?: unknown, time_of_day?: unknown }} input
 * @returns {{
 *   timeFilter: 'ikvall'|'imorgon'|'helgen'|null,
 *   pinnedDow: 0|1|2|3|4|5|6|null,
 *   priceFilter: 'free'|'under_200'|null,
 *   categories: string[]|null,   // Utforska pill keys
 *   queryTerms: string[]|null,   // genre union for search prefill (any-match)
 *   queryLabel: string|null,     // display string for the search box
 *   anchor: 'pinned'|'weekend'|'today'|null,
 * }}
 */

import { normalizeSearchText } from './browseFilters';
import { hasWeekendIntent } from './weekendIntent';

/* ------------------------------------------------------------------ */
/* Term tables (normalized form: lowercase, accents stripped by        */
/* normalizeSearchText, so 'lördag' arrives as 'lordag' etc.)          */
/* ------------------------------------------------------------------ */

function wordMatcher(terms) {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
  return (hay) => re.test(hay);
}

const hasSaturdayText = wordMatcher(['lordag', 'saturday']);
const hasSundayText = wordMatcher(['sondag', 'sunday']);
const hasFridayText = wordMatcher(['fredag', 'friday']);
const hasFreeText = wordMatcher(['gratis', 'free']);
const hasTomorrowText = wordMatcher(['imorgon', 'i morgon', 'tomorrow']);
// 'ikväll' (normalized 'ikvall'), 'kväll' and 'idag' all mean "today, from
// now on" — the closest existing filter is 'ikvall' (today after now).
const hasTonightText = wordMatcher([
  'ikvall', 'i kvall', 'kvall', 'tonight', 'this evening',
  'idag', 'i dag', 'today',
]);

const CATEGORY_TEXT_TERMS = [
  ['music', ['konsert', 'konserter', 'concert', 'concerts', 'musik', 'music', 'spelning', 'gig']],
  ['culture', ['utstallning', 'utstallningar', 'exhibition', 'exhibitions', 'museum', 'konst', 'art']],
  ['sports', ['sport', 'match', 'matcher', 'fotboll', 'football']],
  ['barn', ['barn', 'barnvanlig', 'familj', 'familjevanlig', 'family', 'kids']],
  ['theatre', ['teater', 'theater', 'theatre', 'forestallning']],
].map(([key, terms]) => [key, wordMatcher(terms)]);

/** Genre chips are HONEST search rows, not categories: "Jazz i stan" must
 *  not become "all music". Union terms cover sv/en and accented variants
 *  (compared after normalizeSearchText, so 'hårdrock' == 'hardrock'). */
const GENRES = [
  { label: 'jazz', detect: ['jazz'], queryTerms: ['jazz'] },
  { label: 'klassisk', detect: ['klassisk', 'classical'], queryTerms: ['klassisk', 'classical'] },
  { label: 'metal', detect: ['metal', 'hardrock', 'hard rock'], queryTerms: ['metal', 'hardrock', 'hard rock'] },
].map((g) => ({ ...g, matches: wordMatcher(g.detect) }));

/** Server category_slug → Utforska pill key (feed slugs go through
 *  CATEGORY_GROUPS in browseFilters for the actual matching). */
const SLUG_TO_PILL = {
  music: 'music',
  art: 'culture',
  culture: 'culture',
  family: 'barn',
  barn: 'barn',
  theatre: 'theatre',
  food: 'food',
  sports: 'sports',
  nightlife: 'nightlife',
};

/** Suggested-prompt `category` values → pill key (or genre marker). */
const SUGGESTED_CATEGORY_TO_PILL = {
  konserter: 'music',
  utställningar: 'culture',
  sport: 'sports',
  'barn-familj': 'barn',
};

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolvePromptIntent(input = {}) {
  const hints = input && typeof input === 'object' ? input : {};
  const text = asString(hints.text);
  const normText = text ? normalizeSearchText(text) : '';

  const categorySlug = asString(hints.categorySlug ?? hints.category_slug);
  const suggestedCategory = asString(hints.category);
  const budget = asString(hints.budget);
  const dayFilter = asString(hints.dayFilter ?? hints.day_filter);
  const timeOfDay = asString(hints.timeOfDay ?? hints.time_of_day);

  /* ---- genre (from the chip's own text, or suggested category 'jazz') ---- */
  let genre = GENRES.find((g) => normText && g.matches(normText)) || null;
  if (!genre && suggestedCategory === 'jazz') genre = GENRES[0];

  /* ---- price ---- */
  let priceFilter = null;
  if (budget === 'free') priceFilter = 'free';
  else if (budget === 'low') priceFilter = 'under_200';
  else if (normText && hasFreeText(normText)) priceFilter = 'free';

  /* ---- day / time ---- */
  let timeFilter = null;
  let pinnedDow = null;
  let anchor = null;

  if (dayFilter === 'saturday') { pinnedDow = 6; anchor = 'pinned'; }
  else if (dayFilter === 'sunday') { pinnedDow = 0; anchor = 'pinned'; }
  else if (dayFilter === 'friday') { pinnedDow = 5; anchor = 'pinned'; }
  else if (dayFilter === 'weekend') { timeFilter = 'helgen'; anchor = 'weekend'; }
  else if (dayFilter === 'today') { timeFilter = 'ikvall'; anchor = 'today'; }
  // 'weekday' has no client-side filter — falls through to text hints.

  if (!pinnedDow && !timeFilter && normText) {
    if (hasSaturdayText(normText)) { pinnedDow = 6; anchor = 'pinned'; }
    else if (hasSundayText(normText)) { pinnedDow = 0; anchor = 'pinned'; }
    else if (hasFridayText(normText)) { pinnedDow = 5; anchor = 'pinned'; }
    else if (hasWeekendIntent(text)) { timeFilter = 'helgen'; anchor = 'weekend'; }
    else if (hasTomorrowText(normText)) { timeFilter = 'imorgon'; anchor = 'today'; }
    else if (hasTonightText(normText)) { timeFilter = 'ikvall'; anchor = 'today'; }
  }

  // time_of_day fills 'ikvall' only when no day intent already resolved
  // (morning/afternoon chips get no client time filter per spec).
  if (!timeFilter && !pinnedDow && (timeOfDay === 'evening' || timeOfDay === 'night')) {
    timeFilter = 'ikvall';
    anchor = 'today';
  }

  /* ---- categories (genre chips suppress categories — plan decision) ---- */
  let categories = null;
  if (!genre) {
    if (categorySlug && SLUG_TO_PILL[categorySlug]) {
      categories = [SLUG_TO_PILL[categorySlug]];
    } else if (suggestedCategory && SUGGESTED_CATEGORY_TO_PILL[suggestedCategory]) {
      categories = [SUGGESTED_CATEGORY_TO_PILL[suggestedCategory]];
    } else if (normText) {
      const hit = CATEGORY_TEXT_TERMS.find(([, matches]) => matches(normText));
      if (hit) categories = [hit[0]];
    }
  }

  const anyIntent = Boolean(
    timeFilter || pinnedDow !== null || priceFilter || categories || genre
  );

  return {
    timeFilter,
    pinnedDow,
    priceFilter,
    categories,
    queryTerms: genre ? genre.queryTerms : null,
    queryLabel: genre ? genre.label : null,
    // Any resolved intent re-anchors the feed window ('today' = default
    // window start); no intent at all leaves the window untouched.
    anchor: anyIntent ? (anchor ?? 'today') : null,
  };
}

/** True when the resolved intent changes any filter — used by the caller to
 *  decide whether to show the auto-applied banner/undo affordance. */
export function intentHasFilters(intent) {
  if (!intent) return false;
  return Boolean(
    intent.timeFilter || intent.pinnedDow !== null || intent.priceFilter ||
    (intent.categories && intent.categories.length > 0) ||
    (intent.queryTerms && intent.queryTerms.length > 0)
  );
}
