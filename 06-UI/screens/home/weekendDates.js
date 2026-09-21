/**
 * Din helg (2026-09-20): the upcoming Friday–Sunday as a set of local
 * YYYY-MM-DD strings. On Fri/Sat/Sun "the weekend" IS this weekend (today
 * included); Mon–Thu it means the coming one. The v1 Din helg section is a
 * client-side filter over /agent/recommended — no server route (per plan).
 *
 * Lives in its own module so vitest can pin the day-edge semantics
 * (see weekendDates.test.ts).
 *
 * 2026-09-21: weekend cards also carry a per-card day label and run
 * chronologically (Fre → Lör → Sön) — compareDayTimeAsc + dayLabelForIso.
 */

import { dateNamesFor } from '../../i18n/dateNames';

function localIso(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Localized short day label for a YYYY-MM-DD iso, e.g. 'Fre' (sv) / 'Fri'
 * (en). Empty string for missing/unparseable input — the card then renders
 * time only. Datetime-shaped values ('…T19:00:00') are tolerated.
 */
export function dayLabelForIso(isoDate, language = 'sv') {
  if (typeof isoDate !== 'string' || isoDate.length < 10) {
    return '';
  }
  // Noon avoids any DST-boundary ambiguity when constructing a local Date.
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return dateNamesFor(language).daysShort[d.getDay()];
}

/**
 * Chronological card order: date ascending (Friday before Saturday before
 * Sunday — the user-visible weekend order), then start time ascending
 * within a day. Rows without a date sort last; rows without a time sort
 * after timed rows on the same date. Tolerates null/undefined rows.
 */
export function compareDayTimeAsc(a, b) {
  const da = typeof a?.date === 'string' ? a.date.slice(0, 10) : '';
  const db = typeof b?.date === 'string' ? b.date.slice(0, 10) : '';
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  const ta = typeof a?.time === 'string' ? a.time : '';
  const tb = typeof b?.time === 'string' ? b.time : '';
  if (ta === tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta < tb ? -1 : 1;
}

export function upcomingWeekendIsoSet(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = base.getDay(); // 0=Sun, 1=Mon … 5=Fri, 6=Sat
  const friOffset = day === 5 ? 0 : day === 6 ? -1 : day === 0 ? -2 : 5 - day;
  const fri = new Date(base);
  fri.setDate(base.getDate() + friOffset);
  const sat = new Date(fri);
  sat.setDate(fri.getDate() + 1);
  const sun = new Date(fri);
  sun.setDate(fri.getDate() + 2);
  return new Set([localIso(fri), localIso(sat), localIso(sun)]);
}
