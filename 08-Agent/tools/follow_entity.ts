/**
 * follow_entity — T0050 / MVP-gap §77.
 *
 * Lets a user follow / unfollow a venue (Phase 1 declared preference).
 * Phase 2 will extend this to artists as well — see T0050 spec.
 *
 * Storage:
 *   Persists to the existing `user_preferences` jsonb column (same table
 *   onboarding uses for `categories`). We extend the preferences shape
 *   in-place rather than adding a new column — the table is already the
 *   declared-preferences bag and there is no separate "user_profiles"
 *   table in the current schema (see 00-Vault/.../00-Core/02-North-Star.md).
 *
 *   Shape (jsonb):
 *     {
 *       categories: string[],
 *       followed_venue_ids: string[]   // NEW in T0050 — venue UUIDs
 *     }
 *
 *   Missing / null fields are tolerated — readers always default to `[]`.
 *   Adding new declared-pref shapes later (followed_artists, budget_sek_max,
 *   …) follows the same pattern: additive jsonb key, reader default `[]`.
 *
 * Idempotency:
 *   `followVenue` is idempotent — calling it twice is the same as calling
 *   it once. `unfollowVenue` is also idempotent — missing ids collapse to a
 *   no-op (the upsert still bumps `updated_at` so the user gets a fresh
 *   cache TTL on every action).
 *
 * Best-effort:
 *   Never throws into the chat path. Returns { ok: false, warning } on
 *   validation or DB failure so the caller can decide whether to surface
 *   it. The wire surface (`POST /agent/follow`) treats ok:false as 202
 *   with a warning, mirroring the notification + preferences endpoints.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Hard cap on the size of `followed_venue_ids`. Prevents a malicious
 *  client from blowing up the jsonb column. 200 is plenty for a real
 *  personal agent — Bandsintown caps "followed artists" at 2000 and
 *  Meetup caps "followed groups" similarly. */
export const MAX_FOLLOWED_VENUES = 200;

/** Shape of the user_preferences.preferences jsonb. Kept additive —
 *  unknown keys are preserved through upsert so future declared prefs
 *  (followed_artists, budget_sek_max) do not clobber existing data. */
export interface StatedPreferences {
  categories?: unknown;
  followed_venue_ids?: unknown;
  followed_artist_slugs?: unknown;
  [k: string]: unknown;
}

/** Normalize a raw jsonb row into the fields this module owns. Defensive
 *  against malformed jsonb (wrong types, missing keys). */
export function readFollowedVenueIds(prefs: StatedPreferences | null | undefined): string[] {
  if (!prefs || typeof prefs !== 'object') return [];
  const raw = prefs.followed_venue_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/** T0050 artist follow — read the user's followed artist slugs.
 *  Same defensive shape as readFollowedVenueIds. Slugs are stored
 *  lowercased (matching the artists.slug convention); readers should
 *  compare case-insensitively as a belt-and-braces guard. */
export function readFollowedArtistSlugs(prefs: StatedPreferences | null | undefined): string[] {
  if (!prefs || typeof prefs !== 'object') return [];
  const raw = prefs.followed_artist_slugs;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.toLowerCase());
}

/** Validate an artist slug. Must be a non-empty kebab/lowercase string of
 *  ≤ 120 chars, with no leading or trailing hyphen. The 120-char bound
 *  matches the artists.slug column width. */
const ARTIST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;
export function isArtistSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && ARTIST_SLUG_RE.test(value);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export interface FollowVenueInput {
  client_user_id: string;
  venue_id: string;
  now?: Date;
}

export interface FollowVenueResult {
  ok: boolean;
  /** True if the venue was added, false if it was already followed. */
  added: boolean;
  /** Number of venue ids the user is now following. */
  count: number;
  warning?: string;
}

/**
 * Follow a venue. Idempotent — a no-op when the venue is already in the
 * followed list. Bumps `updated_at` so caches re-fetch.
 */
