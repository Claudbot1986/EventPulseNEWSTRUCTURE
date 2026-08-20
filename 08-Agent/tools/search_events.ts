/**
 * search_events — read-only tool that lists future events from Supabase.
 *
 * Phase 0 contract:
 *  - Always filters out past events (start_time > now()).
 *  - events_public already restricts to status='published' via its view def.
 *  - Defaults city to 'Stockholm' (the lock decision).
 *  - Limit defaults to 25, capped at 50.
 *  - Returns warnings for stale / multi-category / no-confidence rows.
 *  - venue_name is populated from the venues table via a second hop
 *    (events_public does not join to venues, by design).
 *  - Zero-result broadening: widen date window -> relax category. The
 *    relaxation that fired is exposed on the result so the caller can
 *    tell the user honestly. We do NOT silently return unrelated events.
 *
 * Source table: today `events_public`. 08-Agent uses a service_role client,
 * so it can also read `venues` directly (anon cannot - events_public is the
 * only anon-readable slice).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';

export interface SearchEventsInput {
  city?: string;
  date_from?: string;
  date_to?: string;
  categories?: string[];
  exclude_categories?: string[];
  is_free?: boolean | null;
  price_max_sek?: number | null;
  limit?: number;
}

export type RelaxedConstraint = 'date_window' | 'category';

export interface SearchEventsResult {
  events: EventCard[];
  warnings: string[];
  /**
   * Which constraint, if any, was relaxed to surface these results.
   *   null          - strict query matched; no relaxation
   *   'date_window' - initial date range had zero hits; range was widened
   *   'category'    - date widening also empty; category filter was dropped
   *
   * Machine-readable so the agent can tell the user honestly what
   * happened ("hittade inget pa fredag - har ar helgen istallet").
   */
  relaxed_constraint: RelaxedConstraint | null;
}

export const SEARCH_EVENTS_DEFAULT_LIMIT = 25;
export const SEARCH_EVENTS_MAX_LIMIT = 50;

/**
 * Number of days added on each side of the requested window when zero
 * results force broadening. 7 gives a Friday-Sunday swing a reasonable
 * chance of producing a hit while still anchored to the user's intent.
 */
export const SEARCH_EVENTS_BROADEN_DAYS = 7;

export const SEARCH_EVENTS_TABLE: 'events' | 'events_public' = 'events_public';
export const VENUES_TABLE = 'venues';

// parse_intent emits date-only ISO strings (YYYY-MM-DD) per the IntentBrief
// schema. start_time is a full timestamptz - expand to day boundaries so the
// comparison doesn't drop same-day or future-day events.
function expandDateFloor(d: string): string {
  return /T/.test(d) ? d : `${d}T00:00:00.000Z`;
}
function expandDateCeil(d: string): string {
  return /T/.test(d) ? d : `${d}T23:59:59.999Z`;
}

/**
 * Widen a date window by +/-N days. Pure: returns [from, to] as ISO strings.
 * Used by the zero-result broadening ladder. Exported for tests.
 */
export function widenDateWindow(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  days: number,
): { from: string; to: string } {
  const floor = expandDateFloor(dateFrom ?? '1970-01-01');
  const ceil = expandDateCeil(dateTo ?? '2999-12-31');
  const f = new Date(floor);
  const t = new Date(ceil);
  f.setUTCDate(f.getUTCDate() - days);
  t.setUTCDate(t.getUTCDate() + days);
  return { from: f.toISOString(), to: t.toISOString() };
}

// Row shapes returned by Supabase. Defined here so tests + impl agree.
export interface EventRow {
  id: string;
  title_en: string | null;
  title_sv: string | null;
  description_en: string | null;
  description_sv: string | null;
  start_time: string;
  end_time: string | null;
  venue_id: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  category_slug: string | null;
  source: string | null;
  confidence_score: number | null;
  freshness_at: string | null;
  status_expanded: string | null;
}

export interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
}

/** Columns the events_public select pulls. Includes description so the
 *  LLM explainer can ground its "why" copy in real text, never in model
 *  memory. */
const EVENT_SELECT_COLUMNS =
  'id, title_en, title_sv, description_en, description_sv, start_time, end_time, ' +
  'venue_id, is_free, price_min_sek, price_max_sek, ticket_url, image_url, ' +
  'category_slug, source, confidence_score, freshness_at, status_expanded';

const VENUE_SELECT_COLUMNS = 'id, name, city, address';

/** Normalize a city string for comparison. Trims + lowercases. */
function normalizeCity(city: string | undefined | null): string {
  return (city ?? '').trim().toLowerCase();
}

