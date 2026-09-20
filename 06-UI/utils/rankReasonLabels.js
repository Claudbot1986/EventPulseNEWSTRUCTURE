/**
 * RankReason → { icon, label, fullLabel } mapping.
 *
 * Source of truth for the enum: 08-Agent/types.ts (RankReason).
 * No free text. Each label is a short, deterministic phrase derived from the
 * enum value. Per vault 03-Patterns/40-UX-Research-Decisions.md:
 *   - Inline compact (icon + short label) under the card.
 *   - Max 2-3 visible, "visa mer" if more.
 *   - Never free text. Never tooltip-only on mobile.
 *
 * Labels/fullLabels come from the i18n dictionaries (`reason.<enum>.label` /
 * `reason.<enum>.full`) via the shared translate() fallback chain
 * (chosen → en → sv). Icons stay local here — they are pictographic,
 * not translated text.
 *
 * If a new enum value is added on the backend, add its icon here AND its
 * strings to i18n/strings/*.js — do NOT pass the raw string through to the
 * UI. Unknown values are filtered out by the caller (see resolveReason).
 */

import { translate } from '../i18n/translate';

import sv from '../i18n/strings/sv';
import en from '../i18n/strings/en';
import de from '../i18n/strings/de';
import no from '../i18n/strings/no';
import fi from '../i18n/strings/fi';
import da from '../i18n/strings/da';
import nl from '../i18n/strings/nl';
import fr from '../i18n/strings/fr';
import zhHans from '../i18n/strings/zhHans';
import it from '../i18n/strings/it';

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

const ICONS = {
  time_fit: '🕒',
  under_budget: '💰',
  over_budget: '💸',
  category_match: '🎯',
  exclude_match: '🚫',
  not_ended: '✅',
  high_confidence: '✨',
  low_confidence: '⚠️',
  stale: '🕰️',
  category_personalization: '🎯',
  venue_personalization_penalty: '📍',
  followed_venue: '⭐',
  followed_artist: '🎤',
};

/**
 * Resolve a single RankReason to a label entry. Returns null if the enum
 * value is unknown — caller must filter, never substitute a guess.
 */
export function resolveReason(reason, language = 'sv') {
  if (!reason || typeof reason !== 'string') {
    return null;
  }
  // The icon table is the enum gate: a reason without an icon has no
  // dictionary entry either and is by definition unknown.
  if (!Object.prototype.hasOwnProperty.call(ICONS, reason)) {
    return null;
  }
  return {
    key: reason,
    icon: ICONS[reason],
    label: translate(DICTIONARIES, language, `reason.${reason}.label`),
    fullLabel: translate(DICTIONARIES, language, `reason.${reason}.full`),
  };
}

/**
 * Resolve an array of reasons. Filters out unknown values. Preserves the
 * order given by the server (ranker emits reasons in push order, which is
 * roughly semantic — neutral/positive first, negative last).
 */
export function resolveReasons(reasons, language = 'sv') {
  if (!Array.isArray(reasons)) {
    return [];
  }
  return reasons.map((r) => resolveReason(r, language)).filter(Boolean);
}
