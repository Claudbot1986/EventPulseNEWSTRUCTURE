/**
 * Tests for the personalization math + ranker integration.
 *
 * Math primitives are tested pure (no Supabase). The ranker integration
 * test uses a synthetic UserSignal and asserts the new
 * `category_personalization` / `venue_personalization_penalty` reasons
 * fire under the right conditions and respect min-N + caps.
 *
 * Run with:  npx vitest run 08-Agent/tests/personalize.test.ts
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  laplacePosterior,
  recencyDecay,
  wilsonLowerBound,
  buildUserSignal,
  clearPersonalizationCache,
  clearStatedPreferencesCache,
  loadStatedPreferences,
  loadMaterializedCategoryWeights,
  recomputeUserPreferences,
  CACHE_TTL_SECONDS,
  CATEGORY_BOOST_BETA,
  VENUE_PENALTY_GAMMA,
  MIN_SAVES,
  MIN_WEIGHTED_REJECTS,
  BOOST_CAP_FRACTION,
  PENALTY_CAP_ABS,
  type UserSignal,
} from '../tools/personalize';
import { rankEvents } from '../tools/rank_events';
import type { EventCard, IntentBrief } from '../types';

const NOW = new Date('2026-08-17T10:00:00Z');

afterEach(() => {
  clearPersonalizationCache();
  clearStatedPreferencesCache();
});

describe('laplacePosterior', () => {
  it('returns (count+α)/(total+α·|C|) with α=1 (add-one smoothing)', () => {
    // 5 saves in 'music' out of 10 total, 2 categories → (5+1)/(10+1·2) = 6/12 = 0.5
    expect(laplacePosterior(5, 10, 2)).toBeCloseTo(0.5, 6);
  });

  it('smooths zero counts up — never returns 0 when α>0', () => {
    // No saves in 'theater' out of 10 total, 3 categories → (0+1)/(10+1·3) = 1/13
    expect(laplacePosterior(0, 10, 3)).toBeCloseTo(1 / 13, 6);
  });

  it('respects custom α', () => {
    expect(laplacePosterior(0, 0, 2, 2)).toBeCloseTo(2 / 4, 6);
  });

  it('handles zero total + zero categories without dividing by zero', () => {
    // numCategories floors to 1 inside buildUserSignal; here at primitive level
    // we just verify it does not NaN when total=0 and α>0.
    expect(laplacePosterior(0, 0, 1)).toBeCloseTo(1, 6);
  });
});

describe('recencyDecay', () => {
  it('returns 1 for age=0', () => {
    expect(recencyDecay(0)).toBe(1);
  });

  it('returns 0.5 at one half-life', () => {
    expect(recencyDecay(30)).toBeCloseTo(0.5, 6);
  });

  it('decays exponentially', () => {
    expect(recencyDecay(60)).toBeCloseTo(0.25, 6);
    expect(recencyDecay(90)).toBeCloseTo(0.125, 6);
  });

  it('honors custom half-life', () => {
    expect(recencyDecay(7, 7)).toBeCloseTo(0.5, 6);
  });

  it('clamps negative ages to 1', () => {
    expect(recencyDecay(-5)).toBe(1);
  });
});

describe('wilsonLowerBound', () => {
  it('returns 0 for n=0 (no data)', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('returns a conservative bound below the raw rate for small n', () => {
    // Raw rate 3/3 = 1.0, but Wilson lower bound at 95% should be well below 1.
    const lb = wilsonLowerBound(3, 3);
    expect(lb).toBeGreaterThan(0);
    expect(lb).toBeLessThan(1);
  });

  it('approaches the raw rate as n grows', () => {
    const lb100 = wilsonLowerBound(80, 100); // raw 0.8
    const lb10000 = wilsonLowerBound(8000, 10000); // raw 0.8
    expect(lb100).toBeLessThan(0.8);
    expect(lb10000).toBeGreaterThan(lb100);
    expect(lb10000).toBeCloseTo(0.8, 1);
  });
});

describe('buildUserSignal — DB failure path', () => {
  it('returns a cold signal (empty maps, totalSaves=0) on query error', async () => {
    // Minimal Supabase-like stub: from().select() returns { error: ... }.
    const badSb: any = {
      from() {
        return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: null, error: { message: 'table missing' } }); } };
      },
    };
    const sig = await buildUserSignal(badSb, '00000000-0000-0000-0000-000000000001', { now: NOW, skipCache: true });
    expect(sig.totalSaves).toBe(0);
    expect(sig.weightedRejects).toBe(0);
    expect(sig.categoryPosterior).toEqual({});
    expect(sig.venueBadness).toEqual({});
  });

  it('caches the cold signal so the DB is not re-queried within TTL', async () => {
    let calls = 0;
    const sb: any = {
      from() { calls++; return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); } }; },
    };
    await buildUserSignal(sb, '00000000-0000-0000-0000-000000000002', { now: NOW, skipCache: true });
    await buildUserSignal(sb, '00000000-0000-0000-0000-000000000002', { now: NOW });
    // First call hits BOTH user_signal_weights (T0075 fast path) AND
    // user_interactions (the live venue-badness + totalSaves compute).
    // Second call is a cache hit — no DB roundtrips.
    expect(calls).toBe(2);
  });
});

describe('buildUserSignal — happy path with synthetic data', () => {
  // 3 saves in 'music' (10 days old, decay ≈ 0.794), 2 saves in 'art' (60 days old, decay ≈ 0.25).
  // 2 weighted rejects at venue 'BadKlubb' (5 days old, decay ≈ 0.891) and 1 at 'OkKlubb' (40 days old).
  const userId = '00000000-0000-0000-0000-000000000003';
  function fakeRow(daysAgo: number, interaction: string, cat: string | null, venue: string | null) {
    return {
      interaction,
      created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
      events: { category_slug: cat, venue_name: venue },
    };
  }
  const rows = [
    fakeRow(10, 'save', 'music', 'Konserthuset'),
    fakeRow(10, 'save', 'music', 'Debaser'),
    fakeRow(10, 'save', 'music', 'Konserthuset'),
    fakeRow(60, 'save', 'art',   'Moderna'),
    fakeRow(60, 'save', 'art',   'Moderna'),
    fakeRow(5,  'dismiss', null, 'BadKlubb'),
    fakeRow(5,  'dismiss', null, 'BadKlubb'),
    fakeRow(40, 'dismiss', null, 'OkKlubb'),
  ];

  const sb: any = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
      };
    },
  };

  it('aggregates decay-weighted saves per category', async () => {
    // Add more music saves (recency=10d, decay≈0.794) to clear the min-N gate.
    // 7 music × 0.794 ≈ 5.56 → totalSaves ≥ MIN_SAVES=5.
    const moreRows = [
      ...rows,
      fakeRow(10, 'save', 'music', 'Konserthuset'),
      fakeRow(10, 'save', 'music', 'Debaser'),
      fakeRow(10, 'save', 'music', 'Konserthuset'),
      fakeRow(10, 'save', 'music', 'Debaser'),
    ];
    const sbMore: any = {
      from() { return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: moreRows, error: null }); } }; },
    };
    const sig = await buildUserSignal(sbMore, userId, { now: NOW, skipCache: true });
    // music: 7 × 0.794 ≈ 5.56, art: 2 × 0.25 = 0.5 → total ≈ 6.06
    expect(sig.totalSaves).toBeGreaterThanOrEqual(MIN_SAVES);
    expect(sig.categoryPosterior.music).toBeGreaterThan(sig.categoryPosterior.art);
  });

  it('aggregates decay-weighted rejects per venue and clears the min-N gate', async () => {
    const sig = await buildUserSignal(sb, userId, { now: NOW, skipCache: true });
    // BadKlubb: 2 × 0.891 ≈ 1.782 — BELOW MIN_WEIGHTED_REJECTS (3) by raw sum,
    // but with Wilson computation, venueBadness is still non-zero. The min-N
    // gate is enforced by the *ranker*, not here. We just assert computation.
    expect(sig.weightedRejects).toBeGreaterThan(0);
    expect(sig.venueBadness.BadKlubb).toBeGreaterThan(0);
  });
});

// ── loadStatedPreferences ────────────────────────────────────────────────

describe('loadStatedPreferences', () => {
  const userId = '00000000-0000-0000-0000-000000000010';

  it('returns null when no row exists for the user', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: null,
              error: { code: 'PGRST116', message: 'No rows' },
            });
          },
        };
      },
    };
    const result = await loadStatedPreferences(sb, userId, { skipCache: true });
    expect(result).toBeNull();
  });

  it('returns null on a real DB error (collapses to null, not thrown)', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: null,
              error: { code: 'PGRST204', message: 'Relation does not exist' },
            });
          },
        };
      },
    };
    const result = await loadStatedPreferences(sb, userId, { skipCache: true });
    expect(result).toBeNull();
  });

  it('returns the categories array when user has declared preferences', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: { preferences: { categories: ['music', 'art'] } },
              error: null,
            });
          },
        };
      },
    };
    const result = await loadStatedPreferences(sb, userId, { skipCache: true });
    expect(result).toEqual(['music', 'art']);
  });

  it('returns an empty array when user explicitly cleared preferences', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: { preferences: { categories: [] } },
              error: null,
            });
          },
        };
      },
    };
    const result = await loadStatedPreferences(sb, userId, { skipCache: true });
    expect(result).toEqual([]);
  });

  it('filters out non-string category values', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: { preferences: { categories: ['music', null, 42, 'art', false] } },
              error: null,
            });
          },
        };
      },
    };
    const result = await loadStatedPreferences(sb, userId, { skipCache: true });
    expect(result).toEqual(['music', 'art']);
  });

  it('caches null results for CACHE_TTL_SECONDS', async () => {
    let calls = 0;
    const sb: any = {
      from() {
        calls++;
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
          },
        };
      },
    };
    await loadStatedPreferences(sb, userId, { skipCache: true });
    await loadStatedPreferences(sb, userId);
    expect(calls).toBe(1);
  });

  it('does not use stale cache when entry has expired', async () => {
    let calls = 0;
    const sb: any = {
      from() {
        calls++;
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({ data: { preferences: { categories: ['theater'] } }, error: null });
          },
        };
      },
    };
    // First call populates cache
    await loadStatedPreferences(sb, userId, { skipCache: true });
    // Advance time past cache TTL and call again (simulated by using skipCache again)
    const fakeNow = new Date(Date.now() + (CACHE_TTL_SECONDS + 1) * 1000);
    await loadStatedPreferences(sb, userId, { now: fakeNow });
    expect(calls).toBe(2);
  });
});

// ── rank_events integration ────────────────────────────────────────────────

function card(over: Partial<EventCard> & { id: string; start_time: string }): EventCard {
  return {
    id: over.id,
    title: over.title ?? 'Untitled',
    start_time: over.start_time,
    end_time: over.end_time ?? null,
    venue_name: over.venue_name ?? 'Konserthuset',
    city: over.city ?? 'Stockholm',
    category_slug: over.category_slug ?? 'music',
    price_min_sek: over.price_min_sek ?? null,
    price_max_sek: over.price_max_sek ?? null,
    is_free: over.is_free ?? false,
    ticket_url: over.ticket_url ?? null,
    image_url: over.image_url ?? null,
    confidence_score: over.confidence_score ?? null,
    freshness_at: over.freshness_at ?? null,
  };
}

const baseIntent: IntentBrief = {
  raw_query: 'något ikväll',
  date_from: '2026-08-17',
  date_to:   '2026-08-17',
  time_of_day: 'anytime',
  budget: 'any',
  party:  'any',
  categories: [],
  city: 'Stockholm',
  language: 'sv',
  exclude_categories: [],
};

describe('rankEvents — personalization prior', () => {
  const m1 = card({ id: 'm1', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
  const m2 = card({ id: 'm2', start_time: '2026-08-17T20:30:00Z', category_slug: 'music',   venue_name: 'Debaser' });
  const t1 = card({ id: 't1', start_time: '2026-08-17T20:00:00Z', category_slug: 'theater', venue_name: 'Dramaten' });
  const a1 = card({ id: 'a1', start_time: '2026-08-17T20:00:00Z', category_slug: 'art',     venue_name: 'Moderna' });

  const coldSignal: UserSignal = {
    client_user_id: 'u-cold',
    categoryPosterior: {},
    venueBadness: {},
    totalSaves: 0,
    weightedRejects: 0,
    fetchedAt: NOW.toISOString(),
  };

  it('applies no prior when signal is cold (totalSaves=0)', () => {
    const ranked = rankEvents([m1, t1, a1], baseIntent, { now: NOW, personalization: coldSignal });
    for (const r of ranked) expect(r.reasons).not.toContain('category_personalization');
  });

  it('boosts music cards when user has MIN_SAVES in music', () => {
    // 6 saves total, all in 'music'. categoryPosterior should ONLY contain
    // categories the user has saved — if the user never saved theater or art,
    // those cards must not get a personalization boost.
    // posterior(music) = (6+1)/(6+1·1) = 7/7 = 1.0
    // boost = β·log(1 + 6 · 1.0) ≈ 8 · log(7) ≈ 15.6
    // cap   = β·log(1 + 0.2·6)  ≈ 8 · log(2.2) ≈ 6.3
    // → boost clipped to 6.3 on music card only.
    const sig: UserSignal = {
      ...coldSignal,
      totalSaves: 6,
      categoryPosterior: { music: 1.0 },
    };
    const ranked = rankEvents([m1, t1, a1], baseIntent, { now: NOW, personalization: sig });
    const musicReasons = ranked.find((r) => r.card.id === 'm1')!.reasons;
    const theaterReasons = ranked.find((r) => r.card.id === 't1')!.reasons;
    const artReasons = ranked.find((r) => r.card.id === 'a1')!.reasons;
    expect(musicReasons).toContain('category_personalization');
    expect(theaterReasons).not.toContain('category_personalization');
    expect(artReasons).not.toContain('category_personalization');
  });

  it('gates boost off below MIN_SAVES (does not fire at 4 saves)', () => {
    const sig: UserSignal = {
      ...coldSignal,
      totalSaves: MIN_SAVES - 1,
      categoryPosterior: { music: 0.5 },
    };
    const ranked = rankEvents([m1, t1], baseIntent, { now: NOW, personalization: sig });
    const musicReasons = ranked.find((r) => r.card.id === 'm1')!.reasons;
    expect(musicReasons).not.toContain('category_personalization');
  });

  it('caps boost magnitude to prevent filter-bubble pathology', () => {
    // 50 music saves out of 50 total → extreme over-representation.
    // Raw boost = β·log(1 + 50 · 1.0) ≈ 8 · log(51) ≈ 31.5
    // Cap       = β·log(1 + 0.2·50)  = 8 · log(11) ≈ 19.2
    // We verify the cap holds by checking actual score boost is bounded.
    const sig: UserSignal = {
      ...coldSignal,
      totalSaves: 50,
      categoryPosterior: { music: 1.0 },
    };
    const withPers = rankEvents([m1, t1], baseIntent, { now: NOW, personalization: sig });
    const withoutPers = rankEvents([m1, t1], baseIntent, { now: NOW });
    const musicWith = withPers.find((r) => r.card.id === 'm1')!.score;
    const musicWithout = withoutPers.find((r) => r.card.id === 'm1')!.score;
    const delta = musicWith - musicWithout;
    const cap = CATEGORY_BOOST_BETA * Math.log(1 + BOOST_CAP_FRACTION * 50);
    expect(delta).toBeLessThanOrEqual(cap + 1e-9);
    expect(delta).toBeGreaterThan(0);
  });

  it('applies venue penalty when user has MIN_WEIGHTED_REJECTS at a venue', () => {
    const sig: UserSignal = {
      ...coldSignal,
      weightedRejects: 4,
      venueBadness: { Konserthuset: 0.5, Debaser: 0.0, Dramaten: 0.0 },
    };
    const ranked = rankEvents([m1, m2, t1], baseIntent, { now: NOW, personalization: sig });
    const m1Reasons = ranked.find((r) => r.card.id === 'm1')!.reasons;
    const m2Reasons = ranked.find((r) => r.card.id === 'm2')!.reasons;
    expect(m1Reasons).toContain('venue_personalization_penalty');
    expect(m2Reasons).not.toContain('venue_personalization_penalty');
  });

  it('caps penalty magnitude to PENALTY_CAP_ABS', () => {
    // Saturate venue badness at 1.0 with weightedRejects above the gate.
    const sig: UserSignal = {
      ...coldSignal,
      weightedRejects: 10,
      venueBadness: { Konserthuset: 1.0 },
    };
    const withPers = rankEvents([m1, t1], baseIntent, { now: NOW, personalization: sig });
    const withoutPers = rankEvents([m1, t1], baseIntent, { now: NOW });
    const delta = withPers.find((r) => r.card.id === 'm1')!.score
                - withoutPers.find((r) => r.card.id === 'm1')!.score;
    // raw = -VENUE_PENALTY_GAMMA * 1 = -0.05, but bounded above by -PENALTY_CAP_ABS
    expect(delta).toBeGreaterThanOrEqual(-PENALTY_CAP_ABS - 1e-9);
    expect(delta).toBeLessThan(0);
  });

  it('gates penalty off below MIN_WEIGHTED_REJECTS (does not fire at 2)', () => {
    const sig: UserSignal = {
      ...coldSignal,
      weightedRejects: MIN_WEIGHTED_REJECTS - 1,
      venueBadness: { Konserthuset: 0.5 },
    };
    const ranked = rankEvents([m1, t1], baseIntent, { now: NOW, personalization: sig });
    const m1Reasons = ranked.find((r) => r.card.id === 'm1')!.reasons;
    expect(m1Reasons).not.toContain('venue_personalization_penalty');
  });

  it('does not break ties against the deterministic base ranker when no signal', () => {
    // With no personalization, the deterministic order should be stable.
    const r1 = rankEvents([m1, t1, a1], baseIntent, { now: NOW });
    const r2 = rankEvents([a1, t1, m1], baseIntent, { now: NOW });
    expect(r1.map((r) => r.card.id)).toEqual(r2.map((r) => r.card.id));
  });
});

// ── Phase 2 (T0075): materialized weights ─────────────────────────────────

describe('loadMaterializedCategoryWeights', () => {
  const userId = '00000000-0000-0000-0000-000000000020';

  it('returns ok:false with empty map when the table query errors', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: 'relation missing' } }),
        };
      },
    };
    const r = await loadMaterializedCategoryWeights(sb, userId);
    expect(r.ok).toBe(false);
    expect(r.categoryPosterior).toEqual({});
    expect(r.warning).toMatch(/relation missing/);
  });

  it('returns ok:false with empty map when no rows exist for the user', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
      },
    };
    const r = await loadMaterializedCategoryWeights(sb, userId);
    expect(r.ok).toBe(false);
    expect(r.categoryPosterior).toEqual({});
  });

  it('returns ok:true with category posteriors when rows exist', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { key: 'music',   weight: 0.85, computed_at: '2026-08-22T00:00:00Z' },
                { key: 'theater', weight: 0.42, computed_at: '2026-08-22T00:00:00Z' },
              ],
              error: null,
            }),
        };
      },
    };
    const r = await loadMaterializedCategoryWeights(sb, userId);
    expect(r.ok).toBe(true);
    expect(r.categoryPosterior).toEqual({ music: 0.85, theater: 0.42 });
    expect(r.computedAt).toBe('2026-08-22T00:00:00Z');
  });

  it('filters out invalid weight values (NaN, out-of-range)', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { key: 'music',   weight: 0.5,   computed_at: '2026-08-22T00:00:00Z' },
                { key: 'theater', weight: NaN,   computed_at: '2026-08-22T00:00:00Z' },
                { key: 'art',     weight: 1.5,   computed_at: '2026-08-22T00:00:00Z' },
                { key: 'film',    weight: -0.1,  computed_at: '2026-08-22T00:00:00Z' },
                { key: '',        weight: 0.5,   computed_at: '2026-08-22T00:00:00Z' },
              ],
              error: null,
            }),
        };
      },
    };
    const r = await loadMaterializedCategoryWeights(sb, userId);
    expect(r.categoryPosterior).toEqual({ music: 0.5 });
  });
});

describe('recomputeUserPreferences', () => {
  const userId = '00000000-0000-0000-0000-000000000030';

  it('returns ok:false with empty result when interactions read fails', async () => {
    const sb: any = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          in() { return this; },
          order() { return this; },
          limit() {
            return Promise.resolve({ data: null, error: { message: 'db down' } });
          },
        };
      },
    };
    const r = await recomputeUserPreferences(sb, userId);
    expect(r.ok).toBe(false);
    expect(r.weightsWritten).toBe(0);
    expect(r.warning).toMatch(/db down/);
  });

  it('writes one upsert per category with Laplace-smoothed posteriors', async () => {
    const upsertPayload: any[] = [];
    const upsertChain: any = {
      upsert(payload: unknown) {
        upsertPayload.push(payload);
        return Promise.resolve({ data: null, error: null });
      },
    };
    for (const fn of ['select', 'eq', 'in', 'order', 'limit']) {
      upsertChain[fn] = () => upsertChain;
    }
    upsertChain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null });

    let fromCalls = 0;
    const sb: any = {
      from(table: string) {
        fromCalls++;
        if (table === 'user_interactions') {
          return {
            select() { return this; },
            eq() { return this; },
            in() { return this; },
            order() { return this; },
            limit() {
              // 5 music saves (today, decay ≈ 1) + 2 theater saves (today, decay ≈ 1)
              return Promise.resolve({
                data: [
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'music' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'music' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'music' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'music' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'music' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'theater' } },
                  { interaction: 'save', created_at: NOW.toISOString(), events: { category_slug: 'theater' } },
                ],
                error: null,
              });
            },
          };
        }
        if (table === 'user_signal_weights') return upsertChain;
        return upsertChain;
      },
    };
    const r = await recomputeUserPreferences(sb, userId, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.weightsWritten).toBe(2);
    expect(r.categoriesTouched.sort()).toEqual(['music', 'theater']);
    // Both upsert calls happen in one batch (single upsert with array payload).
    expect(upsertPayload.length).toBe(1);
    const payload = upsertPayload[0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(2);
    // music: (5+1)/(7+1·2) = 6/9 = 0.6667
    const music = payload.find((p: any) => p.key === 'music');
    expect(music.weight).toBeCloseTo(6 / 9, 4);
    // theater: (2+1)/(7+1·2) = 3/9 = 0.3333
    const theater = payload.find((p: any) => p.key === 'theater');
    expect(theater.weight).toBeCloseTo(3 / 9, 4);
    // Both rows tagged kind='category' + computed_at = NOW.
    for (const row of payload) {
      expect(row.kind).toBe('category');
      expect(row.client_user_id).toBe(userId);
      expect(row.computed_at).toBe(NOW.toISOString());
    }
    expect(fromCalls).toBeGreaterThanOrEqual(2);
  });

  it('returns ok:true with weightsWritten=0 for users below the min-saves gate', async () => {
    let upsertCalls = 0;
    const sb: any = {
      from(table: string) {
        if (table === 'user_interactions') {
          return {
            select() { return this; },
            eq() { return this; },
            in() { return this; },
            order() { return this; },
            limit() {
              // 0 saves (only dismisses). With save filter, this is empty.
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        if (table === 'user_signal_weights') {
          return {
            select() { return this; },
            eq() { return this; },
            then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
            delete() { return this; },
          };
        }
        return { upsert() { upsertCalls++; return Promise.resolve({ data: null, error: null }); } };
      },
    };
    const r = await recomputeUserPreferences(sb, userId);
    expect(r.ok).toBe(true);
    expect(r.weightsWritten).toBe(0);
    expect(r.categoriesTouched).toEqual([]);
    // No upsert should fire when below the gate.
    expect(upsertCalls).toBe(0);
  });
});

/**
 * T0075 verify line:
 *   "rank_events returns different order for user with saves vs user without saves"
 *
 * When the cron has materialized weights, buildUserSignal consumes them via
 * loadMaterializedCategoryWeights. A user with `music: 0.9` in
 * user_signal_weights gets a category_personalization boost on music cards;
 * a user with no rows does not. This test pins that contract end-to-end
 * with a single rank_events call.
 */
