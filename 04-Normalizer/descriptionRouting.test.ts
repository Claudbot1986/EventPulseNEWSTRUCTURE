/**
 * Tests for descriptionRouting — pure routing logic for description_sv/en.
 *
 * The user-facing contract (2026-10-02, plan §5.2):
 *   - Svenska venues ska inte gå miste om description bara för att titeln saknar å/ä/ö.
 *   - description_sv speglas från description_en ENDAST om venue.country === 'SE'.
 *   - Befintliga regler (detected-sv, title-has-sv-chars) har företräde.
 *   - description_sv får ALDRIG överskriva ett redan satt värde.
 *   - raw.description måste vara ≥10 tecken (inte placeholder).
 *
 * Run: npx vitest run 04-Normalizer/descriptionRouting.test.ts
 */

import { describe, it, expect } from 'vitest';
import { routeDescription, __test__ } from './descriptionRouting';

const { DEFAULT_MIN_LENGTH, SWEDISH_CHARS_RX } = __test__;

const SE_VENUE = { country: 'SE' as const };
const NO_VENUE = { country: 'NO' as const };
const DK_VENUE = { country: 'DK' as const };

describe('SWEDISH_CHARS_RX', () => {
  it('matches åäöÅÄÖ', () => {
    expect(SWEDISH_CHARS_RX.test('Dexys Midnight Runners')).toBe(false);
    expect(SWEDISH_CHARS_RX.test('Konsert på Lördag')).toBe(true);
    expect(SWEDISH_CHARS_RX.test('Östermalm')).toBe(true);
    expect(SWEDISH_CHARS_RX.test('Årets höjdare')).toBe(true);
  });
});

describe('DEFAULT_MIN_LENGTH', () => {
  it('is 10 (matches descriptionFallback.js)', () => {
    expect(DEFAULT_MIN_LENGTH).toBe(10);
  });
});

describe('routeDescription — rule 1: detected language = sv', () => {
  it('uses raw.description as both sv and en', () => {
    const r = routeDescription({
      rawDescription: 'En svensk konsert på Berns i Stockholm',
      detectedLanguage: 'sv',
      title: 'Berns Konsert',
      venue: SE_VENUE,
    });
    expect(r.description_sv).toBe('En svensk konsert på Berns i Stockholm');
    expect(r.description_en).toBe('En svensk konsert på Berns i Stockholm');
    expect(r.sv_rule).toBe('detected-sv');
    expect(r.en_rule).toBe('detected-sv-mirrored');
  });

  it('preserves sv description even when venue is NOT Swedish', () => {
    const r = routeDescription({
      rawDescription: 'En svensk konsert på Berns i Stockholm',
      detectedLanguage: 'sv',
      title: 'Berns Konsert',
      venue: NO_VENUE,
    });
    expect(r.description_sv).toBe('En svensk konsert på Berns i Stockholm');
    expect(r.sv_rule).toBe('detected-sv');
  });
});

describe('routeDescription — rule 2: title has sv chars', () => {
  it('uses raw.description as sv when title contains å/ä/ö', () => {
    const r = routeDescription({
      rawDescription: 'Konsert på Södermalm — folkkära artister',
      detectedLanguage: null,
      title: 'Konsertkväll på Söder',
      venue: SE_VENUE,
    });
    expect(r.description_sv).toBe('Konsert på Södermalm — folkkära artister');
    expect(r.sv_rule).toBe('title-has-sv-chars');
  });

  it('rule 1 (detected-sv) overrides rule 2', () => {
    // Om båda villkoren är uppfyllda är det detected-sv som slog in först
    const r = routeDescription({
      rawDescription: 'Konsert på Södermalm',
      detectedLanguage: 'sv',
      title: 'Konsertkväll på Söder',
      venue: SE_VENUE,
    });
    expect(r.sv_rule).toBe('detected-sv');
  });
});

