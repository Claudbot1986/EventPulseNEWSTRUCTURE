/**
 * Tests for the MMR diversity post-ranker.
 *
 * Covers: empty input, single item, λ=1 (relevance-only), λ=0
 * (diversity-only), guardrail (skipWhenDiverse), determinism,
 * similarity function contract.
 *
 * Run with:  npx vitest run 08-Agent/tests/diversify.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  mmrRerank,
  eventSimilarity,
  daypartOf,
  priceTier,
  DEFAULT_LAMBDA,
} from '../tools/diversify';
import type { RankedEvent, EventCard } from '../types';

function mkCard(over: Partial<EventCard> & { id: string; start_time: string }): EventCard {
  return {
    id: over.id,
    title: over.title ?? over.id,
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

function mkRanked(card: EventCard, score: number): RankedEvent {
  return { card, score, reasons: [] };
}

const musicA = mkCard({ id: 'mA', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
const musicB = mkCard({ id: 'mB', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
const musicC = mkCard({ id: 'mC', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
const musicD = mkCard({ id: 'mD', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });
const musicE = mkCard({ id: 'mE', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'Konserthuset' });

const theater = mkCard({ id: 't1', start_time: '2026-08-17T20:00:00Z', category_slug: 'theater', venue_name: 'Dramaten',     is_free: false, price_min_sek: 250 });
const art     = mkCard({ id: 'a1', start_time: '2026-08-17T20:00:00Z', category_slug: 'art',     venue_name: 'Moderna',      is_free: true });
const dance   = mkCard({ id: 'd1', start_time: '2026-08-17T20:00:00Z', category_slug: 'dance',   venue_name: 'Operan',       is_free: false, price_min_sek: 180 });
const film    = mkCard({ id: 'f1', start_time: '2026-08-17T20:00:00Z', category_slug: 'film',    venue_name: 'Skandia',      is_free: false, price_min_sek: 120 });

describe('daypartOf', () => {
  it('buckets correctly across 24h', () => {
    expect(daypartOf('2026-08-17T07:00:00Z')).toBe('morning');
    expect(daypartOf('2026-08-17T14:00:00Z')).toBe('afternoon');
    expect(daypartOf('2026-08-17T20:00:00Z')).toBe('evening');
    expect(daypartOf('2026-08-17T23:00:00Z')).toBe('night');
    expect(daypartOf('2026-08-17T03:00:00Z')).toBe('night');
  });
});

describe('priceTier', () => {
  it('puts free events in free tier', () => {
    expect(priceTier(true, null)).toBe('free');
  });
  it('buckets paid events by min price', () => {
    expect(priceTier(false, 100)).toBe('low');
    expect(priceTier(false, 200)).toBe('medium');
    expect(priceTier(false, 500)).toBe('high');
  });
  it('handles null min as 0', () => {
    expect(priceTier(false, null)).toBe('low');
  });
});

describe('eventSimilarity', () => {
  it('returns high similarity for same category+venue+daypart+price', () => {
    const s = eventSimilarity(mkRanked(musicA, 10), mkRanked(musicB, 10));
    expect(s).toBeGreaterThan(0.5);
  });

  it('returns low similarity for different category and venue', () => {
    const s = eventSimilarity(mkRanked(musicA, 10), mkRanked(theater, 10));
    expect(s).toBeLessThan(0.5);
  });

  it('is symmetric', () => {
    const a = mkRanked(musicA, 10);
    const b = mkRanked(theater, 10);
    expect(eventSimilarity(a, b)).toBeCloseTo(eventSimilarity(b, a), 6);
  });
});

describe('mmrRerank', () => {
  it('returns [] for empty input', () => {
    expect(mmrRerank([])).toEqual([]);
  });

  it('returns the single item when input has one', () => {
    const out = mmrRerank([mkRanked(musicA, 10)]);
    expect(out).toHaveLength(1);
    expect(out[0].card.id).toBe('mA');
  });

  it('preserves relevance order when λ=1 (pure relevance)', () => {
    const ranked = [musicA, musicB, theater, art, musicC, dance, film].map((c, i) =>
      mkRanked(c, 100 - i * 10)
    );
    const out = mmrRerank(ranked, { lambda: 1.0, topN: 5 });
    expect(out.map((r) => r.card.id)).toEqual(['mA', 'mB', 't1', 'a1', 'mC']);
  });

  it('handles 5 identical music events at λ=0 (diversity-only)', () => {
    const ranked = [musicA, musicB, musicC, musicD, musicE].map((c, i) =>
      mkRanked(c, 100 - i)
    );
    const out = mmrRerank(ranked, { lambda: 0, topN: 3, skipWhenDiverse: false });
    expect(out).toHaveLength(3);
  });

  it('returns a more diverse set than the input when guardrail is bypassed', () => {
    const ranked = [musicA, musicB, musicC, musicD, musicE, theater, art].map((c, i) =>
      mkRanked(c, 100 - i)
    );
    const out = mmrRerank(ranked, { lambda: DEFAULT_LAMBDA, topN: 5, skipWhenDiverse: false });
    const pairs = new Set(out.map((r) => `${r.card.category_slug}|${r.card.venue_name}`));
    expect(pairs.size).toBeGreaterThan(1);
  });

  it('keeps the highest-scoring item as position 1', () => {
    const ranked = [musicA, musicB, theater, art, musicC, dance, film].map((c, i) =>
      mkRanked(c, 100 - i * 10)
    );
    const out = mmrRerank(ranked, { lambda: 0.5, topN: 5 });
    expect(out[0].card.id).toBe('mA');
  });

  it('skipWhenDiverse guardrail returns input unchanged when already diverse', () => {
    const c1 = mkCard({ id: 'c1', start_time: '2026-08-17T20:00:00Z', category_slug: 'music',   venue_name: 'V1' });
    const c2 = mkCard({ id: 'c2', start_time: '2026-08-17T20:00:00Z', category_slug: 'theater', venue_name: 'V2' });
    const c3 = mkCard({ id: 'c3', start_time: '2026-08-17T20:00:00Z', category_slug: 'art',     venue_name: 'V3' });
    const c4 = mkCard({ id: 'c4', start_time: '2026-08-17T20:00:00Z', category_slug: 'dance',   venue_name: 'V4' });
    const c5 = mkCard({ id: 'c5', start_time: '2026-08-17T20:00:00Z', category_slug: 'film',    venue_name: 'V5' });
    const ranked = [c1, c2, c3, c4, c5].map((c, i) => mkRanked(c, 100 - i));
    const out = mmrRerank(ranked, { lambda: 0.3, topN: 5 });
    expect(out.map((r) => r.card.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('is deterministic across calls (same input → same output)', () => {
    const ranked = [musicA, musicB, theater, art, musicC, dance, film].map((c, i) =>
      mkRanked(c, 100 - i * 10)
    );
    const out1 = mmrRerank(ranked, { lambda: DEFAULT_LAMBDA, topN: 5, skipWhenDiverse: false });
    const out2 = mmrRerank(ranked, { lambda: DEFAULT_LAMBDA, topN: 5, skipWhenDiverse: false });
    expect(out1.map((r) => r.card.id)).toEqual(out2.map((r) => r.card.id));
  });

  it('handles fewer input items than topN gracefully', () => {
    const ranked = [musicA, theater].map((c, i) => mkRanked(c, 100 - i));
    const out = mmrRerank(ranked, { topN: 5, skipWhenDiverse: false });
    expect(out).toHaveLength(2);
  });

  it('handles all-equal scores (min-max range = 0)', () => {
    const ranked = [musicA, theater, art, dance, film].map((c) => mkRanked(c, 50));
    const out = mmrRerank(ranked, { topN: 5, skipWhenDiverse: false });
    expect(out).toHaveLength(5);
  });
});
