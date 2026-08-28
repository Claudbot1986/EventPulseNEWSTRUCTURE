/**
 * 08-Agent/tools/temporal_sv — Stockholm-anchored Swedish date helpers.
 *
 * The product is Stockholm-only (MASTERPLAN §2), so every date arithmetic
 * in the agent must read the **wall-clock calendar date in Europe/Stockholm**,
 * not the server's runtime timezone. A naive `new Date().getDay()` on a
 * server running in UTC will silently misclassify "på fredag" near midnight
 * — and a `Date.toISOString().slice(0, 10)` will land on the previous or
 * next calendar day when the server's offset differs from Stockholm's.
 *
 * This module fixes both problems:
 *   - `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', ... })`
 *     reads year/month/day/weekday directly from the wall-clock, with
 *     DST handled by the platform's TZ database (the same approach
 *     `rank_events.ts:87-98` already uses for `hourInTimeZone`).
 *   - `nextWeekday` uses calendar-day arithmetic on those integers, not
 *     millisecond arithmetic on a `Date`, so DST shifts cannot
 *     move us onto the wrong day.
 *
 * Date math never uses `Date.setDate(...)` because that operates in the
 * *server's* local timezone. We always go through these helpers so the
 * Stockholm calendar is the single source of truth.
 *
 * No external dependencies. `Intl` (built into Node + every browser) is
 * sufficient. `date-fns-tz` is available if richer arithmetic is needed
 * later, but is not required for anything here.
 */

/** IANA timezone for the product. Single source of truth. */
export const STOCKHOLM_TZ = 'Europe/Stockholm';

/**
 * Swedish weekday names indexed by JavaScript `Date.getDay()`:
 *   0 = söndag, 1 = måndag, ..., 6 = lördag.
 */
export const SWEDISH_WEEKDAYS: readonly string[] = [
  'söndag',
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
];

export interface DateRange {
  from: string;
  to: string;
}

/** Internal: read the Stockholm YYYY-MM-DD parts for an instant. */
function stockholmYmd(now: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
  const m = parseInt(parts.find((p) => p.type === 'month')!.value, 10);
  const d = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
  return { y, m, d };
}

/** Format a (year, month, day) triple as YYYY-MM-DD in local numbers. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * The Stockholm calendar date for a given instant, formatted as YYYY-MM-DD.
 *
 * Pure function. Independent of the host's runtime TZ env — it always
 * reads from the named IANA zone via `Intl`.
 */
export function todayInStockholm(now: Date, timeZone: string = STOCKHOLM_TZ): string {
  const { y, m, d } = stockholmYmd(now, timeZone);
  return formatYmd(y, m, d);
}

/**
 * Stockholm weekday index (0=Sun..6=Sat), matching JavaScript `Date.getDay`.
 * Pure function. Use this anywhere you would otherwise call `today.getDay()`.
 */
export function weekdayInStockholm(now: Date, timeZone: string = STOCKHOLM_TZ): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
  }).formatToParts(now);
  const wk = parts.find((p) => p.type === 'weekday')!.value;
  // `en-CA` short weekday: Sun, Mon, Tue, Wed, Thu, Fri, Sat.
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const idx = map[wk];
  if (idx === undefined) return NaN;
  return idx;
}

/**
 * Format any Date as the YYYY-MM-DD in the named timezone.
 * Equivalent to `todayInStockholm`; exposed separately for symmetry with
 * `rank_events.hourInTimeZone`.
 */
export function isoDateInStockholm(now: Date, timeZone: string = STOCKHOLM_TZ): string {
  return todayInStockholm(now, timeZone);
}

/**
 * Shift a Stockholm calendar date by `delta` days.
 *
 * Implemented as integer arithmetic on (y, m, d) so DST cannot land us on
 * the wrong day. A naive `setDate(getDate() + 1)` on a `Date` runs in the
 * server's local timezone and would be wrong whenever the server is not
 * in CET/CEST — which is the whole point of this module.
 */