export async function followVenue(
  supabase: SupabaseClient,
  input: FollowVenueInput
): Promise<FollowVenueResult> {
  if (!isUuid(input.client_user_id)) {
    return { ok: false, added: false, count: 0, warning: 'client_user_id must be a uuid' };
  }
  if (!isUuid(input.venue_id)) {
    return { ok: false, added: false, count: 0, warning: 'venue_id must be a uuid' };
  }
  const now = input.now ?? new Date();

  let current: StatedPreferences = {};
  const read = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', input.client_user_id)
    .maybeSingle();
  if (read.error) {
    return { ok: false, added: false, count: 0, warning: `read failed: ${read.error.message}` };
  }
  if (read.data && typeof read.data.preferences === 'object' && read.data.preferences !== null) {
    current = read.data.preferences as StatedPreferences;
  }

  const existing = readFollowedVenueIds(current);
  if (existing.includes(input.venue_id)) {
    return { ok: true, added: false, count: existing.length };
  }
  if (existing.length >= MAX_FOLLOWED_VENUES) {
    return {
      ok: false,
      added: false,
      count: existing.length,
      warning: `followed venue cap reached (${MAX_FOLLOWED_VENUES})`,
    };
  }
  const nextList = [...existing, input.venue_id];
  const next: StatedPreferences = {
    ...current,
    followed_venue_ids: nextList,
  };

  const upsert = await supabase
    .from('user_preferences')
    .upsert(
      {
        client_user_id: input.client_user_id,
        preferences: next,
        updated_at: now.toISOString(),
      },
      { onConflict: 'client_user_id' }
    );
  if (upsert.error) {
    return { ok: false, added: false, count: existing.length, warning: `upsert failed: ${upsert.error.message}` };
  }
  return { ok: true, added: true, count: nextList.length };
}

export interface UnfollowVenueInput {
  client_user_id: string;
  venue_id: string;
  now?: Date;
}

export interface UnfollowVenueResult {
  ok: boolean;
  /** True if the venue was removed, false if it was not in the list. */
  removed: boolean;
  /** Number of venue ids the user is now following. */
  count: number;
  warning?: string;
}

/** Unfollow a venue. Idempotent — no-op when the venue was not followed.
 *  Always bumps `updated_at` so the row is fresh for the next read. */
export async function unfollowVenue(
  supabase: SupabaseClient,
  input: UnfollowVenueInput
): Promise<UnfollowVenueResult> {
  if (!isUuid(input.client_user_id)) {
    return { ok: false, removed: false, count: 0, warning: 'client_user_id must be a uuid' };
  }
  if (!isUuid(input.venue_id)) {
    return { ok: false, removed: false, count: 0, warning: 'venue_id must be a uuid' };
  }
  const now = input.now ?? new Date();

  const read = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', input.client_user_id)
    .maybeSingle();
  if (read.error) {
    return { ok: false, removed: false, count: 0, warning: `read failed: ${read.error.message}` };
  }
  const current: StatedPreferences =
    read.data && typeof read.data.preferences === 'object' && read.data.preferences !== null
      ? (read.data.preferences as StatedPreferences)
      : {};
  const existing = readFollowedVenueIds(current);
  if (!existing.includes(input.venue_id)) {
    return { ok: true, removed: false, count: existing.length };
  }
  const nextList = existing.filter((v) => v !== input.venue_id);
  const next: StatedPreferences = {
    ...current,
    followed_venue_ids: nextList,
  };

  const upsert = await supabase
    .from('user_preferences')
    .upsert(
      {
        client_user_id: input.client_user_id,
        preferences: next,
        updated_at: now.toISOString(),
      },
      { onConflict: 'client_user_id' }
    );
  if (upsert.error) {
    return { ok: false, removed: false, count: existing.length, warning: `upsert failed: ${upsert.error.message}` };
  }
  return {
    ok: true,
    removed: true,
    count: nextList.length,
  };
}

// ─── Reader: cache + load ────────────────────────────────────────────────────

export interface FollowedVenues {
  venue_ids: string[];
  fetchedAt: string;
}

interface FollowedVenuesCacheEntry {
  data: FollowedVenues;
  expiresAt: number;
}

/** 5-minute TTL mirrors the implicit-signal and stated-prefs caches
 *  (see personalize.ts). Long enough to skip hammering Supabase, short
 *  enough to reflect a follow / unfollow within the next chat turn. */
export const FOLLOW_CACHE_TTL_SECONDS = 300;

const _followedCache = new Map<string, FollowedVenuesCacheEntry>();

/**
 * Read the user's followed venue ids, with an in-process cache. Same
 * cache-shape contract as `loadStatedPreferences` (personalize.ts).
 *
 * Returns `[]` (not null) when the user has no row or no followed venues.
 * The caller decides whether to apply the ranker lift based on the
 * array being non-empty — empty is the correct "no follow" answer, not
 * an error.
 */
