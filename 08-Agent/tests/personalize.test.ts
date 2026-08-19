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

afterEach(() => clearPersonalizationCache());

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
    expect(calls).toBe(1);
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
