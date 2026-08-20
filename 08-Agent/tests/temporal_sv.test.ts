/**
 * Tests for `tools/temporal_sv.ts` — Stockholm-anchored Swedish date helpers.
 *
 * Strategy:
 *   - All tests inject a fixed `now: Date` (no real-clock dependency).
 *   - Wall-clock semantics are verified by reading values back via
 *     `Intl.DateTimeFormat` with `en-CA` (YYYY-MM-DD) — the same approach
 *     used by `rank_events.ts` and the production code under test.
 *   - DST is exercised by injecting "now" at the *exact* moment of the
 *     spring/fall transition (last Sunday of March and October in 2026).
 *
 * Run with:  npx vitest run 08-Agent/tests/temporal_sv.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  todayInStockholm,
  weekdayInStockholm,
  nextWeekday,
  shiftDaysInStockholm,
  isoDateInStockholm,
  SWEDISH_WEEKDAYS,
  parseSwedishDateRange,
} from '../tools/temporal_sv';

const TZ = 'Europe/Stockholm';

/**
 * Convenience: the YYYY-MM-DD Stockholm date string for a given UTC instant.
 * Used as the *expected* anchor in tests that check the helpers themselves.
 */
function stockholmDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

describe('todayInStockholm', () => {
  it('returns the Stockholm calendar date for a UTC instant', () => {
    // 2026-08-17 is a Monday. 10:00 UTC → 12:00 CEST (UTC+2 in August).
    const now = new Date('2026-08-17T10:00:00.000Z');
    expect(todayInStockholm(now, TZ)).toBe('2026-08-17');
  });

  it('does not slip to the previous day for early-morning UTC instants', () => {
    // 2026-08-17 00:30 UTC → 02:30 CEST (still same Stockholm day).
    const now = new Date('2026-08-17T00:30:00.000Z');
    expect(todayInStockholm(now, TZ)).toBe('2026-08-17');
  });

  it('rolls forward past midnight Stockholm time', () => {
    // 2026-08-17 22:30 UTC → 2026-08-18 00:30 CEST (next Stockholm day).
    const now = new Date('2026-08-17T22:30:00.000Z');
    expect(todayInStockholm(now, TZ)).toBe('2026-08-18');
  });

  it('survives the spring DST transition (CEST begins)', () => {
    // 2026-03-29 is the last Sunday of March. CET→CEST at 02:00 → 03:00.
    // 00:30 UTC → 01:30 CET (still March 29 in Stockholm).
    const before = new Date('2026-03-29T00:30:00.000Z');
    expect(todayInStockholm(before, TZ)).toBe('2026-03-29');
    // 02:30 UTC → 04:30 CEST (still March 29, the clock-jump hour).
    const during = new Date('2026-03-29T02:30:00.000Z');
    expect(todayInStockholm(during, TZ)).toBe('2026-03-29');
  });

  it('survives the fall DST transition (CEST ends)', () => {
    // 2026-10-25 is the last Sunday of October. CEST→CET at 03:00 → 02:00.
    // 00:30 UTC → 02:30 CEST (still Oct 25 in Stockholm).
    const before = new Date('2026-10-25T00:30:00.000Z');
    expect(todayInStockholm(before, TZ)).toBe('2026-10-25');
    // 02:30 UTC → 03:30 CET (still Oct 25, after the clock falls back).
    const after = new Date('2026-10-25T02:30:00.000Z');
    expect(todayInStockholm(after, TZ)).toBe('2026-10-25');
  });
});

