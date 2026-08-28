/**
 * curated_collections — T0084 / MVP-gap §77 editorial "Kuratorens val" lists.
 *
 * Phase 1 retention: HomeScreen needs *narrative* chips, not just generic
 * time/prompt chips. The editor picks 2–3 named lists per load (e.g.
 * "Klassiskt ikväll", "Gratis på lördag", "Metal under 200 kr") and each
 * list becomes a chip in the UI. Tapping a chip forwards the list's
 * `prompt_text` to /agent/chat — the agent reuses the existing pipeline,
 * so we don't reinvent routing. The list ID + name + up to 3 example event
 * IDs are surfaced so the UI can render a small preview card.
 *
 * Determinism rule: the same inputs (now + locale + day_of_week) MUST
 * yield the same collections in the same order. We pin that with a static
 * CATALOG plus a fixed selection ladder — no RNG, no LLM.
 *
 * Response shape:
 *   {
 *     collections: CuratedCollection[],
 *     generated_at: string,  // ISO
 *     warnings: string[],
 *   }
 *
 *   CuratedCollection {
 *     id: string          — stable collection key (kebab-case)
 *     name: string        — display name shown on the chip (SV/EN)
 *     reason: string      — human-readable one-liner (e.g. "3 evenemang ikväll")
 *     prompt_text: string  — Swedish natural-language query fired on tap
 *     category_slug?: string
 *     time_of_day?: 'morning' | 'afternoon' | 'evening' | 'night'
 *     budget?: 'free' | 'low' | 'medium' | 'high' | 'any'
 *     day_filter?: 'weekday' | 'friday' | 'weekend' | 'saturday' | 'sunday' | 'today'
 *     locale: 'sv' | 'en'
 *     event_ids: string[] — up to 3 example events that match this collection
 *   }
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { searchEvents } from './search_events';
import type { EventCard } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CuratedLocale = 'sv' | 'en';
export type CuratedTimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type CuratedBudget = 'free' | 'low' | 'medium' | 'high' | 'any';
export type CuratedDayFilter =
  | 'weekday'
  | 'friday'
  | 'weekend'
  | 'saturday'
  | 'sunday'
  | 'today';

export interface CuratedCollection {
  id: string;
  name: string;
  reason: string;
  prompt_text: string;
  category_slug?: string;
  time_of_day?: CuratedTimeOfDay;
  budget?: CuratedBudget;
  day_filter?: CuratedDayFilter;
  locale: CuratedLocale;
  event_ids: string[];
}

export interface CuratedCollectionsResult {
  collections: CuratedCollection[];
  generated_at: string;
  /**
   * Per-collection warnings (DB read failures etc.). Empty on the happy
   * path. Collections still render their names when warnings are non-empty;
   * only the preview chips would be blank.
   */
  warnings: string[];
}

export interface GetCuratedCollectionsOptions {
  supabase: SupabaseClient;
  /** Locale drives name + prompt_text language. Default 'sv'. */
  locale?: CuratedLocale;
  /** Override the current time for tests. Default: now() (Stockholm). */
  now?: Date;
  /** Max collections to return. Hard ceiling 3, floor 2. Default 3. */
  limit?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 3;
const MIN_LIMIT = 2;

const EVENT_IDS_PREVIEW_LIMIT = 3;

/**
 * Stockholm's summer offset (CEST). Keeps parity with the rest of 08-Agent
 * (see get_suggested_prompts.ts stockholmNow). Winter (CET) would be +1.
 */
const STOCKHOLM_OFFSET_HOURS = 2;

// ─── Time helpers ────────────────────────────────────────────────────────────

function stockholmNow(now?: Date): Date {
  if (now) return new Date(now);
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + STOCKHOLM_OFFSET_HOURS);
  return d;
}

function getDaySlot(now: Date): CuratedDayFilter {
  const dow = now.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  if (dow === 5) return 'friday';
  return 'weekday';
}

