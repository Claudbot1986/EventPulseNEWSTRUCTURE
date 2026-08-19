/**
 * personalize — count-based priors from implicit user feedback.
 *
 * Research basis (2026-08-19):
 *  - Breese, Heckerman, Kadie (1998) — "Empirical Analysis of Predictive
 *    Algorithms for Collaborative Filtering" — Bayesian prior smoothing
 *    over implicit observation counts. http://heckerman.com/david/bhk98uai.pdf
 *  - Hu, Koren, Volinsky (2008) — "Collaborative Filtering for Implicit
 *    Feedback Datasets" — confidence-weighted implicit feedback with a
 *    floor below which signal-to-noise is worse than no signal.
 *    https://www.researchgate.net/publication/220765111
 *  - Wilson (1927) — "Probable Inference, the Law of Succession, and
 *    Statistical Inference" — lower-bound score formula. Used by Reddit's
 *    "best" comment sort for small samples.
 *  - Seppänen et al. (2016) — "Investigating the Filter Bubble Effect"
 *    arXiv:1601.07778 — magnitude caps to prevent over-specialization.
 *  - Campos et al. (2014) — "Time-aware Recommender Systems: A
 *    Comprehensive Survey" — recency decay on both positive and negative
 *    signals to avoid the "ancient save haunts you forever" failure.
 *
 * Math (implemented below):
 *  - categoryPrior(c) = (saves_c + α) / (totalSaves + α·|C|)  — Laplace smoothed
 *  - boost(e)        = β · log(1 + totalSaves · categoryPrior(category(e)))
 *  - venueBadness(v) = WilsonLower(pos=0, n=Σ_recent_rejects, z=1.96)
 *  - penalty(e)      = -γ · venueBadness(venue(e))
 *  - recent_reject_t = exp(-λ·(now − t) / half_life)  — 30-day half-life
 *
 * Gotchas baked in (see RankOptions in rank_events.ts):
 *  1. Min-N gate: boost only if totalSaves ≥ MIN_SAVES, penalty only if
 *     weightedRejects ≥ MIN_WEIGHTED_REJECTS. Below this, Wilson CI is too
 *     wide to be useful.
 *  2. Magnitude caps: boost ∈ [0, β·log(1+0.2·totalSaves)], penalty ∈ [-0.15, 0].
 *  3. Recency decay on BOTH saves and rejects — symmetric.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Tunable constants (research-backed defaults) ────────────────────────────

/** Laplace smoothing strength. α=1 is the textbook "add-one" prior. */
export const LAPLACE_ALPHA = 1;

/**
 * Boost weight for category prior. Small enough to never override
 * time_fit (25) or category_match (30) — personalization is a nudge,
 * not a primary feature.
 */
export const CATEGORY_BOOST_BETA = 8;

/** Penalty weight for venue badness prior. Smaller than boost: a miss
 *  is cheaper than a wrong recommendation. */
export const VENUE_PENALTY_GAMMA = 0.05;

/** 30-day half-life for recency decay on implicit signals. */
export const SIGNAL_HALF_LIFE_DAYS = 30;

/** Below this, the prior is too noisy to be worth applying (Hu/Koren
 *  floor for confidence-weighted implicit feedback). */
export const MIN_SAVES = 5;

/** Below this, venue badness is too noisy (Wilson CI too wide). */
export const MIN_WEIGHTED_REJECTS = 3;

/** Hard cap on |boost| as a fraction of a single feature's weight.
 *  Prevents the "user who saved 50 jazz events" filter-bubble pathology. */
export const BOOST_CAP_FRACTION = 0.2;

/** Hard cap on |penalty| — keeps venue demotion bounded. */
export const PENALTY_CAP_ABS = 0.15;

/** Cache TTL in seconds — small enough to reflect fresh signals,
 *  large enough to avoid hammering the DB on every chat turn. */
export const CACHE_TTL_SECONDS = 300;

// ─── Types ──────────────────────────────────────────────────────────────────

/** The user signal bundle consumed by rank_events. */
export interface UserSignal {
  client_user_id: string;
  /** Bayesian-smoothed posterior of "liked" per category, in [0, 1]. */
  categoryPosterior: Record<string, number>;
  /** Wilson lower bound of "badness" per venue, in [0, 1]. */
  venueBadness: Record<string, number>;
  /** Total raw save count (decay-weighted for symmetry, raw for gate). */
  totalSaves: number;
  /** Total reject count, time-decayed (used for the penalty gate). */
  weightedRejects: number;
  /** ISO timestamp the signal was computed at. */
  fetchedAt: string;
}

