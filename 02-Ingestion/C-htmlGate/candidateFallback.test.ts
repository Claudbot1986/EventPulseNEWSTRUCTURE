/**
 * candidateFallback.test.ts — ordningen på C-gatens fallback-lista.
 *
 * Fix R′ (2026-10-24): källans EGEN URL ska testas som sista kandidat när
 * C0-vinnaren inte ger sparbara datum. Annars finns ingen väg tillbaka till
 * den URL som faktiskt beskriver källan — mätt på engelbrekt.se (vinnaren
 * /aktiviteter gav 0 events, rot-sidan gav 2) och storkyrkan.se (vinnaren
 * svarade 404, rot-sidan gav 4).
 *
 * Negativa kontroller: varje "nej"-fall har ett "ja"-fall bredvid sig.
 */

import { describe, it, expect } from 'vitest';
import { buildFallbackCandidates } from './candidateFallback';

describe('buildFallbackCandidates', () => {
  it('C0:s övriga kandidater kommer först, i C0:s ordning', () => {
    const list = buildFallbackCandidates(
      [
        { url: 'https://a.se/2', eventDensityScore: 5 },
        { url: 'https://a.se/3', eventDensityScore: 3 },
      ],
      'https://a.se/1',
      'https://a.se',
      3,
    );
    // C0-kandidaterna först i C0:s ordning — den deklarerade URL:en läggs på sist.
    expect(list.slice(0, 2).map((c) => c.url)).toEqual(['https://a.se/2', 'https://a.se/3']);
    expect(list[0].reason).toContain('density=5');
  });

  it('källans egen URL kommer sist, märkt declared-url', () => {
    const list = buildFallbackCandidates(
      [{ url: 'https://a.se/2', eventDensityScore: 5 }],
      'https://a.se/1',
      'https://a.se',
      3,
    );
    expect(list[list.length - 1].url).toBe('https://a.se');
    expect(list[list.length - 1].reason).toBe('declared-url');
  });

  it('källans egen URL finns med även när C0 gav inga kandidater', () => {
    const list = buildFallbackCandidates([], 'https://a.se/1', 'https://a.se', 3);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://a.se');
    expect(list[0].reason).toBe('declared-url');
  });

  it('källans egen URL tas inte bort när den redan är testad', () => {
    const list = buildFallbackCandidates([], 'https://a.se', 'https://a.se', 3);
    expect(list).toHaveLength(0);
  });

  it('redan testad C0-kandidat hoppas över', () => {
    const list = buildFallbackCandidates(
      [
        { url: 'https://a.se/1', eventDensityScore: 9 },
        { url: 'https://a.se/2', eventDensityScore: 4 },
      ],
      'https://a.se/1',
      'https://a.se',
      3,
    );
    expect(list.map((c) => c.url)).toEqual(['https://a.se/2', 'https://a.se']);
  });

  it('C0-kandidater begränsas av limit — declaredUrl räknas inte in', () => {
    const list = buildFallbackCandidates(
      [
        { url: 'https://a.se/2', eventDensityScore: 5 },
        { url: 'https://a.se/3', eventDensityScore: 4 },
        { url: 'https://a.se/4', eventDensityScore: 3 },
      ],
      'https://a.se/1',
      'https://a.se',
      2,
    );
    expect(list).toHaveLength(3); // 2 C0 + 1 declared
    expect(list[2].reason).toBe('declared-url');
  });

  it('utan deklarerad URL saknas declared-url-kandidaten', () => {
    const list = buildFallbackCandidates([{ url: 'https://a.se/2', eventDensityScore: 5 }], 'https://a.se/1', undefined, 3);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://a.se/2');
  });

  it('utan toppkandidater och utan deklarerad URL blir listan tom', () => {
    expect(buildFallbackCandidates(null, 'https://a.se/1', null, 3)).toEqual([]);
  });
});