export function shiftDaysInStockholm(now: Date, timeZone: string, delta: number): string {
  const { y, m, d } = stockholmYmd(now, timeZone);
  // Construct a UTC date that *represents* the Stockholm calendar day,
  // then do integer-day arithmetic. Using UTC for the arithmetic avoids
  // any host TZ contamination.
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() + delta);
  return formatYmd(
    utcMidnight.getUTCFullYear(),
    utcMidnight.getUTCMonth() + 1,
    utcMidnight.getUTCDate()
  );
}

/**
 * Return the next occurrence of the requested weekday in Stockholm time.
 *
 * Semantics (mirrors `dateparser`'s `PREFER_DATES_FROM: future` and
 * Duckling's future grain bias, per MASTERPLAN §18.2 decision 3):
 *   - If `weekday === today`, return **today** — same-day rule.
 *   - Otherwise, return the forward occurrence (1..6 days ahead).
 *   - Never returns a past date.
 */
export function nextWeekday(now: Date, timeZone: string, weekday: number): string {
  const todayWd = weekdayInStockholm(now, timeZone);
  if (!Number.isFinite(todayWd)) {
    // Defensive: unknown weekday from Intl. Fall back to "today + 1d".
    return shiftDaysInStockholm(now, timeZone, 1);
  }
  const delta = weekday === todayWd
    ? 0
    : (weekday - todayWd + 7) % 7;
  return delta === 0
    ? todayInStockholm(now, timeZone)
    : shiftDaysInStockholm(now, timeZone, delta);
}

// ─── Date phrase matching ───────────────────────────────────────────────────
//
// All rules below are evaluated **in declaration order**, first-match wins.
// Order is significant: more specific phrases must come before more general
// ones, otherwise "i helgen" would be eaten by "i <something>".
//
// Every callback receives the matched range, the injected `now`, and the
// timezone, and returns `{ from, to }` (YYYY-MM-DD). The callback is the
// only place Stockholm-anchored math happens, so timezone bugs live here,
// not in the regex layer.

type DateRangeRule = {
  pattern: RegExp;
  build: (match: RegExpExecArray, now: Date, tz: string) => DateRange;
};

