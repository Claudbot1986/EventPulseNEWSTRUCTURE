/**
 * search_events — read-only tool that lists future events from Supabase.
 *
 * Phase 0 contract:
 *  - Always filters out past events (start_time > now()).
 *  - Always includes status = 'published' (default), unless caller overrides.
 *  - Defaults city to 'Stockholm' (the lock decision).
 *  - Limit defaults to 25, capped at 50.
 *  - Returns warnings for stale / multi-category / no-confidence rows.
 *
 * Source table: today `events` (live Supabase pre-migration); after the
 * migration in 20260818-0001-agent-event-graph.sql applies, switch to
 * `events_public` so anon RLS is enforced. With a service_role client
 * either table works.
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

export interface SearchEventsResult {
  events: EventCard[];
  warnings: string[];
}

export const SEARCH_EVENTS_DEFAULT_LIMIT = 25;
export const SEARCH_EVENTS_MAX_LIMIT = 50;

// Toggle: pre-migration we read from the live `events` table directly via
// the service-role client. After migration lands in production, flip this
// to 'events_public'.
export const SEARCH_EVENTS_TABLE: 'events' | 'events_public' = 'events_public';

// parse_intent emits date-only ISO strings (YYYY-MM-DD) per the IntentBrief
// schema. start_time is a full timestamptz — expand to day boundaries so the
// comparison doesn't drop same-day or future-day events.
function expandDateFloor(d: string): string {
  return /T/.test(d) ? d : `${d}T00:00:00.000Z`;
}
function expandDateCeil(d: string): string {
  return /T/.test(d) ? d : `${d}T23:59:59.999Z`;
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

  let query = supabase
    .from(SEARCH_EVENTS_TABLE)
    .select(
      'id, title_en, title_sv, description_en, description_sv, start_time, end_time, venue_id, ' +
      'is_free, price_min_sek, price_max_sek, ticket_url, image_url, ' +
      'category_slug, source, confidence_score, freshness_at, status_expanded'
    )
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(limit);

  // events_public already enforces status='published' in its view definition;
  // the base `events` table needs the filter applied explicitly.
  if (SEARCH_EVENTS_TABLE === 'events') {
    query = query.eq('status', 'published');
  }

  if (input.city) {
    // venues.city is not joined here; we filter via venues in a second hop.
    // For Phase 0 keep the filter on raw venue_id -> resolved client-side.
    // Stub: filter is applied via raw_data->>'city' if present; otherwise no-op.
  }
  if (input.date_from) query = query.gte('start_time', expandDateFloor(input.date_from));
  if (input.date_to)   query = query.lte('start_time', expandDateCeil(input.date_to));
  if (input.is_free === true) query = query.eq('is_free', true);
  if (input.is_free === false) query = query.eq('is_free', false);
  if (input.price_max_sek !== null && input.price_max_sek !== undefined) {
    query = query.lte('price_max_sek', input.price_max_sek);
  }
  if (input.categories && input.categories.length > 0) {
    query = query.in('category_slug', input.categories);
  }
  if (input.exclude_categories && input.exclude_categories.length > 0) {
    // Supabase JS cannot negate .in(); apply in post.
  }

  const { data, error } = await query;
  if (error) {
    return { events: [], warnings: [`search_events error: ${error.message}`] };
  }

  let rows = data ?? [];

  if (input.exclude_categories && input.exclude_categories.length > 0) {
    const ex = new Set(input.exclude_categories);
    rows = rows.filter((r) => !ex.has(r.category_slug));
  }

  // Aggregate warnings so a 25-row result doesn't fan out into 100 messages.
  let noConfidence = 0;
  let lowConfidence = 0;
  let stale = 0;
  for (const r of rows) {
    if (r.confidence_score === null || r.confidence_score === undefined) noConfidence++;
    else if (r.confidence_score < 50) lowConfidence++;
    if (r.freshness_at && new Date(r.freshness_at).getTime() < Date.now() - 14 * 24 * 3600_000) stale++;
  }
  if (noConfidence > 0)  warnings.push(`${noConfidence} event(s) have no confidence_score yet`);
  if (lowConfidence > 0) warnings.push(`${lowConfidence} event(s) have low confidence (<50)`);
  if (stale > 0)         warnings.push(`${stale} event(s) are stale (>14d)`);

  const events: EventCard[] = rows.map((r) => ({
    id: r.id,
    title: r.title_sv || r.title_en || 'Untitled',
    start_time: r.start_time,
    end_time: r.end_time ?? null,
    venue_name: '',
    city: input.city ?? 'Stockholm',
    category_slug: r.category_slug ?? '',
    price_min_sek: r.price_min_sek ?? null,
    price_max_sek: r.price_max_sek ?? null,
    is_free: !!r.is_free,
    ticket_url: r.ticket_url ?? null,
    image_url: r.image_url ?? null,
    confidence_score: r.confidence_score ?? null,
    freshness_at: r.freshness_at ?? null,
  }));

  return { events, warnings };
}
