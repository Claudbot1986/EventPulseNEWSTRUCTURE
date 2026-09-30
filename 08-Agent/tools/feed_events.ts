/**
 * feed_events — paginated browse-window reader.
 *
 * Phase 1 contract:
 *   - Reads a date window [from, from + days) from events_public.
 *   - Excludes past events (start_time > now()).
 *   - Sorted ascending by start_time.
 *   - Paginated via `limit` + `offset` (PostgREST .range).
 *
 * Cap model (2026-09-28 lift for Utforska infinite-scroll):
 *   - DEFAULT_LIMIT = 50  (chat / browse unchanged)
 *   - MAX_LIMIT     = 500 (was 100 — Utforska fetches full categories)
 *   - DEFAULT_DAYS  = 7
 *   - MAX_DAYS      = 3650 (was 30 — Utforska wants all future events)
 *
 * The browse-first UI calls this with `from = today` initially, then advances
 * `from` by 7 days on each scroll-end to load the next week. The Utforska
 * tiles page by `offset` within a single wide window instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';
import { fetchArtistSlugsByEventIds } from './search_events';

export interface FeedEventsInput {
  /** ISO date inclusive lower bound (YYYY-MM-DD). */
  from: string;
  /** Window size in days. Default 7, max 3650 (~10 years). */
  days?: number;
  /** Optional category filter. */
  category?: string | null;
  /** Optional city filter. */
  city?: string | null;
  /** Page size. Default 50, max 500. */
  limit?: number;
  /** Row offset for pagination. Default 0. Use with `limit` for infinite scroll. */
  offset?: number;
  /**
   * Optional BCP-47 locale tag (e.g. 'ar', 'fa', 'so', 'pl', 'tr', 'fi').
   * When provided, the card `title` is taken from event_translations where
   * present, falling back to events.title_sv → events.title_en. Passing a
   * tag we haven't translated yet is a no-op (rows missing → fallback).
   * Språkstöd 2026-09-21 — event_translations table backs this lookup.
   */
  locale?: string | null;
  /**
   * Fas C (2026-09-23): when true, one extra event_artists read attaches
   * lowercased `artist_slugs` to every card so rank_events can apply the
   * followed-artist boost. Off by default — the anonymous/control feed
   * paths skip the read entirely (same isolation discipline as the chat
   * pipeline's variant gating).
   */
  withArtistSlugs?: boolean;
}

export interface FeedEventsResult {
  events: EventCard[];
  /** Echo of the window applied, so the client can advance pagination. */
  from: string;
  to: string;
  /** True when the window has more rows than the limit (caller should paginate). */
  has_more: boolean;
  /**
   * Canonical count of all future events from `from` onward in `events_public`,
   * independent of the page size. The UI displays this as "X riktiga event att
   * upptäcka" so the count reflects what's actually in Supabase right now —
   * not just the locally-paginated window. Refresh on AppState 'active' so the
   * header tracks Supabase when the user returns to the app.
   */
  total: number;
}

