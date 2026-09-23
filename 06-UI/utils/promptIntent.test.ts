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
  const intent = resolvePromptIntent({ text: chip.text, ...(chip.hints || {}) });
  // Fas D (2026-09-23): intent gained a `mood` field (null for every catalog
  // chip — none carries a mood hint). The table entries pin the pre-mood
  // contract, so strip the null default; a chip WITH a mood hint compares
  // fully (and its entry must then pin mood explicitly).
  if (chip.hints?.mood) return intent;
  const { mood: _moodDefault, ...rest } = intent;
  return rest;
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
      categories: null, queryTerms: null, queryLabel: null,
      mood: null, anchor: null,
    });
    expect(resolvePromptIntent({ text: 42 }).anchor).toBeNull();
    expect(resolvePromptIntent({ text: '' }).anchor).toBeNull();
  });
});

describe('resolvePromptIntent — Utforska-tiles (smakordsknappar, 2026-09-21)', () => {
  // Tiles must do what their label promises. "Skratt" is an HONEST search
  // row (like jazz/metal), not a category: hard rock must never sneak into
  // a standup/komedi query (user demand 2026-09-21).
  it('Skratt-tile → standup/komedi search rows, no category leakage', () => {
    const intent = resolvePromptIntent({ text: 'Skratt — standup och komedi' });
    expect(intent.queryTerms).toEqual(['standup', 'komedi', 'comedy', 'skratt']);
    expect(intent.queryLabel).toBe('skratt');
    expect(intent.categories).toBeNull(); // genre suppresses categories
    expect(intent.anchor).toBe('today');
  });

  it('"hitta något roligt" must NOT trigger the skratt genre (no over-match)', () => {
    const intent = resolvePromptIntent({ text: 'Hitta något roligt' });
    expect(intent.queryTerms).toBeNull();
    expect(intent.categories).toBeNull();
    expect(intent.anchor).toBeNull();
  });

  it('Gratis-tile (budget hint) → free price filter, nothing else', () => {
    const intent = resolvePromptIntent({ text: 'Gratis evenemang', budget: 'free' });
    expect(intent.priceFilter).toBe('free');
    expect(intent.categories).toBeNull();
    expect(intent.anchor).toBe('today');
  });

  it('Live-tile (category_slug hint) → music category, text carries no category words', () => {
    const intent = resolvePromptIntent({ text: 'Live på scen', category_slug: 'music' });
    expect(intent.categories).toEqual(['music']);
    expect(intent.queryTerms).toBeNull();
  });

  // Helg/Imorgon tiles (2026-09-22): time tiles must do what their labels
  // promise — weekend window and tomorrow respectively, nothing else.
  it('Helg-tile (dayFilter hint) → weekend window, no other filters', () => {
    const intent = resolvePromptIntent({ text: 'Helgens evenemang', dayFilter: 'weekend' });
    expect(intent.timeFilter).toBe('helgen');
    expect(intent.anchor).toBe('weekend');
    expect(intent.priceFilter).toBeNull();
    expect(intent.categories).toBeNull();
    expect(intent.queryTerms).toBeNull();
  });

  it('Imorgon-tile → tomorrow time filter, no other filters', () => {
    const intent = resolvePromptIntent({ text: 'Imorgon' });
    expect(intent.timeFilter).toBe('imorgon');
    expect(intent.anchor).toBe('today');
    expect(intent.priceFilter).toBeNull();
    expect(intent.categories).toBeNull();
    expect(intent.queryTerms).toBeNull();
  });

  it('English tile prompts resolve identically (Weekend events / Tomorrow)', () => {
    expect(resolvePromptIntent({ text: 'Weekend events', dayFilter: 'weekend' }).anchor).toBe('weekend');
    expect(resolvePromptIntent({ text: 'Tomorrow' }).timeFilter).toBe('imorgon');
  });

  // Stämningsfullt-tile (Fas D, 2026-09-23): the tile finally does what its
  // label promises — a server-side mood filter (the static AI lexicon in
  // 08-Agent/tools/moods.ts), not a banner-only no-op. No other filter may
  // fire: the text is just the mood word.
  it('Stämningsfullt-tile (mood hint) → mood filter, no other filters, today anchor', () => {
    const intent = resolvePromptIntent({ text: 'Stämningsfullt', mood: 'stamningsfullt' });
    expect(intent.mood).toBe('stamningsfullt');
    expect(intent.timeFilter).toBeNull();
    expect(intent.priceFilter).toBeNull();
    expect(intent.categories).toBeNull();
    expect(intent.queryTerms).toBeNull();
    expect(intent.anchor).toBe('today');
  });

  it('the mood hint is required — the word alone must not fake any filter', () => {
    // The tile text alone ('Stämningsfullt') carries no category/day/price
    // words, so without the structured hint nothing fires.
    const intent = resolvePromptIntent({ text: 'Stämningsfullt' });
    expect(intent.mood).toBeNull();
    expect(intent.anchor).toBeNull();
  });

  it('English tile prompt (Atmospheric) resolves identically via the mood hint', () => {
    const intent = resolvePromptIntent({ text: 'Atmospheric', mood: 'stamningsfullt' });
    expect(intent.mood).toBe('stamningsfullt');
    expect(intent.anchor).toBe('today');
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
    expect(intentHasFilters(resolvePromptIntent({ text: 'Stämningsfullt', mood: 'stamningsfullt' }))).toBe(true);
  });
});
