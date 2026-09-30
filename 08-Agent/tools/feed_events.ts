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
import { MOOD_IDS, matchMood } from './moods';

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
  /**
   * 2026-10-01 (gratis-tile consistency): when true, the query and count
   * filter to `is_free = true`. Set by tileRoutes.gratis so the
   * "X EVENEMANG" header in UtforskaSection matches the rows the user
   * actually sees (was: 3662 even though only 30 of 15 events were free).
   * Falsy/undefined → no filter (existing behavior).
   */
  isFree?: boolean | null;
  /**
   * 2026-10-01 (stamning-tile consistency): when set, the data and count
   * pass through tools/moods.matchMood so the "X EVENEMANG" header
   * matches the mood-filtered rows. Server.ts already passed it; moved
   * the actual filter into feed_events so count can apply the same gate
   * (previously count ignored mood → showed 3662 for stamning). Known
   * mood ids: MOOD_IDS (moods.ts). Unknown / null → no filter.
   */
  mood?: string | null;
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
  // 2026-10-01 (gratis consistency): ?isFree=true → server-side .eq filter.
  // tileRoutes.gratis sätter flaggan så data-queryn returnerar garanterat
  // bara gratis-events istället för att klientfiltret gallrar bort 13/15.
  if (input.isFree === true) query = query.eq('is_free', true);
  // events_public does not expose city; the venue-side filter is applied below.

  const { data, error } = await query;
  if (error) {
    throw new Error(`feed_events: ${error.message}`);
  }

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const trimmed = has_more ? rows.slice(0, limit) : rows;

  // Canonical count of events in the active filter — used by the UI header
  // so the displayed count matches what the user actually sees. Two paths:
  //
  // A) mood set → fetch full rows in [from, to), filter via matchMood in-memory,
  //    count = matches. PostgREST can't filter by mood (it's a JS lexicon over
  //    title/description), so head:true isn't enough. Only stamning uses this
  //    and a 14-day window is bounded, so the cost is acceptable.
  //
  // B) no mood → PostgREST head:true count, fast + accurate. Bound the count
  //    to [from, to) UNLESS the request is a pure category query (no isFree /
  //    mood) — pure category queries get full-future count because the user
  //    explicitly asked for "samtliga framtida <kategori>-events i DB" (see
  //    iteration 3, 2026-10-01). Adding isFree on top of a category changes
  //    the semantics to "free <kategori>-events in this window", which should
  //    match what the user sees — so we bound the count again.
  //
  // 2026-10-01: count-frågan är FÖNSTER-BEGRÄNSAD by default (matchar data-
  // frågans [from, to)) för att headern ska överensstämma med antalet events
  // användaren faktiskt scrollar igenom. Tidigare var count obegränsad uppåt
  // för ALLA queries — det funkade för rena kategori-routes (användaren
  // ville ha DB-count av opera) men var fel för gratis/helg/stamning där
  // filtret är klient-side och headern då visade ett icke-matchande antal.
  //
  // 2026-10-01 (undantag): rena kategori-queries (bara `category`, inga
  // andra filter) behåller full-future count. Användaren bad uttryckligen om
  // "samtliga framtida <kategori>-events i DB" — opera ska visa 274 även
  // om data-frågan bara returnerar 15 rader inom en 14-dagars period.
  let total = 0;
  if (input.mood && MOOD_IDS.includes(input.mood)) {
    let moodQuery = supabase
      .from(FEED_EVENTS_TABLE)
      .select(
        'id, title_sv, title_en, description_sv, description_en, category_slug'
      )
      .gt('start_time', new Date().toISOString())
      .gte('start_time', expandDateFloor(fromIso))
      .lte('start_time', expandDateCeil(toIso));
    if (input.category) moodQuery = moodQuery.eq('category_slug', input.category);
    if (input.isFree === true) moodQuery = moodQuery.eq('is_free', true);
    const { data: moodData, error: moodErr } = await moodQuery;
    if (moodErr) {
      throw new Error(`feed_events_count_mood: ${moodErr.message}`);
    }
    total = (moodData ?? []).filter((r: any) =>
      matchMood(
        {
          title: r.title_sv || r.title_en || '',
          description: r.description_sv || r.description_en || undefined,
          category_slug: r.category_slug,
        },
        input.mood!
      )
    ).length;
  } else {
    // Pure-category requests get full-future count (no upper bound). Any
    // request with isFree OR no category at all is window-bounded so the
    // header tracks what the user actually scrolls through.
    const isPureCategory = !!input.category && input.isFree !== true;
    let countQuery = supabase
      .from(FEED_EVENTS_TABLE)
      .select('id', { count: 'exact', head: true })
      .gt('start_time', new Date().toISOString())
      .gte('start_time', expandDateFloor(fromIso));
    if (!isPureCategory) {
      countQuery = countQuery.lte('start_time', expandDateCeil(toIso));
    }
    if (input.category) countQuery = countQuery.eq('category_slug', input.category);
    if (input.isFree === true) countQuery = countQuery.eq('is_free', true);
    const { count: totalRaw, error: countError } = await countQuery;
    if (countError) {
      throw new Error(`feed_events_count: ${countError.message}`);
    }
    total = typeof totalRaw === 'number' ? totalRaw : 0;
  }

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

  // 2026-10-01 (stamning consistency): apply mood filter on the data array
  // so the events we return match the count above. server.ts previously
  // applied this filter post-hoc — moved here so count and data share
  // the same gate. Unknown moods → no-op (gated above with MOOD_IDS).
  const filteredEvents =
    input.mood && MOOD_IDS.includes(input.mood)
      ? events.filter((e) => matchMood(e, input.mood!))
      : events;

  return { events: filteredEvents, from: fromIso, to: toIso, has_more, total };
}
