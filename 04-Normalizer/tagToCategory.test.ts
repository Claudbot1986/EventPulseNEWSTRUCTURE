/**
 * tagToCategory.test.ts — Tester för Last.fm-tag → musikkategori-mapping.
 *
 * v2 (2026-09-30): 8 buckets istället för 3, 'musical' omdöpt till 'musical-theatre',
 * ingen generell catch-all längre (rock/pop/jazz/etc. får egna buckets).
 *
 * Verifierar:
 *   1. Entydig multi-tag match → korrekt kategori + hög confidence
 *   2. Stark single-tag match (count ≥ 100) → korrekt kategori + hög confidence
 *   3. Svag single-tag match → null (LLM fallback)
 *   4. Flera kategori-buckets matchar → null (tvetydig)
 *   5. Inga matchningar alls → null (ingen catch-all)
 *   6. Edge cases: tom tag-lista, konstiga format
 *   7. Casing-känslighet: Last.fm casing ska inte spela roll
 *   8. Tabell-immutability (Object.freeze-skydd)
 *   9. Alla 8 buckets har icke-tomma tag-listor
 */

import { describe, it, expect } from 'vitest';
import {
  mapLastFmTagsToCategory,
  TAG_TO_CATEGORY,
  type MusicCategorySlug,
} from './tagToCategory';
import type { LastFmTag } from './musicLookup';

describe('mapLastFmTagsToCategory — entydiga matchningar (8 buckets)', () => {
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

  it('klassificerar som musical-theatre vid broadway + musical theatre', () => {
    const tags: LastFmTag[] = [
      { name: 'broadway', count: 150 },
      { name: 'musical theatre', count: 120 },
      { name: 'soundtrack', count: 60 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('musical-theatre');
    expect(result?.matched_tags).toContain('broadway');
    expect(result?.matched_tags).toContain('musical theatre');
  });

  it('klassificerar som rock vid 3 träffar i rock-bucket', () => {
    const tags: LastFmTag[] = [
      { name: 'rock', count: 200 },
      { name: 'indie', count: 150 },
      { name: 'alternative', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('rock');
    expect(result?.confidence).toBe(0.95);
    expect(result?.matched_tags).toContain('rock');
    expect(result?.matched_tags).toContain('indie');
  });

  it('klassificerar som pop vid pop + k-pop + synth-pop', () => {
    const tags: LastFmTag[] = [
      { name: 'pop', count: 200 },
      { name: 'k-pop', count: 120 },
      { name: 'synth-pop', count: 80 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('pop');
    expect(result?.confidence).toBe(0.95);
  });

  it('klassificerar som jazz vid jazz + soul + blues', () => {
    const tags: LastFmTag[] = [
      { name: 'jazz', count: 200 },
      { name: 'soul', count: 120 },
      { name: 'blues', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('jazz');
    expect(result?.confidence).toBe(0.95);
  });

  it('klassificerar som electronic vid electronic + house + techno', () => {
    const tags: LastFmTag[] = [
      { name: 'electronic', count: 200 },
      { name: 'house', count: 120 },
      { name: 'techno', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('electronic');
    expect(result?.confidence).toBe(0.95);
  });

  it('klassificerar som hip-hop vid hip-hop + rap + trap', () => {
    const tags: LastFmTag[] = [
      { name: 'hip-hop', count: 200 },
      { name: 'rap', count: 150 },
      { name: 'trap', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('hip-hop');
    expect(result?.confidence).toBe(0.95);
  });
});

describe('mapLastFmTagsToCategory — stark single-tag signal', () => {
  it('räcker med en tag om count ≥ 100 (classical)', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 250 },
      { name: 'seen live', count: 5 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('classical');
    expect(result?.confidence).toBe(0.95);
    expect(result?.reasoning).toContain('stark signal');
  });

  it('räcker med en tag om count ≥ 100 (rock)', () => {
    const tags: LastFmTag[] = [
      { name: 'rock', count: 150 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('rock');
    expect(result?.confidence).toBe(0.95);
  });

  it('räcker INTE med en tag om count < 100 → null', () => {
    const tags: LastFmTag[] = [
      { name: 'classical', count: 80 },
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

  it('returnerar null när musical-theatre OCH classical båda matchar', () => {
    const tags: LastFmTag[] = [
      { name: 'musical theatre', count: 100 },
      { name: 'classical', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });

  it('returnerar null när rock OCH pop båda matchar', () => {
    const tags: LastFmTag[] = [
      { name: 'rock', count: 100 },
      { name: 'pop', count: 100 },
      { name: 'indie', count: 80 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result).toBeNull();
  });
});

describe('mapLastFmTagsToCategory — ingen signal (v2: ingen generell catch-all)', () => {
  it('returnerar null vid tom tag-lista', () => {
    expect(mapLastFmTagsToCategory([])).toBeNull();
  });

  it('returnerar null när taggar inte matchar någon av 8 buckets', () => {
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

  it('returnerar null när bara en svag enskild tag matchar (ingen catch-all räddar)', () => {
    // I v1 returnerade detta 'musical' med conf 0.70 (catch-all).
    // I v2 finns ingen catch-all — en ensam svag rock-tag → null → LLM.
    const tags: LastFmTag[] = [
      { name: 'rock', count: 50 },
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

  it('matchar ROCK oavsett casing', () => {
    const tags: LastFmTag[] = [
      { name: 'ROCK', count: 200 },
      { name: 'Indie', count: 100 },
    ];
    const result = mapLastFmTagsToCategory(tags);
    expect(result?.category_slug).toBe('rock');
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
  it('alla 8 buckets finns och är frozen', () => {
    expect(Object.isFrozen(TAG_TO_CATEGORY)).toBe(true);
    const expectedBuckets: MusicCategorySlug[] = [
      'classical', 'opera', 'musical-theatre',
      'rock', 'pop', 'jazz', 'electronic', 'hip-hop',
    ];
    for (const bucket of expectedBuckets) {
      expect(TAG_TO_CATEGORY[bucket], `bucket '${bucket}' ska existera`).toBeDefined();
      expect(Object.isFrozen(TAG_TO_CATEGORY[bucket]), `bucket '${bucket}' ska vara frozen`).toBe(true);
    }
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

  it('totalt antal taggar är minst 80 (rimlig täckning för 8 buckets)', () => {
    // Guard mot regression — ingen bucket ska glömmas.
    // 8 buckets × ~10 taggar vardera ≈ 80+.
    const total = Object.values(TAG_TO_CATEGORY).reduce((sum, tags) => sum + tags.length, 0);
    expect(total).toBeGreaterThanOrEqual(80);
  });
});
