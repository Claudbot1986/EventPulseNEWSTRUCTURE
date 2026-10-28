/**
 * reddit-contract.test.ts — exitkontraktet för reddit-steget.
 *
 * Negativa kontroller:
 *   - inga misslyckade sökningar → exit 0 (tom källa är ett resultat)
 *   - några misslyckade → exit 0 + DEGRADED (valfri källa försämrad)
 *   - ALLA misslyckade UTAN HTTP-svar → exit 69 (reddit nåddes aldrig)
 *   - ALLA misslyckade MED HTTP-svar (403) → exit 0 + DEGRADED (reddit
 *     svarade men nekade — världen är frisk)
 */

import { describe, it, expect } from 'vitest';
import { redditContract } from './reddit-contract.mjs';

describe('reddit exitkontrakt', () => {
  it('inga misslyckade sökningar → exit 0, ingen försämring', () => {
    const c = redditContract({ totalSearches: 18, failures: 0 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('NEGATIV KONTROLL — 0 kandidater är ett resultat, inte ett fel', () => {
    // Reddit svarade på alla 18 sökningar men hittade inget. Det är en
    // legitimt tom källa, inte en trasig — kedjan går vidare.
    const c = redditContract({ totalSearches: 18, failures: 0 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('några misslyckade → exit 0 + DEGRADED', () => {
    const c = redditContract({ totalSearches: 18, failures: 3 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('ALLA misslyckade UTAN HTTP-svar → exit 69 (transportfel)', () => {
    const c = redditContract({ totalSearches: 18, failures: 18, transportFailures: 18 });
    expect(c.exitCode).toBe(69);
    expect(c.degraded).toBe(false);
  });

  it('ALLA misslyckade MED HTTP-svar (403) → exit 0 + DEGRADED, inte 69', () => {
    // Mätt 2026-10-28: reddit svarar 403 på alla 18 sökningar. Reddit NÅDDE
    // fram — världen är frisk. Om detta blev 69 gick kedjan röd varje natt
    // för en valfri källa som aldrig kommer att svara.
    const c = redditContract({ totalSearches: 18, failures: 18, transportFailures: 0 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('även om antalet sökningar inte stämmer → 69 när alla som gjordes föll utan svar', () => {
    const c = redditContract({ totalSearches: 18, failures: 20, transportFailures: 20 });
    expect(c.exitCode).toBe(69);
  });

  it('en enda lyckad sökning räcker för att inte vara 69', () => {
    const c = redditContract({ totalSearches: 18, failures: 17, transportFailures: 17 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('noll totala sökningar med noll fel är inte ett fel', () => {
    const c = redditContract({ totalSearches: 0, failures: 0 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('noll totala sökningar men med fel → DEGRADED, inte 69', () => {
    // Kan inte ha "alla" misslyckats om inga gjordes.
    const c = redditContract({ totalSearches: 0, failures: 1 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('NEGATIV KONTROLL — 69 kräver att INGEN sökning nådde fram', () => {
    // Blandade fel: 18 misslyckade, men 4 av dem var HTTP-svar. Något svar
    // nådde oss → världen lever → inte 69.
    const c = redditContract({ totalSearches: 18, failures: 18, transportFailures: 14 });
    expect(c.exitCode).toBe(0);
    expect(c.degraded).toBe(true);
  });
});
