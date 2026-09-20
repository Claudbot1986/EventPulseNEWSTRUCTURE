/**
 * i18n shell (Språkstöd 2026-09-20) — deliberately a mini-module, NOT
 * i18next: the app has a flat key space (~80 strings, no plurals/ICU), so a
 * context + fallback chain is the simplest thing that works (KISS).
 *
 * Resolution rules
 *  - First launch: stored choice wins; absent → device locale via
 *    expo-localization, matched against LANGUAGES; no match → 'sv'.
 *  - Persistence: AsyncStorage always; server preference (best-effort) so a
 *    reinstalled/linked account keeps the choice.
 *  - Lookup: chosen → en → sv → key echo (gaps visible, never crash).
 *
 * Switching language re-renders the whole subscribed tree live — no reload.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getLocales } from 'expo-localization';

import { getItem, setItem } from '../services/storage';
import { savePreferencesToServer } from '../services/agentClient';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  matchDeviceLocale,
} from './languages';
import { translate } from './translate';
import { setUiLanguage } from './uiText';

import sv from './strings/sv';
import en from './strings/en';
import de from './strings/de';
import no from './strings/no';
import fi from './strings/fi';
import da from './strings/da';
import nl from './strings/nl';
import fr from './strings/fr';
import zhHans from './strings/zhHans';
import it from './strings/it';

const STORAGE_KEY = 'eventpulse.language';

const DICTIONARIES = {
  sv,
  en,
  de,
  no,
  fi,
  da,
  nl,
  fr,
  'zh-Hans': zhHans,
  it,
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);

  // Resolve the initial language once. AsyncStorage read uses the shared
  // storage wrapper (same hang-guard pattern as AppShell bootstrap).
  useEffect(() => {
    let alive = true;
    (async () => {
      let chosen = null;
      try {
        const stored = await getItem(STORAGE_KEY);
        if (isSupportedLanguage(stored)) chosen = stored;
      } catch (_err) {
        // Fall through to device detection.
      }
      if (!chosen) {
        const locales = getLocales();
        chosen = matchDeviceLocale(locales && locales[0]) || DEFAULT_LANGUAGE;
        // Persist the detection so the choice is stable across restarts.
        setItem(STORAGE_KEY, chosen).catch(() => {});
      }
      if (!alive) return;
      setLanguageState(chosen);
      // Keep the non-React channel (agentClient mappers) in sync.
      setUiLanguage(chosen);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setLanguage = useCallback((tag) => {
    if (!isSupportedLanguage(tag)) return;
    setLanguageState(tag);
    setUiLanguage(tag);
    setItem(STORAGE_KEY, tag).catch(() => {});
    // Best-effort server persistence — the existing preferences flow merges
    // this into user_preferences.preferences.locale. Auth-gated client side;
    // when logged out the local choice is still the source of truth.
    savePreferencesToServer({ locale: tag }).catch(() => {});
  }, []);

  const t = useCallback(
    (key, vars) => translate(DICTIONARIES, language, key, vars),
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Programming error — every render tree lives under the provider.
    throw new Error('useI18n must be used inside <LanguageProvider>');
  }
  return ctx;
}

export { STORAGE_KEY as LANGUAGE_STORAGE_KEY };