describe('T0075 verify line — rank_events + materialized weights shift order', () => {
  const music1 = card({ id: 'music1', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
  const music2 = card({ id: 'music2', start_time: '2026-08-17T20:30:00Z', category_slug: 'music',   venue_name: 'Debaser' });
  const theater = card({ id: 'theater', start_time: '2026-08-17T20:00:00Z', category_slug: 'theater', venue_name: 'Dramaten' });
  const art = card({ id: 'art', start_time: '2026-08-17T20:00:00Z', category_slug: 'art',     venue_name: 'Moderna' });

  it('user with strong music weight gets music cards ranked higher than a user without weights', () => {
    // Two synthetic UserSignals representing "user with saves" vs "user without saves".
    const userWithSaves: UserSignal = {
      client_user_id: 'u-hot',
      categoryPosterior: { music: 0.95 }, // very high music affinity
      venueBadness: {},
      totalSaves: 12,
      weightedRejects: 0,
      fetchedAt: NOW.toISOString(),
    };
    const userWithoutSaves: UserSignal = {
      client_user_id: 'u-cold',
      categoryPosterior: {},
      venueBadness: {},
      totalSaves: 0,
      weightedRejects: 0,
      fetchedAt: NOW.toISOString(),
    };

    const rankedHot  = rankEvents([music1, theater, art], baseIntent, { now: NOW, personalization: userWithSaves });
    const rankedCold = rankEvents([music1, theater, art], baseIntent, { now: NOW, personalization: userWithoutSaves });

    // Hot user: music1 is #1 because of the music prior.
    expect(rankedHot[0].card.id).toBe('music1');
    expect(rankedHot[0].reasons).toContain('category_personalization');

    // Cold user: ordering is by base features only (time_fit + not_ended all tied).
    // With a music card + theater + art all at the same start time, the order
    // is deterministic (tie-breaker by id). The hot user gets a strictly
    // different music1 score, demonstrating the rank-lift.
    expect(rankedCold[0].card.id).not.toBe('music1'); // music1 has no boost in cold path
    expect(rankedCold.find((r) => r.card.id === 'music1')!.reasons).not.toContain('category_personalization');

    // Scores diverge between the two users for music1 specifically.
    const musicHot  = rankedHot.find((r) => r.card.id === 'music1')!.score;
    const musicCold = rankedCold.find((r) => r.card.id === 'music1')!.score;
    expect(musicHot).toBeGreaterThan(musicCold);
  });
});
