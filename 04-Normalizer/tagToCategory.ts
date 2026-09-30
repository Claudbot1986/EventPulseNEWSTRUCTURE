/**
 * tagToCategory.ts — Map Last.fm community tags → canonical EventPulse category.
 *
 * Why this exists
 * ---------------
 * MusicBrainz + Last.fm replaces LLM-interpretation for music events
 * (see docs/MB-LASTFM-PLAN.md). MusicBrainz resolves artist identity
 * (MBID); Last.fm provides crowdsourced genre tags. We need a deterministic,
 * auditable mapping from free-text tags to our 3 canonical music categories
 * (`classical`, `opera`, `musical`) plus the catch-all `community` fallback.
 *
 * Mapping strategy
 * ----------------
 * Conservative. We accept a tag→category match only when:
 *   1. The tag is in our explicit allow-list (TAG_TO_CATEGORY), AND
 *   2. Either:
 *      a) ≥ 2 tags from the same category bucket match, OR
 *      b) Exactly 1 tag matches but its Last.fm count ≥ 100 (strong signal)
 *
 * If multiple categories each have matches → AMBIGUOUS, return null
 *   (caller falls back to LLM).
 * If zero categories match but the artist looks musical (catch-all tags like
 * "rock", "pop", "jazz") → return `{category_slug: 'musical', confidence: 0.70}`
 *   with `reasoning` explaining "uncategorized music, default to musical".
 * If zero matches and no musical catch-all → null.
 *
 * Why this design
 * ---------------
 * - We have only 3 music categories today. Without sub-genre slugs
 *   (rock/jazz/electronic/etc.), anything that's "music but not classical/opera"
 *   collapses into `musical`. The plan defers sub-genres to a later phase.
 * - Confidence 0.95 on a clear multi-tag match — MB+Last.fm is a stronger
 *   signal than LLM and deserves higher confidence.
 * - Confidence 0.70 on the catch-all — "this is music, but I can't say what
 *   kind" is honest. The 0.80 auto-write gate in apply-retag-v3 will defer
 *   these to human review.
 *
 * Usage
 * -----
 *   const match = mapLastFmTagsToCategory([
 *     { name: 'classical', count: 142 },
 *     { name: 'symphony', count: 89 },
 *     { name: 'orchestra', count: 51 },
 *   ]);
 *   if (match?.category_slug === 'classical') { ... }
 */

import type { LastFmTag } from './musicLookup.js';

/** Single match between a tag and a category bucket. Internal type. */
interface CategoryHits {
  category: 'classical' | 'opera' | 'musical';
  matched: string[];
  maxCount: number;
}

/** Minimum Last.fm count for a single-tag match to count as authoritative. */
const STRONG_SINGLE_TAG_COUNT = 100;

/** Minimum count of distinct tags from one bucket for an authoritative match. */
const MULTI_TAG_THRESHOLD = 2;

/**
 * Tag → canonical category mapping.
 *
 * Tags are normalized (lowercase, trimmed) before lookup, so casing in
 * `Last.fm`'s response doesn't matter.
 *
 * Adding new tags here is safe — they're additive. Removing tags is risky
 * (could re-classify existing artists) and should follow the Generalization
 * Protection Rule: only remove if multiple unrelated sites prove the tag
 * doesn't belong.
 */
export const TAG_TO_CATEGORY: Readonly<Record<'classical' | 'opera' | 'musical', readonly string[]>> = Object.freeze({
  classical: Object.freeze([
    'classical',
    'symphony',
    'orchestra',
    'baroque',
    'chamber music',
    'requiem',
    'concerto',
    'sonata',
    'sonic art',
    'minimalism',
    '20th century classical',
    'contemporary classical',
    'choral',
    'classical music',
    'quartet',
    'string quartet',
    'early music',
    'romantic',
    'impressionist',
    'piano',
    'violin',
  ]),
  opera: Object.freeze([
    'opera',
    'operatic',
    'vocal classical',
  ]),
  musical: Object.freeze([
    'musical theatre',
    'broadway',
    'musical',
    'musicals',
    'operetta',
  ]),
});

/**
 * Last.fm tags that signal "this is music" but don't disambiguate between
 * our 3 categories. Used for the catch-all fallback to `musical`.
 *
 * Conservative — only well-known genre roots. Niche tags like 'shoegaze' or
 * 'dnb' intentionally NOT included; we'd rather return null and let LLM
 * handle those.
 */
