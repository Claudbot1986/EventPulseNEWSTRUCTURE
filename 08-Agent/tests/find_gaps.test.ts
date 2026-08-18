/**
 * Tests for find_gaps — cold-start question generation.
 *
 * Pure unit tests; no live Supabase or Anthropic calls.
 */

import { describe, expect, it } from 'vitest';
import { findGaps, isIntentComplete } from '../tools/find_gaps';
import type { IntentBrief } from '../types';

function makeIntent(over: Partial<IntentBrief> = {}): IntentBrief {
  return {
    raw_query: 'konsert ikväll solo',
    time_of_day: 'evening',
    budget: 'any',
    party: 'solo',
    categories: ['music'],
    city: 'Stockholm',
    language: 'sv',
    date_from: '2026-08-18',
    date_to: '2026-08-18',
    exclude_categories: [],
    ...over,
  };
}

describe('findGaps', () => {
  it('returns empty when every critical slot is filled (sv)', () => {
    const gaps = findGaps(makeIntent());
    expect(gaps).toEqual([]);
  });

  it('asks for category when categories is empty', () => {
    const gaps = findGaps(
      makeIntent({ categories: [], raw_query: 'något ikväll solo' })
    );
    expect(gaps.map((g) => g.id)).toContain('category');
    const cat = gaps.find((g) => g.id === 'category')!;
    expect(cat.text).toMatch(/Vad för typ/);
    expect(cat.options.length).toBeGreaterThan(0);
    expect(cat.options[0]).toHaveProperty('label');
    expect(cat.options[0]).toHaveProperty('value');
  });

  it('asks for time_of_day when anytime', () => {
    const gaps = findGaps(
      makeIntent({ time_of_day: 'anytime', raw_query: 'konsert solo' })
    );
    expect(gaps.map((g) => g.id)).toContain('time_of_day');
    const tod = gaps.find((g) => g.id === 'time_of_day')!;
    expect(tod.text).toMatch(/När/);
  });

  it('asks for party when any', () => {
    const gaps = findGaps(
      makeIntent({ party: 'any', raw_query: 'konsert ikväll' })
    );
    expect(gaps.map((g) => g.id)).toContain('party');
    const p = gaps.find((g) => g.id === 'party')!;
    expect(p.text).toMatch(/Vem/);
  });

  it('caps to MAX_QUESTIONS=3', () => {
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(gaps.length).toBeLessThanOrEqual(3);
  });

  it('returns English text when language is en', () => {
    const gaps = findGaps(
      makeIntent({
        language: 'en',
        categories: [],
        raw_query: 'something tonight',
      })
    );
    const cat = gaps.find((g) => g.id === 'category')!;
    expect(cat.text).toMatch(/What kind of event/);
  });

  it('prioritises category over time_of_day over party', () => {
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(gaps.map((g) => g.id)).toEqual(['category', 'time_of_day', 'party']);
  });

  it('option values are regex triggers that parse_intent can match', () => {
    // This is the anti-noise guarantee: when a user taps a chip, the value
    // they send must be parsed back into the same IntentBrief slot.
    const gaps = findGaps(makeIntent({ categories: [], party: 'any', raw_query: '' }));
    const categoryValues = gaps.find((g) => g.id === 'category')!.options.map((o) => o.value);
    // 'konsert' and 'familj' are explicit parse_intent regex keywords.
    expect(categoryValues).toContain('konsert');
    expect(categoryValues).toContain('familj');

    const partyValues = gaps.find((g) => g.id === 'party')!.options.map((o) => o.value);
    expect(partyValues).toContain('solo');
    expect(partyValues).toContain('familj');
  });
});

describe('isIntentComplete', () => {
  it('true when no gaps', () => {
    expect(isIntentComplete(makeIntent())).toBe(true);
  });

  it('false when category missing', () => {
    expect(
      isIntentComplete(makeIntent({ categories: [] }))
    ).toBe(false);
  });

  it('false when time_of_day is anytime', () => {
    expect(
      isIntentComplete(makeIntent({ time_of_day: 'anytime' }))
    ).toBe(false);
  });

  it('false when party is any', () => {
    expect(
      isIntentComplete(makeIntent({ party: 'any' }))
    ).toBe(false);
  });
});