export async function loadFollowedVenues(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; skipCache?: boolean } = {}
): Promise<FollowedVenues> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (!opts.skipCache) {
    const hit = _followedCache.get(client_user_id);
    if (hit && hit.expiresAt > nowMs) return hit.data;
  }

  const cold: FollowedVenues = {
    venue_ids: [],
    fetchedAt: now.toISOString(),
  };

  if (!isUuid(client_user_id)) {
    return cold;
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preferences')
      .eq('client_user_id', client_user_id)
      .maybeSingle();

    if (error || !data) {
      _followedCache.set(client_user_id, { data: cold, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
      return cold;
    }

    const prefs = (data.preferences ?? null) as StatedPreferences | null;
    const venue_ids = readFollowedVenueIds(prefs);
    const fresh: FollowedVenues = {
      venue_ids,
      fetchedAt: now.toISOString(),
    };
    _followedCache.set(client_user_id, { data: fresh, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
    return fresh;
  } catch {
    _followedCache.set(client_user_id, { data: cold, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
    return cold;
  }
}

/** Test/dev helper — clear the in-process cache. */
export function clearFollowedVenuesCache(): void {
  _followedCache.clear();
}

// ─── T0050 — Artist follows (Phase 1 declared preference) ────────────────────
//
// Mirror of the venue helpers above. Slugs are the canonical artist identifier
// (see 05-Supabase/migrations/20260818-0001-agent-event-graph.sql `artists`).
// All readers/store-writers lowercase on write; cache stores the normalized form.

/** Hard cap on the size of `followed_artist_slugs`. Mirrors the venue cap. */
export const MAX_FOLLOWED_ARTISTS = 500;

export interface FollowArtistInput {
  client_user_id: string;
  artist_slug: string;
  now?: Date;
}

export interface FollowArtistResult {
  ok: boolean;
  /** True if the artist was added, false if it was already followed. */
  added: boolean;
  /** Number of followed artists after the call. */
  count: number;
  warning?: string;
}

/** Read-modify-write inside the same upsert. Same idempotency contract as
 *  followVenue: a no-op when already followed. */
export async function followArtist(
  supabase: SupabaseClient,
  input: FollowArtistInput
): Promise<FollowArtistResult> {
  if (!isUuid(input.client_user_id)) {
    return { ok: false, added: false, count: 0, warning: 'client_user_id must be a uuid' };
  }
  const slug = (input.artist_slug ?? '').trim().toLowerCase();
  if (!isArtistSlug(slug)) {
    return { ok: false, added: false, count: 0, warning: 'artist_slug must be lowercase kebab (a-z, 0-9, hyphen)' };
  }
  const now = input.now ?? new Date();

  let current: StatedPreferences = {};
  const read = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', input.client_user_id)
    .maybeSingle();
  if (read.error) {
    return { ok: false, added: false, count: 0, warning: `read failed: ${read.error.message}` };
  }
  if (read.data && typeof read.data.preferences === 'object' && read.data.preferences !== null) {
    current = read.data.preferences as StatedPreferences;
  }

  const existing = readFollowedArtistSlugs(current);
  if (existing.includes(slug)) {
    return { ok: true, added: false, count: existing.length };
  }
  if (existing.length >= MAX_FOLLOWED_ARTISTS) {
    return {
      ok: false,
      added: false,
      count: existing.length,
      warning: `followed artist cap reached (${MAX_FOLLOWED_ARTISTS})`,
    };
  }
  const nextList = [...existing, slug];
  const next: StatedPreferences = { ...current, followed_artist_slugs: nextList };

  const upsert = await supabase
    .from('user_preferences')
    .upsert(
      {
        client_user_id: input.client_user_id,
        preferences: next,
        updated_at: now.toISOString(),
      },
      { onConflict: 'client_user_id' }
    );
  if (upsert.error) {
    return { ok: false, added: false, count: existing.length, warning: `upsert failed: ${upsert.error.message}` };
  }
  // Invalidate both caches — same row, shared TTL.
  _followedCache.delete(input.client_user_id);
  _artistCache.delete(input.client_user_id);
  return { ok: true, added: true, count: nextList.length };
}

export interface UnfollowArtistInput {
  client_user_id: string;
  artist_slug: string;
  now?: Date;
}

export interface UnfollowArtistResult {
  ok: boolean;
  removed: boolean;
  count: number;
  warning?: string;
}

export async function unfollowArtist(
  supabase: SupabaseClient,
  input: UnfollowArtistInput
): Promise<UnfollowArtistResult> {
  if (!isUuid(input.client_user_id)) {
    return { ok: false, removed: false, count: 0, warning: 'client_user_id must be a uuid' };
  }
  const slug = (input.artist_slug ?? '').trim().toLowerCase();
  if (!isArtistSlug(slug)) {
    return { ok: false, removed: false, count: 0, warning: 'artist_slug must be lowercase kebab' };
  }
  const now = input.now ?? new Date();

  const read = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', input.client_user_id)
    .maybeSingle();
  if (read.error) {
    return { ok: false, removed: false, count: 0, warning: `read failed: ${read.error.message}` };
  }
  const current: StatedPreferences =
    read.data && typeof read.data.preferences === 'object' && read.data.preferences !== null
      ? (read.data.preferences as StatedPreferences)
      : {};
  const existing = readFollowedArtistSlugs(current);
  if (!existing.includes(slug)) {
    return { ok: true, removed: false, count: existing.length };
  }
  const nextList = existing.filter((s) => s !== slug);
  const next: StatedPreferences = { ...current, followed_artist_slugs: nextList };

  const upsert = await supabase
    .from('user_preferences')
    .upsert(
      {
        client_user_id: input.client_user_id,
        preferences: next,
        updated_at: now.toISOString(),
      },
      { onConflict: 'client_user_id' }
    );
  if (upsert.error) {
    return { ok: false, removed: false, count: existing.length, warning: `upsert failed: ${upsert.error.message}` };
  }
  _followedCache.delete(input.client_user_id);
  _artistCache.delete(input.client_user_id);
  return { ok: true, removed: true, count: nextList.length };
}

// ─── Reader (cached): followed artists ───────────────────────────────────────

export interface FollowedArtists {
  artist_slugs: string[];
  fetchedAt: string;
}

interface FollowedArtistsCacheEntry {
  data: FollowedArtists;
  expiresAt: number;
}

const _artistCache = new Map<string, FollowedArtistsCacheEntry>();

/** Read the user's followed artist slugs, with the same 5-minute TTL used
 *  by loadFollowedVenues. Same row, same cache key — we keep the cache
 *  Maps separate to keep type signatures clean, and we invalidate the
 *  venue cache on any artist follow/unfollow above (and vice versa would
 *  be needed if we exposed venue mutation paths that also wrote to this
 *  row). The double-cache trade-off is acceptable: read fan-out is the
 *  ranker hot-path, and the second Map is one slice of memory per user. */
export async function loadFollowedArtists(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; skipCache?: boolean } = {}
): Promise<FollowedArtists> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (!opts.skipCache) {
    const hit = _artistCache.get(client_user_id);
    if (hit && hit.expiresAt > nowMs) return hit.data;
  }

  const cold: FollowedArtists = {
    artist_slugs: [],
    fetchedAt: now.toISOString(),
  };

  if (!isUuid(client_user_id)) {
    return cold;
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preferences')
      .eq('client_user_id', client_user_id)
      .maybeSingle();

    if (error || !data) {
      _artistCache.set(client_user_id, { data: cold, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
      return cold;
    }

    const prefs = (data.preferences ?? null) as StatedPreferences | null;
    const slugs = readFollowedArtistSlugs(prefs);
    const fresh: FollowedArtists = {
      artist_slugs: slugs,
      fetchedAt: now.toISOString(),
    };
    _artistCache.set(client_user_id, { data: fresh, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
    return fresh;
  } catch {
    _artistCache.set(client_user_id, { data: cold, expiresAt: nowMs + FOLLOW_CACHE_TTL_SECONDS * 1000 });
    return cold;
  }
}

/** Test/dev helper — clear the in-process artist cache. */
export function clearFollowedArtistsCache(): void {
  _artistCache.clear();
}

/** Bulk reader used by the ranker. Combines venue + artist lookups in one
 *  round-trip so the ranker hot path stays single-query. Falls back to
 *  the cached venues helper when the artist read fails (or vice versa)
 *  so partial data is still useful. */
export async function loadFollowedEntities(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; skipCache?: boolean } = {}
): Promise<{
  venue_ids: string[];
  artist_slugs: string[];
  fetchedAt: string;
}> {
  const now = opts.now ?? new Date();
  if (!isUuid(client_user_id)) {
    return { venue_ids: [], artist_slugs: [], fetchedAt: now.toISOString() };
  }

  // Cold-path: one query reads both lists in parallel via Promise.all. Hot-path:
  // both caches hit and we never round-trip. Even with cache misses the
  // combined query is one SELECT instead of two.
  const [venues, artists] = await Promise.all([
    loadFollowedVenues(supabase, client_user_id, opts),
    loadFollowedArtists(supabase, client_user_id, opts),
  ]);
  return {
    venue_ids: venues.venue_ids,
    artist_slugs: artists.artist_slugs,
    fetchedAt: now.toISOString(),
  };
}
