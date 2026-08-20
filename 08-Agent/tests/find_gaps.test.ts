/**
 * Tests for find_gaps — cold-start question generation.
 *
 * Pure unit tests; no live Supabase or Anthropic calls.
 *
 * Phase 1.8 contract (MASTERPLAN §18.2 — Workstream C):
 *   - The server ALWAYS runs search, never gates on a clarifying question.
 *   - `pickClarifyingQuestion` returns AT MOST one question — the single
 *     slot with the highest information gain — or null when the intent is
 *     complete enough to search as-is.
 *   - The legacy `findGaps` helper is preserved as a thin internal adapter
 *     used by the existing tests; it caps at MAX_QUESTIONS = 1.
 *   - `isIntentComplete` is no longer a hard gate. It is exposed as a soft
 *     "all critical slots filled" hint so other tools can use it without
 *     it ever blocking search.
 */

import { describe, expect, it } from 'vitest';
import {
  findGaps,
  isIntentComplete,
  pickClarifyingQuestion,
  slotGain,
} from '../tools/find_gaps';
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

describe('findGaps (legacy adapter — capped at MAX_QUESTIONS=1)', () => {
  it('returns empty when every critical slot is filled (sv)', () => {
    const gaps = findGaps(makeIntent());
    expect(gaps).toEqual([]);
  });

  it('returns at most one question (MAX_QUESTIONS=1)', () => {
    const gaps = findGaps(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(gaps.length).toBeLessThanOrEqual(1);
  });

  it('returns English text when language is en', () => {
    const gaps = findGaps(
      makeIntent({
        language: 'en',
        categories: [],
        raw_query: 'something tonight',
      })
    );
    expect(gaps[0]?.text).toMatch(/What kind of event/);
  });

  it('option values are regex triggers that parse_intent can match', () => {
    const gaps = findGaps(makeIntent({ categories: [], party: 'any', raw_query: '' }));
    const categoryValues = gaps.find((g: { id: string }) => g.id === 'category')?.options.map((o: { value: string }) => o.value) ?? [];
    expect(categoryValues).toContain('konsert');
    expect(categoryValues).toContain('familj');
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

  it('gain ordering (open window): category > time_of_day > party', () => {
    expect(slotGain(makeIntent(), 'category')).toBeGreaterThan(
      slotGain(makeIntent(), 'time_of_day')
    );
    expect(slotGain(makeIntent(), 'time_of_day')).toBeGreaterThan(
      slotGain(makeIntent(), 'party')
    );
  });
});

// ─── Phase 1.8: pickClarifyingQuestion (mixed-initiative orchestration) ────

describe('pickClarifyingQuestion', () => {
  it('returns null when the intent is complete enough to search as-is', () => {
    expect(pickClarifyingQuestion(makeIntent())).toBeNull();
  });

  it('returns a single question (never an array)', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(q).not.toBeNull();
    expect(Array.isArray(q)).toBe(false);
    expect(typeof q?.id).toBe('string');
  });

  it('asks for category when only category is missing', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: [],
        time_of_day: 'evening',
        party: 'solo',
        raw_query: 'något ikväll solo',
      })
    );
    expect(q?.id).toBe('category');
    expect(q?.text).toMatch(/Vad för typ/);
    expect(q?.options.length).toBeGreaterThan(0);
  });

  it('asks for time_of_day when only time_of_day is missing', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: ['music'],
        time_of_day: 'anytime',
        party: 'solo',
        raw_query: 'konsert solo',
      })
    );
    expect(q?.id).toBe('time_of_day');
    expect(q?.text).toMatch(/När/);
  });

  it('asks for party when only party is missing', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: ['music'],
        time_of_day: 'evening',
        party: 'any',
        raw_query: 'konsert ikväll',
      })
    );
    expect(q?.id).toBe('party');
    expect(q?.text).toMatch(/Vem/);
  });

  it('always returns the highest-gain slot when multiple are missing (category > others)', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(q?.id).toBe('category');
  });

  it('returns exactly one question even when many slots are missing', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: [],
        time_of_day: 'anytime',
        party: 'any',
        raw_query: '',
      })
    );
    expect(q).not.toBeNull();
    expect(q?.id).toBe('category');
    // Confirm only one by re-reading shape (no array).
    expect(Array.isArray(q)).toBe(false);
  });

  it('returns English copy when language is en', () => {
    const q = pickClarifyingQuestion(
      makeIntent({
        language: 'en',
        categories: [],
        raw_query: 'something tonight',
      })
    );
    expect(q?.text).toMatch(/What kind of event/);
  });

  it('option values are regex triggers parse_intent understands (sv)', () => {
    const q = pickClarifyingQuestion(
      makeIntent({ categories: [], party: 'any', raw_query: '' })
    );
    const values = q?.options.map((o: { value: string }) => o.value) ?? [];
    expect(values).toContain('konsert');
    expect(values).toContain('familj');
  });

  it('returns a party question with both solo and familj options', () => {
    const q = pickClarifyingQuestion(
      makeIntent({ categories: ['music'], time_of_day: 'evening', party: 'any', raw_query: '' })
    );
    expect(q?.id).toBe('party');
    const values = q?.options.map((o: { value: string }) => o.value) ?? [];
    expect(values).toContain('solo');
    expect(values).toContain('familj');
  });

  it('respects the same-day-window gain bump for time_of_day', () => {
    // Single-day window → time_of_day gain 0.95. With category filled and
    // party missing (0.5), time_of_day wins.
    const q = pickClarifyingQuestion(
      makeIntent({
        categories: ['music'],
        time_of_day: 'anytime',
        party: 'any',
        date_from: '2026-08-20',
        date_to: '2026-08-20',
        raw_query: 'konsert på fredag',
      })
    );
    expect(q?.id).toBe('time_of_day');
  });

  it('omits the question entirely when nothing is missing', () => {
    expect(pickClarifyingQuestion(makeIntent())).toBeNull();
  });
});