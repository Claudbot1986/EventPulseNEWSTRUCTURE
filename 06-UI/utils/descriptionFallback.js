/**
 * Helpers for handling missing descriptions in event rows.
 *
 * Two callers:
 *   1. DetailsScreen (App.js ~line 1794): instead of silently dropping the
 *      "Om eventet" section when event.description is empty, show a muted
 *      fallback that names the source. User can decide whether to click the
 *      ticket URL or not — and we lose the "is this a bug?" ambiguity.
 *   2. Utforska row (UtforskaSection.js EventRow ~line 217): show a
 *      2-line description preview under the title when present.
 *
 * Pure functions — no React, no i18n runtime side effects beyond the
 * supplied `t` translator. Keeps them unit-testable without mounting.
 *
 * 2026-10-02 — see 02-Operations/2026-10-02-Description-Coverage-Investigation.md
 * §5.1 (UI-fallback + preview-rad).
 */

const FALLBACK_KEY = 'details.descriptionMissing';
const FALLBACK_UNKNOWN_KEY = 'details.descriptionMissingUnknown';

import { stripHtml } from './stripHtml.js';

function hasRealDescription(s) {
  return typeof s === 'string' && s.trim().length >= 10;
}

function chooseDescriptionField(...candidates) {
  for (const c of candidates) {
    // 2026-10-03 — stripHtml innan längd-koll så beskrivningar med enbart
    // HTML-taggar (t.ex. "<p></p>") inte räknas som "real".
    const cleaned = stripHtml(c);
    if (hasRealDescription(cleaned)) return cleaned.trim();
  }
  return null;
}

/**
 * Returns the description text to render in DetailsScreen, or null if
 * event.description (or any of the fallbacks) is empty. Caller decides
 * whether to show the "Om eventet" section.
 *
 * @param {{ description?: string|null, description_sv?: string|null,
 *           description_en?: string|null, source?: string|null }} event
 * @returns {string|null}
 */
export function getDetailsDescription(event) {
  if (!event || typeof event !== 'object') return null;
  return chooseDescriptionField(
    event.description,
    event.description_sv,
    event.description_en,
  );
}

/**
 * Returns the muted fallback text for DetailsScreen when the event has
 * no real description. Names the source so the user can judge whether
 * the data is worth clicking through to ticket_url.
 *
 * @param {{ source?: string|null }} event
 * @param {{ (key: string, params?: Record<string, unknown>) => string }} t
 * @param {{ formatProviderLabel?: (k: string) => string, unknownLabel?: string }} opts
 * @returns {string}
 */
export function getDetailsDescriptionFallback(event, t, opts = {}) {
  const formatProviderLabel = opts.formatProviderLabel;
  const unknownLabel = opts.unknownLabel;
  const raw = event?.source;
  let label;
  if (raw && typeof formatProviderLabel === 'function') {
    label = formatProviderLabel(raw);
  } else if (raw) {
    label = String(raw);
  } else if (unknownLabel) {
    label = unknownLabel;
  } else {
    return t(FALLBACK_UNKNOWN_KEY);
  }
  return t(FALLBACK_KEY, { source: label });
}

/**
 * Returns the description preview to render under the title in a row.
 * Two-line max — callers apply `numberOfLines={2} ellipsizeMode="tail"`.
 *
 * @param {{ description?: string|null, description_sv?: string|null,
 *           description_en?: string|null }} event
 * @returns {string|null}
 */
export function getRowDescriptionPreview(event) {
  return getDetailsDescription(event);
}

export const __test__ = {
  hasRealDescription,
  chooseDescriptionField,
  FALLBACK_KEY,
  FALLBACK_UNKNOWN_KEY,
};