/**
 * diversify — Maximal Marginal Relevance (MMR) post-ranker.
 *
 * Research basis (2026-08-19):
 *  - Carbonell & Goldstein 1998 — "The Use of MMR, Diversity-Based
 *    Reranking for Reordering Documents and Producing Summaries"
 *    https://www.cs.cmu.edu/~jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf
 *    The original MMR formula. Recommended a two-phase strategy but found
 *    no statistically significant precision difference between λ=0.3 and
 *    λ=0.7 in document summarization.
 *  - Wilhelm et al. CIKM 2018 — YouTube DPP at scale. Strong precedent
 *    for treating diversity as a last-layer re-ranker over top-N from a
 *    primary ranker. https://jgillenw.com/cikm2018.pdf
 *  - Drosou & Pitoura 2017 — "DIVERSITY PLUS": sliding-budget diversity,
 *    better than plain MMR when the upstream ranker is already good.
 *  - DFGR (Liang 2023, https://doi.org/10.1007/s11063-023-11376-0) —
 *    weighted coverage on (time, venue, sponsor, content) similarity;
 *    monotonic improvement when more diversity dimensions are added.
 *
 * Design choices for EventPulse:
 *  - Algorithm: greedy MMR. DPP is overkill at K=5 from 25 candidates.
 *  - Default λ = 0.7 (relevance-heavy). Exposed as a tunable.
 *  - Similarity: Jaccard on (category, venue, daypart) + venue-binary.
 *    No embeddings — they add latency without value at K=25.
 *  - skipWhenDiverse: if the input top-K is already diverse (≥K distinct
 *    (category, venue) pairs), skip the re-rank. This is the
 *    "personalization already diversified" guardrail.
 *  - Architecture: called AFTER rank_events, BEFORE agent composition.
 *    Caller passes the topN it actually wants; we re-rank the full input
 *    then trim to topN.
 */

import type { RankedEvent } from '../types';

// ─── Tunable constants ──────────────────────────────────────────────────────

/** Relevance weight in MMR. Higher = more relevance, less diversity. */
export const DEFAULT_LAMBDA = 0.7;

/** Guardrail: if the top-K input has at least this many distinct
 *  (category, venue) pairs, skip the re-rank (already diverse). */
export const DEFAULT_SKIP_WHEN_DIVERSE_THRESHOLD = 4;

// ─── Similarity (Jaccard on a categorical feature set) ──────────────────────

/** Buckets an ISO instant to a daypart (morning/afternoon/evening/night).
 *  Pure function so tests are deterministic. */
export function daypartOf(iso: string): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date(iso).getUTCHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/** Price tier: 'free' | 'low' | 'medium' | 'high'. Coarse bucketing so two
 *  events at 150kr and 180kr don't look "different" for diversity. */
export function priceTier(isFree: boolean, minSek: number | null | undefined): 'free' | 'low' | 'medium' | 'high' {
  if (isFree) return 'free';
  const v = minSek ?? 0;
  if (v <= 150) return 'low';
  if (v <= 400) return 'medium';
  return 'high';
}

/** Similarity in [0, 1] between two ranked events. Pure categorical
 *  Jaccard + venue-binary match (DFGR: more dimensions = better diversity).
 *  Exported so the test suite can pin the contract. */
export function eventSimilarity(a: RankedEvent, b: RankedEvent): number {
  const aSet = new Set<string>([
    `cat:${a.card.category_slug}`,
    `ven:${a.card.venue_name}`,
    `day:${daypartOf(a.card.start_time)}`,
    `prc:${priceTier(a.card.is_free, a.card.price_min_sek)}`,
  ]);
  const bSet = new Set<string>([
    `cat:${b.card.category_slug}`,
    `ven:${b.card.venue_name}`,
    `day:${daypartOf(b.card.start_time)}`,
    `prc:${priceTier(b.card.is_free, b.card.price_min_sek)}`,
  ]);
  const aArr = [...aSet];
  const bArr = [...bSet];
  const inter = aArr.filter((x) => bSet.has(x)).length;
  const union = new Set([...aArr, ...bArr]).size;
  const jaccard = union > 0 ? inter / union : 0;
  const sameVenue = a.card.venue_name === b.card.venue_name ? 0.5 : 0;
  return Math.min(1, jaccard + sameVenue);
}

// ─── MMR core ───────────────────────────────────────────────────────────────

export interface MmrOptions {
  /** Relevance weight. 0 = pure diversity, 1 = pure relevance. Default 0.7. */
  lambda?: number;
  /** Final K to return. Default 5. */
  topN?: number;
  /** If true and the input's top-K (after slicing) has ≥ threshold distinct
   *  (category, venue) pairs, skip the re-rank. Default true. */
  skipWhenDiverse?: boolean;
  /** Threshold for skipWhenDiverse. Default 4. */
  skipWhenDiverseThreshold?: number;
}

/**
 * Greedy MMR re-ranking. Returns a new array of length ≤ topN.
 *
 * Algorithm (Carbonell & Goldstein 1998):
 *   S = ∅
 *   R = candidates (input order is the relevance ranking)
 *   while |S| < topN and R ≠ ∅:
 *     d* = argmax_{d ∈ R} [λ · norm(d) - (1-λ) · max_{d'∈S} sim(d, d')]
 *     S = S ∪ {d*}; R = R \ {d*}
 *
 * `norm(d)` is the ranker's score normalized into [0, 1] via min-max over
 * the input set, so that relevance and similarity live on the same scale.
 *
 * First item is always the highest-relevance one (Carbonell's "first
 * should be the best match" intent). Subsequent picks trade off.
 */
export function mmrRerank(ranked: RankedEvent[], opts: MmrOptions = {}): RankedEvent[] {
  if (ranked.length === 0) return [];
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const topN = opts.topN ?? 5;
  const skipDiv = opts.skipWhenDiverse ?? true;
  const skipThresh = opts.skipWhenDiverseThreshold ?? DEFAULT_SKIP_WHEN_DIVERSE_THRESHOLD;

  // Guardrail: if the top-K input is already diverse, do nothing.
  if (skipDiv) {
    const inputK = ranked.slice(0, topN);
    const distinct = new Set(inputK.map((r) => `${r.card.category_slug}|${r.card.venue_name}`)).size;
    if (distinct >= skipThresh) return inputK;
  }

  // Min-max normalize the score into [0, 1].
  let lo = Infinity, hi = -Infinity;
  for (const r of ranked) {
    if (r.score < lo) lo = r.score;
    if (r.score > hi) hi = r.score;
  }
  const range = hi - lo || 1;
  const norm = (r: RankedEvent) => (r.score - lo) / range;

  const selected: RankedEvent[] = [];
  const remaining = ranked.slice();

  while (selected.length < topN && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = remaining[i];
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => eventSimilarity(d, s)));
      const val = lambda * norm(d) - (1 - lambda) * maxSim;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
