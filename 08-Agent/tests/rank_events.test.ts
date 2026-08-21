/**
 * Tests for rankEvents — deterministic ranker.
 *
 * Run with:  npx vitest run 08-Agent/tests
 */

import { describe, expect, it } from 'vitest';
import {
  rankEvents,
  RANK_WEIGHTS,
  hourInTimeZone,
  DEFAULT_TIME_ZONE,
} from '../tools/rank_events';
import type { EventCard, IntentBrief } from '../types';
import type { UserSignal } from '../tools/personalize';

const NOW = new Date('2026-08-17T10:00:00Z');

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
  raw_query: 'konsert ikväll',
  date_from: '2026-08-17',
  date_to:   '2026-08-17',
  time_of_day: 'evening',
  budget: 'any',
  party:  'any',
  categories: [],
  city: 'Stockholm',
  language: 'sv',
  exclude_categories: [],
};

describe('rankEvents', () => {
  it('rewards cards that match the intent time_of_day', () => {
    const evening = card({ id: 'a', start_time: '2026-08-17T19:30:00Z', category_slug: 'music' });
    const morning = card({ id: 'b', start_time: '2026-08-17T08:00:00Z', category_slug: 'music' });
    const ranked = rankEvents([morning, evening], baseIntent, { now: NOW, topN: 5 });
    expect(ranked[0].card.id).toBe('a');
    expect(ranked[0].reasons).toContain('time_fit');
  });

  it('punishes exclude_match', () => {
    const theater = card({ id: 'a', start_time: '2026-08-17T19:30:00Z', category_slug: 'theater' });
    const ranked = rankEvents([theater], { ...baseIntent, exclude_categories: ['theater'] }, { now: NOW });
    expect(ranked[0].reasons).toContain('exclude_match');
    expect(ranked[0].score).toBeLessThan(0);
  });

  it('rewards category_match when categories are requested', () => {
    const music = card({ id: 'a', start_time: '2026-08-17T19:30:00Z', category_slug: 'music' });
    const film  = card({ id: 'b', start_time: '2026-08-17T19:30:00Z', category_slug: 'film' });
    const ranked = rankEvents([film, music], { ...baseIntent, categories: ['music'] }, { now: NOW });
    expect(ranked[0].card.id).toBe('a');
    expect(ranked[0].reasons).toContain('category_match');
  });

  it('marks free intent as over_budget when event is paid', () => {
    const paid = card({ id: 'a', start_time: '2026-08-17T19:30:00Z', category_slug: 'music', is_free: false });
    const ranked = rankEvents([paid], { ...baseIntent, budget: 'free' }, { now: NOW });
    expect(ranked[0].reasons).toContain('over_budget');
  });

  it('limits result to topN', () => {
    const cards = Array.from({ length: 12 }, (_, i) =>
      card({ id: `e${i}`, start_time: '2026-08-17T19:30:00Z', category_slug: 'music' })
    );
    const ranked = rankEvents(cards, baseIntent, { now: NOW, topN: 5 });
    expect(ranked).toHaveLength(5);
  });

  it('uses stable tie-breaker (earlier start_time wins)', () => {
    const late = card({ id: 'late', start_time: '2026-08-17T21:00:00Z', category_slug: 'music' });
    const early = card({ id: 'early', start_time: '2026-08-17T19:00:00Z', category_slug: 'music' });
    const ranked = rankEvents([late, early], baseIntent, { now: NOW });
    expect(ranked[0].card.id).toBe('early');
  });

  it('exposes the weight constants for the eval harness', () => {
    expect(RANK_WEIGHTS.time_fit).toBeGreaterThan(0);
    expect(RANK_WEIGHTS.exclude_match).toBeLessThan(0);
  });
});

