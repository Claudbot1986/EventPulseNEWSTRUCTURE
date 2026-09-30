/**
 * artistResolver.ts — MusicBrainz + Last.fm → canonical artist + category.
 *
 * Bridges three layers:
 *
 *   event.title ─► extractHeadliner() ─► musicBrainzLookup()
 *                                              │
 *                                              ▼
 *                                         MusicBrainzArtist (MBID)
 *                                              │
 *                                              ▼
 *                                       lastFmGetTopTags(MBID)
 *                                              │
 *                                              ▼
 *                                       Last.fm tags
 *                                              │
 *                                              ▼
 *                                  mapLastFmTagsToCategory()
 *                                              │
 *                                              ▼
 *                                       canonical slug
 *
 * Also upserts the artist row in the `artists` table so future events
 * with the same headliner benefit from cached metadata.
 *
 * Why this layer exists
 * ---------------------
 * `musicLookup.ts` knows how to talk to MusicBrainz and Last.fm. This
 * module knows what to DO with the responses in EventPulse context —
 * upsert canonical artist rows, populate `metadata.mbid`, derive a
 * category from tags. It mirrors the `resolveVenue` pattern in
 * `normalizer.ts:218` (find-or-create) but for artists.
 *
 * Graceful behavior
 * -----------------
 * `resolveArtist` returns `null` whenever any step fails or yields no
 * usable signal. The caller (normalizer / retag) treats `null` as "no
 * authoritative signal — fall back to LLM". Never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { musicBrainzLookup, lastFmGetTopTags, type MusicBrainzArtist, type LastFmTag } from './musicLookup.js';
import { mapLastFmTagsToCategory } from './tagToCategory.js';

/** Auto-write threshold — same constant as apply-retag-v3 uses. */
export const AUTO_WRITE_THRESHOLD = 0.80;

/** Split characters used by extractHeadliner. */
const HEADLINER_SEPARATORS = [' - ', ' – ', ' / ', ' | ', ', ', ' · '];

/**
 * Extract the headliner (primary act) from an event title.
 *
 * Heuristics (in order):
 *   1. If title contains a separator, take the first segment (trimmed).
 *   2. Otherwise, return the full title.
 *
 * Returns `{headliner, extraction_hint}` where `extraction_hint=true` means
 * "this might not be a real headliner — no separator found" (e.g. event is
 * titled "Piano Recital" or "Indie Night"). Callers can use the hint to
 * decide whether to attempt MB lookup at all.
 *
 * Examples:
 *   "Rodrigo y Gabriela - Stockholm" → "Rodrigo y Gabriela", hint=false
 *   "Berlin Philharmonics / Brahms Night" → "Berlin Philharmonics", hint=false
 *   "Piano Recital" → "Piano Recital", hint=true (no separator)
 *   "" → "", hint=true
 */
export function extractHeadliner(title: string): { headliner: string; extraction_hint: boolean } {
  if (!title || !title.trim()) return { headliner: '', extraction_hint: true };

  for (const sep of HEADLINER_SEPARATORS) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const headliner = title.slice(0, idx).trim();
      if (headliner.length > 0) {
        return { headliner, extraction_hint: false };
      }
    }
  }

  return { headliner: title.trim(), extraction_hint: true };
}

/** Result of resolving an artist through MusicBrainz + Last.fm. */
export interface ResolvedArtist {
  /** UUID of the artist row in the `artists` table. */
  artist_id: string;
  /** Display name as listed in MusicBrainz (canonical). */
  display_name: string;
  /** Slug used in the `artists` table (URL-safe). */
  slug: string;
  /** MBID, or null if no MB match. */
  mbid: string | null;
  /** Canonical category derived from Last.fm tags, or null if ambiguous. */
  category_slug: 'classical' | 'opera' | 'musical' | null;
  /** Confidence 0.0–1.0 for the category guess. */
  confidence: number;
  /** True if confidence ≥ AUTO_WRITE_THRESHOLD — caller can persist. */
  high_confidence_category: boolean;
  /** Which Last.fm tags triggered the match (for audit). */
  matched_tags: string[];
  /** Short human-readable reasoning. */
  reasoning: string;
}