/**
 * Fetch venues for a set of venue_ids. Returns a Map keyed by venue_id.
 * Empty Map when no ids. The caller filters events by city against this map.
 *
 * Pure-with-IO: the only side effect is the supabase fetch. Exported for tests.
 */
export async function fetchVenuesById(
  supabase: SupabaseClient,
  venueIds: ReadonlyArray<string>,
): Promise<Map<string, VenueRow>> {
  const out = new Map<string, VenueRow>();
  if (venueIds.length === 0) return out;
  const { data, error } = await supabase
    .from(VENUES_TABLE)
    .select(VENUE_SELECT_COLUMNS)
    .in('id', [...venueIds]);
  if (error) return out;
  for (const row of (data ?? []) as VenueRow[]) {
    out.set(row.id, row);
  }
  return out;
}

/**
 * Apply city filter to events using a venue index. Pure: no IO.
 * If city is empty/null, returns events unchanged.
 *
 * Honest filtering rules (no fabricated data):
 *  - event with no venue_id           -> kept (city unknown; honest)
 *  - event with venue_id but missing  -> kept (orphan; honest, venue_name='')
 *  - event with resolved venue        -> kept iff venue.city matches city
 *
 * Exported for tests.
 */
export function filterByCity<E extends { venue_id: string | null }>(
  events: ReadonlyArray<E>,
  venues: ReadonlyMap<string, VenueRow>,
  city: string | undefined,
): E[] {
  if (!city) return [...events];
  const want = normalizeCity(city);
  return events.filter((e) => {
    if (!e.venue_id) return true; // honest: no venue, can't claim mismatch
    const v = venues.get(e.venue_id);
    if (!v) return true; // honest: orphan venue, can't claim mismatch
    return normalizeCity(v.city) === want;
  });
}

/**
 * Build the events query (without date/category - those are layered in by
 * the caller so the broadening ladder can mutate them). Pure-with-IO:
 * returns the supabase chain; the chain still needs `.then(...)` to execute.
 */
function buildEventQuery(supabase: SupabaseClient, limit: number) {
  let q = supabase
    .from(SEARCH_EVENTS_TABLE)
    .select(EVENT_SELECT_COLUMNS)
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(limit);
  if (SEARCH_EVENTS_TABLE === 'events') {
    q = q.eq('status', 'published');
  }
  return q;
}

/**
 * Add filter clauses to a base events query. Pure-with-IO: returns the
 * chain. Exported for tests so the broadening ladder can be observed.
 */
export function applyEventFilters(
  q: ReturnType<typeof buildEventQuery>,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    isFree?: boolean | null;
    priceMaxSek?: number | null;
    categories?: ReadonlyArray<string>;
  },
): ReturnType<typeof buildEventQuery> {
  let out = q;
  if (filters.dateFrom) out = out.gte('start_time', expandDateFloor(filters.dateFrom));
  if (filters.dateTo)   out = out.lte('start_time', expandDateCeil(filters.dateTo));
  if (filters.isFree === true)  out = out.eq('is_free', true);
  if (filters.isFree === false) out = out.eq('is_free', false);
  if (filters.priceMaxSek !== null && filters.priceMaxSek !== undefined) {
    out = out.lte('price_max_sek', filters.priceMaxSek);
  }
  if (filters.categories && filters.categories.length > 0) {
    out = out.in('category_slug', [...filters.categories]);
  }
  return out;
}

/** Run a supabase query and unwrap (data, error). Logs no console. */
async function runQuery<T>(q: any): Promise<{ data: T[]; error: { message: string } | null }> {
  const { data, error } = await q;
  return { data: (data ?? []) as T[], error };
}

/**
 * Aggregate per-event warnings so a 25-row result doesn't fan out into
 * 100 messages. Pure: no IO. Exported for tests.
 */
export function computeWarnings(rows: ReadonlyArray<EventRow>): string[] {
  let noConfidence = 0;
  let lowConfidence = 0;
  let stale = 0;
  const fourteenDays = 14 * 24 * 3600_000;
  const cutoff = Date.now() - fourteenDays;
  for (const r of rows) {
    if (r.confidence_score === null || r.confidence_score === undefined) noConfidence++;
    else if (r.confidence_score < 50) lowConfidence++;
    if (r.freshness_at && new Date(r.freshness_at).getTime() < cutoff) stale++;
  }
  const warnings: string[] = [];
  if (noConfidence > 0)  warnings.push(`${noConfidence} event(s) have no confidence_score yet`);
  if (lowConfidence > 0) warnings.push(`${lowConfidence} event(s) have low confidence (<50)`);
  if (stale > 0)         warnings.push(`${stale} event(s) are stale (>14d)`);
  return warnings;
}

