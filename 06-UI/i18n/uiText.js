/**
 * Non-React access to the active UI language (Språkstöd 2026-09-20).
 *
 * Service modules without a React tree (agentClient's event mappers) can't
 * call useI18n(), but still bake UI text into event objects. They read the
 * active language here; the LanguageProvider in index.js keeps it in sync
 * via setUiLanguage().
 *
 * Lookup uses the same fallback chain as the hook (chosen → en → sv → key).
 * No imports from index.js — that would create a require cycle (index.js
 * imports savePreferencesToServer from services/agentClient).
 */

import { translate } from './translate';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages';

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
import ar from './strings/ar';

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
  ar,
};

let currentLanguage = DEFAULT_LANGUAGE;

export function setUiLanguage(tag) {
  if (isSupportedLanguage(tag)) currentLanguage = tag;
}

export function uiText(key, vars) {
  return translate(DICTIONARIES, currentLanguage, key, vars);
}

export function getUiLanguage() {
  return currentLanguage;
}
