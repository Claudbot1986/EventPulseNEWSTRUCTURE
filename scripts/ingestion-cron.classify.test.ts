/**
 * scripts/ingestion-cron.classify.test.ts
 *
 * Kedjans klassificering av ett STEG — från exitkod + stegets stderr.
 *
 * Varför (2026-10-28). Kedjan gick röd med exit 69 ("nätet dog") på en
 * körning där 129 av 139 källor svarade normalt: de 10 som nekade skrevs
 * alla som "fetch failed", och det är en transportmarkör. Samtidigt är den
 * andra riktningen lika viktig — ett steg som SÄGER exit 0 men skriver ett
 * transportfel i stderr får inte se ut att vara klart.
 *
 * Negativa kontroller:
 *   - exit 0 + DEGRADED-rader ⇒ försämring, INTE fel (kedjan förblir grön)
 *   - exit 0 + "fetch failed" utan DEGRADED ⇒ transport (kedjan går röd)
 *   - exit 0 + vägran-text ⇒ försämring (inte auth, inte transport)
 *   - exit 69 ⇒ transport oavsett text
 *   - exit 75 ⇒ ofullständigt, inte trasigt
 */

import { describe, it, expect } from 'vitest';
import { classifyStepFailure } from './ingestion-cron';
import { createStreamingClassifier } from './lib/net-error.mjs';

/** Kör en stderr-text genom kedjans strömmande klassificator. */
function verdictOf(text: string): { worstClass: any; degradedCount: number } {
  const classifier = createStreamingClassifier();
  classifier.append(text);
  classifier.flush();
  return { worstClass: classifier.worstClass, degradedCount: classifier.degradedCount };
}

describe('classifyStepFailure', () => {
  it('exit 0 + DEGRADED-rader ⇒ försämring, kedjan förblir grön', () => {
    // Exakt det som direct-jsonld skriver när 8 av 139 källor inte gick
    // igenom: varje källa på sin egen DEGRADED-rad.
    const stderr = [
      '[direct-jsonld] DEGRADED källa billetto-stockholm: vägrade vår förfrågan (svarskod 403)',
      '[direct-jsonld] DEGRADED källa riksarkivet: gick inte att nå (ETIMEDOUT)',
      '[direct-jsonld] DEGRADED 8 av 139 källor gick inte igenom (1 otillgängliga, 7 nekade)',
    ].join('\n');
    const result = classifyStepFailure(0, verdictOf(stderr));
    expect(result.errorClass).toBeUndefined();
    expect(result.degraded).toBe(true);
  });

  it('NEGATIV KONTROLL — exit 0 + "fetch failed" utan DEGRADED ⇒ transport', () => {
    // Detta är den gröna ljugen. Utan DEGRADED-markören ska kedjan gå röd.
    const stderr = '  riksarkivet: FATAL fetch failed';
    const result = classifyStepFailure(0, verdictOf(stderr));
    expect(result.errorClass).toBe('transport');
  });

  it('NEGATIV KONTROLL — exit 0 + "HTTP 403" ⇒ auth (kedjan går röd med 77)', () => {
    // Råa HTTP-statusar i feltext ska fortsatt fångas. Vägrans-texten får
    // INTE se ut sådan — det är därför describeRefusal() formulerar om den.
    const result = classifyStepFailure(0, verdictOf('  biletto: HTTP 403'));
    expect(result.errorClass).toBe('auth');
  });

  it('vägran-texten från describeRefusal ⇒ försämring, inte auth', () => {
    const stderr = '[direct-jsonld] DEGRADED källa biletto: vägrade vår förfrågan (svarskod 403)';
    const result = classifyStepFailure(0, verdictOf(stderr));
    expect(result.errorClass).toBeUndefined();
    expect(result.degraded).toBe(true);
  });

  it('exit 69 ⇒ transport, oavsett text', () => {
    const result = classifyStepFailure(69, verdictOf('inga fel'));
    expect(result.errorClass).toBe('transport');
  });

  it('exit 75 ⇒ ofullständigt (empty), inte trasigt', () => {
    const result = classifyStepFailure(75, verdictOf('alla nekade'));
    expect(result.errorClass).toBe('empty');
    expect(result.degraded).toBe(true);
  });

  it('exit 77 ⇒ auth', () => {
    const result = classifyStepFailure(77, verdictOf(''));
    expect(result.errorClass).toBe('auth');
  });

  it('exit 0 + inga fel alls ⇒ inget att rapportera', () => {
    const result = classifyStepFailure(0, verdictOf(''));
    expect(result.errorClass).toBeUndefined();
    expect(result.degraded).toBeUndefined();
  });
});