/** Map an EventRow + (optional) VenueRow to an EventCard. Pure. */
function toCard(
  r: EventRow,
  venue: VenueRow | undefined,
  fallbackCity: string,
): EventCard {
  return {
    id: r.id,
    title: r.title_sv || r.title_en || 'Untitled',
    description: r.description_sv ?? r.description_en ?? null,
    start_time: r.start_time,
    end_time: r.end_time ?? null,
    venue_name: venue?.name ?? '',
    city: venue?.city ?? fallbackCity,
    category_slug: r.category_slug ?? '',
    price_min_sek: r.price_min_sek ?? null,
    price_max_sek: r.price_max_sek ?? null,
    is_free: !!r.is_free,
    ticket_url: r.ticket_url ?? null,
    image_url: r.image_url ?? null,
    source: r.source ?? null,
    confidence_score: r.confidence_score ?? null,
    freshness_at: r.freshness_at ?? null,
  };
}

export async function searchEvents(
  supabase: SupabaseClient,
  input: SearchEventsInput = {}
): Promise<SearchEventsResult> {
  const warnings: string[] = [];
  const limit = Math.min(
    Math.max(input.limit ?? SEARCH_EVENTS_DEFAULT_LIMIT, 1),
    SEARCH_EVENTS_MAX_LIMIT
  );
  const fallbackCity = input.city ?? 'Stockholm';
  const hasDateFrom = !!input.date_from;
  const hasDateTo = !!input.date_to;
  const hasCategories = !!(input.categories && input.categories.length > 0);

  // ─── Pass 1: strict query (date + category as supplied) ─────────────
  let q = applyEventFilters(buildEventQuery(supabase, limit), {
    dateFrom: input.date_from,
    dateTo: input.date_to,
    isFree: input.is_free,
    priceMaxSek: input.price_max_sek,
    categories: input.categories,
  });
  let { data: rows, error } = await runQuery<EventRow>(q);
  if (error) {
    return { events: [], warnings: [`search_events error: ${error.message}`], relaxed_constraint: null };
  }
  let relaxed: RelaxedConstraint | null = null;

  // ─── Pass 2: widen date window when zero rows ───────────────────────
  // Record the FIRST relaxation that fired (not the last) so the user
  // sees the strongest signal: their date window was too narrow.
  if (rows.length === 0 && (hasDateFrom || hasDateTo)) {
    const widened = widenDateWindow(input.date_from, input.date_to, SEARCH_EVENTS_BROADEN_DAYS);
    q = applyEventFilters(buildEventQuery(supabase, limit), {
      dateFrom: widened.from,
      dateTo: widened.to,
      isFree: input.is_free,
      priceMaxSek: input.price_max_sek,
      categories: input.categories,
    });
    const widenedResult = await runQuery<EventRow>(q);
    if (widenedResult.error) {
      return { events: [], warnings: [`search_events error: ${widenedResult.error.message}`], relaxed_constraint: null };
    }
    rows = widenedResult.data;
    if (relaxed === null) relaxed = 'date_window';
  }

  // ─── Pass 3: relax category when still zero rows ────────────────────
  if (rows.length === 0 && hasCategories) {
    q = applyEventFilters(buildEventQuery(supabase, limit), {
      dateFrom: input.date_from,
      dateTo: input.date_to,
      isFree: input.is_free,
      priceMaxSek: input.price_max_sek,
      // categories intentionally omitted
    });
    const relaxedResult = await runQuery<EventRow>(q);
    if (relaxedResult.error) {
      return { events: [], warnings: [`search_events error: ${relaxedResult.error.message}`], relaxed_constraint: relaxed };
    }
    rows = relaxedResult.data;
    if (relaxed === null) relaxed = 'category';
  }

  // ─── Exclude categories (client-side; supabase-js cannot negate .in) ──
  if (input.exclude_categories && input.exclude_categories.length > 0) {
    const ex = new Set(input.exclude_categories);
    rows = rows.filter((r) => !ex.has(r.category_slug ?? ''));
  }

  // ─── Venue hop: populate venue_name + city filter ───────────────────
  const venueIds = Array.from(
    new Set(rows.map((r) => r.venue_id).filter((v): v is string => !!v)),
  );
  const venues = await fetchVenuesById(supabase, venueIds);

  // City filter anchored on the (real) venue city. Default Stockholm.
  const filteredByCity = filterByCity(rows, venues, fallbackCity);

  warnings.push(...computeWarnings(filteredByCity));

  const events: EventCard[] = filteredByCity.map((r) =>
    toCard(r, r.venue_id ? venues.get(r.venue_id) : undefined, fallbackCity),
  );

  return { events, warnings, relaxed_constraint: relaxed };
}