export const FEED_EVENTS_TABLE: 'events_public' = 'events_public';
export const FEED_EVENTS_DEFAULT_DAYS = 7;
// 2026-09-28 lift: Utforska-tiles behöver kunna hämta hela kategorier som
// "music" (~1181 events) i ett enda fönster. 3650 dagar (~10 år) täcker hela
// spannet vi har i DB (events_public sträcker sig till 2032).
export const FEED_EVENTS_MAX_DAYS = 3650;
// 2026-09-28 lift: 500 rader / sida är nog för Utforska infinite scroll.
// Början-vyn laddar 15, scroll laddar 15 åt gången — total kapacitet ~500
// rader innan klienten behöver gå vidare.
export const FEED_EVENTS_DEFAULT_LIMIT = 50;
export const FEED_EVENTS_MAX_LIMIT = 500;

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
  const offset = Math.max(input.offset ?? 0, 0);

  const fromIso = input.from;
  const toIso = addDays(fromIso, days);

  let query = supabase
    .from(FEED_EVENTS_TABLE)
    .select(
      // 20260825-0001-ai-image-mandatory.sql + 20260826-0001-events-image-ai-optout.sql
      // expose image_license, image_ai_generated, image_ai_optout, and
      // image_generation_status through events_public. The hook
      // 06-UI/hooks/useAiImageUrl.js reads these to decide between
      // pre-baked / lazy / original / empty in the Utforska tab.
      // Fas C (2026-09-23) adds description_sv/en, confidence_score,
      // freshness_at and event-level lat/lng so rank_events' priors
      // (confidence, staleness, geo nudge) and the upcoming mood matcher
      // become active on the browse page. Same columns events_public
      // already exposes for search_events (EVENT_SELECT_COLUMNS).
      'id, title_sv, title_en, description_sv, description_en, ' +
      'start_time, end_time, venue_id, ' +
      'category_slug, is_free, price_min_sek, price_max_sek, ticket_url, image_url, ' +
      'image_license, image_attribution, image_source_url, ' +
      'image_ai_generated, image_ai_optout, image_generation_status, ' +
      'confidence_score, freshness_at, lat, lng, ' +
      'source, ' +
      'venues:venue_id(name, city)'
    )
    .gt('start_time', new Date().toISOString())
    .gte('start_time', expandDateFloor(fromIso))
    .lte('start_time', expandDateCeil(toIso))
    .order('start_time', { ascending: true })
    // PostgREST pagination: .range(start, end) is inclusive on both ends, so
    // we ask for `limit + 1` rows beyond offset to detect has_more, then
    // trim the sentinel row before returning. offset=0 + limit=15 yields
    // rows 0..15 (16 fetched, 15 returned, has_more=true if more exist).
    .range(offset, offset + limit);

  if (input.category) query = query.eq('category_slug', input.category);
  // events_public does not expose city; the venue-side filter is applied below.

  const { data, error } = await query;
  if (error) {
    throw new Error(`feed_events: ${error.message}`);
  }

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const trimmed = has_more ? rows.slice(0, limit) : rows;

  // Canonical count of all future events in the active filter — used by the UI
  // header so the displayed count tracks Supabase, not the local page. Uses
  // `head: true` so PostgREST returns only the count, no row bodies.
  //
  // 2026-10-01: Utforska-tiles behöver ett kategorispecifikt antal ("opera
  // visar 1200 events i DB") istället för det lokala sid-fönstret. Samma
  // kategori-filter som data-frågan så varje knapp speglar sin kategori.
  //
  // 2026-10-01 (iteration 3, användarens förtydligande): count-frågan ska
  // INTE vara fönster-begränsad. Användaren vill se "samtliga framtida
  // opera-events i DB" — inte "opera-events inom 14-dagarsfönstret". Tar
  // bort `.lte(toIso)` så total representerar DB-antalet för hela den
  // framtida horisonten, inte bara vad som ryms i data-frågans [from, to).
  // Kvar: `.gt(now)` (bara framtida), `.gte(fromIso)` (knappens tidsstart
  // — "imorgon" hoppar över dagens events), `.eq(category)` (knappens
  // kategori när sådan finns).
  let countQuery = supabase
    .from(FEED_EVENTS_TABLE)
    .select('id', { count: 'exact', head: true })
    .gt('start_time', new Date().toISOString())
    .gte('start_time', expandDateFloor(fromIso));
  if (input.category) countQuery = countQuery.eq('category_slug', input.category);
  const { count: totalRaw, error: countError } = await countQuery;
  if (countError) {
    throw new Error(`feed_events_count: ${countError.message}`);
  }
  const total = typeof totalRaw === 'number' ? totalRaw : 0;

  // Optional post-filter on venue.city when caller passed a city.
  const cityFiltered = input.city
    ? trimmed.filter((r: any) => r.venues?.city === input.city)
    : trimmed;

  // Språkstöd 2026-09-21: when a locale is supplied, swap the Swedish
  // title for the matching translation row where present. Empty map =
  // every row falls back to title_sv. service_role read on
  // event_translations; anon never reaches the table directly (DENY
  // policies on the table). One round trip per feed read — cheap, and
  // callers that don't pass locale skip the SELECT entirely.
  const translationByEvent: Map<string, { title?: string | null }> = new Map();
  if (input.locale && cityFiltered.length > 0) {
    const ids = cityFiltered.map((r: any) => r.id);
    const { data: translations, error: tErr } = await supabase
      .from('event_translations')
      .select('event_id, title')
      .eq('language', input.locale)
      .in('event_id', ids);
    if (!tErr && translations) {
      for (const t of translations as Array<{ event_id: string; title?: string | null }>) {
        if (t.title) translationByEvent.set(t.event_id, { title: t.title });
      }
    }
  }

  // Fas C: one artist_slugs hop for the treatment feed so the
  // followed-artist boost works on the browse page. Gated behind
  // withArtistSlugs — anonymous/control callers never pay this read.
  const artistMap =
    input.withArtistSlugs && cityFiltered.length > 0
      ? await fetchArtistSlugsByEventIds(
          supabase,
          cityFiltered.map((r: any) => r.id).filter((id: unknown): id is string => !!id)
        )
      : new Map<string, Set<string>>();

  const events: EventCard[] = cityFiltered.map((r: any) => {
    const artistSlugs = artistMap.get(r.id);
    return {
      id: r.id,
      // Translation > Swedish > English > 'Untitled'. Per Språkstöd plan
      // 2026-09-21 — search/ranking intentionally remains sv-only; this
      // only affects what the card displays client-side.
      title:
        translationByEvent.get(r.id)?.title ||
        r.title_sv ||
        r.title_en ||
        'Untitled',
      // Fas C: description feeds the ranker (and the mood matcher, Fas D).
      // Same sv > en fallback as search_events so ranking stays language-stable.
      description: r.description_sv || r.description_en || undefined,
      start_time: r.start_time,
      end_time: r.end_time ?? null,
      venue_name: r.venues?.name ?? '',
      venue_id: r.venue_id ?? null,
      city: r.venues?.city ?? input.city ?? 'Stockholm',
      venue_lat: typeof r.lat === 'number' ? r.lat : undefined,
      venue_lng: typeof r.lng === 'number' ? r.lng : undefined,
      category_slug: r.category_slug ?? '',
      price_min_sek: r.price_min_sek ?? null,
      price_max_sek: r.price_max_sek ?? null,
      is_free: !!r.is_free,
      ticket_url: r.ticket_url ?? null,
      image_url: r.image_url ?? null,
      image_license: r.image_license ?? null,
      image_attribution: r.image_attribution ?? null,
      image_source_url: r.image_source_url ?? null,
      image_ai_generated: r.image_ai_generated ?? false,
      image_ai_optout: r.image_ai_optout ?? false,
      image_generation_status: r.image_generation_status ?? null,
      confidence_score: typeof r.confidence_score === 'number' ? r.confidence_score : undefined,
      freshness_at: r.freshness_at ?? undefined,
      source: r.source ?? null,
      artist_slugs: artistSlugs && artistSlugs.size > 0 ? Array.from(artistSlugs) : undefined,
    };
  });

  return { events, from: fromIso, to: toIso, has_more, total };
}