describe('rankEvents — quality reasons (confidence + freshness)', () => {
  it('rewards high_confidence when confidence_score >= 70', () => {
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 80,
      freshness_at: '2026-08-17T09:00:00Z',
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).toContain('high_confidence');
    expect(ranked[0].reasons).not.toContain('low_confidence');
    expect(ranked[0].reasons).not.toContain('stale');
    expect(ranked[0].score).toBe(RANK_WEIGHTS.not_ended + RANK_WEIGHTS.time_fit + RANK_WEIGHTS.high_confidence);
  });

  it('punishes low_confidence when confidence_score < 50', () => {
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 30,
      freshness_at: '2026-08-17T09:00:00Z',
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).toContain('low_confidence');
    expect(ranked[0].reasons).not.toContain('high_confidence');
    expect(ranked[0].reasons).not.toContain('stale');
    expect(ranked[0].score).toBe(RANK_WEIGHTS.not_ended + RANK_WEIGHTS.time_fit + RANK_WEIGHTS.low_confidence);
  });

  it('ignores confidence when confidence_score is null (no signal yet)', () => {
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: null,
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).not.toContain('high_confidence');
    expect(ranked[0].reasons).not.toContain('low_confidence');
  });

  it('flags stale when freshness_at is older than 14 days', () => {
    // 12 weeks back → well past the 14d window
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 80,
      freshness_at: '2026-06-01T10:00:00Z',
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).toContain('stale');
    expect(ranked[0].reasons).toContain('high_confidence');
  });

  it('does not flag stale when freshness_at is fresh', () => {
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      freshness_at: '2026-08-17T09:00:00Z',
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).not.toContain('stale');
  });

  it('does not flag stale when freshness_at is missing', () => {
    const c = card({
      id: 'a',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([c], baseIntent, { now: NOW });
    expect(ranked[0].reasons).not.toContain('stale');
  });

  it('uses exact thresholds — score=70 is high_confidence, score=50 is neither', () => {
    const highEdge = card({
      id: 'h',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 70,
    });
    const lowEdge = card({
      id: 'l',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 50,
    });
    expect(rankEvents([highEdge], baseIntent, { now: NOW })[0].reasons).toContain('high_confidence');
    expect(rankEvents([lowEdge],  baseIntent, { now: NOW })[0].reasons).not.toContain('high_confidence');
    expect(rankEvents([lowEdge],  baseIntent, { now: NOW })[0].reasons).not.toContain('low_confidence');
  });

  it('ranks a fresh high-confidence card above a stale low-confidence card', () => {
    const fresh = card({
      id: 'fresh',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 90,
      freshness_at: '2026-08-17T09:00:00Z',
    });
    const staleRow = card({
      id: 'stale',
      start_time: '2026-08-17T19:30:00Z',
      category_slug: 'music',
      confidence_score: 30,
      freshness_at: '2026-06-01T10:00:00Z',
    });
    const ranked = rankEvents([staleRow, fresh], baseIntent, { now: NOW });
    expect(ranked[0].card.id).toBe('fresh');
    expect(ranked[1].card.id).toBe('stale');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

/**
 * Stockholm-time bucketing regression — the latent timezone bug.
 *
 * Before the fix, rank_events called `new Date(c.start_time).getHours()`
 * which reads wall-clock hour in the SERVER's runtime timezone (e.g. UTC).
 * DB stores UTC instants but the product is Stockholm-only — so an event at
 * 22:00 Stockholm (= 20:00 UTC in CEST) was being stamped 'time_fit' for an
 * "evening" intent because getHours() returned 20 (UTC), not 22 (Stockholm).
 * Q21 "konsert ikväll" passed only by accident: m1 20:00 UTC = 22:00 Stockholm
 * (night) leaked into the evening bucket.
 *
 * After the fix, hourInTimeZone(c.start_time, 'Europe/Stockholm') is used,
 * correctly reflecting Stockholm wall-clock across DST shifts.
 */
describe('rankEvents — stated category preferences', () => {
  const m1 = card({ id: 'm1', start_time: '2026-08-17T20:00:00Z', category_slug: 'music' });
  const t1 = card({ id: 't1', start_time: '2026-08-17T20:00:00Z', category_slug: 'theater' });
  const a1 = card({ id: 'a1', start_time: '2026-08-17T20:00:00Z', category_slug: 'art' });

  it('adds stated_category_match reason when event category is in statedCategories', () => {
    const ranked = rankEvents([m1, t1], baseIntent, {
      now: NOW,
      statedCategories: ['music', 'theater'],
    });
    const musicCard = ranked.find((r) => r.card.id === 'm1')!;
    const theaterCard = ranked.find((r) => r.card.id === 't1')!;
    expect(musicCard.reasons).toContain('stated_category_match');
    expect(theaterCard.reasons).toContain('stated_category_match');
    expect(musicCard.score).toBeGreaterThan(
      rankEvents([m1], baseIntent, { now: NOW }).find((r) => r.card.id === 'm1')!.score
    );
  });

  it('does NOT fire when statedCategories is empty', () => {
    const ranked = rankEvents([m1], baseIntent, { now: NOW, statedCategories: [] });
    expect(ranked[0].reasons).not.toContain('stated_category_match');
  });

  it('does NOT fire when event category is not in statedCategories', () => {
    const ranked = rankEvents([a1], baseIntent, { now: NOW, statedCategories: ['music', 'theater'] });
    expect(ranked[0].reasons).not.toContain('stated_category_match');
  });

  it('does NOT fire when statedCategories is undefined (backwards-compatible)', () => {
    const ranked = rankEvents([m1], baseIntent, { now: NOW });
    expect(ranked[0].reasons).not.toContain('stated_category_match');
  });

  it('stacks with behavioral personalization — user with both signals gets both boosts', () => {
    const behavioralSignal: UserSignal = {
      client_user_id: 'u-hot',
      categoryPosterior: { music: 1.0 },
      venueBadness: {},
      totalSaves: 10,
      weightedRejects: 0,
      fetchedAt: NOW.toISOString(),
    };
    const ranked = rankEvents([m1], baseIntent, {
      now: NOW,
      personalization: behavioralSignal,
      statedCategories: ['music'],
    });
    expect(ranked[0].reasons).toContain('stated_category_match');
    expect(ranked[0].reasons).toContain('category_personalization');
  });

  it('boost is small constant — does not dominate category_match (30) or time_fit (25)', () => {
    const baseScore = rankEvents([m1], baseIntent, { now: NOW }).find((r) => r.card.id === 'm1')!.score;
    const boostedScore = rankEvents([m1], baseIntent, {
      now: NOW,
      statedCategories: ['music'],
    }).find((r) => r.card.id === 'm1')!.score;
    const delta = boostedScore - baseScore;
    expect(delta).toBeCloseTo(RANK_WEIGHTS.stated_category_match, 5);
  });
});

describe('rankEvents — Stockholm-time bucketing (timezone bug regression)', () => {
  it('treats 20:00 UTC on 2026-08-17 as NIGHT (22:00 Stockholm CEST), not evening', () => {
    const event = card({
      id: 'a',
      start_time: '2026-08-17T20:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).not.toContain('time_fit');
  });

  it('treats 18:00 UTC on 2026-08-17 as EVENING (20:00 Stockholm CEST)', () => {
    const event = card({
      id: 'a',
      start_time: '2026-08-17T18:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).toContain('time_fit');
  });

  it('treats 13:00 UTC on 2026-08-17 as AFTERNOON (15:00 Stockholm), not evening', () => {
    // 13:00 UTC = 15:00 Stockholm (CEST). Bucket = afternoon [12, 17).
    // For an evening intent, this event must NOT match — proves the ranker
    // isn't blindly stamping 'time_fit' on the afternoon→evening boundary.
    const event = card({
      id: 'a',
      start_time: '2026-08-17T13:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).not.toContain('time_fit');
  });

  it('treats 23:00 UTC on 2026-08-17 as NIGHT (01:00 Stockholm next-day), not evening', () => {
    // 23:00 UTC = 01:00 Stockholm on 08-18. Bucket = night.
    const event = card({
      id: 'a',
      start_time: '2026-08-17T23:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).not.toContain('time_fit');
  });

  it('handles winter CET (UTC+1): 21:00 UTC = 22:00 Stockholm = NIGHT, not evening', () => {
    // 2026-01-15 is winter — Stockholm is on CET (+1), not CEST (+2).
    // 21:00 UTC = 22:00 Stockholm. Evening bucket is hour ∈ [17, 22).
    // hour=22 falls outside the bucket — must NOT match.
    const event = card({
      id: 'a',
      start_time: '2026-01-15T21:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).not.toContain('time_fit');
  });

  it('handles DST correctly — same UTC instant lands on different Stockholm hours by season', () => {
    // 14:00 UTC on 2026-03-29 (post spring-forward) = 16:00 Stockholm (CEST +2)
    // 14:00 UTC on 2026-10-25 (pre fall-back)        = 15:00 Stockholm (CET  +1)
    // Both must bucket as afternoon (hour ∈ [12, 17)) — proves the helper
    // does NOT use a naive fixed offset and instead defers to Intl, which
    // handles DST transparently.
    const spring = card({ id: 's', start_time: '2026-03-29T14:00:00Z', category_slug: 'music' });
    const fall   = card({ id: 'f', start_time: '2026-10-25T14:00:00Z', category_slug: 'music' });
    expect(
      rankEvents([spring], { ...baseIntent, time_of_day: 'afternoon' }, { now: NOW })[0].reasons
    ).toContain('time_fit');
    expect(
      rankEvents([fall],   { ...baseIntent, time_of_day: 'afternoon' }, { now: NOW })[0].reasons
    ).toContain('time_fit');
  });

  it('uses Europe/Stockholm by default (default-export contract)', () => {
    // The same discriminating case (20:00 UTC = night in Stockholm, evening
    // in UTC) pins the default to Europe/Stockholm — failing this would mean
    // someone silently changed the default and shipped the bug back.
    expect(DEFAULT_TIME_ZONE).toBe('Europe/Stockholm');
    const event = card({
      id: 'a',
      start_time: '2026-08-17T20:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents([event], { ...baseIntent, time_of_day: 'evening' }, { now: NOW });
    expect(ranked[0].reasons).not.toContain('time_fit');
  });

  it('honours RankOptions.timeZone override (UTC pinned test path)', () => {
    // With timeZone='UTC', the same 20:00 UTC IS at hour 20 in UTC = evening.
    // This proves the option actually flows through, not just defaults.
    const event = card({
      id: 'a',
      start_time: '2026-08-17T20:00:00Z',
      category_slug: 'music',
    });
    const ranked = rankEvents(
      [event],
      { ...baseIntent, time_of_day: 'evening' },
      { now: NOW, timeZone: 'UTC' }
    );
    expect(ranked[0].reasons).toContain('time_fit');
  });
});

describe('hourInTimeZone (helper)', () => {
  it('returns Stockholm wall-clock hour from a UTC ISO in summer (CEST +2)', () => {
    expect(hourInTimeZone('2026-08-17T18:00:00Z', 'Europe/Stockholm')).toBe(20);
    expect(hourInTimeZone('2026-08-17T20:00:00Z', 'Europe/Stockholm')).toBe(22);
    expect(hourInTimeZone('2026-08-17T17:00:00Z', 'Europe/Stockholm')).toBe(19);
  });

  it('returns Stockholm wall-clock hour from a UTC ISO in winter (CET +1)', () => {
    expect(hourInTimeZone('2026-01-15T18:00:00Z', 'Europe/Stockholm')).toBe(19);
    expect(hourInTimeZone('2026-01-15T21:00:00Z', 'Europe/Stockholm')).toBe(22);
  });

  it('returns 0 (not "24") for midnight — robust against locale quirks', () => {
    // 2026-06-15T22:00:00Z = 00:00 Stockholm on 06-16. Some Intl implementations
    // yield "24" for midnight in certain locale combinations; the helper
    // normalizes that to 0 to keep rank_events purely numeric. Pin the
    // contract across a few minutes around midnight so any future change
    // that lets a non-zero value leak into rank_events arithmetic is caught.
    const minutes = [0, 15, 30, 45];
    for (const m of minutes) {
      const iso = `2026-06-15T22:${String(m).padStart(2, '0')}:00Z`;
      expect(hourInTimeZone(iso, 'Europe/Stockholm')).toBe(0);
    }
  });
});
