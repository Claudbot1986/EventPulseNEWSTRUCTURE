/**
 * i18n shell tests (Språkstöd 2026-09-20).
 *
 * The dictionary files are JS modules imported directly; the provider itself
 * is React and is exercised in Expo Go (auto-detect), so these tests pin the
 * two pure contracts: the lookup fallback chain (translate.js) and the
 * device-locale matcher (languages.js).
 *
 * Run with: npx vitest run 06-UI/i18n/i18n.test.ts   (from repo root)
 */

import { describe, expect, it } from 'vitest';

// JS modules — tsc resolves them via allowJs, so no directive needed.
import { translate } from './translate';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  isSupportedLanguage,
  matchDeviceLocale,
} from './languages';

const DICTS = {
  sv: { 'common.save': 'Spara', 'home.title': 'Hem', only_sv: 'Bara svenska' },
  en: { 'common.save': 'Save', 'home.title': 'Home' },
  de: { 'common.save': 'Speichern' },
  it: {},
};

describe('translate — fallback chain chosen → en → sv → key', () => {
  it('returns the chosen language string when present', () => {
    expect(translate(DICTS, 'de', 'common.save')).toBe('Speichern');
  });

  it('falls back to en when the chosen language misses the key', () => {
    expect(translate(DICTS, 'de', 'home.title')).toBe('Home');
  });

  it('falls back to sv when chosen and en both miss the key', () => {
    expect(translate(DICTS, 'en', 'only_sv')).toBe('Bara svenska');
    expect(translate(DICTS, 'de', 'only_sv')).toBe('Bara svenska');
  });

  it('echoes the key when nothing has it (visible gap, never blank)', () => {
    expect(translate(DICTS, 'de', 'missing.everywhere')).toBe('missing.everywhere');
  });

  it('interpolates {vars} and leaves unknown placeholders intact', () => {
    const dicts = { sv: { greet: 'Hej {name}, du har {count} kort' } };
    expect(translate(dicts, 'sv', 'greet', { name: 'Tomor', count: 3 })).toBe(
      'Hej Tomor, du har 3 kort',
    );
    expect(translate(dicts, 'sv', 'greet', {})).toBe('Hej {name}, du har {count} kort');
  });
});

describe('matchDeviceLocale', () => {
  it('maps exact supported tags', () => {
    expect(matchDeviceLocale({ languageTag: 'zh-Hans', languageCode: 'zh' })).toBe('zh-Hans');
  });

  it('maps sv-SE → sv, de-AT → de, en-US → en', () => {
    expect(matchDeviceLocale({ languageTag: 'sv-SE', languageCode: 'sv' })).toBe('sv');
    expect(matchDeviceLocale({ languageTag: 'de-AT', languageCode: 'de' })).toBe('de');
    expect(matchDeviceLocale({ languageTag: 'en-US', languageCode: 'en' })).toBe('en');
  });

  it('maps iOS Norwegian codes nb/nn → no', () => {
    expect(matchDeviceLocale({ languageTag: 'nb-NO', languageCode: 'nb' })).toBe('no');
    expect(matchDeviceLocale({ languageTag: 'nn-NO', languageCode: 'nn' })).toBe('no');
  });

  it('maps Simplified Chinese variants → zh-Hans', () => {
    expect(
      matchDeviceLocale({ languageTag: 'zh-Hans-CN', languageCode: 'zh', scriptCode: 'Hans' }),
    ).toBe('zh-Hans');
    // Older devices without scriptCode: mainland region implies Simplified.
    expect(matchDeviceLocale({ languageTag: 'zh-CN', languageCode: 'zh' })).toBe('zh-Hans');
  });

  it('returns null for Traditional Chinese (not covered)', () => {
    expect(
      matchDeviceLocale({ languageTag: 'zh-Hant-TW', languageCode: 'zh', scriptCode: 'Hant' }),
    ).toBeNull();
    expect(matchDeviceLocale({ languageTag: 'zh-TW', languageCode: 'zh' })).toBeNull();
  });

  it('returns null for unsupported languages and junk input', () => {
    expect(matchDeviceLocale({ languageTag: 'pt-BR', languageCode: 'pt' })).toBeNull();
    expect(matchDeviceLocale({ languageTag: 'ja-JP', languageCode: 'ja' })).toBeNull();
    expect(matchDeviceLocale(null)).toBeNull();
    expect(matchDeviceLocale({})).toBeNull();
  });
});

describe('language list', () => {
  it('contains exactly the 10 data-backed tags in picker order', () => {
    // SBR/Tillväxtverket 2025 — India fell out of the top markets → it, not hi.
    expect(LANGUAGES.map((l: { tag: string }) => l.tag)).toEqual([
      'sv',
      'en',
      'de',
      'no',
      'fi',
      'da',
      'nl',
      'fr',
      'zh-Hans',
      'it',
    ]);
  });

  it('default is sv and isSupportedLanguage guards the tag set', () => {
    expect(DEFAULT_LANGUAGE).toBe('sv');
    expect(isSupportedLanguage('zh-Hans')).toBe(true);
    expect(isSupportedLanguage('hi')).toBe(false);
    expect(isSupportedLanguage('sv-SE')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });
});
