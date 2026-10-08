/**
 * Tests for descriptionFallback helpers.
 *
 * The user-facing contract:
 *   - 2026-10-02: DetailsScreen MUST show some description or an honest muted
 *     fallback ("Ingen beskrivning från {källa}") — never silently drop
 *     the section.
 *   - 2026-10-02: Utforska row MUST NOT show a preview when the event has no
 *     description (avoid blank space).
 *   - 2026-10-05 (T0201): UI:t får ALDRIG falla tillbaka till scraped source
 *     description om description_license INTE är tillåtande (default 'unknown').
 *   - 2026-10-05 (T0201): UI:t visar eventpulse_summary primärt om det finns.
 *   - 2026-10-05 (T0201): UI:t visar kort faktabaserad rad ("Konsert med X
 *     på Y den 14 november.") om varken summary eller license-tillåten
 *     description finns.
 *
 * Run: npx vitest run 06-UI/utils/descriptionFallback.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getDetailsDescription,
  getDetailsDescriptionFallback,
  getRowDescriptionPreview,
  buildShortFactBasedLine,
  __test__,
} from './descriptionFallback';

const { hasRealDescription, chooseDescriptionField, FALLBACK_KEY, FALLBACK_UNKNOWN_KEY } = __test__;

describe('hasRealDescription', () => {
  it('returns false for null / undefined / empty', () => {
    expect(hasRealDescription(null)).toBe(false);
    expect(hasRealDescription(undefined)).toBe(false);
    expect(hasRealDescription('')).toBe(false);
    expect(hasRealDescription('   ')).toBe(false);
  });

  it('returns false for short placeholder strings (<10 chars)', () => {
    expect(hasRealDescription('Kort')).toBe(false);
    expect(hasRealDescription('Moto Boy')).toBe(false);
  });

  it('returns true for real descriptions (≥10 chars)', () => {
    expect(hasRealDescription('Dexys Midnight Runners | 2026-10-04')).toBe(true);
    expect(hasRealDescription('  Way Down We Go Tour ')).toBe(true);
  });
});

describe('chooseDescriptionField', () => {
  it('returns first non-empty candidate (≥10 chars)', () => {
    expect(chooseDescriptionField(null, '', 'a real description here')).toBe('a real description here');
    expect(chooseDescriptionField('first description', 'second description')).toBe('first description');
  });

  it('returns null when all candidates are too short (<10 chars)', () => {
    expect(chooseDescriptionField(null, '', 'short')).toBe(null);
  });

  it('returns null when all candidates empty', () => {
    expect(chooseDescriptionField(null, '', undefined)).toBe(null);
  });
});

describe('buildShortFactBasedLine (T0201)', () => {
  it('builds "Konsert med Artist X på Venue i Stad den D månad."', () => {
    const line = buildShortFactBasedLine({
      category_slug: 'music',
      artist: 'Artist X',
      venue_name: 'Avicii Arena',
      start_time: '2026-11-14T19:30:00Z',
    });
    expect(line).toContain('Konsert med Artist X');
    expect(line).toContain('Avicii Arena');
    expect(line).toContain('14 november');
  });

  it('builds line without artist (venue-led)', () => {
    const line = buildShortFactBasedLine({
      category_slug: 'theater',
      venue_name: 'Dramaten',
      start_time: '2026-12-01T19:00:00Z',
    });
    expect(line).toContain('Teater');
    expect(line).toContain('Dramaten');
  });

  it('returns null without start_time', () => {
    expect(buildShortFactBasedLine({
      category_slug: 'music',
      artist: 'X',
      venue_name: 'Y',
      start_time: null,
    })).toBe(null);
  });

  it('returns null without category_slug', () => {
    expect(buildShortFactBasedLine({
      artist: 'X',
      venue_name: 'Y',
      start_time: '2026-11-14T19:30:00Z',
    })).toBe(null);
  });

  it('returns null without artist AND venue', () => {
    expect(buildShortFactBasedLine({
      category_slug: 'music',
      start_time: '2026-11-14T19:30:00Z',
    })).toBe(null);
  });
});

describe('getDetailsDescription (P7 + T0201 resolution order)', () => {
  it('0) prefers editorial_description when present (P7 — MiniMax-M3)', () => {
    expect(
      getDetailsDescription({
        editorial_description: 'Hooligan Bobs intar Debaser med en svängig rockkonsert och publikrespons.',
        eventpulse_summary: 'Kort template-rad som INTE ska visas.',
        description_license: 'pressbild',
      })
    ).toBe('Hooligan Bobs intar Debaser med en svängig rockkonsert och publikrespons.');
  });

  it('0b) falls through to eventpulse_summary when editorial_description is null', () => {
    expect(
      getDetailsDescription({
        editorial_description: null,
        eventpulse_summary: 'Template-rad som vinner när editorial saknas.',
      })
    ).toBe('Template-rad som vinner när editorial saknas.');
  });

  it('0c) falls through to eventpulse_summary when editorial_description is too short (<10 chars)', () => {
    // Samma hasRealDescription-tröskel som andra fält.
    expect(
      getDetailsDescription({
        editorial_description: 'Kort',
        eventpulse_summary: 'Template-rad som vinner när editorial är för kort.',
      })
    ).toBe('Template-rad som vinner när editorial är för kort.');
  });

  it('0d) strips HTML in editorial_description (defensive — MiniMax-M3 ska inte leverera HTML)', () => {
    expect(
      getDetailsDescription({
        editorial_description: '<p>Hooligan Bobs intar Debaser med rockkonsert.</p>',
        eventpulse_summary: 'Template-rad som INTE ska visas.',
      })
    ).toBe('Hooligan Bobs intar Debaser med rockkonsert.');
  });

  it('1) prefers eventpulse_summary when present (and no editorial_description)', () => {
    expect(
      getDetailsDescription({
        eventpulse_summary: 'Konsert med Artist X på Avicii Arena den 14 november.',
        description_sv: 'Marknadsföringstext som INTE ska visas.',
        description_license: 'pressbild',
      })
    ).toBe('Konsert med Artist X på Avicii Arena den 14 november.');
  });

  it('2) shows description when description_license is "pressbild"', () => {
    expect(
      getDetailsDescription({
        description: 'Pressbild-beskrivning från kulturarrangören.',
        description_license: 'pressbild',
      })
    ).toBe('Pressbild-beskrivning från kulturarrangören.');
  });

  it('2b) shows description when description_license is "copyright-with-attribution"', () => {
    expect(
      getDetailsDescription({
        description_en: 'English description from API with attribution.',
        description_license: 'copyright-with-attribution',
      })
    ).toBe('English description from API with attribution.');
  });

  it('CRITICAL: does NOT show scraped description when license is "unknown" (default)', () => {
    expect(
      getDetailsDescription({
        description_sv: 'Scraped text som vi INTE får visa.',
        description_license: 'unknown',
      })
    ).toBe(null);  // ← INTE scraped text; null → fallback-kedja
  });

  it('CRITICAL: does NOT show scraped description when license is null', () => {
    expect(
      getDetailsDescription({
        description_sv: 'Scraped text — default-no-go utan license.',
        description_license: null,
      })
    ).toBe(null);
  });

  it('CRITICAL: does NOT show scraped description when license field is missing', () => {
    // Default-beteende enligt användarbeslut 2026-10-05: inget license = osynligt.
    expect(
      getDetailsDescription({
        description: 'Scraped description without license field.',
      })
    ).toBe(null);
  });

  it('3) shows faktabaserad kort rad om ingen license-tillåten description finns', () => {
    const result = getDetailsDescription({
      category_slug: 'music',
      artist: 'Artist Y',
      venue_name: 'Debaser',
      start_time: '2026-10-18T20:00:00Z',
      description_sv: 'Scraped text — ej tillåten.',
      description_license: 'unknown',
    });
    expect(result).toContain('Konsert med Artist Y');
    expect(result).toContain('Debaser');
    expect(result).not.toContain('Scraped');
  });

  it('4) returns null when even faktaraden inte kan byggas', () => {
    expect(
      getDetailsDescription({
        description: null,
        description_license: 'unknown',
      })
    ).toBe(null);
  });

  it('ignores short placeholders (<10 chars) in description', () => {
    expect(
      getDetailsDescription({
        description: 'Moto Boy',                    // too short
        description_sv: 'kort',                     // too short
        description_en: 'Dexys | 2026-10-04',       // 16-char placeholder pattern
        description_license: 'pressbild',
      })
    ).toBe('Dexys | 2026-10-04');
  });

  it('returns null for null/invalid event', () => {
    expect(getDetailsDescription(null as any)).toBe(null);
    expect(getDetailsDescription(undefined as any)).toBe(null);
    expect(getDetailsDescription('not an object' as any)).toBe(null);
  });
});

describe('getDetailsDescriptionFallback', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === FALLBACK_KEY) return `Ingen beskrivning från ${(params as any)?.source ?? '?'}.`;
    if (key === FALLBACK_UNKNOWN_KEY) return 'Ingen beskrivning finns.';
    return key;
  };
  const formatProviderLabel = (k: string) => k.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  it('names the source when source is set', () => {
    expect(
      getDetailsDescriptionFallback({ source: 'sthlmlist' }, t, { formatProviderLabel })
    ).toBe('Ingen beskrivning från Sthlmlist.');
  });

  it('uses raw source when formatProviderLabel is not given', () => {
    expect(getDetailsDescriptionFallback({ source: 'kultur-stockholm' }, t)).toBe(
      'Ingen beskrivning från kultur-stockholm.'
    );
  });

  it('uses unknownLabel when source is missing', () => {
    expect(getDetailsDescriptionFallback({}, t, { unknownLabel: 'okänd källa' })).toBe(
      'Ingen beskrivning från okänd källa.'
    );
  });

  it('uses FALLBACK_UNKNOWN_KEY string when no source/formatProviderLabel/unknownLabel', () => {
    expect(getDetailsDescriptionFallback({}, t)).toBe('Ingen beskrivning finns.');
  });
});

describe('getRowDescriptionPreview', () => {
  it('returns eventpulse_summary when present', () => {
    expect(
      getRowDescriptionPreview({
        eventpulse_summary: 'Konsert med Artist X på Avicii Arena.',
      })
    ).toBe('Konsert med Artist X på Avicii Arena.');
  });

  it('returns description only with license', () => {
    expect(
      getRowDescriptionPreview({
        description: 'Konstruktion och bild på Nacka konsthall',
        description_license: 'pressbild',
      })
    ).toBe('Konstruktion och bild på Nacka konsthall');
  });

  it('returns null when no description and no summary (preview row stays hidden)', () => {
    expect(
      getRowDescriptionPreview({
        description: null,
        description_sv: null,
        description_en: null,
      })
    ).toBe(null);
  });
});