const DATE_RANGE_RULES: readonly DateRangeRule[] = [
  // ── Single-day relative phrases (specific → general) ────────────────────
  // ORDER MATTERS. "ikväll" must come before "imorgon" so the first wins on
  // overlapping queries like "ikväll imorgon". Similarly "i övermorgon" before
  // "övermorgon" before "imorgon".
  {
    pattern: /\b(i\s+övermorgon|i\s+overmorgon)\b/i,
    build: (_m, now, tz) => ({ from: shiftDaysInStockholm(now, tz, 2), to: shiftDaysInStockholm(now, tz, 2) }),
  },
  {
    pattern: /(?:^|\s)(övermorgon)\b/i,
    build: (_m, now, tz) => ({ from: shiftDaysInStockholm(now, tz, 2), to: shiftDaysInStockholm(now, tz, 2) }),
  },
  {
    pattern: /\b(ikväll|i\s+kväll|tonight|ikvällen)\b/i,
    build: (_m, now, tz) => ({ from: todayInStockholm(now, tz), to: todayInStockholm(now, tz) }),
  },
  {
    pattern: /\b(imorgon|i\s+morgon)\b/i,
    build: (_m, now, tz) => ({ from: shiftDaysInStockholm(now, tz, 1), to: shiftDaysInStockholm(now, tz, 1) }),
  },
  {
    pattern: /\b(idag|i\s+dag)\b/i,
    build: (_m, now, tz) => ({ from: todayInStockholm(now, tz), to: todayInStockholm(now, tz) }),
  },

  // ── "på <weekday>" / bare weekday → next occurrence (with same-day rule) ─
  ...SWEDISH_WEEKDAYS.map<DateRangeRule>((name, idx) => ({
    pattern: new RegExp(`\\b(på\\s+${name}|${name})\\b`, 'i'),
    build: (_m, now, tz) => ({ from: nextWeekday(now, tz, idx), to: nextWeekday(now, tz, idx) }),
  })),

  // ── Multi-day phrases ───────────────────────────────────────────────────
  {
    // "i helgen" / "helgen" / "denna helg" / "this weekend" / "i weekenden"
    // → Sat–Sun of the current/next Stockholm week.
    pattern: /\b(denna\s+helg|i\s+helgen|helgen|this\s+weekend|i\s+weekenden)\b/i,
    build: (_m, now, tz) => {
      // Anchor to today's Stockholm Saturday. If today is Sat or Sun,
      // keep that weekend; otherwise jump to the upcoming Sat.
      const wd = weekdayInStockholm(now, tz);
      const satDelta = wd === 6 ? 0 : wd === 0 ? -1 : (6 - wd + 7) % 7;
      const sat = shiftDaysInStockholm(now, tz, satDelta);
      const sun = shiftDaysInStockholm(
        new Date(`${sat}T12:00:00.000Z`),
        tz,
        1
      );
      return { from: sat, to: sun };
    },
  },
  {
    pattern: /\b(nästa\s+helg|next\s+weekend)\b/i,
    build: (_m, now, tz) => {
      const wd = weekdayInStockholm(now, tz);
      // "nästa helg" = the Saturday AFTER this week's Saturday.
      // From Sun (0): +6d → next Sat. From Mon (1): +12d → Sat after.
      // From Sat (6): +7d → next Sat (not this one).
      const satDelta = wd === 6 ? 7 : (6 - wd + 7) % 7 + 7;
      const sat = shiftDaysInStockholm(now, tz, satDelta);
      const sun = shiftDaysInStockholm(
        new Date(`${sat}T12:00:00.000Z`),
        tz,
        1
      );
      return { from: sat, to: sun };
    },
  },
  {
    pattern: /\b(denna\s+vecka|this\s+week|i\s+veckan)\b/i,
    build: (_m, now, tz) => {
      const wd = weekdayInStockholm(now, tz); // 0=Sun..6=Sat
      const mon = shiftDaysInStockholm(now, tz, wd === 0 ? -6 : 1 - wd);
      const sun = shiftDaysInStockholm(
        new Date(`${mon}T12:00:00.000Z`),
        tz,
        6
      );
      return { from: mon, to: sun };
    },
  },
  {
    pattern: /\b(nästa\s+vecka|next\s+week)\b/i,
    build: (_m, now, tz) => {
      const wd = weekdayInStockholm(now, tz);
      // Next Monday: from Sun, +1d; otherwise days until next Mon +7.
      const nextMonDelta = wd === 0 ? 1 : (1 - wd + 7) % 7 + 7;
      const mon = shiftDaysInStockholm(now, tz, nextMonDelta);
      const sun = shiftDaysInStockholm(
        new Date(`${mon}T12:00:00.000Z`),
        tz,
        6
      );
      return { from: mon, to: sun };
    },
  },
  {
    pattern: /\b(nästa\s+månad|next\s+month)\b/i,
    build: (_m, now, tz) => {
      const { y, m } = stockholmYmd(now, tz);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      // Last day of next month: day 0 of the month after that.
      const lastDay = new Date(Date.UTC(nextY, nextM, 0)).getUTCDate();
      return {
        from: formatYmd(nextY, nextM, 1),
        to: formatYmd(nextY, nextM, lastDay),
      };
    },
  },
];

/**
 * Resolve a free-text query to a Stockholm-anchored date range.
 *
 * Returns `null` when no date phrase is present. Caller decides whether to
 * default to "any date" or ask for clarification.
 *
 * Pure function — given the same (query, now, tz) tuple, returns the same
 * { from, to } pair. Tests inject a fixed `now` so the result is stable.
 */
export function parseSwedishDateRange(
  query: string,
  now: Date,
  timeZone: string = STOCKHOLM_TZ
): DateRange | null {
  for (const rule of DATE_RANGE_RULES) {
    const m = rule.pattern.exec(query);
    if (m) return rule.build(m, now, timeZone);
  }
  return null;
}