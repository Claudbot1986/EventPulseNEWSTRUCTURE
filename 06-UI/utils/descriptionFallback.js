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
 *
 * 2026-10-05 — T0201: description-en/sv exponeras BARA om description_license
 * är tillåtande (default 'unknown' → osynligt). UI:t ska aldrig falla tillbaka
 * till scraped source-text automatiskt. Ny ordning:
 *   1. eventpulse_summary (primär — faktabaserad, neutral)
 *   2. Faktbaserad kort rad ("Konsert med X på Y i Stockholm den 14 november.")
 *      byggd från typ/artist/venue/stad/datum.
 *   3. description_en/sv ENDAST om license är tillåtande (säker fallback).
 *   4. Aldrig: scraped raw description eller license='unknown' text.
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
 * Lista av licenses som tillåter publik visning av description_en/sv.
 * Speglar `descriptionLicense.PUBLIC_DESCRIPTION_LICENSES` i 04-Normalizer.
 */
const PUBLIC_LICENSES = new Set([
  'pressbild',
  'copyright-with-attribution',
  'partner-licensed',
  'public-domain',
]);

function isPublicLicense(license) {
  return license != null && PUBLIC_LICENSES.has(license);
}

/**
 * Bygg en kort faktabaserad beskrivning från strukturerade fält.
 * Detta är UI:s sista "säkra" rad om varken eventpulse_summary eller en
 * tillåten description finns.
 *
 * Format: "{typ} {med artist} {datum}." eller "{typ} {på venue} {datum}."
 *
 * Returnerar null om vi inte ens har typ + datum + (artist|venue).
 */
export function buildShortFactBasedLine(event) {
  if (!event || typeof event !== 'object') return null;
  const type = event.category_slug || null;
  const artist = event.artist || event.headliner || null;
  const venue = event.venue_name || event.venue || null;
  const start = event.start_time || null;

  // Vi kräver typ + datum + (artist ELLER venue)
  if (!type || !start) return null;
  if (!artist && !venue) return null;

  // Extrahera datum och tid på svenska
  let datePart = '';
  try {
    const d = new Date(start);
    if (!isNaN(d.getTime())) {
      const months = [
        'januari', 'februari', 'mars', 'april', 'maj', 'juni',
        'juli', 'augusti', 'september', 'oktober', 'november', 'december',
      ];
      datePart = `${d.getDate()} ${months[d.getMonth()]}`;
    }
  } catch {
    // ignore
  }
  if (!datePart) return null;

  // Typ → svenska
  const typeMap = {
    music: 'Konsert',
    concert: 'Konsert',
    theater: 'Teater',
    teater: 'Teater',
    standup: 'Standup',
    comedy: 'Standup',
    'art-exhibitions': 'Utställning',
    exhibition: 'Utställning',
    festival: 'Festival',
    workshop: 'Workshop',
    film: 'Visning',
    screening: 'Visning',
    sport: 'Sportevenemang',
    community: 'Evenemang',
  };
  const typeSv = typeMap[type] || 'Evenemang';

  // Sätt ihop
  let line = typeSv;
  if (artist) {
    line += ` med ${artist}`;
  }
  if (venue) {
    line += artist ? ` på ${venue}` : ` på ${venue}`;
  }
  line += ` den ${datePart}.`;
  return line;
}

/**
 * Returns the description text to render in DetailsScreen, or null if
 * the event has no real description. Caller decides whether to show
 * the "Om eventet" section.
 *
 * Resolution order (T0201):
 *   1. eventpulse_summary (primary — fact-based, neutral)
 *   2. description_en/sv ENDAST om description_license är tillåtande
 *      (vi ALDRIG visar scraped text om license='unknown')
 *   3. Faktbaserad kort rad byggd från strukturerade fält
 *   4. null → UI visar muted fallback
 *
 * @param {{ eventpulse_summary?: string|null, description?: string|null,
 *           description_sv?: string|null, description_en?: string|null,
 *           description_license?: string|null, source?: string|null,
 *           category_slug?: string|null, artist?: string|null,
 *           venue_name?: string|null, venue?: string|null,
 *           start_time?: string|null }} event
 * @returns {string|null}
 */
export function getDetailsDescription(event) {
  if (!event || typeof event !== 'object') return null;

  // 1. Primär: eventpulse_summary
  if (event.eventpulse_summary && hasRealDescription(event.eventpulse_summary)) {
    return stripHtml(event.eventpulse_summary).trim();
  }

  // 2. Beskrivning ENDAST om license är tillåtande
  // (default 'unknown' blockerar scraped source text)
  if (isPublicLicense(event.description_license)) {
    const fromDescription = chooseDescriptionField(
      event.description,
      event.description_sv,
      event.description_en,
    );
    if (fromDescription) return fromDescription;
  }

  // 3. Faktbaserad kort rad (aldrig scraped text)
  const factBased = buildShortFactBasedLine(event);
  if (factBased) return factBased;

  // 4. null → UI visar muted fallback
  return null;
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
 * Samma T0201-resolution som getDetailsDescription.
 *
 * @param {{ eventpulse_summary?: string|null, description?: string|null,
 *           description_sv?: string|null, description_en?: string|null,
 *           description_license?: string|null,
 *           category_slug?: string|null, artist?: string|null,
 *           venue_name?: string|null, venue?: string|null,
 *           start_time?: string|null }} event
 * @returns {string|null}
 */
export function getRowDescriptionPreview(event) {
  return getDetailsDescription(event);
}

export const __test__ = {
  hasRealDescription,
  chooseDescriptionField,
  buildShortFactBasedLine,
  FALLBACK_KEY,
  FALLBACK_UNKNOWN_KEY,
  PUBLIC_LICENSES,
};