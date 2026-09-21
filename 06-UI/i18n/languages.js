/**
 * Supported UI languages (Språkstöd 2026-09-21).
 *
 * 2026-09-20 baseline: SBR/Tillväxtverket guest nights 2025
 * for Stockholm — USA, Germany, UK, Norway, Finland are the top-5 foreign
 * markets, Netherlands/France strongest growth, Denmark Nordic neighbor,
 * China long-haul, Italy national top-10 (India fell out of the 2025 lists
 * → hi dropped in favor of it). Swedish is the default (domestic majority).
 *
 * 2026-09-21 additions: 'ar' (Arabic), 'fa' (Persian/Farsi — covers
 * Iranian Persian + Afghan Dari as one tag per Stockholm-resident data),
 * 'so' (Somali), 'pl' (Polish), 'tr' (Turkish). Empty dictionaries — locale
 * is exposed in the picker now, strings fall back to en → sv until a
 * translator fills them in. No RTL layout work in this PR (per design:
 * held for the future Arab-region launch; Stockholm-resident users select
 * these in an otherwise LTR UI).
 *
 * `tag` is the app-internal locale code. The 2026-09-20 note also required
 * sync with the server's SUPPORTED_CURATED_LOCALES
 * (08-Agent/tools/curated_collections.ts); for these new tags we
 * deliberately DO NOT extend the server list in this PR — agent-side
 * language coverage is a separate decision (curated_collections drives
 * agent prompts and intent parsing, which is not the same surface as UI).
 * UI-only addition. Event-title translations will live in the
 * `event_translations` table (20260921 migration) and surface through
 * 08-Agent's existing /agent/feed fallback chain — see plan 2026-09-21.
 *
 * `nativeName` is rendered in the Profile language picker so every visitor
 * reads their own language name.
 */
export const LANGUAGES = [
  { tag: 'sv', nativeName: 'Svenska' },
  { tag: 'en', nativeName: 'English' },
  { tag: 'de', nativeName: 'Deutsch' },
  { tag: 'no', nativeName: 'Norsk' },
  { tag: 'fi', nativeName: 'Suomi' },
  { tag: 'da', nativeName: 'Dansk' },
  { tag: 'nl', nativeName: 'Nederlands' },
  { tag: 'fr', nativeName: 'Français' },
  { tag: 'zh-Hans', nativeName: '简体中文' },
  { tag: 'it', nativeName: 'Italiano' },
  { tag: 'ar', nativeName: 'العربية' },
  { tag: 'fa', nativeName: 'فارسی' },
  { tag: 'so', nativeName: 'Soomaali' },
  { tag: 'pl', nativeName: 'Polski' },
  { tag: 'tr', nativeName: 'Türkçe' },
];

export const DEFAULT_LANGUAGE = 'sv';

const SUPPORTED_TAGS = new Set(LANGUAGES.map((l) => l.tag));

export function isSupportedLanguage(tag) {
  return typeof tag === 'string' && SUPPORTED_TAGS.has(tag);
}

/**
 * Map an expo-localization locale object ({ languageTag, languageCode,
 * scriptCode, ... }) to a supported language tag, or null when the device
 * speaks a language we do not cover.
 *
 * Notable mappings:
 *  - iOS reports Norwegian as 'nb' / 'nn' — both map to 'no'.
 *  - Chinese is only supported in Simplified script; Traditional (TW/HK)
 *    devices fall through to null → caller applies DEFAULT_LANGUAGE.
 */
export function matchDeviceLocale(deviceLocale) {
  if (!deviceLocale || typeof deviceLocale !== 'object') return null;
  const { languageTag, languageCode, scriptCode } = deviceLocale;

  if (typeof languageTag === 'string' && SUPPORTED_TAGS.has(languageTag)) {
    return languageTag;
  }
  if (languageCode === 'zh') {
    // expo-localization exposes scriptCode ('Hans'/'Hant') on modern OSes.
    if (scriptCode === 'Hans') return 'zh-Hans';
    if (typeof languageTag === 'string' && /-(CN|SG|MY)(-|$)/.test(languageTag)) return 'zh-Hans';
    return null;
  }
  if (languageCode === 'nb' || languageCode === 'nn') return 'no';
  if (typeof languageCode === 'string' && SUPPORTED_TAGS.has(languageCode)) {
    return languageCode;
  }
  return null;
}
