/**
 * feed_events — paginated browse-window reader.
 *
 * Phase 1 contract:
 *   - Reads a date window [from, from + days) from events_public.
 *   - Excludes past events (start_time > now()).
 *   - Sorted ascending by start_time.
 *   - Capped limit (default 50, max 100) — one "page" of browse content.
 *
 * The browse-first UI calls this with `from = today` initially, then advances
 * `from` by 7 days on each scroll-end to load the next week.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';

export interface FeedEventsInput {
  /** ISO date inclusive lower bound (YYYY-MM-DD). */
  from: string;
  /** Window size in days. Default 7, max 30. */
  days?: number;
  /** Optional category filter. */
  category?: string | null;
  /** Optional city filter. */
  city?: string | null;
  /** Page size. Default 50, max 100. */
  limit?: number;
}

export interface FeedEventsResult {
  events: EventCard[];
  /** Echo of the window applied, so the client can advance pagination. */
  from: string;
  to: string;
  /** True when the window has more rows than the limit (caller should paginate). */
  has_more: boolean;
}

export const FEED_EVENTS_TABLE: 'events_public' = 'events_public';
export const FEED_EVENTS_DEFAULT_DAYS = 7;
export const FEED_EVENTS_MAX_DAYS = 30;
export const FEED_EVENTS_DEFAULT_LIMIT = 50;
export const FEED_EVENTS_MAX_LIMIT = 100;

function expandDateFloor(d: string): string {
  return /T/.test(d) ? d : `${d}T00:00:00.000Z`;
}
function expandDateCeil(d: string): string {
  return /T/.test(d) ? d : `${d}T23:59:59.999Z`;
}

/** Return YYYY-MM-DD `days` days after `from` (date arithmetic only). */
export function addDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return from;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in UTC. Caller may shift to local timezone separately. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function feedEvents(
  supabase: SupabaseClient,
  input: FeedEventsInput
): Promise<FeedEventsResult> {
  const days = Math.min(
    Math.max(input.days ?? FEED_EVENTS_DEFAULT_DAYS, 1),
    FEED_EVENTS_MAX_DAYS
  );
  const limit = Math.min(
    Math.max(input.limit ?? FEED_EVENTS_DEFAULT_LIMIT, 1),
    FEED_EVENTS_MAX_LIMIT
  );

  const fromIso = input.from;
  const toIso = addDays(fromIso, days);

  let query = supabase
    .from(FEED_EVENTS_TABLE)
    .select(
      // Live events_public has not applied 20260821-0004 (image_license).
      // Selecting those columns returns Postgres 42703; do not add them back
      // until that migration is on the live view.
      'id, title_sv, title_en, start_time, end_time, venue_id, ' +
      'category_slug, is_free, price_min_sek, price_max_sek, ticket_url, image_url, ' +
      'source, ' +
      'venues:venue_id(name, city)'
    )
    .gt('start_time', new Date().toISOString())
    .gte('start_time', expandDateFloor(fromIso))
    .lte('start_time', expandDateCeil(toIso))
    .order('start_time', { ascending: true })
    .limit(limit + 1); // +1 sentinel for has_more detection

  if (input.category) query = query.eq('category_slug', input.category);
  // events_public does not expose city; the venue-side filter is applied below.

  const { data, error } = await query;
  if (error) {
    throw new Error(`feed_events: ${error.message}`);
  }

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const trimmed = has_more ? rows.slice(0, limit) : rows;

  // Optional post-filter on venue.city when caller passed a city.
  const cityFiltered = input.city
    ? trimmed.filter((r: any) => r.venues?.city === input.city)
    : trimmed;

  const events: EventCard[] = cityFiltered.map((r: any) => ({
    id: r.id,
    title: r.title_sv || r.title_en || 'Untitled',
    start_time: r.start_time,
    end_time: r.end_time ?? null,
    venue_name: r.venues?.name ?? '',
    venue_id: r.venue_id ?? null,
    city: r.venues?.city ?? input.city ?? 'Stockholm',
    category_slug: r.category_slug ?? '',
    price_min_sek: r.price_min_sek ?? null,
    price_max_sek: r.price_max_sek ?? null,
    is_free: !!r.is_free,
    ticket_url: r.ticket_url ?? null,
    image_url: r.image_url ?? null,
    image_license: null,
    image_attribution: null,
    image_source_url: null,
    source: r.source ?? null,
  }));

  return { events, from: fromIso, to: toIso, has_more };
}
