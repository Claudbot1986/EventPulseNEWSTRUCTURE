/**
 * "Händer just nu" rules for the Home live strip (2026-09-20, user spec):
 *
 *   - Same day: show events that have not happened yet by clock time.
 *     (Started-but-not-ended events count as "not happened yet".)
 *   - An event disappears 3 hours after it ENDED. Events missing end_time
 *     fall back to their start time (i.e. gone 3h after start).
 *   - Overnight events (22:00–02:00) roll the end into the next day.
 *   - If nothing remains today at all, surface the next day that DOES have
 *     hand-picked events — "Imorgon" or the weekday — instead of going quiet.
 *
 * Pure module (no React / no fetch) so vitest can pin every edge — see
 * happeningNow.test.ts. The component does IO (fetchRecommendedEvents) and
 * delegates all picking logic here.
 */

/** 3-hour grace tail after an event ends, per spec. */
export const END_GRACE_MS = 3 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Local YYYY-MM-DD for a Date. */
export function localIsoOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a local event date + optional 'HH:MM' into a Date, or null. */
function parseLocal(dateIso, time) {
  if (typeof dateIso !== 'string') return null;
  const [y, m, d] = dateIso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = typeof time === 'string' && time.length >= 4
    ? time.split(':').map(Number)
    : [0, 0];
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

/**
 * The moment an event is considered "over". Overnight end times
 * (end <= start, e.g. 22:00–02:00) roll into the next day. Missing end_time
 * falls back to the start time; missing both falls back to end of day.
 */
export function eventEndDate(event) {
  const start = parseLocal(event?.date, event?.time);
  // parseLocal(undefined time) returns midnight — only treat end as present
  // when end_time is actually a string, or the fallbacks below never run.
  const end = typeof event?.end_time === 'string'
    ? parseLocal(event?.date, event.end_time)
    : null;
  if (start && end) {
    return end > start ? end : new Date(end.getTime() + MS_PER_DAY);
  }
  if (end) return end;
  if (start && typeof event?.time === 'string') return start;
  const day = parseLocal(event?.date, null);
  return day ? new Date(day.getTime() + MS_PER_DAY) : null;
}

function eventStartMs(event) {
  const start = parseLocal(event?.date, event?.time);
  return start ? start.getTime() : 0;
}

function byStartTimeAsc(a, b) {
  return eventStartMs(a) - eventStartMs(b);
}

/**
 * Pick what the strip should show right now.
 *
 * @param {Array} events  hand-picked events (any dates), unsorted ok.
 * @param {Date}  now
 * @returns {{ kind: 'today'|'later'|'empty', dateIso: string|null, events: Array }}
 *   kind 'today' → today's not-yet-finished events (grace applied).
 *   kind 'later' → earliest future date with events, all of them that day.
 *   kind 'empty' → nothing at all (caller hides the section).
 */
export function pickHappeningNow(events, now = new Date()) {
  const list = Array.isArray(events) ? events : [];
  const todayIso = localIsoOf(now);
  const nowMs = now.getTime();

  const todaysEvents = list
    .filter((ev) => ev?.date === todayIso)
    .filter((ev) => {
      const end = eventEndDate(ev);
      return end !== null && end.getTime() + END_GRACE_MS > nowMs;
    })
    .sort(byStartTimeAsc);

  if (todaysEvents.length > 0) {
    return { kind: 'today', dateIso: todayIso, events: todaysEvents };
  }

  // Fallback: earliest future date that has any hand-picked events at all.
  const futureDates = new Set(
    list
      .filter((ev) => parseLocal(ev?.date, null) !== null && ev.date > todayIso)
      .map((ev) => ev.date)
  );
  const nextDate = Array.from(futureDates).sort()[0] ?? null;
  if (!nextDate) {
    return { kind: 'empty', dateIso: null, events: [] };
  }
  return {
    kind: 'later',
    dateIso: nextDate,
    events: list.filter((ev) => ev?.date === nextDate).sort(byStartTimeAsc),
  };
}

/**
 * Display-label descriptor for the section title. 'today' and 'tomorrow'
 * resolve to i18n keys in the component; 'weekday' carries the Date parts
 * so the component can localize via dateNamesFor(language).
 *
 * @returns {{ type: 'today' } | { type: 'tomorrow' } |
 *            { type: 'weekday', dayIndex: number, dayOfMonth: number, monthIndex: number } }
 */
export function happeningTitleParts(pick, now = new Date()) {
  if (!pick || pick.kind === 'today' || !pick.dateIso) return { type: 'today' };
  const tomorrowIso = localIsoOf(new Date(now.getTime() + MS_PER_DAY));
  if (pick.dateIso === tomorrowIso) return { type: 'tomorrow' };
  const d = parseLocal(pick.dateIso, null);
  if (!d) return { type: 'tomorrow' };
  return { type: 'weekday', dayIndex: d.getDay(), dayOfMonth: d.getDate(), monthIndex: d.getMonth() };
}

/**
 * Next Saturday as local YYYY-MM-DD (today if today IS Saturday).
 * Lives here so both the weekend-intent jump (App.js) and tests share
 * one definition. Used when a "helgen" chip lands: the browse feed is a
 * 50-event ascending page, so the list must refetch anchored at Saturday
 * or weekend events never enter the window.
 */
export function nextSaturdayIso(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = base.getDay();
  const offset = day === 6 ? 0 : (6 - day + 7) % 7;
  return localIsoOf(new Date(base.getTime() + offset * MS_PER_DAY));
}

/**
 * Feed-window anchor for weekend-intent chips (2026-09-20). /agent/feed
 * pages are 50 events ascending from `from`, so on dense weeks Saturday's
 * rows never reach the client and a 'helgen' filter matched zero. Anchor:
 *   - Saturday or Sunday → today (the weekend is happening NOW; the feed
 *     excludes past start times server-side, so nothing stale leaks in).
 *   - Monday–Friday → the coming Saturday.
 */
export function weekendFeedAnchorIso(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return localIsoOf(now);
  return nextSaturdayIso(now);
}
