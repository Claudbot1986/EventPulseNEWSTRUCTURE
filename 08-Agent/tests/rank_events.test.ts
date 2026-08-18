/**
 * Tests for rankEvents — deterministic ranker.
 *
 * Run with:  npx vitest run 08-Agent/tests
 */

import { describe, expect, it } from 'vitest';
import { rankEvents, RANK_WEIGHTS } from '../tools/rank_events';
import type { EventCard, IntentBrief } from '../types';

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
