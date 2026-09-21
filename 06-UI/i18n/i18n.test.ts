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

  it('maps Arabic region variants (ar-SA, ar-EG, ar-AE) → ar', () => {
    // 2026-09-21: Arabic added. Region suffixes (SA/EG/AE/MA…) all collapse
    // to the bare 'ar' tag; we don't ship region-specific dialects yet.
    expect(matchDeviceLocale({ languageTag: 'ar-SA', languageCode: 'ar' })).toBe('ar');
    expect(matchDeviceLocale({ languageTag: 'ar-EG', languageCode: 'ar' })).toBe('ar');
    expect(matchDeviceLocale({ languageTag: 'ar-AE', languageCode: 'ar' })).toBe('ar');
    expect(matchDeviceLocale({ languageTag: 'ar', languageCode: 'ar' })).toBe('ar');
  });

  it('maps Persian/Farsi region variants (fa-IR, fa-AF) → fa', () => {
    // 2026-09-21: 'fa' covers both Iranian Persian and Afghan Dari as one
    // tag — user decision. Region suffixes collapse to 'fa'.
    expect(matchDeviceLocale({ languageTag: 'fa-IR', languageCode: 'fa' })).toBe('fa');
    expect(matchDeviceLocale({ languageTag: 'fa-AF', languageCode: 'fa' })).toBe('fa');
    expect(matchDeviceLocale({ languageTag: 'fa', languageCode: 'fa' })).toBe('fa');
  });

  it('maps Somali, Polish, Turkish → so/pl/tr', () => {
    expect(matchDeviceLocale({ languageTag: 'so-SO', languageCode: 'so' })).toBe('so');
    expect(matchDeviceLocale({ languageTag: 'so-ET', languageCode: 'so' })).toBe('so');
    expect(matchDeviceLocale({ languageTag: 'pl-PL', languageCode: 'pl' })).toBe('pl');
    expect(matchDeviceLocale({ languageTag: 'pl', languageCode: 'pl' })).toBe('pl');
    expect(matchDeviceLocale({ languageTag: 'tr-TR', languageCode: 'tr' })).toBe('tr');
    expect(matchDeviceLocale({ languageTag: 'tr', languageCode: 'tr' })).toBe('tr');
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
  it('contains exactly the 15 data-backed tags in picker order', () => {
    // 2026-09-20 baseline: SBR/Tillväxtverket 2025 — India fell out of the
    // top markets → it, not hi.
    // 2026-09-21 (commit 2bd0db9): + 'ar' (Arabic) — UI-only.
    // 2026-09-21 (this commit): + 'fa' (Persian, covering Iranian Persian
    // and Afghan Dari per user decision), 'so' (Somali), 'pl' (Polish),
    // 'tr' (Turkish). All UI-only — agent API is not extended; event-title
    // translations land via event_translations table (migration
    // 20260921-0001).
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
      'ar',
      'fa',
      'so',
      'pl',
      'tr',
    ]);
  });

  it('default is sv and isSupportedLanguage guards the tag set', () => {
    expect(DEFAULT_LANGUAGE).toBe('sv');
    expect(isSupportedLanguage('zh-Hans')).toBe(true);
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('fa')).toBe(true);
    expect(isSupportedLanguage('so')).toBe(true);
    expect(isSupportedLanguage('pl')).toBe(true);
    expect(isSupportedLanguage('tr')).toBe(true);
    expect(isSupportedLanguage('hi')).toBe(false);
    expect(isSupportedLanguage('sv-SE')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });
});
