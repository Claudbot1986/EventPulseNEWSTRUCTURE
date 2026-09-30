/**
 * tagToCategory.test.ts — Tester för Last.fm-tag → kategori-mapping.
 *
 * Verifierar:
 *   1. Entydig multi-tag match → korrekt kategori + hög confidence
 *   2. Stark single-tag match (count ≥ 100) → korrekt kategori + hög confidence
 *   3. Svag single-tag match → null (LLM fallback)
 *   4. Flera kategori-buckets matchar → null (tvetydig)
 *   5. Bara catch-all musik-taggar → 'musical' med conf 0.70
 *   6. Inga matchningar alls → null
 *   7. Edge cases: tom tag-lista, konstiga format
 *   8. Casing-känslighet: Last.fm casing ska inte spela roll
 *   9. Tabell-immutability (Object.freeze-skydd)
 */

import { describe, it, expect } from 'vitest';
import {
  mapLastFmTagsToCategory,
  TAG_TO_CATEGORY,
} from './tagToCategory';
import type { LastFmTag } from './musicLookup';

describe('mapLastFmTagsToCategory — entydiga matchningar', () => {
  it('klassificerar som classical vid 3 träffar i classical-bucket', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 200 },
      { name: 'symphony', count: 100 },
      { name: 'orchestra', count: 80 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('classical');
    expect(result?.confidence).toBe(0.95);
    expect(result?.matched_tags).toEqual(['classical', 'symphony', 'orchestra']);
    expect(result?.reasoning).toContain('entydigt');
  });

  it('klassificerar som opera vid stark enskild träff (count ≥ 100)', () => {
    const tags: LastFmTag[] = [
      { name: 'opera', count: 142 },
      { name: 'italian', count: 30 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('opera');
    expect(result?.confidence).toBe(0.95);
  });

  it('klassificerar som musical vid broadway + musical theatre', () => {
    const tags: LastFmTag[] = [
      { name: 'broadway', count: 150 },
      { name: 'musical theatre', count: 120 },
      { name: 'soundtrack', count: 60 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('musical');
    expect(result?.matched_tags).toContain('broadway');
    expect(result?.matched_tags).toContain('musical theatre');
  });
});

describe('mapLastFmTagsToCategory — stark single-tag signal', () => {
  it('räcker med en tag om count ≥ 100', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 250 },
      { name: 'seen live', count: 5 }, // filtreras normalt, men här är den bara brus
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('classical');
    expect(result?.confidence).toBe(0.95);
    expect(result?.reasoning).toContain('stark signal');
  });

  it('räcker INTE med en tag om count < 100 → null', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 80 }, // ensam svag träff
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });
});

describe('mapLastFmTagsToCategory — tvetydiga matchningar', () => {
  it('returnerar null när classical OCH opera båda matchar', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 100 },
      { name: 'opera', count: 80 },
      { name: 'symphony', count: 50 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });

  it('returnerar null när opera OCH musical båda matchar', () => {
    const tags: LastFmTag[] = [
      { name: 'opera', count: 100 },
      { name: 'broadway', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });
});

describe('mapLastFmTagsToCategory — musik catch-all', () => {
  it('klassificerar som musical (conf 0.70) när bara catch-all-taggar finns', () => {
    const tags: LastFmTag[] = [
      { name: 'rock', count: 200 },
      { name: 'indie', count: 150 },
      { name: 'alternative', count: 80 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('musical');
    expect(result?.confidence).toBe(0.70);
    expect(result?.matched_tags).toContain('rock');
    expect(result?.matched_tags).toContain('indie');
    expect(result?.reasoning).toContain('catch-all');
  });

  it('catch-all vinner INTE över entydig kategori-match', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 200 },
      { name: 'rock', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('classical');
    expect(result?.confidence).toBe(0.95); // inte catch-allets 0.70
  });
});

describe('mapLastFmTagsToCategory — ingen signal', () => {
  it('returnerar null vid tom tag-lista', () => {
    expect(mapLastFmTagsToCategory([])).toBeNull();
  });

  it('returnerar null när taggar inte matchar någonting', () => {
    const tags: LastFmTag[] = [
      { name: 'unheard', count: 50 },
      { name: 'obscure', count: 30 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });

  it('returnerar null för tags som bara är "seen live"-brus', () => {
    const tags: LastFmTag[] = [
      { name: 'seen live', count: 999 },
      { name: 'favorites', count: 500 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });
});

describe('mapLastFmTagsToCategory — casing-känslighet', () => {
  it('matchar oavsett casing i tag-namn', () => {
    const tags: LastFmTag[] = [
      { name: 'CLASSICAL', count: 200 },
      { name: 'Symphony', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('classical');
  });

  it('trimmar whitespace runt tag-namn', () => {
    const tags: LastFmTag[] = [
      { name: '  classical  ', count: 200 },
      { name: '\topera\t', count: 80 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    // Båda matchar men tvetydig (opera + classical), så null
    expect(result).toBeNull();
  });
});

describe('TAG_TO_CATEGORY tabell-immutability', () => {
  it('alla buckets är frozen', () => {
    expect(Object.isFrozen(TAG_TO_CATEGORY)).toBe(true);
    expect(Object.isFrozen(TAG_TO_CATEGORY.classical)).toBe(true);
    expect(Object.isFrozen(TAG_TO_CATEGORY.opera)).toBe(true);
    expect(Object.isFrozen(TAG_TO_CATEGORY.musical)).toBe(true);
  });

  it('alla buckets innehåller icke-tomma strängar', () => {
    for (const [bucket, tags] of Object.entries(TAG_TO_CATEGORY)) {
      expect(tags.length, `${bucket} ska ha taggar`).toBeGreaterThan(0);
      for (const t of tags) {
        expect(typeof t).toBe('string');
        expect(t.length, `${t} ska vara icke-tom`).toBeGreaterThan(0);
        expect(t, `${t} ska vara lowercase`).toBe(t.toLowerCase());
      }
    }
  });
});
