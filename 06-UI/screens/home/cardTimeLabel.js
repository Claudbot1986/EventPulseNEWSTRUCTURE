/**
 * Hem card time-line label (2026-09-21, user direction via annotated
 * screenshot): every card in GRATIS and För dig — and, for one consistent
 * style, the weekend sections too — shows the DAY on the time line, after
 * the time, separated by a real round bullet:
 *
 *     display: "17:30 • LÖR"      spoken: "Lördag 17:30"
 *
 * Pure module so the exact composition is vitest-pinned
 * (cardTimeLabel.test.ts); HomeScreen's EventCardCompact only renders what
 * this returns. Day/month names come from i18n/dateNames (translate()
 * fallback chain: chosen → en → sv).
 */

import { dateNamesFor } from '../../i18n/dateNames';

/** Parse a YYYY-MM-DD (or datetime) string to a local Date at noon, or null. */
function parseIsoLocal(isoDate) {
  if (typeof isoDate !== 'string' || isoDate.length < 10) {
    return null;
  }
  // Noon avoids any DST-boundary ambiguity when constructing a local Date.
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bullet separator — U+2022 renders as a real round dot in every font. */
const BULLET = '•';

/**
 * @param {{date?: string|null, time?: string|null}|null|undefined} event
 * @param {string} language
 * @returns {{display: string, spoken: string}} display = "17:30 • LÖR"
 *   (short day, uppercase — no-op for zh-Hans); spoken = "Lördag 17:30"
 *   (full day name for screen readers). Missing pieces degrade: no time →
 *   day only; no date → time only; neither → empty strings.
 */
export function dayTimeLabel(event, language = 'sv') {
  const time = typeof event?.time === 'string' && event.time ? event.time : '';
  const d = event ? parseIsoLocal(event.date) : null;
  if (!d) {
    return { display: time, spoken: time };
  }
  const names = dateNamesFor(language);
  const dayShort = names.daysShort[d.getDay()].toUpperCase();
  const dayFull = names.daysFull[d.getDay()];
  return {
    display: [time, dayShort].filter(Boolean).join(` ${BULLET} `),
    spoken: [dayFull, time].filter(Boolean).join(' '),
  };
}
