/**
 * Table-driven proof that EVERY Home chip resolves to the exact Utforska
 * intent its text promises (2026-09-20 — the user's "varenda knapp" demand).
 *
 * The chip universe (curated CATALOG + every suggested-prompt template +
 * negative non-chips) lives in chipCatalog.testkit.ts and statically mirrors
 * 08-Agent/tools/curated_collections.ts and get_suggested_prompts.ts.
 *
 * Run:  npx vitest run 06-UI/utils/promptIntent.test.ts
 */

import { describe, it, expect } from 'vitest';

import { resolvePromptIntent, intentHasFilters } from './promptIntent';
import {
  ALL_CHIP_CASES,
  CURATED_CHIPS,
  SUGGESTED_CHIPS,
  NON_CHIPS,
  type ChipCase,
} from './chipCatalog.testkit';

function resolveChip(chip: ChipCase) {
  return resolvePromptIntent({ text: chip.text, ...(chip.hints || {}) });
}

describe('resolvePromptIntent — every curated chip (sv + en)', () => {
  for (const chip of CURATED_CHIPS) {
    it(`${chip.id} → ${JSON.stringify(chip.expected)}`, () => {
      expect(resolveChip(chip)).toEqual(chip.expected);
    });
  }
});

describe('resolvePromptIntent — every suggested-prompt template', () => {
  for (const chip of SUGGESTED_CHIPS) {
    it(`${chip.id} → ${JSON.stringify(chip.expected)}`, () => {
      expect(resolveChip(chip)).toEqual(chip.expected);
    });
  }
});

describe('resolvePromptIntent — non-chips must NOT filter (no false intent)', () => {
  for (const chip of NON_CHIPS) {
    it(`${chip.id} → ${JSON.stringify(chip.expected)}`, () => {
      expect(resolveChip(chip)).toEqual(chip.expected);
    });
  }
});

describe('resolvePromptIntent — general rules', () => {
  it('structured hints win over a misleading text', () => {
    // Text mentions nothing about Saturday, but the server pinned it.
    const intent = resolvePromptIntent({
      text: 'Gratis i stan?',
      budget: 'free',
      day_filter: 'saturday',
    });
    expect(intent.pinnedDow).toBe(6);
    expect(intent.priceFilter).toBe('free');
    expect(intent.anchor).toBe('pinned');
  });

  it('accepts camelCase hint keys too (wire robustness)', () => {
    const intent = resolvePromptIntent({
      text: 'whatever',
      categorySlug: 'art',
      dayFilter: 'weekend',
      timeOfDay: 'evening',
    });
    expect(intent.categories).toEqual(['culture']);
    expect(intent.timeFilter).toBe('helgen'); // day_filter wins over time_of_day
    expect(intent.anchor).toBe('weekend');
  });

  it('genre beats category: slug music + jazz text → queryTerms, not categories', () => {
    const intent = resolvePromptIntent({ text: 'JAZZ ikväll?', category_slug: 'music' });
    expect(intent.queryTerms).toEqual(['jazz']);
    expect(intent.categories).toBeNull();
  });

  it('time_of_day evening yields ikvall when the text carries no day hint', () => {
    const intent = resolvePromptIntent({ text: 'Livsmedel?', time_of_day: 'evening' });
    expect(intent.timeFilter).toBe('ikvall');
    expect(intent.anchor).toBe('today');
  });

  it('morning time_of_day alone does NOT set a time filter', () => {
    const intent = resolvePromptIntent({ text: 'xyzzy', time_of_day: 'morning' });
    expect(intent.timeFilter).toBeNull();
    expect(intent.anchor).toBeNull(); // no intent at all
  });

  it('day_filter today maps to the ikvall filter', () => {
    const intent = resolvePromptIntent({ text: 'xyzzy', day_filter: 'today' });
    expect(intent.timeFilter).toBe('ikvall');
    expect(intent.anchor).toBe('today');
  });

  it('handles garbage input without crashing', () => {
    expect(resolvePromptIntent(null as unknown as object)).toEqual({
      timeFilter: null, pinnedDow: null, priceFilter: null,
      categories: null, queryTerms: null, queryLabel: null, anchor: null,
    });
    expect(resolvePromptIntent({ text: 42 }).anchor).toBeNull();
    expect(resolvePromptIntent({ text: '' }).anchor).toBeNull();
  });
});

describe('intentHasFilters', () => {
  it('false for null / empty / anchor-only intents', () => {
    expect(intentHasFilters(null)).toBe(false);
    expect(intentHasFilters(resolvePromptIntent({ text: 'Visa allt' }))).toBe(false);
  });

  it('true when any filter field is set', () => {
    expect(intentHasFilters(resolvePromptIntent({ text: 'Gratis?' }))).toBe(true);
    expect(intentHasFilters(resolvePromptIntent({ text: 'xyzzy', category: 'konserter' }))).toBe(true);
    expect(intentHasFilters(resolvePromptIntent({ text: 'Jazz?' }))).toBe(true);
  });
});
