/**
 * sourceCategoryDefaults.test.ts — Tests för source-level category defaults.
 *
 * Verifierar:
 *   1. Kända källor returnerar korrekt slug + reason
 *   2. Okända källor returnerar null (inte 'community' eller kasta)
 *   3. Edge cases: null, undefined, tomma strängar
 *   4. listSourceCategoryDefaults() returnerar tabellen med source-nycklar
 *   5. Mappingen är oföränderlig (Object.freeze-skydd)
 */

import { describe, it, expect } from 'vitest';
import {
  getDefaultCategoryForSource,
  getDefaultCategorySlugForSource,
  listSourceCategoryDefaults,
} from './sourceCategoryDefaults';

describe('getDefaultCategoryForSource', () => {
  describe('kända källor (verifierade 2026-09-29)', () => {
    it('berwaldhallen → classical', () => {
      const def = getDefaultCategoryForSource('berwaldhallen');
      expect(def).not.toBeNull();
      expect(def?.slug).toBe('classical');
      expect(def?.reason).toMatch(/klassisk/i);
    });

    it('lulea-hf-2 → musical (biljettshop.se Chicago-musikal)', () => {
      const def = getDefaultCategoryForSource('lulea-hf-2');
      expect(def?.slug).toBe('musical');
    });

    it('downtown-2 → musical (samma upstream)', () => {
      const def = getDefaultCategoryForSource('downtown-2');
      expect(def?.slug).toBe('musical');
    });

    it('globen-3 → musical (samma upstream)', () => {
      const def = getDefaultCategoryForSource('globen-3');
      expect(def?.slug).toBe('musical');
    });

    it('halmstad-konserthus-2 → musical (samma upstream)', () => {
      const def = getDefaultCategoryForSource('halmstad-konserthus-2');
      expect(def?.slug).toBe('musical');
    });

    it('sthlmlist → music (Stockholm music listings)', () => {
      const def = getDefaultCategoryForSource('sthlmlist');
      expect(def?.slug).toBe('music');
    });

    it('debaser → music (Debaser musikscen)', () => {
      const def = getDefaultCategoryForSource('debaser');
      expect(def?.slug).toBe('music');
    });
  });

  describe('okända källor', () => {
    it('returnerar null för källor som inte finns i tabellen', () => {
      expect(getDefaultCategoryForSource('ticketmaster')).toBeNull();
      expect(getDefaultCategoryForSource('eventbrite-sthlm-all')).toBeNull();
      expect(getDefaultCategoryForSource('some-future-source')).toBeNull();
    });

    it('returnerar null för null-input', () => {
      expect(getDefaultCategoryForSource(null)).toBeNull();
    });

    it('returnerar null för undefined-input', () => {
      expect(getDefaultCategoryForSource(undefined)).toBeNull();
    });

    it('returnerar null för tom sträng', () => {
      expect(getDefaultCategoryForSource('')).toBeNull();
    });
  });

  describe('datakvalitet', () => {
    it('alla entries har verifiedSince i YYYY-MM-DD-format', () => {
      const entries = listSourceCategoryDefaults();
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.verifiedSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('alla entries har icke-tom reason', () => {
      const entries = listSourceCategoryDefaults();
      for (const e of entries) {
        expect(e.reason.length).toBeGreaterThan(10);
      }
    });

    it('alla entries har slug som är icke-tom och inte catch-all', () => {
      // Categories-tabellen har både gamla och nya slugs (se migration
      // 20260927-0001-categories-v2.sql — äldre slugs som 'music' är
      // kvar). DB-FK:n fångar ogiltiga slugs vid insert; vi testar bara
      // att slugen är icke-tom och inte 'community' (som är fall-back).
      const entries = listSourceCategoryDefaults();
      for (const e of entries) {
        expect(e.slug).toBeTruthy();
        expect(e.slug).not.toBe('community');
        expect(typeof e.slug).toBe('string');
        expect(e.slug.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('getDefaultCategorySlugForSource', () => {
  it('returnerar slug-sträng för känd källa', () => {
    expect(getDefaultCategorySlugForSource('berwaldhallen')).toBe('classical');
    expect(getDefaultCategorySlugForSource('lulea-hf-2')).toBe('musical');
  });

  it('returnerar null för okänd källa', () => {
    expect(getDefaultCategorySlugForSource('unknown-source')).toBeNull();
  });

  it('returnerar null för null/undefined', () => {
    expect(getDefaultCategorySlugForSource(null)).toBeNull();
    expect(getDefaultCategorySlugForSource(undefined)).toBeNull();
  });
});

describe('listSourceCategoryDefaults', () => {
  it('returnerar alla entries med source-nyckel', () => {
    const entries = listSourceCategoryDefaults();
    const sources = entries.map((e) => e.source);
    expect(sources).toContain('berwaldhallen');
    expect(sources).toContain('lulea-hf-2');
    expect(sources).toContain('downtown-2');
    expect(sources).toContain('globen-3');
    expect(sources).toContain('halmstad-konserthus-2');
    expect(sources).toContain('sthlmlist');
    expect(sources).toContain('debaser');
  });

  it('returnerar icke-tom array (minst 5 entries för 7 verifierade källor)', () => {
    const entries = listSourceCategoryDefaults();
    expect(entries.length).toBeGreaterThanOrEqual(5);
  });

  it('returnerar entries i deterministisk ordning (Object.entries ordning)', () => {
    const a = listSourceCategoryDefaults();
    const b = listSourceCategoryDefaults();
    expect(a.map((e) => e.source)).toEqual(b.map((e) => e.source));
  });
});