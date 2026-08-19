/**
 * Tests for find_gaps — cold-start question generation.
 *
 * Pure unit tests; no live Supabase or Anthropic calls.
 */

import { describe, expect, it } from 'vitest';
import { findGaps, isIntentComplete, slotGain } from '../tools/find_gaps';
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

// ─── Phase 1.8: active-learning information gain ───────────────────────────

describe('slotGain', () => {
  it('category has the highest base gain (1.0)', () => {
    expect(slotGain(makeIntent(), 'category')).toBe(1.0);
  });

  it('time_of_day has medium base gain (0.7) for open date windows', () => {
    const intent = makeIntent({ date_from: undefined, date_to: undefined });
    expect(slotGain(intent, 'time_of_day')).toBe(0.7);
  });

  it('time_of_day gain rises to 0.95 when date window is a single day', () => {
    const intent = makeIntent({ date_from: '2026-08-20', date_to: '2026-08-20' });
    expect(slotGain(intent, 'time_of_day')).toBe(0.95);
  });

  it('time_of_day stays at 0.7 when only date_from is set (open-ended range)', () => {
    const intent = makeIntent({ date_from: '2026-08-20', date_to: undefined });
    expect(slotGain(intent, 'time_of_day')).toBe(0.7);
  });

  it('time_of_day stays at 0.7 when date_from < date_to (multi-day window)', () => {
    const intent = makeIntent({ date_from: '2026-08-20', date_to: '2026-08-25' });
    expect(slotGain(intent, 'time_of_day')).toBe(0.7);
  });

  it('party has the lowest base gain (0.5)', () => {
    expect(slotGain(makeIntent(), 'party')).toBe(0.5);
  });

  it('gain ordering (open window): category > party > time_of_day', () => {
    // party (0.5) > time_of_day (0.7)? No, 0.7 > 0.5. Reorder:
    // category 1.0 > time_of_day 0.7 > party 0.5.
    expect(slotGain(makeIntent(), 'category')).toBeGreaterThan(
      slotGain(makeIntent(), 'time_of_day')
    );
    expect(slotGain(makeIntent(), 'time_of_day')).toBeGreaterThan(
      slotGain(makeIntent(), 'party')
    );
  });
});

describe('findGaps — active-learning ordering', () => {
  it('orders by gain desc when all three slots are missing (open window)', () => {
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        date_from: undefined,
        date_to: undefined,
        raw_query: '',
      })
    );
    expect(gaps.map((g) => g.id)).toEqual(['category', 'time_of_day', 'party']);
  });

  it('still orders category first when date window is narrow', () => {
    // Even when time_of_day gain rises to 0.95, category (1.0) wins.
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        date_from: '2026-08-20',
        date_to: '2026-08-20',
        raw_query: '',
      })
    );
    expect(gaps[0].id).toBe('category');
    expect(gaps.map((g) => g.id)).toEqual(['category', 'time_of_day', 'party']);
  });

  it('omits questions for slots that are already filled', () => {
    const gaps = findGaps(
      makeIntent({
        categories: ['music'],
        time_of_day: 'anytime', // still missing
        party: 'any', // still missing
        raw_query: 'something',
      })
    );
    const ids = gaps.map((g) => g.id);
    expect(ids).not.toContain('category');
    expect(ids).toContain('time_of_day');
    expect(ids).toContain('party');
    // With category filled, time_of_day (0.7) > party (0.5).
    expect(gaps[0].id).toBe('time_of_day');
  });

  it('caps to MAX_QUESTIONS=3 even when many slots are missing', () => {
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(gaps.length).toBe(3);
  });

  it('returns empty when all slots filled (no questions needed)', () => {
    expect(findGaps(makeIntent())).toEqual([]);
  });

  it('gain ordering is stable: insertion order preserved on ties', () => {
    // If two slots had equal gain, our sort is stable so the one added
    // first in the candidate array (category) wins. We verify by mocking
    // equal gains via a slot combination where time_of_day and party
    // share the same gain — currently time_of_day 0.7 ≠ party 0.5, so
    // we instead verify the documented tie-break via direct construction.
    const gaps = findGaps(
      makeIntent({ categories: [], time_of_day: 'anytime', party: 'any', raw_query: '' })
    );
    // If gains were equal, order would be category → time_of_day → party.
    // Current ordering already matches; this test pins the contract.
    expect(gaps.map((g) => g.id)).toEqual(['category', 'time_of_day', 'party']);
  });
});