// ─── Math primitives (pure, exported for tests) ──────────────────────────────

/** Laplace-smoothed posterior: (count + α) / (total + α·|categories|). */
export function laplacePosterior(
  countInCategory: number,
  totalSaves: number,
  numCategories: number,
  alpha: number = LAPLACE_ALPHA
): number {
  return (countInCategory + alpha) / (totalSaves + alpha * numCategories);
}

/** Exponential decay weight in [0, 1] given age in days and half-life. */
export function recencyDecay(ageDays: number, halfLifeDays: number = SIGNAL_HALF_LIFE_DAYS): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Wilson score lower bound — "what's the lowest plausible true rate of
 * bad outcomes, given we observed n trials?" Used because for small n,
 * the raw rate is wildly overconfident.
 */
export function wilsonLowerBound(
  successes: number,
  total: number,
  z: number = 1.96
): number {
  if (total <= 0) return 0;
  const phat = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

// ─── Supabase query + cache ─────────────────────────────────────────────────

interface RawInteractionRow {
  interaction: 'impression' | 'click' | 'save' | 'dismiss' | 'feedback_positive' | 'feedback_negative' | 'outbound';
  created_at: string;
  events: { category_slug: string | null; venue_name: string | null } | null;
}

interface CacheEntry {
  data: UserSignal;
  expiresAt: number;
}

/** In-process cache keyed by client_user_id. Per-process; Supabase is
 *  already the source of truth and a 5-min TTL is fine. */
const _cache = new Map<string, CacheEntry>();

/**
 * Build a UserSignal for one user by reading their implicit feedback
 * history. Returns a "cold" signal (empty maps, totalSaves=0) on DB
 * failure or for users with no history — never throws into the chat path.
 */
export async function buildUserSignal(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; skipCache?: boolean } = {}
): Promise<UserSignal> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (!opts.skipCache) {
    const hit = _cache.get(client_user_id);
    if (hit && hit.expiresAt > nowMs) return hit.data;
  }

  const cold: UserSignal = {
    client_user_id,
    categoryPosterior: {},
    venueBadness: {},
    totalSaves: 0,
    weightedRejects: 0,
    fetchedAt: now.toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('user_interactions')
      .select('interaction, created_at, events:event_id(category_slug, venue_name)')
      .eq('client_user_id', client_user_id)
      .in('interaction', ['save', 'dismiss', 'feedback_positive', 'feedback_negative'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (error || !data) {
      _cache.set(client_user_id, { data: cold, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
      return cold;
    }

    const rows = data as unknown as RawInteractionRow[];
    const savesPerCategory: Record<string, number> = {};
    let totalSaves = 0;
    const weightedRejectsPerVenue: Record<string, number> = {};
    let weightedRejects = 0;
    const categories = new Set<string>();
    const venues = new Set<string>();

    for (const r of rows) {
      const ageDays = (nowMs - new Date(r.created_at).getTime()) / 86_400_000;
      const decay = recencyDecay(ageDays);
      const cat = r.events?.category_slug ?? null;
      const venue = r.events?.venue_name ?? null;
      if (cat) categories.add(cat);
      if (venue) venues.add(venue);

      if (r.interaction === 'save' || r.interaction === 'feedback_positive') {
        const w = decay;
        if (cat) savesPerCategory[cat] = (savesPerCategory[cat] ?? 0) + w;
        totalSaves += w;
      } else if (r.interaction === 'dismiss' || r.interaction === 'feedback_negative') {
        if (venue) {
          weightedRejectsPerVenue[venue] = (weightedRejectsPerVenue[venue] ?? 0) + decay;
          weightedRejects += decay;
        }
      }
    }

    const numCats = Math.max(1, categories.size);
    const categoryPosterior: Record<string, number> = {};
    for (const c of categories) {
      categoryPosterior[c] = laplacePosterior(savesPerCategory[c] ?? 0, totalSaves, numCats);
    }

    const venueBadness: Record<string, number> = {};
    for (const v of venues) {
      const w = weightedRejectsPerVenue[v] ?? 0;
      venueBadness[v] = wilsonLowerBound(w, w);
    }

    const signal: UserSignal = {
      client_user_id,
      categoryPosterior,
      venueBadness,
      totalSaves,
      weightedRejects,
      fetchedAt: now.toISOString(),
    };

    _cache.set(client_user_id, { data: signal, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
    return signal;
  } catch {
    _cache.set(client_user_id, { data: cold, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
    return cold;
  }
}

/** Test/dev helper — clear the in-process cache. */
export function clearPersonalizationCache(): void {
  _cache.clear();
}
