/**
 * confidence_v1 unit tests.
 *
 * Covers each scoring component, the structured-source boost, the 7-day
 * freshness window edge, and the [0,100] clamp. Inputs are synthetic —
 * no production data.
 */

import { describe, it, expect } from 'vitest';
import {
  computeConfidenceV1,
  STRUCTURED_SOURCES,
  CONFIDENCE_V1_MAX,
} from './confidence_v1';

const FIXED_NOW = new Date('2026-08-19T12:00:00.000Z');
const FUTURE_ISO = '2026-09-12T19:00:00.000Z'; // ~24d ahead
const PAST_ISO   = '2026-01-01T12:00:00.000Z';
const FRESH_ISO  = '2026-08-18T12:00:00.000Z'; // 1 day ago
const STALE_ISO  = '2025-01-01T12:00:00.000Z'; // > 7d ago

describe('computeConfidenceV1', () => {
  it('returns 100 for a fully-populated Ticketmaster event', () => {
    const score = computeConfidenceV1({
      venue_id: '00000000-0000-0000-0000-000000000001',
      start_time: FUTURE_ISO,
      price_min_sek: 250,
      price_max_sek: 400,
      is_free: false,
      image_url: 'https://cdn.example.se/x.jpg',
      freshness_at: FRESH_ISO,
      source: 'ticketmaster',
      now: FIXED_NOW,
    });
    // 20 (venue) + 20 (future) + 15 (price) + 10 (image) + 15 (fresh) + 20 (structured)
    expect(score).toBe(CONFIDENCE_V1_MAX);
  });

  it('returns 0 for an empty/past event', () => {
    expect(
      computeConfidenceV1({
        venue_id: null,
        start_time: PAST_ISO,
        price_min_sek: null,
        price_max_sek: null,
        is_free: null,
        image_url: null,
        freshness_at: null,
        source: 'unknown-source',
        now: FIXED_NOW,
      })
    ).toBe(0);
  });

  it('is_free alone contributes the price component', () => {
    const score = computeConfidenceV1({
      venue_id: null,
      start_time: FUTURE_ISO,
      price_min_sek: null,
      price_max_sek: null,
      is_free: true,
      image_url: null,
      freshness_at: null,
      source: 'unknown',
      now: FIXED_NOW,
    });
    // +20 future + 15 is_free
    expect(score).toBe(35);
  });

  it('rejects stale freshness (>7d) without adding the +15 component', () => {
    const score = computeConfidenceV1({
      venue_id: null,
      start_time: FUTURE_ISO,
      price_min_sek: null,
      price_max_sek: null,
      is_free: null,
      image_url: null,
      freshness_at: STALE_ISO,
      source: 'unknown',
      now: FIXED_NOW,
    });
    expect(score).toBe(20); // only +20 future
  });

  it('structured source list matches SQL migration', () => {
    // Mirrors 20260818-0002-confidence-v1.sql — if these diverge, ranking
    // will silently disagree between SQL backfill and TS scorer.
    expect([...STRUCTURED_SOURCES].sort()).toEqual(
      ['berwaldhallen-tixly', 'dramaten', 'eventbrite', 'konserthuset', 'ticketmaster'].sort()
    );
  });

  it('clamps to [0, 100] when score would exceed max', () => {
    // All 6 components → 100. Verify ceiling.
    const score = computeConfidenceV1({
      venue_id: 'v',
      start_time: FUTURE_ISO,
      price_min_sek: 1,
      price_max_sek: 1,
      is_free: true,
      image_url: 'img',
      freshness_at: FRESH_ISO,
      source: 'ticketmaster',
      now: FIXED_NOW,
    });
    expect(score).toBeLessThanOrEqual(CONFIDENCE_V1_MAX);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});