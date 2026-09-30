/**
 * tagToCategory.ts — Map Last.fm community tags → canonical EventPulse music category.
 *
 * Why this exists
 * ---------------
 * MusicBrainz + Last.fm replaces LLM-interpretation for music events
 * (see docs/MB-LASTFM-PLAN.md). MusicBrainz resolves artist identity
 * (MBID); Last.fm provides crowdsourced genre tags. We need a deterministic,
 * auditable mapping from free-text tags to our 8 canonical music categories.
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
 * If zero categories match → null (genuinely unknown — let LLM decide).
 *
 * v2 (2026-09-30): 5 nya sub-genre-buckets tillagda (rock/pop/jazz/electronic/hip-hop),
 * slug `musical` döptes om till `musical-theatre` (var tidigare både musikal-slangen
 * OCH catch-all för all musik). Ingen generell catch-all längre — specifika buckets
 * täcker de vanligaste Last.fm-taggarna, okänt → LLM.
 *
 * Why this design
 * ---------------
 * - 8 buckets täcker de genrer som faktiskt syns i Stockholm-eventdata
 *   (Rodrigo y Gabriela = rock, Anna Netrebko = opera, Berliner Philharmoniker
 *   = classical, etc.).
 * - Confidence 0.95 på tydlig multi-tag match — MB+Last.fm är starkare signal
 *   än LLM och förtjänar högre confidence.
 * - Ingen catch-all → hellre LLM-fallback än felaktig "musical"-klassificering.
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

/** Alla kanonska musikkategorier vi mappar till. */
export type MusicCategorySlug =
  | 'classical'
  | 'opera'
  | 'musical-theatre'
  | 'rock'
  | 'pop'
  | 'jazz'
  | 'electronic'
  | 'hip-hop';

/** Single match between a tag and a category bucket. Internal type. */
interface CategoryHits {
  category: MusicCategorySlug;
  matched: string[];
  maxCount: number;
}

/** Minimum Last.fm count for a single-tag match to count as authoritative. */
const STRONG_SINGLE_TAG_COUNT = 100;

/** Minimum count of distinct tags from one bucket for an authoritative match. */
const MULTI_TAG_THRESHOLD = 2;

/**
 * Tag → canonical music category mapping.
 *
 * Tags are normalized (lowercase, trimmed) before lookup, so casing in
 * Last.fm's response doesn't matter.
 *
 * Adding new tags here is safe — they're additive. Removing tags is risky
 * (could re-classify existing artists) and should follow the Generalization
 * Protection Rule: only remove if multiple unrelated sites prove the tag
 * doesn't belong.
 */
export const TAG_TO_CATEGORY: Readonly<Record<MusicCategorySlug, readonly string[]>> = Object.freeze({
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
  // V2 rename: 'musical' → 'musical-theatre' för att ta bort semantik-kollisionen
  // med musik som generell kategori. Bucket innehåller genuin musikal/operett.
  'musical-theatre': Object.freeze([
    'musical theatre',
    'broadway',
    'musical',
    'musicals',
    'operetta',
  ]),
  // V2 nya sub-genre-buckets. Täcker de vanligaste Last.fm-taggarna för
  // Stockholm-stockholm-eventdata. Nischade taggar (shoegaze, krautrock etc.)
  // mappas INTE — de faller till LLM.
  rock: Object.freeze([
    'rock',
    'indie',
    'indie rock',
    'alternative',
    'alternative rock',
    'punk',
    'punk rock',
    'metal',
    'heavy metal',
    'hard rock',
    'classic rock',
    'progressive rock',
    'post-punk',
    'grunge',
    'stoner rock',
    'shoegaze',          // inkluderad — vanlig i svensk indie-data
  ]),
  pop: Object.freeze([
    'pop',
    'indie pop',
    'synth-pop',
    'dance pop',
    'k-pop',
    'j-pop',
    'schlager',
    'dansband',
    'europop',
    'swedish pop',
    'singer-songwriter',
    'vocal',
  ]),
  jazz: Object.freeze([
    'jazz',
    'bebop',
    'swing',
    'fusion',
    'jazz fusion',
    'smooth jazz',
    'free jazz',
    'contemporary jazz',
    'blues',
    'soul',
    'funk',
    'neo-soul',
    'rnb',
    'r&b',
  ]),
  electronic: Object.freeze([
    'electronic',
    'house',
    'deep house',
    'techno',
    'minimal techno',
    'ambient',
    'edm',
    'drum and bass',
    'dnb',
    'trance',
    'industrial',
    'idm',
    'new wave',
    'synth',
    'electronica',
    'experimental',
  ]),
  'hip-hop': Object.freeze([
    'hip-hop',
    'hip hop',
    'rap',
    'gangster rap',
    'trap',
    'southern hip hop',
    'east coast hip hop',
    'underground hip hop',
    'swedish hip hop',
  ]),
});

/** Normalize a tag for lookup. */
function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

/** Find category hits for a list of tags. Internal helper. */
function bucketTagHits(tags: LastFmTag[]): Map<MusicCategorySlug, CategoryHits> {
  const hits = new Map<MusicCategorySlug, CategoryHits>();

  for (const tag of tags) {
    const norm = normalizeTag(tag.name);
    for (const [category, allowedTags] of Object.entries(TAG_TO_CATEGORY) as Array<[MusicCategorySlug, readonly string[]]>) {
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

/**
 * Result of mapping Last.fm tags to a canonical category.
 * `null` means "ambiguous or no signal" — caller should fall back to LLM.
 */
export interface TagMatchResult {
  /** Canonical category slug from `categoryDefinitions.ts`. */
  category_slug: MusicCategorySlug;
  /** Confidence 0.0–1.0. ≥ 0.80 typically passes auto-write gate. */
  confidence: number;
  /** Which Last.fm tags triggered the match (for audit/JSONL). */
  matched_tags: string[];
  /** Short human-readable reasoning. */
  reasoning: string;
}

/**
 * Map Last.fm tags to a canonical music category.
 *
 * @param tags  Top-N tags from Last.fm, sorted by count descending preferred.
 * @returns     TagMatchResult on confident match; null on ambiguous/missing.
 */
export function mapLastFmTagsToCategory(tags: readonly LastFmTag[]): TagMatchResult | null {
  if (!tags || tags.length === 0) return null;

  const hits = bucketTagHits([...tags]);
  const bucketCount = hits.size;

  // Zero buckets hit → no signal — fall back to LLM
  if (bucketCount === 0) {
    return null;
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
