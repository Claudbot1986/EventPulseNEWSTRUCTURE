/**
 * Tests for descriptionFallback helpers.
 *
 * The user-facing contract (2026-10-02):
 *   - DetailsScreen MUST show some description or an honest muted
 *     fallback ("Ingen beskrivning från {källa}") — never silently drop
 *     the section.
 *   - Utforska row MUST NOT show a preview when the event has no
 *     description (avoid blank space).
 *   - getRowDescriptionPreview MUST prefer `description` then sv then en.
 *   - getDetailsDescription MUST ignore short placeholder values
 *     (<10 chars).
 *
 * Run: npx vitest run 06-UI/utils/descriptionFallback.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getDetailsDescription,
  getDetailsDescriptionFallback,
  getRowDescriptionPreview,
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

describe('getDetailsDescription', () => {
  it('returns description when present and ≥10 chars', () => {
    expect(
      getDetailsDescription({
        description: 'A long enough description for the event',
      })
    ).toBe('A long enough description for the event');
  });

  it('falls back to description_sv when description is missing', () => {
    expect(
      getDetailsDescription({
        description: null,
        description_sv: 'Svensk beskrivning av eventet — hela meningen',
      })
    ).toBe('Svensk beskrivning av eventet — hela meningen');
  });

  it('falls back to description_en when both description and sv are missing', () => {
    expect(
      getDetailsDescription({
        description: null,
        description_sv: null,
        description_en: 'English fallback description for the event',
      })
    ).toBe('English fallback description for the event');
  });

  it('ignores short placeholders (<10 chars) and falls through', () => {
    // Real-world: sthlmlist "Dexys" placeholder via description_en
    expect(
      getDetailsDescription({
        description: 'Moto Boy',                  // too short
        description_sv: 'kort',                   // too short
        description_en: 'Dexys | 2026-10-04',     // 16-char placeholder pattern
      })
    ).toBe('Dexys | 2026-10-04'); // still passes the 10-char floor
  });

  it('returns null when no real description exists', () => {
    expect(getDetailsDescription({ description: null, description_sv: null, description_en: null })).toBe(null);
    expect(getDetailsDescription({})).toBe(null);
  });

  it('trims whitespace from chosen description', () => {
    expect(
      getDetailsDescription({
        description: '  Way Down We Go Tour  ',
      })
    ).toBe('Way Down We Go Tour');
  });

  it('returns null for null/invalid event', () => {
    expect(getDetailsDescription(null)).toBe(null);
    expect(getDetailsDescription(undefined)).toBe(null);
    expect(getDetailsDescription('not an object')).toBe(null);
  });
});

describe('getDetailsDescriptionFallback', () => {
  const t = (key, params) => {
    if (key === FALLBACK_KEY) return `Ingen beskrivning från ${params.source}.`;
    if (key === FALLBACK_UNKNOWN_KEY) return 'Ingen beskrivning finns.';
    return key;
  };
  const formatProviderLabel = (k) => k.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
  it('returns the description when present (Utforska row)', () => {
    expect(
      getRowDescriptionPreview({
        description: 'Konstruktion och bild på Nacka konsthall',
      })
    ).toBe('Konstruktion och bild på Nacka konsthall');
  });

  it('returns null when no description (preview row stays hidden)', () => {
    expect(
      getRowDescriptionPreview({
        description: null,
        description_sv: null,
        description_en: null,
      })
    ).toBe(null);
  });
});