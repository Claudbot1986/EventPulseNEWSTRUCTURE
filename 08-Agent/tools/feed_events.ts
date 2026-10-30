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
 *
 * Implementation note (option A, 2026-10-14 — production hardening):
 *   This module bypasses supabase-js and talks to PostgREST directly via
 *   fetch(). The reason is supabase-js' PostgREST OpenAPI cache: after a
 *   migration adds a column to events_public, supabase-js caches the prior
 *   column list and silently drops unknown columns from query responses
 *   until the cache invalidates asynchronously. Direct fetch() always returns
 *   exactly what PostgREST returns, so newly-added columns (e.g.
 *   editorial_description from migration 20261014-0001) become visible
 *   immediately. Same fetch also handles counts via HEAD + Prefer: count.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';
import { fetchArtistSlugsByEventIds } from './search_events';
import { MOOD_IDS, matchMood } from './moods';
import { pickDisplayText, guardDisplayTextWithFallback } from './textIntegrity';

export interface FeedEventsInput {
  /** ISO date inclusive lower bound (YYYY-MM-DD). */
  from: string;
  /**
   * Search — Utforska sök (2026-10-02): free-text sökning mot
   * title_sv, title_en, description_sv, description_en OCH venue name.
   * Whitespace-trimmas och splittas på whitespace — varje term måste
   * matchas (AND-logik). Tom sträng / null → inget filter.
   *
   * Filter-server-side via PostgREST `.or()` med `ilike` per fält; case-
   * insensitive. Saniteras mot citattecken / paranteser för att inte
   * bryta PostgREST-syntax. Resultatet är identiskt med klient-side
   * browseFilters.matchesQuery så sökresultatet matchar UI-förväntan.
   */
  q?: string | null;
  /**
   * Explicit upper-bound date (YYYY-MM-DD). När satt, ersätter `days`
   * för den övre gränsen så UI:t kan välja ett exakt datumintervall
   * (sök "1–14 november"). Mutually exclusive-ish med `days`: om satt
   * används det istället för from+days.
   */
  dateTo?: string | null;
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

// 2026-10-14: explicit columns list — PostgREST fetch bypasses supabase-js
// OpenAPI cache, so the request always includes every column we need.
//   - image_license / image_attribution / image_source_url / image_ai_generated /
//     image_ai_optout / image_generation_status: 20260825-0001 +
//     20260826-0001 — Utforska image-fallback logic.
//   - description_sv/en, confidence_score, freshness_at, lat/lng: Fas C
//     (2026-09-23) — rank_events priors + mood matcher.
//   - eventpulse_summary, description_license, description_attribution,
//     description_source_url: T0201 (2026-10-05) — UI primary description.
//   - editorial_description, editorial_description_generated_at, event_profile:
//     FAS 5.7 (2026-10-14) — migration 20261014-0001/0002. Pre-fix this was
//     silently dropped by supabase-js due to stale PostgREST OpenAPI cache;
//     direct fetch returns them immediately.
const FEED_SELECT_COLUMNS = [
  'id',
  'title_sv', 'title_en',
  'description_sv', 'description_en',
  'description_license', 'description_attribution', 'description_source_url',
  'eventpulse_summary',
  'editorial_description', 'editorial_description_generated_at', 'event_profile',
  'start_time', 'end_time',
  'venue_id',
  // 2026-10-30 — källans eget lokalnamn. Används som reserv när den
  // kurerade lokalen (venues.name) bär ett skript som inte passar
  // visningsspråket (t.ex. den koreanska lokalen "왕의 정원").
  'venue_full_name',
  'category_slug', 'is_free', 'price_min_sek', 'price_max_sek',
  'ticket_url', 'image_url',
  'image_license', 'image_attribution', 'image_source_url',
  'image_ai_generated', 'image_ai_optout', 'image_generation_status',
  'confidence_score', 'freshness_at', 'lat', 'lng',
  'is_online', 'online_url',
  'source',
  'venues:venue_id(name, city)',
].join(',');

// Minimal columns for the mood-count round-trip (text fields only — matchMood
// operates on title/description). Kept narrow so the rows payload is small.
const MOOD_SELECT_COLUMNS = [
  'id', 'title_sv', 'title_en', 'description_sv', 'description_en', 'category_slug',
].join(',');

function expandDateFloor(d: string): string {
  return /T/.test(d) ? d : `${d}T00:00:00.000Z`;
}
function expandDateCeil(d: string): string {
  return /T/.test(d) ? d : `${d}T23:59:59.999Z`;
}

/**
 * 2026-10-02 (Utforska sök): bygg en PostgREST `.or()`-sträng som matchar
 * ALLA whitespace-separerade termer mot något av title_sv/title_en/
 * description_sv/description_en via ilike. Inom en term är logiken OR
 * (något fält räcker); för AND över multipla termer används
 * searchScreen:s client-side filter (matchesQuery) på resultatet.
 *
 * PostgREST-syntax (upptäckt 2026-10-02 efter riktig server-smoke):
 * `.or()`-värdet är en komma-separerad lista av `column.operator.value`-
 * uttryck UTAN egna paranteser — PostgREST wrappar innehållet med egna
 * paranteser. Dubbel-wrap → "failed to parse logic tree". Därför
 * plockade vi bort term-grupperingen och bygger en platt komma-lista.
 *
 * Sanitering: tar bort PostgREST-syntax-tecken (citationstecken,
 * paranteser, komma) som annars kunde tolkas som filter-injection. Vi
 * strippar också `%` och `_` så de matchas litteralt (annars blir
 * "50%" en wildcard-match i PostgREST).
 *
 * Returnerar null om frågan är tom/saknas efter trim — då ingen filter-
 * sats läggs till (befintligt beteende).
 */
export function buildSearchOrFilter(q: string | null | undefined): string | null {
  if (!q || !q.trim()) return null;
  const terms = q
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[%_'"(),]/g, '').trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  // PostgREST `.or()` tar en komma-lista av OR-villkor. Vi bygger en
  // platt lista: varje term × 4 fält = 4 villkor per term. AND över
  // multipla termer hanteras client-side av search-skärmen (se
  // SearchScreen.fetchResults + browseFilters.matchesQuery).
  const clauses: string[] = [];
  for (const term of terms) {
    const needle = `%${term}%`;
    clauses.push(`title_sv.ilike.${needle}`);
    clauses.push(`title_en.ilike.${needle}`);
    clauses.push(`description_sv.ilike.${needle}`);
    clauses.push(`description_en.ilike.${needle}`);
  }
  return clauses.join(',');
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

/* ──────────────────────────────────────────────────────────────────────────
 * Direct PostgREST helper layer
 * Replaces supabase-js for tables where we need:
 *   - reliable post-migration column visibility (OpenAPI cache safe)
 *   - explicit error handling without the supabase-js wrapper shape
 * ────────────────────────────────────────────────────────────────────────── */

interface PostgrestErrorContext {
  table: string;
  status: number;
  body: string;
}

class FeedPostgrestError extends Error {
  readonly context: PostgrestErrorContext;
  constructor(ctx: PostgrestErrorContext, msg: string) {
    super(msg);
    this.context = ctx;
    this.name = 'FeedPostgrestError';
  }
}

function pgBaseUrl(): string {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error('SUPABASE_URL not configured');
  return base.replace(/\/+$/, '');
}

function pgKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function pgHeaders(): Record<string, string> {
  return {
    apikey: pgKey(),
    Authorization: `Bearer ${pgKey()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * GET request → JSON array. PostgREST returns [] for no rows.
 * Throws FeedPostgrestError with status + body on non-2xx so callers can
 * decide whether to retry, fall back, or surface the failure.
 */
async function pgSelect<T>(
  table: string,
  params: URLSearchParams,
): Promise<T[]> {
  const url = `${pgBaseUrl()}/rest/v1/${table}?${params.toString()}`;
  const r = await fetch(url, { headers: pgHeaders() });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new FeedPostgrestError(
      { table, status: r.status, body: body.slice(0, 200) },
      `pgSelect ${table} ${r.status}: ${body.slice(0, 200)}`,
    );
  }
  return (await r.json()) as T[];
}

/**
 * HEAD request with Prefer: count=exact returns Content-Range: 0-N/TOTAL
 * (or the "*"/TOTAL shape when no rows match). We parse TOTAL out of the
 * header; a missing header or "*" → 0.
 *
 * Why HEAD + Prefer rather than GET: GET would return the full row payload
 * for the count, which is wasteful when the caller only needs the number.
 * PostgREST honors HEAD + Prefer: count=exact and returns the count header
 * without a body.
 */
async function pgCount(
  table: string,
  params: URLSearchParams,
): Promise<number> {
  const url = `${pgBaseUrl()}/rest/v1/${table}?${params.toString()}`;
  const headers = pgHeaders();
  headers['Prefer'] = 'count=exact';
  const r = await fetch(url, { method: 'HEAD', headers });
  if (!r.ok) {
    // PostgREST may not honor HEAD on every endpoint. If HEAD fails, fall
    // back to a GET with a 0-row range so we still get Content-Range. The
    // Range header tells PostgREST to return 0 rows but still include the
    // count.
    return await pgCountViaRange(table, params);
  }
  const contentRange = r.headers.get('content-range') ?? '';
  const m = contentRange.match(/\/(\d+|\*)$/);
  if (!m || m[1] === '*') return 0;
  return parseInt(m[1], 10) || 0;
}

async function pgCountViaRange(
  table: string,
  params: URLSearchParams,
): Promise<number> {
  const url = `${pgBaseUrl()}/rest/v1/${table}?${params.toString()}`;
  const headers = pgHeaders();
  headers['Prefer'] = 'count=exact';
  headers['Range-Unit'] = 'items';
  headers['Range'] = '0-0';
  const r = await fetch(url, { method: 'GET', headers });
  if (!r.ok) return 0;
  const contentRange = r.headers.get('content-range') ?? '';
  const m = contentRange.match(/\/(\d+|\*)$/);
  if (!m || m[1] === '*') return 0;
  return parseInt(m[1], 10) || 0;
}

/**
 * Build a URLSearchParams for the main events_public read:
 *   - select: FEED_SELECT_COLUMNS (always present)
 *   - start_time: gt.now, gte.from, lte.to (PostgREST AND-combines duplicates)
 *   - ordering + limit + offset + optional category / isFree / searchOr
 *
 * PostgREST allows duplicate keys; URLSearchParams supports append() to
 * keep all three start_time constraints.
 */
function buildMainReadParams(input: {
  nowIso: string;
  fromIso: string;
  toIso: string;
  searchOr: string | null;
  category: string | null;
  isFree: boolean | null;
  limit: number;
  offset: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('select', FEED_SELECT_COLUMNS);
  params.append('start_time', `gt.${input.nowIso}`);
  params.append('start_time', `gte.${expandDateFloor(input.fromIso)}`);
  params.append('start_time', `lte.${expandDateCeil(input.toIso)}`);
  params.set('order', 'start_time.asc');
  params.set('limit', String(input.limit + 1)); // +1 sentinel for has_more
  params.set('offset', String(input.offset));
  if (input.category) params.set('category_slug', `eq.${input.category}`);
  if (input.isFree === true) params.set('is_free', 'eq.true');
  if (input.searchOr) params.set('or', `(${input.searchOr})`);
  return params;
}

/**
 * Build URLSearchParams for the mood count read: full window of future events
 * in the requested category / free / search filter, but only text-fields so
 * payload is small. limit is high enough to cover Stockholm density (typical
 * 14-day windows fit well under this).
 */
function buildMoodCountParams(input: {
  nowIso: string;
  fromIso: string;
  toIso: string;
  category: string | null;
  isFree: boolean | null;
  searchOr: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('select', MOOD_SELECT_COLUMNS);
  params.append('start_time', `gt.${input.nowIso}`);
  params.append('start_time', `gte.${expandDateFloor(input.fromIso)}`);
  params.append('start_time', `lte.${expandDateCeil(input.toIso)}`);
  // 5000 covers "all free music in Stockholm for the next 5 years" comfortably.
  params.set('limit', '5000');
  if (input.category) params.set('category_slug', `eq.${input.category}`);
  if (input.isFree === true) params.set('is_free', 'eq.true');
  if (input.searchOr) params.set('or', `(${input.searchOr})`);
  return params;
}

/**
 * Build URLSearchParams for the PostgREST head-count read.
 *   - select = id only (no payload needed, count comes from Content-Range)
 *   - start_time: future-anchored + window-bounded (unless pure-category)
 *   - optional category / isFree / searchOr
 * `isPureCategory = true` skips the upper bound so the count reflects "all
 * future events in this category" — opera shows 274 even when the page only
 * loads the first 15 in a 14-day window.
 */
function buildCountParams(input: {
  nowIso: string;
  fromIso: string;
  toIso: string;
  category: string | null;
  isFree: boolean | null;
  searchOr: string | null;
  isPureCategory: boolean;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('select', 'id');
  params.append('start_time', `gt.${input.nowIso}`);
  params.append('start_time', `gte.${expandDateFloor(input.fromIso)}`);
  if (!input.isPureCategory) {
    params.append('start_time', `lte.${expandDateCeil(input.toIso)}`);
  }
  if (input.category) params.set('category_slug', `eq.${input.category}`);
  if (input.isFree === true) params.set('is_free', 'eq.true');
  if (input.searchOr) params.set('or', `(${input.searchOr})`);
  return params;
}

/**
 * Build URLSearchParams for the event_translations read by event_id set.
 * service_role read — anon never reaches this table directly (DENY on the
 * table). One round trip per feed read — cheap, gated on input.locale.
 */
function buildTranslationsParams(locale: string, ids: string[]): URLSearchParams {
  const params = new URLSearchParams();
  params.set('select', 'event_id,title');
  params.set('language', `eq.${locale}`);
  params.set('event_id', `in.(${ids.join(',')})`);
  return params;
}

type AnyRow = Record<string, unknown>;

/* ──────────────────────────────────────────────────────────────────────────
 * Main export
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Paginated read of `events_public` over a future-anchored window.
 *
 * Signature kept as `(supabase, input)` for back-compat with server.ts;
 * the `supabase` client is no longer used internally — only the artist-slug
 * hop in fetchArtistSlugsByEventIds (which reads from event_artists and is
 * unrelated to the OpenAPI cache issue). When callers want to drop the
 * dep, they can pass anything truthy.
 */
export async function feedEvents(
  _supabase: SupabaseClient,
  input: FeedEventsInput,
): Promise<FeedEventsResult> {
  // Back-compat: supabase-js client is no longer required, but the
  // signature stays so server.ts (and any future caller) need no change.
  // We use it only for the artist-slug hop, which is also fine with a
  // direct fetch — keeping supabase here for now to minimise diff.

  // Clamp inputs — identical to previous supabase-js path.
  const days = Math.min(
    Math.max(input.days ?? FEED_EVENTS_DEFAULT_DAYS, 1),
    FEED_EVENTS_MAX_DAYS,
  );
  const limit = Math.min(
    Math.max(input.limit ?? FEED_EVENTS_DEFAULT_LIMIT, 1),
    FEED_EVENTS_MAX_LIMIT,
  );
  const offset = Math.max(input.offset ?? 0, 0);

  const fromIso = input.from;
  // 2026-10-02: explicit dateTo vinner över days när satt (UI:t väljer
  // ett bestämt intervall i sökningen — "1–14 november"). days:3650
  // tillsammans med dateTo ger ett brett undre fönster + bestämt tak.
  const toIso = input.dateTo ? input.dateTo : addDays(fromIso, days);
  const nowIso = new Date().toISOString();

  // 2026-10-02: text search filter (server-side). När q är satt returnerar
  // buildSearchOrFilter en .or()-sträng som söker mot titel + beskrivning
  // på både sv och en.
  const searchOr = buildSearchOrFilter(input.q);

  // ─── 1. Main read ─────────────────────────────────────────────────────
  // (limit + 1) lets us detect has_more by counting the sentinel row.
  const mainParams = buildMainReadParams({
    nowIso,
    fromIso,
    toIso,
    searchOr,
    category: input.category ?? null,
    isFree: input.isFree ?? null,
    limit,
    offset,
  });
  const rows = await pgSelect<AnyRow>(FEED_EVENTS_TABLE, mainParams);
  const has_more = rows.length > limit;
  const trimmed = has_more ? rows.slice(0, limit) : rows;

  // ─── 2. Mood / count branch ───────────────────────────────────────────
  let total = 0;
  if (input.mood && MOOD_IDS.includes(input.mood)) {
    // A) mood set → fetch full rows in [from, to), filter via matchMood
    //    in-memory, count = matches. PostgREST can't filter by mood (it's
    //    a JS lexicon over title/description), so head:true isn't enough.
    //    Stamning is the only mood that uses this; the 14-day window keeps
    //    it bounded.
    const moodParams = buildMoodCountParams({
      nowIso,
      fromIso,
      toIso,
      category: input.category ?? null,
      isFree: input.isFree ?? null,
      searchOr,
    });
    let moodRows: AnyRow[];
    try {
      moodRows = await pgSelect<AnyRow>(FEED_EVENTS_TABLE, moodParams);
    } catch (err) {
      throw new FeedPostgrestError(
        (err instanceof FeedPostgrestError)
          ? err.context
          : { table: FEED_EVENTS_TABLE, status: 0, body: (err as Error).message },
        `feed_events_count_mood: ${(err as Error).message}`,
      );
    }
    // 2026-10-02 (sök) client-side fallback filter — keeps total consistent
    // even if PostgREST .or() ever changes semantics. Mirror the data query.
    const totalRows = searchOr
      ? moodRows.filter((r) => {
          const terms = searchOr
            .split(',')
            .map((s) => s.replace(/[()]/g, '').trim())
            .filter(Boolean);
          return terms.every((term) => {
            const needle = term.match(/\.ilike\.(.+)\)$/)?.[1] ?? '';
            const clean = needle.replace(/%/g, '').toLowerCase();
            if (!clean) return true;
            const hay =
              `${r.title_sv ?? ''} ${r.title_en ?? ''} ` +
              `${r.description_sv ?? ''} ${r.description_en ?? ''}`.toLowerCase();
            return hay.includes(clean);
          });
        })
      : moodRows;
    total = totalRows.filter((r) =>
      matchMood(
        {
          title: (r.title_sv ?? r.title_en ?? '') as string,
          description: ((r.description_sv ?? r.description_en) as string) || undefined,
          category_slug: (r.category_slug ?? '') as string,
        },
        input.mood!,
      ),
    ).length;
  } else {
    // B) No mood → PostgREST count via HEAD + Prefer.
    //
    // 2026-10-01: count-frågan är FÖNSTER-BEGRÄNSAD by default (matchar
    // data-frågans [from, to)) för att headern ska överensstämma med
    // antalet events användaren faktiskt scrollar igenom. Tidigare var
    // count obegränsad uppåt för ALLA queries.
    //
    // 2026-10-01 (undantag): rena kategori-queries (bara `category`,
    // inga andra filter) behåller full-future count.
    //
    // 2026-10-02 (Utforska sök): en `q`-filter KVALIFICERAR count:n som
    // window-bounded — text-frågan är ett användar-explicerat filter som
    // inte ska släppa headern fri.
    const isPureCategory =
      !!input.category && input.isFree !== true && !searchOr;
    const countParams = buildCountParams({
      nowIso,
      fromIso,
      toIso,
      category: input.category ?? null,
      isFree: input.isFree ?? null,
      searchOr,
      isPureCategory,
    });
    try {
      total = await pgCount(FEED_EVENTS_TABLE, countParams);
    } catch (err) {
      throw new FeedPostgrestError(
        (err instanceof FeedPostgrestError)
          ? err.context
          : { table: FEED_EVENTS_TABLE, status: 0, body: (err as Error).message },
        `feed_events_count: ${(err as Error).message}`,
      );
    }
  }

  // Optional post-filter on venue.city when caller passed a city.
  const cityFiltered = input.city
    ? trimmed.filter((r) => {
        const v = r.venues as { city?: string } | undefined;
        return v?.city === input.city;
      })
    : trimmed;

  // ─── 3. Optional locale translation lookup ─────────────────────────────
  const translationByEvent: Map<string, { title?: string | null }> = new Map();
  if (input.locale && cityFiltered.length > 0) {
    const ids = cityFiltered.map((r) => r.id).filter((x): x is string => !!x);
    const tParams = buildTranslationsParams(input.locale, ids);
    try {
      const translations = await pgSelect<{ event_id: string; title?: string | null }>(
        'event_translations',
        tParams,
      );
      for (const t of translations) {
        if (t.title) translationByEvent.set(t.event_id, { title: t.title });
      }
    } catch {
      // Translation read is best-effort — fail silently and let the
      // fallback (title_sv → title_en → 'Untitled') kick in.
    }
  }

  // ─── 4. Optional artist-slug hop ──────────────────────────────────────
  // Fas C (2026-09-23): one event_artists read attaches lowercased
  // artist_slugs to every card. fetchArtistSlugsByEventIds still uses
  // supabase-js internally — that path doesn't touch the affected
  // columns, so it stays. If we ever migrate event_artists too, swap it
  // for a parallel pgSelect helper.
  const artistMap =
    input.withArtistSlugs && cityFiltered.length > 0
      ? await fetchArtistSlugsByEventIds(
          _supabase,
          cityFiltered.map((r) => r.id).filter((id): id is string => !!id),
        )
      : new Map<string, Set<string>>();

  // ─── 5. Map rows → EventCard ──────────────────────────────────────────
  const events: EventCard[] = cityFiltered.map((r) => {
    const idStr = r.id as string;
    const artistSlugs = artistMap.get(idStr);
    const venue = (r.venues as { name?: string; city?: string } | undefined) ?? {};
    return {
      id: idStr,
      // Translation > Swedish > English > 'Untitled'. Per Språkstöd plan
      // 2026-09-21 — search/ranking intentionally remains sv-only; this
      // only affects what the card displays client-side.
      //
      // 2026-10-30 (textintegritet): pickDisplayText väljer den första
      // varianten som passar visningsspråket. En event vars titel är på
      // ryska ska inte visas som ryska i en svensk app om vi har en
      // översättning — och den ska inte tyst bytas ut mot en tom rad.
      title: pickDisplayText(
        [
          translationByEvent.get(idStr)?.title,
          r.title_sv as string,
          r.title_en as string,
          'Untitled',
        ],
        input.locale,
      ),
      // T0201 (2026-10-05): eventpulse_summary primärt, sen licens-tillåten
      // description_sv/en. events_public view sätter description_* till
      // NULL när license='unknown' (20261010-0001-linter-cleanup-alt-a).
      // FAS 5.7 (2026-10-14): editorial_description är det primära valet
      // i UI:t (descriptionFallback.js steg 1) — server-side returnerar
      // det som ett separat fält, appen mappar in det. Vi lägger inte in
      // det i `description` (som styr Vilse-stämpling) eftersom vi vill
      // hålla editorial separat och undvika dubbel-skrivning mellan
      // primär/sekundär kanal.
      description:
        (r.eventpulse_summary as string) ||
        (r.description_sv as string) ||
        (r.description_en as string) ||
        undefined,
      description_license: (r.description_license as string | null) ?? null,
      description_attribution: (r.description_attribution as string | null) ?? null,
      description_source_url: (r.description_source_url as string | null) ?? null,
      editorial_description: (r.editorial_description as string | null) ?? null,
      event_profile: (r.event_profile as Record<string, unknown> | null) ?? null,
      start_time: r.start_time as string,
      end_time: (r.end_time as string | null) ?? null,
      venue_name: guardDisplayTextWithFallback(
        venue.name,
        r.venue_full_name as string | null,
        input.locale,
      ),
      venue_id: (r.venue_id as string | null) ?? null,
      city: venue.city ?? input.city ?? 'Stockholm',
      venue_lat: typeof r.lat === 'number' ? r.lat : undefined,
      venue_lng: typeof r.lng === 'number' ? r.lng : undefined,
      category_slug: (r.category_slug as string) ?? '',
      price_min_sek: (r.price_min_sek as number | null) ?? null,
      price_max_sek: (r.price_max_sek as number | null) ?? null,
      is_free: !!r.is_free,
      ticket_url: (r.ticket_url as string | null) ?? null,
      image_url: (r.image_url as string | null) ?? null,
      image_license: (r.image_license as string | null) ?? null,
      image_attribution: (r.image_attribution as string | null) ?? null,
      image_source_url: (r.image_source_url as string | null) ?? null,
      image_ai_generated: !!r.image_ai_generated,
      image_ai_optout: !!r.image_ai_optout,
      // EventCard types this as a fixed literal union; PostgREST returns
      // arbitrary text so we cast to the type, then narrow the unknown
      // rows to that union by simple membership.
      image_generation_status: ((): EventCard['image_generation_status'] => {
        const raw = r.image_generation_status as string | null;
        if (raw === 'pending' || raw === 'completed' || raw === 'failed' || raw === 'no_credits') {
          return raw;
        }
        return null;
      })(),
      confidence_score: typeof r.confidence_score === 'number' ? r.confidence_score : undefined,
      freshness_at: (r.freshness_at as string | undefined) ?? undefined,
      source: (r.source as string | null) ?? null,
      artist_slugs: artistSlugs && artistSlugs.size > 0 ? Array.from(artistSlugs) : undefined,
    };
  });

  // ─── 6. Final mood filter on returned cards ───────────────────────────
  // 2026-10-01 (stamning consistency): apply mood filter on the data array
  // so the events we return match the count above. Unknown moods → no-op.
  const filteredEvents =
    input.mood && MOOD_IDS.includes(input.mood)
      ? events.filter((e) => matchMood(e, input.mood!))
      : events;

  return { events: filteredEvents, from: fromIso, to: toIso, has_more, total };
}