const MUSIC_CATCH_ALL_TAGS: ReadonlySet<string> = new Set([
  'rock', 'pop', 'indie', 'alternative', 'jazz', 'electronic', 'house',
  'techno', 'hip-hop', 'rap', 'folk', 'country', 'blues', 'reggae',
  'world', 'metal', 'punk', 'ambient', 'experimental', 'soul', 'funk',
  'rnb', 'r&b', 'dance', 'edm', 'hard rock', 'heavy metal', 'classic rock',
  'singer-songwriter', 'acoustic', 'bluegrass', 'latin', 'reggaeton',
  'trap', 'k-pop', 'j-pop', 'soundtrack', 'new wave', 'industrial',
]);

/** Normalize a tag for lookup. */
function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

/** Find category hits for a list of tags. Internal helper. */
function bucketTagHits(tags: LastFmTag[]): Map<'classical' | 'opera' | 'musical', CategoryHits> {
  const hits = new Map<'classical' | 'opera' | 'musical', CategoryHits>();

  for (const tag of tags) {
    const norm = normalizeTag(tag.name);
    for (const [category, allowedTags] of Object.entries(TAG_TO_CATEGORY) as Array<['classical' | 'opera' | 'musical', readonly string[]]>) {
      if (allowedTags.includes(norm)) {
        const existing = hits.get(category);
        if (existing) {
          existing.matched.push(norm);
          existing.maxCount = Math.max(existing.maxCount, tag.count);
        } else {
          hits.set(category, { category, matched: [norm], maxCount: tag.count });
        }
        break; // tag can only match one category
      }
    }
  }

  return hits;
}

/** True if any tag is in the music catch-all set. */
function hasMusicCatchAll(tags: readonly LastFmTag[]): boolean {
  for (const t of tags) {
    if (MUSIC_CATCH_ALL_TAGS.has(normalizeTag(t.name))) return true;
  }
  return false;
}

/**
 * Result of mapping Last.fm tags to a canonical category.
 * `null` means "ambiguous or no signal" — caller should fall back to LLM.
 */
export interface TagMatchResult {
  /** Canonical category slug from `categoryDefinitions.ts`. */
  category_slug: 'classical' | 'opera' | 'musical';
  /** Confidence 0.0–1.0. ≥ 0.80 typically passes auto-write gate. */
  confidence: number;
  /** Which Last.fm tags triggered the match (for audit/JSONL). */
  matched_tags: string[];
  /** Short human-readable reasoning. */
  reasoning: string;
}

/**
 * Map Last.fm tags to a canonical category.
 *
 * @param tags  Top-N tags from Last.fm, sorted by count descending preferred.
 * @returns     TagMatchResult on confident match; null on ambiguous/missing.
 */
export function mapLastFmTagsToCategory(tags: readonly LastFmTag[]): TagMatchResult | null {
  if (!tags || tags.length === 0) return null;

  const hits = bucketTagHits([...tags]);
  const bucketCount = hits.size;

  // Zero buckets hit → either catch-all music or no signal
  if (bucketCount === 0) {
    if (hasMusicCatchAll(tags)) {
      return {
        category_slug: 'musical',
        confidence: 0.70,
        matched_tags: tags.filter((t) => MUSIC_CATCH_ALL_TAGS.has(normalizeTag(t.name)))
                          .map((t) => normalizeTag(t.name)),
        reasoning: 'Last.fm-taggar matchar musik-catch-all (ingen specifik sub-kategori).',
      };
    }
    return null; // no signal — fall back to LLM
  }

  // Single bucket hit — decide if it's authoritative
  if (bucketCount === 1) {
    const hit = hits.values().next().value as CategoryHits;
    const isMultiTag = hit.matched.length >= MULTI_TAG_THRESHOLD;
    const isStrongSingle = hit.matched.length === 1 && hit.maxCount >= STRONG_SINGLE_TAG_COUNT;

    if (isMultiTag || isStrongSingle) {
      return {
        category_slug: hit.category,
        confidence: 0.95,
        matched_tags: hit.matched,
        reasoning: buildReasoning(hit, isMultiTag, isStrongSingle),
      };
    }

    // Weak single-tag hit — let LLM decide
    return null;
  }

  // Multiple bucket hits → ambiguous, never auto-classify
  return null;
}

/** Build the reasoning string for a confident match. */
function buildReasoning(hit: CategoryHits, isMulti: boolean, isStrongSingle: boolean): string {
  const tagList = hit.matched.join(', ');
  if (isMulti) {
    return `Last.fm-taggar [${tagList}] matchar entydigt mot '${hit.category}' (${hit.matched.length} träffar).`;
  }
  if (isStrongSingle) {
    return `Last.fm-tag '${tagList}' har count=${hit.maxCount} (stark signal) → '${hit.category}'.`;
  }
  return `Last.fm-tag [${tagList}] matchar '${hit.category}'.`;
}