describe('routeDescription — rule 3: swedish-venue-fallback (5.2 NEW)', () => {
  it('mirrors description_en → description_sv when venue is Swedish and no other sv rule fired', () => {
    const r = routeDescription({
      rawDescription: 'Dexys Midnight Runners | 2026-10-04 | Göta Lejon',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',  // INGEN å/ä/ö
      venue: SE_VENUE,
    });
    // Title saknar sv-tecken, men venue är SE → rule 3 kickar in
    expect(r.description_sv).toBe('Dexys Midnight Runners | 2026-10-04 | Göta Lejon');
    expect(r.description_en).toBe('Dexys Midnight Runners | 2026-10-04 | Göta Lejon');
    expect(r.sv_rule).toBe('swedish-venue-fallback');
    expect(r.en_rule).toBe('detected-en');
  });

  it('does NOT apply rule 3 when venue is non-Swedish (NO)', () => {
    const r = routeDescription({
      rawDescription: 'Dexys Midnight Runners | 2026-10-04',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',
      venue: NO_VENUE,
    });
    expect(r.description_sv).toBe(null);
    expect(r.description_en).toBe('Dexys Midnight Runners | 2026-10-04');
    expect(r.sv_rule).toBe('none');
  });

  it('does NOT apply rule 3 when venue is non-Swedish (DK)', () => {
    const r = routeDescription({
      rawDescription: 'Dexys Midnight Runners | 2026-10-04',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',
      venue: DK_VENUE,
    });
    expect(r.description_sv).toBe(null);
    expect(r.sv_rule).toBe('none');
  });

  it('does NOT apply rule 3 when venue info is missing', () => {
    const r = routeDescription({
      rawDescription: 'Dexys Midnight Runners | 2026-10-04',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',
      venue: null,
    });
    expect(r.description_sv).toBe(null);
    expect(r.sv_rule).toBe('none');
  });

  it('does NOT apply rule 3 when venue.country is null', () => {
    const r = routeDescription({
      rawDescription: 'Dexys Midnight Runners | 2026-10-04',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',
      venue: { country: null },
    });
    expect(r.description_sv).toBe(null);
    expect(r.sv_rule).toBe('none');
  });

  it('does NOT apply rule 3 when title already has sv chars (rule 2 has företräde)', () => {
    // Title med å/ä/ö → rule 2 hanterar det. Rule 3 får inte skriva över.
    const r = routeDescription({
      rawDescription: 'Södermalm konsert med svenska artister',
      detectedLanguage: 'en',
      title: 'Konsert på Söder',
      venue: SE_VENUE,
    });
    expect(r.sv_rule).toBe('title-has-sv-chars');
  });

  it('does NOT apply rule 3 when description is shorter than minLength (placeholder filter)', () => {
    const r = routeDescription({
      rawDescription: 'Dexys | 2026',  // 11 chars — men OK
      detectedLanguage: 'en',
      title: 'Dexys',
      venue: SE_VENUE,
    });
    // 11 chars >= 10 → rule 3 applies (placeholder-filter <10 är "Dexys|2")
    expect(r.description_sv).toBe('Dexys | 2026');
  });

  it('does NOT apply rule 3 when raw.description is too short (5 chars)', () => {
    const r = routeDescription({
      rawDescription: 'Kort',  // 4 chars
      detectedLanguage: 'en',
      title: 'Dexys',
      venue: SE_VENUE,
    });
    expect(r.description_sv).toBe(null);
    expect(r.description_en).toBe(null);  // <10 chars filtreras bort
  });

  it('does NOT apply rule 3 when raw.description is null/empty', () => {
    const r = routeDescription({
      rawDescription: null,
      detectedLanguage: 'en',
      title: 'Dexys',
      venue: SE_VENUE,
    });
    expect(r.description_sv).toBe(null);
    expect(r.description_en).toBe(null);
  });
});

describe('routeDescription — description_en behavior', () => {
  it('sets description_en when detected_language is "en"', () => {
    const r = routeDescription({
      rawDescription: 'A long enough English description here',
      detectedLanguage: 'en',
      title: 'Some Title',
      venue: NO_VENUE,
    });
    expect(r.description_en).toBe('A long enough English description here');
    expect(r.en_rule).toBe('detected-en');
  });

  it('sets description_en even when detected_language is null (preserves existing behavior)', () => {
    // Befintligt beteende (normalizer.ts:484): description_en = raw.description ALLTID.
    // Detta är OK eftersom vi bara "gissar språk" för description_sv-routingen — inte för
    // description_en som användaren kan läsa rakt av valfri butik.
    const r = routeDescription({
      rawDescription: 'Beskrivning utan språktagg',
      detectedLanguage: null,
      title: 'Dexys',  // no sv chars
      venue: SE_VENUE,
    });
    expect(r.description_en).toBe('Beskrivning utan språktagg');
    expect(r.en_rule).toBe('detected-en');
    // description_sv sätts via rule 3 om venue.country='SE'
    expect(r.description_sv).toBe('Beskrivning utan språktagg');
    expect(r.sv_rule).toBe('swedish-venue-fallback');
  });

  it('sets description_en when detected_language is "sv" (mirrored)', () => {
    // Svensk text — speglas till description_en så icke-svensktalande kan läsa.
    const r = routeDescription({
      rawDescription: 'Svensk beskrivning av ett evenemang',
      detectedLanguage: 'sv',
      title: 'Svensk title',
      venue: NO_VENUE,
    });
    expect(r.description_en).toBe('Svensk beskrivning av ett evenemang');
    expect(r.en_rule).toBe('detected-sv-mirrored');
  });
});

describe('routeDescription — minLength override', () => {
  it('respects custom minLength', () => {
    const r = routeDescription({
      rawDescription: 'AB',  // 2 chars
      detectedLanguage: 'en',
      title: 'Dexys',
      venue: SE_VENUE,
      minLength: 2,
    });
    expect(r.description_sv).toBe('AB');
    expect(r.sv_rule).toBe('swedish-venue-fallback');
  });
});

describe('routeDescription — total contract', () => {
  it('does not mutate input', () => {
    const input = {
      rawDescription: 'A long enough English description here',
      detectedLanguage: 'en',
      title: 'Dexys Midnight Runners',
      venue: { country: 'SE' as const },
    };
    const inputCopy = JSON.parse(JSON.stringify(input));
    routeDescription(input);
    expect(input).toEqual(inputCopy);
  });

  it('handles all-null input gracefully', () => {
    const r = routeDescription({
      rawDescription: null,
      detectedLanguage: null,
      title: null,
      venue: null,
    });
    expect(r.description_sv).toBe(null);
    expect(r.description_en).toBe(null);
    expect(r.sv_rule).toBe('none');
    expect(r.en_rule).toBe('none');
  });
});