/** Generate a URL-safe slug from an artist name. */
function slugifyArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD') // strip diacritics
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Find existing artist row by slug (case-insensitive). */
async function findArtistBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<{ id: string; display_name: string; slug: string; metadata: Record<string, unknown> } | null> {
  const { data } = await supabase
    .from('artists')
    .select('id, display_name, slug, metadata')
    .ilike('slug', slug)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Create new artist row, return id+slug+metadata. */
async function createArtist(
  supabase: SupabaseClient,
  args: { display_name: string; slug: string; mbid: string | null; lastfm_tags: LastFmTag[] | null },
): Promise<{ id: string; display_name: string; slug: string; metadata: Record<string, unknown> } | null> {
  const metadata: Record<string, unknown> = {
    ...(args.mbid ? { mbid: args.mbid, mb_last_lookup: new Date().toISOString() } : {}),
    ...(args.lastfm_tags ? { lastfm_tags: args.lastfm_tags.slice(0, 10) } : {}),
  };
  const { data, error } = await supabase
    .from('artists')
    .insert({
      display_name: args.display_name,
      slug: args.slug,
      metadata,
    })
    .select('id, display_name, slug, metadata')
    .single();
  if (error) {
    // Race condition: another worker may have created the same artist.
    // Re-fetch by slug and use that.
    if (error.code === '23505') {
      const existing = await findArtistBySlug(supabase, args.slug);
      return existing;
    }
    return null;
  }
  return data ?? null;
}

/** Update existing artist row with new MBID/tags. */
async function updateArtistMetadata(
  supabase: SupabaseClient,
  args: { id: string; mbid: string | null; lastfm_tags: LastFmTag[] | null; existing: Record<string, unknown> },
): Promise<Record<string, unknown> | null> {
  const merged: Record<string, unknown> = {
    ...args.existing,
    ...(args.mbid && !args.existing.mbid ? { mbid: args.mbid } : {}),
    mb_last_lookup: new Date().toISOString(),
    ...(args.lastfm_tags ? { lastfm_tags: args.lastfm_tags.slice(0, 10) } : {}),
  };
  const { error } = await supabase
    .from('artists')
    .update({ metadata: merged })
    .eq('id', args.id);
  if (error) return null;
  return merged;
}

/**
 * Main entry point: extract headliner from title, look up in MusicBrainz,
 * get tags from Last.fm, derive a canonical category, upsert the artist row.
 *
 * Returns `null` if MusicBrainz returns no usable match, Last.fm has no
 * relevant tags, or the upsert fails. The caller should treat `null` as
 * "no authoritative signal — fall back to MiniMax-M2.7".
 *
 * The function is intentionally tolerant: every step returns null on
 * failure rather than throwing. This matches the `exaLookup.ts` pattern
 * (graceful degradation over correct failure).
 */
export async function resolveArtist(
  headliner: string,
  supabase: SupabaseClient,
): Promise<ResolvedArtist | null> {
  if (!headliner.trim()) return null;

  // Step 1: MusicBrainz lookup
  const mbArtist = await musicBrainzLookup(headliner);
  if (!mbArtist) return null;

  // Step 2: Last.fm tags
  const lfResult = await lastFmGetTopTags(mbArtist.mbid);
  const tags = lfResult?.tags ?? null;

  // Step 3: Map tags to category (may return null for ambiguous)
  const match = tags ? mapLastFmTagsToCategory(tags) : null;

  // Step 4: Upsert artist row
  const slug = slugifyArtistName(mbArtist.name);
  const existing = await findArtistBySlug(supabase, slug);
  let artistRow: { id: string; display_name: string; slug: string; metadata: Record<string, unknown> } | null;
  if (existing) {
    const updated = await updateArtistMetadata(supabase, {
      id: existing.id,
      mbid: mbArtist.mbid,
      lastfm_tags: tags,
      existing: existing.metadata ?? {},
    });
    artistRow = updated ? { ...existing, metadata: updated } : existing;
  } else {
    artistRow = await createArtist(supabase, {
      display_name: mbArtist.name,
      slug,
      mbid: mbArtist.mbid,
      lastfm_tags: tags,
    });
  }

  if (!artistRow) return null;

  // Step 5: Build result
  const confidence = match?.confidence ?? 0;
  return {
    artist_id: artistRow.id,
    display_name: artistRow.display_name,
    slug: artistRow.slug,
    mbid: mbArtist.mbid,
    category_slug: match?.category_slug ?? null,
    confidence,
    high_confidence_category: confidence >= AUTO_WRITE_THRESHOLD,
    matched_tags: match?.matched_tags ?? [],
    reasoning: buildReasoning(mbArtist, tags, match),
  };
}

function buildReasoning(
  mbArtist: MusicBrainzArtist,
  tags: LastFmTag[] | null,
  match: ReturnType<typeof mapLastFmTagsToCategory>,
): string {
  if (match) {
    return `MusicBrainz=${mbArtist.name} (score=${mbArtist.score}), Last.fm=${tags?.length ?? 0} taggar → '${match.category_slug}' (conf=${match.confidence}).`;
  }
  if (tags && tags.length > 0) {
    return `MusicBrainz=${mbArtist.name} (score=${mbArtist.score}), Last.fm=${tags.length} taggar men tvetydigt — LLM-fallback.`;
  }
  return `MusicBrainz=${mbArtist.name} (score=${mbArtist.score}), Last.fm saknar taggar — LLM-fallback.`;
}
