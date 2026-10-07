/**
 * Tests for rawDescriptionRetention — T0201 (2026-10-05).
 *
 * User contract:
 *   - license = 'unknown' → ALLTID capture (vi vet inte vad den innehåller)
 *   - license known + rik fakta (>=5 fält) → INTE capture
 *   - license known + tunn fakta (<5 fält) → capture (för reprocessing)
 *   - Retention worker rensar rader äldre än 30 dagar
 *
 * Run: npx vitest run 04-Normalizer/rawDescriptionRetention.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  shouldCaptureRawDescription,
  countFilledFacts,
  retentionCutoff,
  retentionSelectionSpec,
  __test__,
} from './rawDescriptionRetention';

const { MIN_FILLED_FOR_DISCARD } = __test__;

describe('shouldCaptureRawDescription', () => {
  it('captures raw_description when license is "unknown"', () => {
    const r = shouldCaptureRawDescription({ license: 'unknown', filledFactCount: 16 });
    expect(r.capture).toBe(true);
    expect(r.reason).toBe('unknown-license-reprocess');
  });

  it('does NOT capture when license is known and facts are rich', () => {
    const r = shouldCaptureRawDescription({
      license: 'pressbild',
      filledFactCount: MIN_FILLED_FOR_DISCARD,
    });
    expect(r.capture).toBe(false);
    expect(r.reason).toBe('license-known-rich-facts');
  });

  it('captures when license is known but facts are thin (< 5 fält)', () => {
    const r = shouldCaptureRawDescription({
      license: 'pressbild',
      filledFactCount: 2,
    });
    expect(r.capture).toBe(true);
    expect(r.reason).toBe('thin-facts-needs-reprocessing');
  });

  it('handles edge case: license known + facts EXACTLY at threshold', () => {
    // MIN_FILLED_FOR_DISCARD = 5; threshold är strikt mindre än → vid 5 fångar vi INTE
    const r = shouldCaptureRawDescription({
      license: 'pressbild',
      filledFactCount: MIN_FILLED_FOR_DISCARD,
    });
    expect(r.capture).toBe(false);
  });
});

describe('countFilledFacts', () => {
  it('counts non-null, non-undefined, non-empty-string values', () => {
    expect(countFilledFacts({
      a: 'x',
      b: 0,
      c: null,
      d: undefined,
      e: '',
      f: 'real value',
      g: false,  // false är truthy i object values
    })).toBe(4);  // a, b, f, g
  });

  it('returns 0 for empty object', () => {
    expect(countFilledFacts({})).toBe(0);
  });

  it('handles full EventpulseFacts object', () => {
    const full = {
      event_type: 'concert',
      artist: 'X',
      support_act: null,
      venue: 'Y',
      city: 'Z',
      date: '2026-11-14',
      start_time: '19:30',
      end_time: null,
      doors_time: '18:30',
      age_limit: null,
      language: 'sv',
      is_free: false,
      price_min_sek: 450,
      price_max_sek: 650,
      accessibility: null,
      organizer: null,
    };
    expect(countFilledFacts(full)).toBe(11);  // 11 icke-null fält (is_free=false räknas som fylld)
  });
});

describe('retentionCutoff', () => {
  it('returns 30 days ago by default', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const cutoff = retentionCutoff(now);
    const expected = new Date('2026-10-02T12:00:00Z');
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });

  it('respects custom retentionDays', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(retentionCutoff(now, 7).toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(retentionCutoff(now, 90).toISOString()).toBe('2026-08-03T12:00:00.000Z');
  });

  it('uses current date when no argument given', () => {
    const before = Date.now();
    const cutoff = retentionCutoff();
    const after = Date.now();
    // cutoff bör vara 30 dagar bakåt från nu
    const cutoffMs = cutoff.getTime();
    expect(cutoffMs).toBeLessThan(before);  // strikt mindre
    expect(cutoffMs).toBeGreaterThan(after - 31 * 24 * 60 * 60 * 1000);
  });
});

describe('retentionSelectionSpec', () => {
  it('produces correct Supabase query spec', () => {
    const cutoff = new Date('2026-10-01T00:00:00Z');
    const spec = retentionSelectionSpec({ cutoff, limit: 500 });
    expect(spec.table).toBe('events');
    expect(spec.select).toBe('id, raw_description_captured_at');
    expect(spec.where.raw_description).toEqual({ not: null });
    expect(spec.where.raw_description_captured_at).toEqual({ lt: '2026-10-01T00:00:00.000Z' });
    expect(spec.limit).toBe(500);
  });

  it('defaults limit to 1000', () => {
    const spec = retentionSelectionSpec({ cutoff: new Date() });
    expect(spec.limit).toBe(1000);
  });
});