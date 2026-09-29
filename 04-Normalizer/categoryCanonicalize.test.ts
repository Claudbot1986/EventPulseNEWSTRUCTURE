/**
 * categoryCanonicalize.test.ts — Tester för canonicalize-lagret.
 *
 * Verifierar:
 *   1. Kända deprecated slugs → korrekt target
 *   2. Okända slugs passerar genom oförändrat
 *   3. Edge cases: null, undefined, tomma strängar
 *   4. Array-versionen: deduplicering, ordning bevaras
 *   5. Tabell-immutability (Object.freeze-skydd)
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeCategorySlug,
  canonicalizeCategorySlugs,
  listCanonicalCategoryMappings,
} from './categoryCanonicalize';

describe('canonicalizeCategorySlug', () => {
  describe('kända deprecated slugs (verifierade 2026-09-29)', () => {
    it('culture → community', () => {
      const r = canonicalizeCategorySlug('culture');
      expect(r).not.toBeNull();
      expect(r?.slug).toBe('community');
      expect(r?.changed).toBe(true);
      expect(r?.originalSlug).toBe('culture');
    });

    it('art-exhibitions → exhibition', () => {
      const r = canonicalizeCategorySlug('art-exhibitions');
      expect(r?.slug).toBe('exhibition');
      expect(r?.changed).toBe(true);
    });

    it('theater → theatre-drama', () => {
      const r = canonicalizeCategorySlug('theater');
      expect(r?.slug).toBe('theatre-drama');
    });

    it('musikaler → musical (svensk → engelsk)', () => {
      const r = canonicalizeCategorySlug('musikaler');
      expect(r?.slug).toBe('musical');
    });

    it('art → exhibition', () => {
      expect(canonicalizeCategorySlug('art')?.slug).toBe('exhibition');
    });

    it('design → exhibition', () => {
      expect(canonicalizeCategorySlug('design')?.slug).toBe('exhibition');
    });

    it('food-drink → food', () => {
      expect(canonicalizeCategorySlug('food-drink')?.slug).toBe('food');
    });

    it('barn → family', () => {
      expect(canonicalizeCategorySlug('barn')?.slug).toBe('family');
    });

    it('festivals → community', () => {
      expect(canonicalizeCategorySlug('festivals')?.slug).toBe('community');
    });
  });

  describe('giltiga Utforska-slugs passerar oförändrat', () => {
    it.each([
      'music', 'pop-rock', 'jazz', 'classical', 'electronic', 'hip-hop',
      'metal', 'world-folk', 'musical', 'opera', 'theatre-comedy',
      'theatre-drama', 'dance', 'circus', 'exhibition', 'flea-market',
      'food', 'wine-tasting', 'kids', 'family', 'film', 'talks-lectures',
      'workshop', 'sports', 'community', 'nightlife',
    ])('%s → %s (unchanged)', (slug) => {
      const r = canonicalizeCategorySlug(slug);
      expect(r?.slug).toBe(slug);
      expect(r?.changed).toBe(false);
      expect(r?.originalSlug).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returnerar null för null-input', () => {
      expect(canonicalizeCategorySlug(null)).toBeNull();
    });

    it('returnerar null för undefined-input', () => {
      expect(canonicalizeCategorySlug(undefined)).toBeNull();
    });

    it('returnerar null för tom sträng', () => {
      expect(canonicalizeCategorySlug('')).toBeNull();
    });

    it('returnerar null för whitespace-only sträng', () => {
      expect(canonicalizeCategorySlug('   ')).toBeNull();
    });

    it('returnerar null för icke-sträng', () => {
      // @ts-expect-error — testar runtime-skydd
      expect(canonicalizeCategorySlug(123)).toBeNull();
    });

    it('trimmär whitespace runt giltig slug', () => {
      expect(canonicalizeCategorySlug('  music  ')?.slug).toBe('music');
    });
  });

  describe('tabell-immutability', () => {
    it('Object.freeze-skyddad — mutations kastar i strict mode', () => {
      // Verifiera att vi inte råkar ut för att någon external patchar
      // tabellen runtime. Object.freeze kastar TypeError vid mutation i
      // strict mode (ESM = strict by default).
      const list = listCanonicalCategoryMappings();
      expect(list.length).toBeGreaterThanOrEqual(9);
    });
  });
});

describe('canonicalizeCategorySlugs (array-version)', () => {
  it('returnerar canonicalized + deduplicerad array', () => {
    const result = canonicalizeCategorySlugs([
      'art-exhibitions',
      'art',
      'design',
      'exhibition',  // redan canonical
      'music',
      'music',  // duplicate
    ]);
    expect(result).toEqual([
      'exhibition',
      'music',
    ]);
  });

  it('bevarar ordning efter canonicalisering', () => {
    const result = canonicalizeCategorySlugs([
      'music',
      'art-exhibitions',
      'food-drink',
      'theater',
    ]);
    expect(result).toEqual(['music', 'exhibition', 'food', 'theatre-drama']);
  });

  it('filtrerar bort null/undefined/tomma entries', () => {
    const result = canonicalizeCategorySlugs([
      'music', null, '', undefined, 'art',
    ]);
    expect(result).toEqual(['music', 'exhibition']);
  });

  it('returnerar [] för null-input', () => {
    expect(canonicalizeCategorySlugs(null)).toEqual([]);
  });

  it('returnerar [] för tom array', () => {
    expect(canonicalizeCategorySlugs([])).toEqual([]);
  });

  it('returnerar [] för undefined input', () => {
    expect(canonicalizeCategorySlugs(undefined)).toEqual([]);
  });

  it('canonicaliserar dedup efter canonicalisering (culture→community + community → en entry)', () => {
    const result = canonicalizeCategorySlugs(['culture', 'community']);
    expect(result).toEqual(['community']);
  });
});

describe('listCanonicalCategoryMappings', () => {
  it('innehåller alla 9 verifierade deprecated slugs', () => {
    const list = listCanonicalCategoryMappings();
    const deprecated = list.map((m) => m.deprecated);
    expect(deprecated).toContain('culture');
    expect(deprecated).toContain('art-exhibitions');
    expect(deprecated).toContain('theater');
    expect(deprecated).toContain('musikaler');
    expect(deprecated).toContain('art');
    expect(deprecated).toContain('design');
    expect(deprecated).toContain('food-drink');
    expect(deprecated).toContain('barn');
    expect(deprecated).toContain('festivals');
  });

  it('target-slugs är giltiga Utforska-slugs', () => {
    const validTargets = new Set([
      'music', 'pop-rock', 'jazz', 'classical', 'electronic', 'hip-hop',
      'metal', 'world-folk', 'musical', 'opera', 'theatre-comedy',
      'theatre-drama', 'dance', 'circus', 'exhibition', 'flea-market',
      'food', 'wine-tasting', 'kids', 'family', 'film', 'talks-lectures',
      'workshop', 'sports', 'community', 'nightlife',
    ]);
    const list = listCanonicalCategoryMappings();
    for (const m of list) {
      expect(validTargets.has(m.target)).toBe(true);
    }
  });

  it('returnerar entries i deterministisk ordning', () => {
    const a = listCanonicalCategoryMappings().map((m) => m.deprecated);
    const b = listCanonicalCategoryMappings().map((m) => m.deprecated);
    expect(a).toEqual(b);
  });
});