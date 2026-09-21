/**
 * Pins the rank-reason → chip mapping (utils/rankReasonLabels.js) and the
 * consumer filter (2026-09-21): ops/data-quality reasons like 'stale'
 * ("Gammal data") must never render on consumer home cards — they leak
 * internal ranking state and read terribly. The full set stays available
 * for the agent "why" surface (AgentScreen ReasonChips).
 *
 * Run:  npx vitest run 06-UI/utils/rankReasonLabels.test.ts
 */

import { describe, it, expect } from 'vitest';

import { resolveReasons, resolveConsumerReasons } from './rankReasonLabels';

describe('resolveReasons — full set (agent explain surface)', () => {
  it('resolves known reasons with icon + sv labels', () => {
    const out = resolveReasons(['not_ended', 'stale'], 'sv');
    expect(out).toEqual([
      { key: 'not_ended', icon: '✅', label: 'Inte avslutad', fullLabel: expect.any(String) },
      { key: 'stale', icon: '🕰️', label: 'Gammal data', fullLabel: expect.any(String) },
    ]);
  });

  it('drops unknown enum values instead of guessing', () => {
    expect(resolveReasons(['stale', 'bogus_reason'], 'sv').map((r) => r?.key)).toEqual(['stale']);
    expect(resolveReasons(null)).toEqual([]);
    expect(resolveReasons(undefined)).toEqual([]);
  });
});

describe('resolveConsumerReasons — home cards must never show data-quality flags', () => {
  it('filters stale / low_confidence / exclude_match / over_budget / venue penalty', () => {
    const out = resolveConsumerReasons(
      ['not_ended', 'stale', 'low_confidence', 'time_fit', 'exclude_match', 'over_budget', 'venue_personalization_penalty'],
      'sv',
    );
    expect(out.map((r) => r?.key)).toEqual(['not_ended', 'time_fit']);
  });

  it('keeps positive/affirmative reasons incl. personalization, in server order', () => {
    const out = resolveConsumerReasons(
      ['followed_venue', 'category_match', 'stale', 'high_confidence', 'category_personalization', 'under_budget'],
      'sv',
    );
    expect(out.map((r) => r?.key)).toEqual([
      'followed_venue', 'category_match', 'high_confidence', 'category_personalization', 'under_budget',
    ]);
  });

  it('a card whose only reasons are negative renders NO chips', () => {
    expect(resolveConsumerReasons(['stale'], 'sv')).toEqual([]);
    expect(resolveConsumerReasons(['low_confidence'], 'sv')).toEqual([]);
  });

  it('handles garbage input like resolveReasons', () => {
    expect(resolveConsumerReasons(null)).toEqual([]);
    expect(resolveConsumerReasons([null, 'stale', 'not_ended']).map((r) => r?.key)).toEqual(['not_ended']);
  });
});