describe('weekdayInStockholm', () => {
  it('returns Monday=1 ... Sunday=0 (JavaScript Date.getDay convention)', () => {
    // 2026-08-17 is a Monday in Stockholm.
    const mon = new Date('2026-08-17T12:00:00.000Z'); // 14:00 CEST
    expect(weekdayInStockholm(mon, TZ)).toBe(1);
    const sun = new Date('2026-08-23T12:00:00.000Z'); // 14:00 CEST, Sunday
    expect(weekdayInStockholm(sun, TZ)).toBe(0);
  });

  it('does not depend on the server runtime timezone', () => {
    // Same instant — weekday should be 1 (Mon) in Stockholm regardless of
    // the host machine's TZ env. The helper reads via Intl explicitly.
    const now = new Date('2026-08-17T10:00:00.000Z');
    expect(weekdayInStockholm(now, TZ)).toBe(1);
  });
});

describe('SWEDISH_WEEKDAYS', () => {
  it('covers all seven weekdays with the expected JS getDay mapping', () => {
    expect(SWEDISH_WEEKDAYS[0]).toBe('söndag');
    expect(SWEDISH_WEEKDAYS[1]).toBe('måndag');
    expect(SWEDISH_WEEKDAYS[2]).toBe('tisdag');
    expect(SWEDISH_WEEKDAYS[3]).toBe('onsdag');
    expect(SWEDISH_WEEKDAYS[4]).toBe('torsdag');
    expect(SWEDISH_WEEKDAYS[5]).toBe('fredag');
    expect(SWEDISH_WEEKDAYS[6]).toBe('lördag');
  });
});

describe('nextWeekday', () => {
  it('returns today when the requested weekday matches today (same-day rule)', () => {
    // Today (Mon 2026-08-17 10:00 UTC, 12:00 CEST) — ask for "måndag" → today.
    const now = new Date('2026-08-17T10:00:00.000Z');
    const result = nextWeekday(now, TZ, 1);
    expect(result).toBe('2026-08-17');
  });

  it('returns next-week for "fredag" when today is Monday', () => {
    const now = new Date('2026-08-17T10:00:00.000Z'); // Mon
    expect(nextWeekday(now, TZ, 5)).toBe('2026-08-21'); // Fri
  });

  it('returns next-week for "söndag" when today is Saturday', () => {
    const now = new Date('2026-08-22T10:00:00.000Z'); // Sat
    expect(nextWeekday(now, TZ, 0)).toBe('2026-08-23'); // Sun (this Sunday)
  });

  it('returns next-week for "måndag" when today is Sunday (rolls forward, never back)', () => {
    const now = new Date('2026-08-23T10:00:00.000Z'); // Sun
    expect(nextWeekday(now, TZ, 1)).toBe('2026-08-24'); // Mon (next week)
  });
});

describe('shiftDaysInStockholm', () => {
  it('shifts +1 day across a Stockholm midnight', () => {
    // Instant: 2026-08-17T22:00Z = 00:00 CEST Aug 18 in Stockholm.
    // todayInStockholm returns '2026-08-18'; +1 day → '2026-08-19'.
    const now = new Date('2026-08-17T22:00:00.000Z'); // 00:00 CEST Aug 18
    expect(todayInStockholm(now, TZ)).toBe('2026-08-18');
    expect(shiftDaysInStockholm(now, TZ, 1)).toBe('2026-08-19');
  });

  it('shifts -1 day across a Stockholm midnight', () => {
    const now = new Date('2026-08-17T22:00:00.000Z'); // 00:00 CEST Aug 18
    expect(shiftDaysInStockholm(now, TZ, -1)).toBe('2026-08-17');
  });

  it('crosses a DST boundary correctly (spring forward, +1 day)', () => {
    // 2026-03-28 23:00 CET → 2026-03-29 00:00 CET, which becomes 01:00 CEST.
    const now = new Date('2026-03-28T22:00:00.000Z');
    expect(shiftDaysInStockholm(now, TZ, 1)).toBe('2026-03-29');
  });

  it('crosses a DST boundary correctly (fall back, +1 day)', () => {
    // 2026-10-25 00:30 UTC → 02:30 CEST (still Oct 25).
    const now = new Date('2026-10-25T00:30:00.000Z');
    expect(shiftDaysInStockholm(now, TZ, 1)).toBe('2026-10-26');
  });
});