function getTimeSlot(now: Date): CuratedTimeOfDay {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

function isWeekend(day: CuratedDayFilter): boolean {
  return day === 'friday' || day === 'saturday' || day === 'sunday';
}

// ─── Catalog ─────────────────────────────────────────────────────────────────
//
// Each entry is a hand-curated editorial list. Order in the array is
// irrelevant — the selection ladder below picks 2–3 based on context
// (time of day, day of week, locale).
//
// IDs are stable and used as the chip key on the client side so analytics
// can correlate taps without re-parsing names.

interface CatalogEntryBase {
  id: string;
  category_slug?: string;
  /** Flexible budget hint. The selection ladder rewrites 'low' to a number at runtime. */
  budget?: CuratedBudget;
  /** Day filter. The selection ladder resolves "tomorrow" etc. at runtime. */
  day_filter?: CuratedDayFilter;
  /** Time of day hint. Used by the selection ladder. */
  time_of_day?: CuratedTimeOfDay;
}

interface CatalogEntrySe extends CatalogEntryBase {
  sv_name: string;
  sv_reason: string;
  sv_prompt: string;
  en_name: string;
  en_reason: string;
  en_prompt: string;
}

/**
 * Catalog — Stockholm-specific editorial lists.
 *
 * Why these lists? They cover the three orthogonal "it-list" axes the user
 * cares about:
 *   1. Time-of-day  (Klassiskt ikväll, Morgonens lugna toner)
 *   2. Budget       (Gratis på lördag, Konsert under 200 kr)
 *   3. Theme        (Metal under 200 kr, Barnens helg, Jazz i stan)
 *
 * The selection ladder picks 1 time-of-day + 1 budget + 1 theme by default
 * (depending on weekday/weekend which gates some entries).
 */
const CATALOG: CatalogEntrySe[] = [
  // Time-of-day collections — picked by current hour
  {
    id: 'klassiskt-ikvall',
    category_slug: 'music',
    time_of_day: 'evening',
    sv_name: 'Klassiskt ikväll',
    sv_reason: 'Klassiska konserter och konserthuskvällar',
    sv_prompt: 'Klassisk konsert ikväll i Stockholm?',
    en_name: 'Classical tonight',
    en_reason: 'Classical concerts and concert-hall evenings',
    en_prompt: 'Classical concert tonight in Stockholm?',
  },
  {
    id: 'jazz-i-stan',
    category_slug: 'music',
    time_of_day: 'evening',
    sv_name: 'Jazz i stan',
    sv_reason: 'Jazzklubbar i Stockholm ikväll',
    sv_prompt: 'Jazz ikväll i Stockholm?',
    en_name: 'Jazz in the city',
    en_reason: 'Jazz clubs in Stockholm tonight',
    en_prompt: 'Jazz tonight in Stockholm?',
  },
  {
    id: 'morgonens-lugna-toner',
    category_slug: 'music',
    time_of_day: 'morning',
    sv_name: 'Morgonens lugna toner',
    sv_reason: 'Lugna konserter och frukostevenemang',
    sv_prompt: 'Lugn musik eller frukostevenemang i Stockholm?',
    en_name: 'Calm morning sounds',
    en_reason: 'Quiet concerts and breakfast events',
    en_prompt: 'Calm music or breakfast events in Stockholm?',
  },

  // Budget-driven — picked regardless of weekday, but the *Gratis* entries
  // require weekend + upcoming future date so they're meaningful.
  {
    id: 'gratis-pa-lordag',
    budget: 'free',
    day_filter: 'saturday',
    sv_name: 'Gratis på lördag',
    sv_reason: 'Gratis evenemang under lördagen',
    sv_prompt: 'Gratis evenemang i Stockholm på lördag?',
    en_name: 'Free Saturday',
    en_reason: 'Free events during Saturday',
    en_prompt: 'Free events in Stockholm on Saturday?',
  },
  {
    id: 'gratis-pa-sondag',
    budget: 'free',
    day_filter: 'sunday',
    sv_name: 'Gratis på söndag',
    sv_reason: 'Gratis evenemang under söndagen',
    sv_prompt: 'Gratis evenemang i Stockholm på söndag?',
    en_name: 'Free Sunday',
    en_reason: 'Free events during Sunday',
    en_prompt: 'Free events in Stockholm on Sunday?',
  },
  {
    id: 'gratis-i-helgen',
    budget: 'free',
    day_filter: 'weekend',
    sv_name: 'Gratis i helgen',
    sv_reason: 'Gratis evenemang under helgen',
    sv_prompt: 'Gratis evenemang i Stockholm i helgen?',
    en_name: 'Free this weekend',
    en_reason: 'Free events this weekend',
    en_prompt: 'Free events in Stockholm this weekend?',
  },
  {
    id: 'konsert-under-200',
    category_slug: 'music',
    budget: 'low',
    sv_name: 'Konsert under 200 kr',
    sv_reason: 'Lågbudgetkonserter under 200 kr',
    sv_prompt: 'Konserter i Stockholm under 200 kronor?',
    en_name: 'Concerts under 200 kr',
    en_reason: 'Affordable concerts under 200 kr',
    en_prompt: 'Concerts in Stockholm under 200 kronor?',
  },
  {
    id: 'metal-under-200',
    category_slug: 'music',
    budget: 'low',
    sv_name: 'Metal under 200 kr',
    sv_reason: 'Metal och hårdrock under 200 kr',
    sv_prompt: 'Metal- eller hårdrockskonserter i Stockholm under 200 kronor?',
    en_name: 'Metal under 200 kr',
    en_reason: 'Metal and hard rock under 200 kr',
    en_prompt: 'Metal or hard rock concerts in Stockholm under 200 kronor?',
  },

  // Theme-driven — independent of budget, but some lean on weekends.
  {
    id: 'barnens-helg',
    category_slug: 'family',
    day_filter: 'weekend',
    sv_name: 'Barnens helg',
    sv_reason: 'Familjevänliga evenemang för barnen',
    sv_prompt: 'Familjevänliga evenemang i Stockholm i helgen?',
    en_name: 'Kids weekend',
    en_reason: 'Family-friendly events for kids',
    en_prompt: 'Family-friendly events in Stockholm this weekend?',
  },
  {
    id: 'utstallningar-i-helgen',
    category_slug: 'art',
    day_filter: 'weekend',
    sv_name: 'Utställningar i helgen',
    sv_reason: 'Konst och utställningar öppna under helgen',
    sv_prompt: 'Utställningar i Stockholm öppna i helgen?',
    en_name: 'Exhibitions this weekend',
    en_reason: 'Art and exhibitions open this weekend',
    en_prompt: 'Exhibitions in Stockholm open this weekend?',
  },
];

// ─── Catalog matching ────────────────────────────────────────────────────────

/**
 * Find catalog entries whose `day_filter` matches the current day. The
 * matcher is intentionally permissive: 'weekend' matches Friday, Saturday
 * AND Sunday (Friday evening still benefits from a weekend list).
 */
function matchesDay(
  entry: Pick<CatalogEntryBase, 'day_filter'>,
  daySlot: CuratedDayFilter,
): boolean {
  if (!entry.day_filter) return true; // no day constraint = always eligible
  if (entry.day_filter === 'weekend') return isWeekend(daySlot);
  if (entry.day_filter === 'weekday') return daySlot === 'weekday';
  return entry.day_filter === daySlot;
}

/**
 * Selection ladder: pick 2–3 collections deterministically from the catalog.
 * Order: time-of-day → budget → theme. We always yield at least MIN_LIMIT
 * by including baseline lists when the catalog is sparse.
 */
function selectCollections(
  catalog: CatalogEntrySe[],
  timeSlot: CuratedTimeOfDay,
  daySlot: CuratedDayFilter,
  limit: number,
): CatalogEntrySe[] {
  const eligible = catalog.filter((c) => matchesDay(c, daySlot));

  const timeOfDayEntry = eligible.find((c) => c.time_of_day === timeSlot);
  const budgetEntries = eligible.filter((c) => !!c.budget && !c.time_of_day);
  const themeEntries = eligible.filter((c) => !c.budget && !c.time_of_day);

  const picked: CatalogEntrySe[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (entry: CatalogEntrySe | undefined) => {
    if (!entry) return;
    if (seenIds.has(entry.id)) return;
    seenIds.add(entry.id);
    picked.push(entry);
  };

  // 1) One time-of-day collection if available.
  pushUnique(timeOfDayEntry);

  // 2) Prefer budget-led collections: a free-weekend list when weekend,
  //    else the cheapest-price entry.
  const budgetPriority =
    daySlot === 'saturday'
      ? budgetEntries.find((c) => c.day_filter === 'saturday')
      : daySlot === 'sunday'
        ? budgetEntries.find((c) => c.day_filter === 'sunday')
        : daySlot === 'friday' || daySlot === 'saturday' || daySlot === 'sunday'
          ? budgetEntries.find((c) => c.day_filter === 'weekend')
          : undefined;
  if (budgetPriority) {
    pushUnique(budgetPriority);
  } else {
    // Fall back to any eligible budget entry (e.g. weekday => Konsert under 200)
    for (const e of budgetEntries) {
      pushUnique(e);
      if (picked.length >= limit) break;
    }
  }

  // 3) Fill with themes up to the limit
  for (const e of themeEntries) {
    if (picked.length >= limit) break;
    pushUnique(e);
  }

  // 4) If we still have slack (e.g. weekday with no budget/theme), re-fill
  //    from any remaining catalog entry that hasn't been picked.
  if (picked.length < MIN_LIMIT) {
    for (const e of eligible) {
      if (picked.length >= MIN_LIMIT) break;
      pushUnique(e);
    }
  }

  // 5) Final fallback: if catalog has no eligible entries at all, take the
  //    first MIN_LIMIT entries from the catalog unconditionally.
  if (picked.length < MIN_LIMIT) {
    for (const e of catalog) {
      if (picked.length >= MIN_LIMIT) break;
      pushUnique(e);
    }
  }

  return picked.slice(0, limit);
}

// ─── Search → event_ids preview ──────────────────────────────────────────────

interface CatalogSearchInput {
  city: string;
  date_from: string;
  date_to: string;
  categories?: string[];
  is_free: boolean | null;
  price_max_sek: number | null;
}

/**
 * Map a collection to search_events input. Pure: no IO.
 */
function toSearchInput(
  entry: CatalogEntrySe,
  now: Date,
): CatalogSearchInput {
  let from: Date = new Date(now);
  let to: Date = new Date(now);

  if (entry.day_filter === 'today') {
    // Today (00:00–23:59 Stockholm-relative).
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    to = new Date(now);
    to.setHours(23, 59, 59, 999);
  } else if (
    entry.day_filter === 'saturday' ||
    entry.day_filter === 'sunday' ||
    entry.day_filter === 'friday'
  ) {
    // Jump to the named day-of-week within the next 7 days.
    const targetDow =
      entry.day_filter === 'friday'
        ? 5
        : entry.day_filter === 'saturday'
          ? 6
          : 0;
    const todayDow = now.getDay();
    let delta = (targetDow - todayDow + 7) % 7;
    if (delta === 0) delta = 7; // never "today" when explicitly named
    from = new Date(now);
    from.setDate(from.getDate() + delta);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setHours(23, 59, 59, 999);
  } else if (entry.day_filter === 'weekend') {
    // Sat + Sun. todayDow ∈ {5,6,0} when this branch fires.
    const todayDow = now.getDay();
    if (todayDow === 5) {
      // Friday → Sat + Sun
      from = new Date(now);
      from.setDate(from.getDate() + 1);
      from.setHours(0, 0, 0, 0);
      to = new Date(from);
      to.setDate(to.getDate() + 1);
      to.setHours(23, 59, 59, 999);
    } else if (todayDow === 6) {
      // Saturday → today + tomorrow
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      to = new Date(from);
      to.setDate(to.getDate() + 1);
      to.setHours(23, 59, 59, 999);
    } else {
      // Sunday → today only
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      to = new Date(from);
      to.setHours(23, 59, 59, 999);
    }
  } else {
    // weekday / no day_filter → 7-day window
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setDate(to.getDate() + 7);
    to.setHours(23, 59, 59, 999);
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let is_free: boolean | null = null;
  let price_max_sek: number | null = null;
  if (entry.budget === 'free') {
    is_free = true;
  } else if (entry.budget === 'low') {
    price_max_sek = 200;
  }

  const out: CatalogSearchInput = {
    city: 'Stockholm',
    date_from: isoDay(from),
    date_to: isoDay(to),
    is_free,
    price_max_sek,
  };
  if (entry.category_slug) out.categories = [entry.category_slug];
  return out;
}

/**
 * Hydrate one collection's event-id preview by running search_events with
 * the collection's filters and reading the first N ids. Pure-with-IO.
 * Errors collapse to empty preview + warning; never throws.
 */
async function hydrateEventIds(
  supabase: SupabaseClient,
  entry: CatalogEntrySe,
  now: Date,
): Promise<{ ids: string[]; warning?: string }> {
  const input = toSearchInput(entry, now);
  try {
    const result = await searchEvents(supabase, {
      city: input.city,
      date_from: input.date_from,
      date_to: input.date_to,
      categories: input.categories,
      is_free: input.is_free,
      price_max_sek: input.price_max_sek,
      limit: 10,
    });
    const ids = (result.events ?? [])
      .map((e: EventCard) => e.id)
      .filter((id: string) => !!id)
      .slice(0, EVENT_IDS_PREVIEW_LIMIT);
    return { ids, warning: result.warnings?.[0] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { ids: [], warning: msg };
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate 2–3 curated ("Kuratorens val") collections deterministically.
 *
 * Determinism: same `now` + same `locale` always yields the same list.
 * The hydrate step is best-effort — empty event_ids is valid (the UI
 * still renders the chip with a "no preview" placeholder).
 *
 * Failures during hydration collapse to an empty event_ids array; the
 * collection name + reason + prompt_text are still emitted so the UI
 * remains useful and analytics can fire.
 */
export async function getCuratedCollections({
  supabase,
  locale = 'sv',
  now,
  limit = DEFAULT_LIMIT,
}: GetCuratedCollectionsOptions): Promise<CuratedCollectionsResult> {
  const capLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, limit));
  const t = stockholmNow(now);
  const daySlot = getDaySlot(t);
  const timeSlot = getTimeSlot(t);

  const selected = selectCollections(CATALOG, timeSlot, daySlot, capLimit);

  const warnings: string[] = [];

  // Hydrate all collections in parallel — bounded cost (max 3) and a single
  // round-trip per collection (search_events itself fans out internally).
  const hydrated = await Promise.all(
    selected.map((entry) => hydrateEventIds(supabase, entry, t)),
  );

  const collections: CuratedCollection[] = selected.map((entry, idx) => {
    const ids = hydrated[idx]?.ids ?? [];
    const warn = hydrated[idx]?.warning;
    if (warn && !warnings.includes(warn)) warnings.push(warn);

    return {
      id: entry.id,
      name: locale === 'en' ? entry.en_name : entry.sv_name,
      reason: locale === 'en' ? entry.en_reason : entry.sv_reason,
      prompt_text: locale === 'en' ? entry.en_prompt : entry.sv_prompt,
      locale,
      ...(entry.category_slug ? { category_slug: entry.category_slug } : {}),
      ...(entry.time_of_day ? { time_of_day: entry.time_of_day } : {}),
      ...(entry.budget ? { budget: entry.budget } : {}),
      ...(entry.day_filter ? { day_filter: entry.day_filter } : {}),
      event_ids: ids,
    };
  });

  return {
    collections: collections.slice(0, capLimit),
    generated_at: new Date().toISOString(),
    warnings,
  };
}

/**
 * Internal: pure selector, exposed for unit tests so we don't need a
 * Supabase client to exercise the deterministic lane. Catalog is exported
 * through the side effect of `selectCollections` already being callable.
 */
export function _selectCollectionsForTest(
  timeSlot: CuratedTimeOfDay,
  daySlot: CuratedDayFilter,
  limit: number,
): CatalogEntrySe[] {
  return selectCollections(CATALOG, timeSlot, daySlot, limit);
}

/**
 * Internal: pure search-input mapper, exposed for unit tests.
 */
export function _toSearchInputForTest(
  entry: CatalogEntrySe,
  now: Date,
): CatalogSearchInput {
  return toSearchInput(entry, now);
}
