/**
 * Tests for descriptionLicense — T0201 (2026-10-05).
 *
 * User contract:
 *   - Default = 'unknown' för ALLA källor utan explicit registry-override.
 *   - Registry-override respekteras om den finns och är tillåten enum.
 *   - 'unknown' är endast license som ALDRIG ger publikt exponeringsrätt.
 *   - forceUnknown vinner över allt (test/emergency-stopp).
 *
 * Run: npx vitest run 04-Normalizer/descriptionLicense.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDescriptionLicense,
  isPublicDescriptionLicense,
  __test__,
} from './descriptionLicense';

const { PUBLIC_DESCRIPTION_LICENSES } = __test__;

describe('PUBLIC_DESCRIPTION_LICENSES', () => {
  it('excludes "unknown" (default-no-go)', () => {
    expect(PUBLIC_DESCRIPTION_LICENSES).not.toContain('unknown');
  });

  it('includes the four allowed licenses', () => {
    expect(PUBLIC_DESCRIPTION_LICENSES).toEqual([
      'pressbild',
      'copyright-with-attribution',
      'partner-licensed',
      'public-domain',
    ]);
  });
});

describe('isPublicDescriptionLicense', () => {
  it('returns true for allowed licenses', () => {
    expect(isPublicDescriptionLicense('pressbild')).toBe(true);
    expect(isPublicDescriptionLicense('copyright-with-attribution')).toBe(true);
    expect(isPublicDescriptionLicense('partner-licensed')).toBe(true);
    expect(isPublicDescriptionLicense('public-domain')).toBe(true);
  });

  it('returns false for "unknown" and null', () => {
    expect(isPublicDescriptionLicense('unknown')).toBe(false);
    expect(isPublicDescriptionLicense(null)).toBe(false);
  });
});

describe('resolveDescriptionLicense — default behavior (T0201 user decision)', () => {
  it('returns "unknown" when no registry override is provided', () => {
    const r = resolveDescriptionLicense({ source: 'sthlmlist' });
    expect(r.license).toBe('unknown');
    expect(r.attribution).toBe(null);
    expect(r.rule).toBe('unknown-default');
  });

  it('returns "unknown" for null/undefined source', () => {
    expect(resolveDescriptionLicense({ source: null }).license).toBe('unknown');
    expect(resolveDescriptionLicense({ source: undefined }).license).toBe('unknown');
  });

  it('returns "unknown" when source is not in registry', () => {
    const r = resolveDescriptionLicense({
      source: 'thatsup-stockholm-articles',
      registry: { 'kulturhuset': { license: 'pressbild' } },
    });
    expect(r.license).toBe('unknown');
    expect(r.rule).toBe('unknown-default');
  });
});

describe('resolveDescriptionLicense — registry override', () => {
  const registry = {
    'billetto-se': { license: 'copyright-with-attribution' as const, attribution: 'Photo: Billetto' },
    'kulturhuset': { license: 'pressbild' as const },
    'konserthuset': { license: 'pressbild' as const },
    'wikimedia-events': { license: 'public-domain' as const, attribution: 'Wikimedia Commons' },
    'partner-x': { license: 'partner-licensed' as const },
  };

  it('uses registry override when present', () => {
    const r = resolveDescriptionLicense({ source: 'kulturhuset', registry });
    expect(r.license).toBe('pressbild');
    expect(r.attribution).toBe(null);
    expect(r.rule).toBe('registry-override');
  });

  it('preserves attribution from registry', () => {
    const r = resolveDescriptionLicense({ source: 'billetto-se', registry });
    expect(r.license).toBe('copyright-with-attribution');
    expect(r.attribution).toBe('Photo: Billetto');
    expect(r.rule).toBe('registry-override');
  });

  it('handles partner-licensed correctly', () => {
    const r = resolveDescriptionLicense({ source: 'partner-x', registry });
    expect(r.license).toBe('partner-licensed');
    expect(r.rule).toBe('registry-override');
  });

  it('handles public-domain correctly', () => {
    const r = resolveDescriptionLicense({ source: 'wikimedia-events', registry });
    expect(r.license).toBe('public-domain');
    expect(r.attribution).toBe('Wikimedia Commons');
    expect(r.rule).toBe('registry-override');
  });
});

describe('resolveDescriptionLicense — forceUnknown override', () => {
  it('forces "unknown" even when registry has override (test-only / emergency)', () => {
    const r = resolveDescriptionLicense({
      source: 'kulturhuset',
      registry: { 'kulturhuset': { license: 'pressbild' } },
      forceUnknown: true,
    });
    expect(r.license).toBe('unknown');
    expect(r.attribution).toBe(null);
    expect(r.rule).toBe('forced-unknown');
  });
});

describe('resolveDescriptionLicense — total contract', () => {
  it('does not mutate input', () => {
    const registry = { 'kulturhuset': { license: 'pressbild' as const } };
    const input = { source: 'kulturhuset', registry };
    const snapshot = JSON.parse(JSON.stringify(input));
    resolveDescriptionLicense(input);
    expect(input).toEqual(snapshot);
  });

  it('handles null registry (treated as empty)', () => {
    expect(resolveDescriptionLicense({ source: 'foo', registry: null }).license).toBe('unknown');
  });
});