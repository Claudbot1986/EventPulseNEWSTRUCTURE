/**
 * Strömmande klassning — 2026-10-28.
 *
 * BUGEN SOM DETTA FIL FÖRhindrar:
 *
 *   Kedjan buffrade stegets stderr i en takad buffert (32 KB början + 32 KB
 *   slut) och klassade DEN texten. Mätt på en verklig logg —
 *   `runtime/ingestion-cron/steps/worker-drain-2026-10-28T06-07-38-030Z.err.log`,
 *   1 213 321 byte — låg den enda transportmarkören ("fetch failed") på byte
 *   119 988, alltså i den kastade mitten. Kedjan klassade steget som 'logic',
 *   avslutade exit 0 och skrev "klar".
 *
 *   Det är exakt det tysta fel hela kedjan finns för att döda: nätet var
 *   dött, kedjan skrev "klar", och ingen såg det.
 *
 * Negativa kontroller:
 *   - en markör i MITTEN av en stor logg fångas fortfarande
 *   - en DEGRADED-rad med transportmarkör är INTE transport
 *   - en retry-rad med transportmarkör är INTE transport
 *   - strömmande resultat == classifyMessage över hela texten
 *   - en markör som delas mellan två chunks fångas
 */

import { describe, it, expect } from 'vitest';
import { createStreamingClassifier, classifyMessage } from './net-error.mjs';
import { createLastMatchScanner } from './bounded-text.mjs';

describe('createStreamingClassifier', () => {
  it('fångar en transportmarkör i MITTEN av en stor logg', () => {
    const c = createStreamingClassifier();
    c.append('start\n');
    // ~120 KB brus — markören hamnar långt förbi både början och slut.
    c.append('x'.repeat(120_000) + '\n');
    c.append('TypeError: fetch failed\n');
    c.append('x'.repeat(120_000) + '\n');
    c.append('slut\n');
    c.flush();
    expect(c.worstClass).toBe('transport');
  });

  it('NEGATIV KONTROLL — utan markör är den inte transport', () => {
    const c = createStreamingClassifier();
    c.append('allt gick bra\n'.repeat(1000));
    c.flush();
    expect(c.worstClass).toBe('logic');
    expect(c.degradedCount).toBe(0);
  });

  it('en DEGRADED-rad med transportmarkör är INTE transport', () => {
    const c = createStreamingClassifier();
    c.append('[editorial] DEGRADED event abc misslyckades: fetch failed\n');
    c.flush();
    expect(c.worstClass).toBe('logic');
    expect(c.degradedCount).toBe(1);
  });

  it('en retry-rad med transportmarkör är INTE transport', () => {
    const c = createStreamingClassifier();
    c.append('connect ECONNREFUSED — retry om 5 s\n');
    c.flush();
    expect(c.worstClass).toBe('logic');
  });

  it('en retry-rad med transportmarkör RAPPORTERAS som försämring (den kastas inte bort)', () => {
    // 2026-10-28 — retry-rader slogs tidigare bort helt. Då försvann
    // informationen: kedjan kunde inte skilja "nätverksfläck som retry
    // räddade" från "fel som aldrig syntes". Nu räknas raden som en
    // försämring — kedjan går inte röd, men raden finns kvar i statusen.
    const c = createStreamingClassifier();
    c.append('connect ECONNREFUSED — retry om 5 s\n');
    c.flush();
    expect(c.degradedCount).toBe(1);
    expect(c.worstClass).toBe('logic');
  });

  it('NEGATIV KONTROLL — en retry-rad UTAN transportmarkör är ingen försämring', () => {
    const c = createStreamingClassifier();
    c.append('retry 2 av 3\n');
    c.flush();
    expect(c.degradedCount).toBe(0);
  });

  it('fångar en markör som delas mellan två chunks', () => {
    const c = createStreamingClassifier();
    c.append('TypeError: fe');
    c.append('tch failed\n');
    c.flush();
    expect(c.worstClass).toBe('transport');
  });

  it('fångar den sista raden även utan avslutande newline', () => {
    const c = createStreamingClassifier();
    c.append('socket hang up');
    c.flush();
    expect(c.worstClass).toBe('transport');
  });

  it('tar den värsta klassen — auth slår http, http slår logic', () => {
    const c = createStreamingClassifier();
    c.append('HTTP 500\n');
    c.append('status=403\n');
    c.flush();
    expect(c.worstClass).toBe('auth');
  });

  it('strömmande resultat == classifyMessage över hela texten', () => {
    const samples = [
      'ECONNREFUSED 127.0.0.1:6379\n',
      'HTTP 404 not found\n',
      'unauthorized\n',
      'inget fel alls\n',
      'HTTP 500\nHTTP 503\n',
      'DEGRADED fetch failed\nHTTP 404\n',
    ];
    for (const text of samples) {
      const c = createStreamingClassifier();
      c.append(text);
      c.flush();
      const expected = classifyMessage(
        text
          .split('\n')
          .filter((l) => !/\bDEGRADED\b/.test(l))
          .filter((l) => !/retry|retrying|försök(ar)? igen|will retry/i.test(l))
          .join('\n'),
      );
      expect(c.worstClass, `text: ${JSON.stringify(text)}`).toBe(expected);
    }
  });
});

describe('createLastMatchScanner', () => {
  const RECIPE = /^KLAR\s+│\s+(\d+)\s+events till bullmq/m;

  it('tar den sista matchningen', () => {
    const s = createLastMatchScanner(RECIPE);
    s.append('KLAR  │  10 events till bullmq\n');
    s.append('KLAR  │  20 events till bullmq\n');
    s.flush();
    expect(s.lastValue).toBe('20');
  });

  it('fångar en matchning i MITTEN av en stor utdata', () => {
    const s = createLastMatchScanner(RECIPE);
    s.append('x'.repeat(120_000) + '\n');
    s.append('KLAR  │  1147 events till bullmq\n');
    s.append('x'.repeat(120_000) + '\n');
    s.flush();
    expect(s.lastValue).toBe('1147');
  });

  it('NEGATIV KONTROLL — ingen matchning ger null, inte 0', () => {
    const s = createLastMatchScanner(RECIPE);
    s.append('inget att se här\n');
    s.flush();
    expect(s.lastValue).toBeNull();
  });

  it('ett globalt regex ger samma svar varje gång (lastIndex får inte läcka)', () => {
    const s = createLastMatchScanner(/^KLAR\s+│\s+(\d+)\s+events till bullmq/gm);
    s.append('KLAR  │  7 events till bullmq\n');
    s.flush();
    expect(s.lastValue).toBe('7');
  });
});
