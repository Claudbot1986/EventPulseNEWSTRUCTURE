/**
 * localTime — single source of truth for rendering UTC timestamps as
 * Europe/Stockholm wall-clock values.
 *
 * Background:
 *   Supabase stores `start_time` / `end_time` as UTC ISO 8601 strings
 *   (e.g., `2026-09-26T19:30:00+00:00`). The UI shows them to a Stockholm
 *   user who expects "19:30" to mean 19:30 CET/CEST — never 21:30 or
 *   17:30 depending on the day the code was written.
 *
 * Earlier the codebase used `iso.split('T')` and `new Date(dateString)`
 * to slice out the date and time. That returned the **UTC** components
 * verbatim — an event at 19:30 Stockholm-time (CEST = UTC+2) was rendered
 * as "17:30" because that's what the ISO string literally contained.
 *
 * This helper renders the same UTC instant in Europe/Stockholm via
 * `Intl.DateTimeFormat`, which handles DST transitions correctly (spring
 * forward, fall back) and stays correct even when the device's local
 * timezone is something else.
 *
 * Used by:
 *   - services/eventsCanonical.js (transformEvent)
 *   - services/eventsCanonical.cjs (same shape, CommonJS mirror)
 *   - App.js (formatDate / formatFullDate / formatDayHeader)
 *   - screens/MapScreen.js (formatDateShort)
 */

const STOCKHOLM_TZ = 'Europe/Stockholm';

// Long-lived formatter instances — Intl.DateTimeFormat is expensive to
// construct and the locale/timezone never change at runtime.
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: STOCKHOLM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: STOCKHOLM_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Parse an ISO 8601 string into a Date. Accepts both `Z` and `+00:00`
// suffixes (and bare offsets) — `new Date(...)` handles them all.
function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format an ISO 8601 timestamp as YYYY-MM-DD in Europe/Stockholm.
 * Returns '' when input is missing or invalid (never throws).
 *
 * @param {string|null|undefined} iso
 * @returns {string} e.g., "2026-09-26"
 */
export function formatLocalDate(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  // en-CA gives us the exact ISO order we want (Y-M-D) — no manual
  // padding/joining needed.
  return dateParts.format(d);
}

/**
 * Format an ISO 8601 timestamp as HH:MM in Europe/Stockholm (24-hour).
 * Returns '' when input is missing or invalid (never throws).
 *
 * @param {string|null|undefined} iso
 * @returns {string} e.g., "19:30"
 */
export function formatLocalTime(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  return timeParts.format(d);
}

/**
 * Parse a YYYY-MM-DD date-only string as midnight in Europe/Stockholm
 * (not local midnight, not UTC midnight). Used when grouping events
 * into day buckets so the user sees their day, not the server's.
 *
 * @param {string|null|undefined} dateString
 * @returns {Date|null}
 */
export function parseLocalDate(dateString) {
  if (!dateString) return null;
  const d = new Date(`${dateString}T00:00:00${getStockholmOffset(dateString)}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Long-lived parts formatters — one per weekday set we need. Same
// timezone, different fields. Cheap to construct up-front.
const stockholmDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: STOCKHOLM_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const stockholmWeekdayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: STOCKHOLM_TZ,
  weekday: 'long',
});

const stockholmWeekdayShortParts = new Intl.DateTimeFormat('en-US', {
  timeZone: STOCKHOLM_TZ,
  weekday: 'short',
});

/**
 * Extract calendar parts (year / month / day / weekday) for an ISO 8601
 * timestamp as seen from Europe/Stockholm. The fields are plain numbers
 * or English weekday strings — callers wrap them in their own language
 * names list (e.g., dateNamesFor('sv')).
 *
 * Replaces `date.getDay() / date.getDate() / date.getMonth() /
 * date.getFullYear()` after `new Date(iso)`, which is timezone-dependent
 * on the device and breaks near midnight for users west or east of UTC.
 *
 * @param {string|null|undefined} iso
 * @returns {{year: number, month: number, day: number, weekdayLong: string, weekdayShort: string}|null}
 */
export function getStockholmParts(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  const parts = stockholmDateParts.formatToParts(d);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayLong = stockholmWeekdayParts.format(d);
  const weekdayShort = stockholmWeekdayShortParts.format(d);
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekdayLong,
    weekdayShort,
  };
}

// Determine the Stockholm UTC offset on a given calendar date
// (CEST = +02:00 in summer, CET = +01:00 in winter). Used to build
// a Date that, when fed to `Intl.DateTimeFormat` with `Europe/Stockholm`,
// reproduces the same calendar day regardless of the device timezone.
function getStockholmOffset(dateString) {
  // Use Intl on a noop UTC parse of the date itself to learn the offset
  // for that day. 2026-03-29 02:00 → 03:00 is the DST flip in Sweden;
  // Intl picks the correct side.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ,
    timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(new Date(`${dateString}T12:00:00Z`));
  const tz = parts.find((p) => p.type === 'timeZoneName');
  if (!tz) return '+01:00'; // safe Stockholm default (CET)
  // tz.value looks like "GMT+01:00" or "GMT+02:00"
  const match = tz.value.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (!match) return '+01:00';
  return `${match[1]}:${match[2] || '00'}`;
}