describe('isoDateInStockholm', () => {
  it('formats the Stockholm calendar date as YYYY-MM-DD', () => {
    const now = new Date('2026-08-17T10:00:00.000Z');
    expect(isoDateInStockholm(now, TZ)).toBe('2026-08-17');
  });

  it('produces the same string as Intl for cross-validation', () => {
    const fixtures = [
      '2026-01-01T00:00:00.000Z',
      '2026-06-15T12:00:00.000Z',
      '2026-08-17T22:30:00.000Z',
      '2026-12-31T23:30:00.000Z',
      '2026-03-29T01:30:00.000Z', // DST spring
      '2026-10-25T01:30:00.000Z', // DST fall
    ];
    for (const iso of fixtures) {
      const d = new Date(iso);
      expect(isoDateInStockholm(d, TZ)).toBe(stockholmDateString(d));
    }
  });
});

describe('parseSwedishDateRange — rule coverage', () => {
  // Fixed anchor: Monday 2026-08-17, 12:00 Stockholm (10:00 UTC).
  const NOW = new Date('2026-08-17T10:00:00.000Z');

  it('"ikväll" / "i kväll" / "tonight" → today only', () => {
    for (const q of ['ikväll', 'i kväll', 'tonight', 'musik ikväll']) {
      const r = parseSwedishDateRange(q, NOW, TZ);
      expect(r, `query=${q}`).toEqual({ from: '2026-08-17', to: '2026-08-17' });
    }
  });

  it('"idag" / "i dag" → today only', () => {
    for (const q of ['idag', 'i dag']) {
      const r = parseSwedishDateRange(q, NOW, TZ);
      expect(r, `query=${q}`).toEqual({ from: '2026-08-17', to: '2026-08-17' });
    }
  });

  it('"imorgon" / "i morgon" → tomorrow', () => {
    for (const q of ['imorgon', 'i morgon', 'musik imorgon']) {
      const r = parseSwedishDateRange(q, NOW, TZ);
      expect(r, `query=${q}`).toEqual({ from: '2026-08-18', to: '2026-08-18' });
    }
  });

  it('"i övermorgon" → +2 days', () => {
    for (const q of ['i övermorgon', 'i overmorgon', 'övermorgon']) {
      const r = parseSwedishDateRange(q, NOW, TZ);
      expect(r, `query=${q}`).toEqual({ from: '2026-08-19', to: '2026-08-19' });
    }
  });

  it('"på fredag" → next Friday (today is Monday → +4d)', () => {
    const r = parseSwedishDateRange('på fredag', NOW, TZ);
    expect(r).toEqual({ from: '2026-08-21', to: '2026-08-21' });
  });

  it('bare "fredag" → next Friday (today is Monday → +4d)', () => {
    const r = parseSwedishDateRange('fredag', NOW, TZ);
    expect(r).toEqual({ from: '2026-08-21', to: '2026-08-21' });
  });

  it('"på fredag" when today is Friday resolves to today (same-day rule)', () => {
    // 2026-08-21 is a Friday.
    const friNow = new Date('2026-08-21T08:00:00.000Z'); // 10:00 CEST Fri
    const r = parseSwedishDateRange('på fredag', friNow, TZ);
    expect(r).toEqual({ from: '2026-08-21', to: '2026-08-21' });
  });

  it('"på lördag" when today is Friday resolves to tomorrow', () => {
    const friNow = new Date('2026-08-21T08:00:00.000Z'); // Fri
    const r = parseSwedishDateRange('på lördag', friNow, TZ);
    expect(r).toEqual({ from: '2026-08-22', to: '2026-08-22' });
  });

  it('"på måndag" when today is Monday resolves to today (same-day rule)', () => {
    // MASTERPLAN §18.2 decision 3 — bare weekdays resolve to the next
    // occurrence, with same-day if the weekday has not effectively passed.
    const monNow = new Date('2026-08-17T08:00:00.000Z'); // 10:00 CEST Mon
    const r = parseSwedishDateRange('på måndag', monNow, TZ);
    expect(r).toEqual({ from: '2026-08-17', to: '2026-08-17' });
  });

  it('every bare Swedish weekday resolves to a valid YYYY-MM-DD', () => {
    const days = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
    for (const d of days) {
      const r = parseSwedishDateRange(`på ${d}`, NOW, TZ);
      expect(r, `weekday=${d}`).not.toBeNull();
      expect(r!.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r!.from).toBe(r!.to);
    }
  });

  it('"i helgen" / "helgen" / "this weekend" → Sat–Sun', () => {
    // Today is Monday 2026-08-17 → upcoming Sat 2026-08-22 / Sun 2026-08-23.
    for (const q of ['i helgen', 'helgen', 'this weekend', 'denna helg']) {
      const r = parseSwedishDateRange(q, NOW, TZ);
      expect(r, `query=${q}`).toEqual({ from: '2026-08-22', to: '2026-08-23' });
    }
  });

  it('"denna helg" on Saturday still resolves to that Sat–Sun (not next weekend)', () => {
    // 2026-08-22 is a Saturday in Stockholm.
    const satNow = new Date('2026-08-22T08:00:00.000Z'); // 10:00 CEST Sat
    const r = parseSwedishDateRange('denna helg', satNow, TZ);
    expect(r).toEqual({ from: '2026-08-22', to: '2026-08-23' });
  });

  it('"denna vecka" → Monday..Sunday of the current Stockholm week', () => {
    // Today is Mon 2026-08-17 → Mon..Sun = 2026-08-17..2026-08-23.
    const r = parseSwedishDateRange('denna vecka', NOW, TZ);
    expect(r).toEqual({ from: '2026-08-17', to: '2026-08-23' });
  });

  it('"nästa vecka" → Monday..Sunday of next Stockholm week', () => {
    const r = parseSwedishDateRange('nästa vecka', NOW, TZ);
    expect(r).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('"nästa månad" → first day of next Stockholm month (placeholder; revisit later)', () => {
    const r = parseSwedishDateRange('nästa månad', NOW, TZ);
    // August → September: 2026-09-01..2026-09-30.
    expect(r).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('returns null when no date phrase is present', () => {
    expect(parseSwedishDateRange('konsert i Stockholm', NOW, TZ)).toBeNull();
    expect(parseSwedishDateRange('free jazz', NOW, TZ)).toBeNull();
  });

  it('first match wins (a query containing "ikväll" and "imorgon" picks the first)', () => {
    const r = parseSwedishDateRange('ikväll imorgon', NOW, TZ);
    expect(r).toEqual({ from: '2026-08-17', to: '2026-08-17' });
  });
});

describe('parseSwedishDateRange — DST robustness', () => {
  it('"imorgon" crossing the spring DST boundary', () => {
    // 2026-03-29 is the last Sunday of March (CET→CEST).
    // Anchor: Saturday 2026-03-28 noon Stockholm (11:00 UTC).
    const sat = new Date('2026-03-28T11:00:00.000Z');
    const r = parseSwedishDateRange('imorgon', sat, TZ);
    expect(r).toEqual({ from: '2026-03-29', to: '2026-03-29' });
  });

  it('"i helgen" crossing the fall DST boundary', () => {
    // 2026-10-25 is the last Sunday of October (CEST→CET).
    // Anchor: Friday 2026-10-23 noon Stockholm (10:00 UTC).
    const fri = new Date('2026-10-23T10:00:00.000Z');
    const r = parseSwedishDateRange('i helgen', fri, TZ);
    expect(r).toEqual({ from: '2026-10-24', to: '2026-10-25' });
  });
});