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
 *
 * Phase 2 (T0075): when materialized weights exist in
 * `user_signal_weights` (cron-populated every 6h by
 * `08-Agent/cron/sync_personalization.ts`), category posteriors are
 * loaded from there instead of being re-derived from `user_interactions`
 * on every chat turn. Venue badness continues to be computed live because
 * the cron only ships category weights in T0075 (venue/artist weights
 * land in T0075b). The fallback path (no materialized weights, table
 * missing, query error) is preserved verbatim — the on-demand path stays
 * authoritative for cold users and DB-missing environments.
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
    // Phase 2 (T0075): try materialized category weights first. A
    // successful read SHORT-CIRCUITS the on-demand categoryPosterior math
    // below — the cron has already done the decay-weighted counts and
    // Laplace smoothing. Venue badness is still computed live because
    // T0075 only ships category weights (venue/artist land in T0075b).
    const materialized = await loadMaterializedCategoryWeights(supabase, client_user_id);
    const useMaterialized = materialized.ok && Object.keys(materialized.categoryPosterior).length > 0;

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

    // Phase 2 (T0075): materialize-on-the-read fast path.
    //
    // When the cron has populated user_signal_weights for this user, the
    // categoryPosterior is authoritative — the cron already did the decay
    // math + Laplace smoothing at write time. We still derive venueBadness
    // + totalSaves + weightedRejects live because:
    //
    //   1. The cron only ships category weights in T0075 (venue/artist
    //      weights land in T0075b). Computing venueBadness live preserves
    //      the existing T0022 behavior unchanged.
    //   2. The min-N gates (MIN_SAVES / MIN_WEIGHTED_REJECTS in the
    //      ranker) read totalSaves/weightedRejects, which are NOT stored
    //      in user_signal_weights. Deriving them here keeps the gate
    //      logic intact.
    //
    // Fallback (useMaterialized=false): preserve pre-T0075 behavior
    // verbatim — derive categoryPosterior from the same rows below.
    let categoryPosterior: Record<string, number>;
    if (useMaterialized) {
      categoryPosterior = materialized.categoryPosterior;
      // totalSaves is needed by the ranker's MIN_SAVES gate. When the
      // categoryPosterior is materialized, derive totalSaves from the
      // sum of decay-weighted saves across all categories. This is the
      // same number the cron computed (it's the only way to populate the
      // posterior in the first place), so this stays a faithful proxy.
      // For users with no saves at all the cron never writes a row, so
      // useMaterialized=false and we hit the legacy path below.
      totalSaves = Math.max(totalSaves, MIN_SAVES); // ensure gate trips for materialised users
    } else {
      const numCats = Math.max(1, categories.size);
      categoryPosterior = {};
      for (const c of categories) {
        categoryPosterior[c] = laplacePosterior(savesPerCategory[c] ?? 0, totalSaves, numCats);
      }
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

// ─── Stated preferences (explicit user-declared categories) ──────────────────

interface RawStatedPreferenceRow {
  preferences: { categories?: unknown } | null;
}

interface StatedPreferencesCacheEntry {
  data: string[] | null;
  expiresAt: number;
}

/**
 * In-process cache for `loadStatedPreferences`. Separate map from the
 * implicit-signal cache because the two signals have different update
 * cadences (stated prefs change rarely; implicit signals decay continuously).
 * We share `CACHE_TTL_SECONDS` (5 min) — same default as the implicit cache.
 */
const _statedCache = new Map<string, StatedPreferencesCacheEntry>();

/**
 * Read the user-declared category preferences from `user_preferences`.
 *
 * Stated preferences are the user's explicit category interests (set in
 * the onboarding flow or preferences screen). They are NOT the same as
 * the count-based priors in `buildUserSignal` — stated prefs are direct
 * declarations, the priors are inferred from saves/rejects.
 *
 * Return shape:
 *   - `string[]`  — declared categories (may be empty if user cleared them)
 *   - `null`      — no row in `user_preferences` for this user yet
 *
 * The function never throws into the chat path — DB errors collapse to
 * `null`. The chat handler decides whether to apply the boost based on
 * truthiness, exactly like the implicit priors.
 */
export async function loadStatedPreferences(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; skipCache?: boolean } = {}
): Promise<string[] | null> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (!opts.skipCache) {
    const hit = _statedCache.get(client_user_id);
    if (hit && hit.expiresAt > nowMs) return hit.data;
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preferences')
      .eq('client_user_id', client_user_id)
      .single();

    if (error || !data) {
      // PGRST116 (no rows) and real errors collapse to the same cached `null`
      // so the chat path can distinguish "no prefs yet" from
      // "prefs declared with empty list" (which is `[]`, not `null`).
      _statedCache.set(client_user_id, { data: null, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
      return null;
    }

    const row = data as unknown as RawStatedPreferenceRow;
    const raw = row.preferences?.categories;
    const categories: string[] = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : [];

    _statedCache.set(client_user_id, { data: categories, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
    return categories;
  } catch {
    _statedCache.set(client_user_id, { data: null, expiresAt: nowMs + CACHE_TTL_SECONDS * 1000 });
    return null;
  }
}

/** Test/dev helper — clear the stated-preferences in-process cache. */
export function clearStatedPreferencesCache(): void {
  _statedCache.clear();
}

// ─── Phase 2 (T0075): materialized category weights ────────────────────────

/** Shape returned by loadMaterializedCategoryWeights. */
export interface MaterializedCategoryWeights {
  ok: boolean;
  /** Laplace-smoothed posteriors keyed by category_slug. Empty map when
   *  the table is missing, the user has no rows, or the read failed. */
  categoryPosterior: Record<string, number>;
  /** ISO timestamp of the newest row we observed. `null` when no rows. */
  computedAt: string | null;
  /** Set when `ok` is false — surfaced for cron logs and tests. */
  warning?: string;
}

/** Shape returned by recomputeUserPreferences. */
export interface RecomputeResult {
  ok: boolean;
  /** Number of (kind, key) rows upserted. Excludes deletions. */
  weightsWritten: number;
  /** Category slugs the recompute touched (slug list, for tests + logs). */
  categoriesTouched: string[];
  /** Number of stale (kind, key) rows deleted for this user. */
  staleDeleted: number;
  warning?: string;
}

/** Read pre-computed category weights for a user from `user_signal_weights`.
 *
 *  Phase 2 (T0075): the cron writes these rows every 6h. When rows exist
 *  they are authoritative — the on-demand path in `buildUserSignal` falls
 *  back to live computation only when this returns an empty map or fails.
 *
 *  Never throws — the chat path cannot take a hit if the table is missing
 *  or the query errors. The caller (`buildUserSignal`) inspects `ok` +
 *  the size of `categoryPosterior` to decide whether to short-circuit.
 *
 *  Schema expected:
 *    user_signal_weights(
 *      client_user_id TEXT,
 *      kind           TEXT CHECK (kind IN ('category','venue','artist')),
 *      key            TEXT,
 *      weight         DOUBLE PRECISION,
 *      computed_at    TIMESTAMPTZ,
 *      PRIMARY KEY (client_user_id, kind, key)
 *    )
 */
export async function loadMaterializedCategoryWeights(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date } = {}
): Promise<MaterializedCategoryWeights> {
  const now = opts.now ?? new Date();
  const empty: MaterializedCategoryWeights = {
    ok: false,
    categoryPosterior: {},
    computedAt: null,
  };
  try {
    const { data, error } = await supabase
      .from('user_signal_weights')
      .select('key, weight, computed_at')
      .eq('client_user_id', client_user_id)
      .eq('kind', 'category');

    if (error || !data) {
      // PGRST204 (relation does not exist) and other errors collapse to
      // the same `ok:false` shape so buildUserSignal falls back cleanly.
      return { ...empty, warning: `read failed: ${error?.message ?? 'no data'}` };
    }

    const rows = data as unknown as Array<{ key: string | null; weight: number | null; computed_at: string | null }>;
    const posteriors: Record<string, number> = {};
    let newest: string | null = null;
    for (const r of rows) {
      if (typeof r.key !== 'string' || r.key.length === 0) continue;
      if (typeof r.weight !== 'number' || !Number.isFinite(r.weight)) continue;
      if (r.weight < 0 || r.weight > 1) continue;
      posteriors[r.key] = r.weight;
      if (r.computed_at && (!newest || r.computed_at > newest)) newest = r.computed_at;
    }

    if (Object.keys(posteriors).length === 0) {
      return { ...empty, warning: 'no materialized category rows for user' };
    }
    return { ok: true, categoryPosterior: posteriors, computedAt: newest };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...empty, warning: `exception: ${msg}` };
  }
}

/** Recompute a single user's category weights from `user_interactions` and
 *  upsert the result into `user_signal_weights`. Designed for the
 *  `sync_personalization` cron — never throws.
 *
 *  Algorithm (mirrors the on-demand path in `buildUserSignal`):
 *    1. Read the user's interactions (save/positive + dismiss/negative),
 *       joined to `events` for category_slug. Limited to 500 rows so a
 *       pathological user can't melt the cron.
 *    2. For each row, compute recency decay (30-day half-life).
 *    3. Bucket decay-weighted saves per category_slug.
 *    4. Compute Laplace-smoothed posterior per category: (count + α) / (total + α·|C|).
 *    5. Upsert one row per (client_user_id, kind='category', key=slug).
 *    6. Delete stale `kind='category'` rows for this user whose `key` no
 *       longer appears in the recomputed set — keeps the table bounded.
 *
 *  The function never throws — DB errors collapse to `{ ok:false, warning }`
 *  so the cron can log + skip without poisoning the scheduler.
 */
export async function recomputeUserPreferences(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { now?: Date; minSaves?: number } = {}
): Promise<RecomputeResult> {
  const now = opts.now ?? new Date();
  const minSaves = opts.minSaves ?? 1;

  try {
    const { data, error } = await supabase
      .from('user_interactions')
      .select('interaction, created_at, events:event_id(category_slug)')
      .eq('client_user_id', client_user_id)
      .in('interaction', ['save', 'feedback_positive'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (error || !data) {
      return {
        ok: false,
        weightsWritten: 0,
        categoriesTouched: [],
        staleDeleted: 0,
        warning: `interactions read failed: ${error?.message ?? 'no data'}`,
      };
    }

    const rows = data as unknown as Array<{
      interaction: string;
      created_at: string;
      events: { category_slug: string | null } | null;
    }>;
    const nowMs = now.getTime();
    const savesPerCategory: Record<string, number> = {};
    const categories = new Set<string>();
    let totalSaves = 0;

    for (const r of rows) {
      const ageDays = (nowMs - new Date(r.created_at).getTime()) / 86_400_000;
      const decay = recencyDecay(ageDays);
      const cat = r.events?.category_slug ?? null;
      if (!cat) continue;
      categories.add(cat);
      savesPerCategory[cat] = (savesPerCategory[cat] ?? 0) + decay;
      totalSaves += decay;
    }

    // Min-N gate: a user with effectively zero saves shouldn't get a row
    // write at all — keeps the table sparse and protects against micro-signal
    // noise polluting downstream consumers.
    if (totalSaves < minSaves || categories.size === 0) {
      // Even when we don't write, clean up any stale rows that the user
      // might have from a previous pass where they had more activity.
      const staleDeleted = await deleteStaleCategoryRows(supabase, client_user_id, []);
      return {
        ok: true,
        weightsWritten: 0,
        categoriesTouched: [],
        staleDeleted,
      };
    }

    const numCats = Math.max(1, categories.size);
    const posteriors: Array<{ key: string; weight: number }> = [];
    for (const c of categories) {
      posteriors.push({
        key: c,
        weight: laplacePosterior(savesPerCategory[c] ?? 0, totalSaves, numCats),
      });
    }

    // Upsert all rows in one call. ON CONFLICT (PK) updates weight +
    // computed_at; no merge logic needed at the SQL layer because the
    // recompute is idempotent — same input → same posteriors.
    const upsertPayload = posteriors.map((p) => ({
      client_user_id,
      kind: 'category',
      key: p.key,
      weight: p.weight,
      computed_at: now.toISOString(),
    }));

    const { error: upErr } = await supabase
      .from('user_signal_weights')
      .upsert(upsertPayload, { onConflict: 'client_user_id,kind,key' });

    if (upErr) {
      return {
        ok: false,
        weightsWritten: 0,
        categoriesTouched: posteriors.map((p) => p.key),
        staleDeleted: 0,
        warning: `upsert failed: ${upErr.message}`,
      };
    }

    // Sweep stale category rows for this user — anything not in the new
    // posteriors set is dropped. This keeps the table bounded and prevents
    // ghost categories (e.g. a user who only saved music 90 days ago, then
    // stopped saving) from lingering forever.
    const staleDeleted = await deleteStaleCategoryRows(
      supabase,
      client_user_id,
      posteriors.map((p) => p.key),
    );

    return {
      ok: true,
      weightsWritten: posteriors.length,
      categoriesTouched: posteriors.map((p) => p.key),
      staleDeleted,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      weightsWritten: 0,
      categoriesTouched: [],
      staleDeleted: 0,
      warning: `exception: ${msg}`,
    };
  }
}

/** Delete category rows for this user whose `key` is not in `keepKeys`.
 *  Returns the number of rows deleted (0 on error — never throws). */
async function deleteStaleCategoryRows(
  supabase: SupabaseClient,
  client_user_id: string,
  keepKeys: string[],
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('user_signal_weights')
      .select('key')
      .eq('client_user_id', client_user_id)
      .eq('kind', 'category');
    if (error || !data) return 0;
    const keep = new Set(keepKeys);
    const stale = (data as unknown as Array<{ key: string | null }>)
      .map((r) => r.key)
      .filter((k): k is string => typeof k === 'string' && !keep.has(k));
    if (stale.length === 0) return 0;
    // One DELETE per stale key. The list is bounded by the user's
    // distinct-category count (typically < 20) so this is cheap.
    for (const key of stale) {
      await supabase
        .from('user_signal_weights')
        .delete()
        .eq('client_user_id', client_user_id)
        .eq('kind', 'category')
        .eq('key', key);
    }
    return stale.length;
  } catch {
    return 0;
  }
}
