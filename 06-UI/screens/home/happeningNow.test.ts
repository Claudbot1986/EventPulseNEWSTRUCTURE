/**
 * Pins the "Händer just nu" rules (screens/home/happeningNow.js) — user spec
 * 2026-09-20:
 *
 *   - Same day: events that have not happened yet by clock time are shown
 *     (started-but-not-ended counts as "not happened yet").
 *   - An event disappears 3 hours after it ENDED; missing end_time falls
 *     back to the start time.
 *   - Overnight events (22:00–02:00) roll the end into the next day.
 *   - If nothing remains today, surface the next day with hand-picked
 *     events ("Imorgon" or the weekday) instead of going quiet.
 *
 * All dates are passed explicitly so the suite is timezone- and
 * run-date-independent. 2026-09-20 is a Sunday.
 *
 * Run:  npx vitest run 06-UI/screens/home/happeningNow.test.ts
 */

import { describe, it, expect } from 'vitest';

import {
  END_GRACE_MS,
  eventEndDate,
  pickHappeningNow,
  happeningTitleParts,
  nextSaturdayIso,
  weekendFeedAnchorIso,
  nextLocalWeekdayIso,
} from './happeningNow';

/** Local Date shorthand: at(2026, 9, 20, 18, 30) = 20 Sep 2026 18:30. */
function at(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm);
}

const SUN = '2026-09-20'; // Sunday
const MON = '2026-09-21';
const WED = '2026-09-23';

describe('END_GRACE_MS', () => {
  it('is exactly 3 hours', () => {
    expect(END_GRACE_MS).toBe(3 * 60 * 60 * 1000);
  });
});

describe('eventEndDate — when is an event "over"', () => {
  it('same-day event: end_time on the same date', () => {
    const end = eventEndDate({ date: SUN, time: '18:00', end_time: '20:00' });
    expect(end).toEqual(at(2026, 9, 20, 20, 0));
  });

  it('overnight event 22:00–02:00 rolls the end into the next day', () => {
    const end = eventEndDate({ date: SUN, time: '22:00', end_time: '02:00' });
    expect(end).toEqual(at(2026, 9, 21, 2, 0));
  });

  it('end equal to start (22:00–22:00) counts as overnight', () => {
    const end = eventEndDate({ date: SUN, time: '22:00', end_time: '22:00' });
    expect(end).toEqual(at(2026, 9, 21, 22, 0));
  });

  it('missing end_time falls back to the start time', () => {
    const end = eventEndDate({ date: SUN, time: '09:00' });
    expect(end).toEqual(at(2026, 9, 20, 9, 0));
  });

  it('missing both times falls back to end of day', () => {
    const end = eventEndDate({ date: SUN });
    expect(end).toEqual(at(2026, 9, 21, 0, 0));
  });

  it('missing date returns null', () => {
    expect(eventEndDate({ time: '18:00' })).toBeNull();
    expect(eventEndDate(null)).toBeNull();
    expect(eventEndDate(undefined)).toBeNull();
  });
});

describe('pickHappeningNow — today\'s events', () => {
  it('keeps an upcoming event later today', () => {
    const now = at(2026, 9, 20, 15, 0);
    const pick = pickHappeningNow([{ date: SUN, time: '18:00', end_time: '20:00', title: 'A' }], now);
    expect(pick.kind).toBe('today');
    expect(pick.dateIso).toBe(SUN);
    expect(pick.events.map((e) => e.title)).toEqual(['A']);
  });

  it('keeps an event that started but has not ended', () => {
    const now = at(2026, 9, 20, 15, 0);
    const pick = pickHappeningNow([{ date: SUN, time: '13:00', end_time: '17:00', title: 'A' }], now);
    expect(pick.kind).toBe('today');
    expect(pick.events).toHaveLength(1);
  });

  it('keeps an event that ended less than 3 hours ago', () => {
    const now = at(2026, 9, 20, 13, 30); // ended 11:00 → grace until 14:00
    const pick = pickHappeningNow([{ date: SUN, time: '09:00', end_time: '11:00', title: 'A' }], now);
    expect(pick.kind).toBe('today');
    expect(pick.events).toHaveLength(1);
  });

  it('drops an event exactly at / beyond the 3-hour boundary', () => {
    const boundary = at(2026, 9, 20, 14, 0); // 11:00 + 3h — not strictly greater
    const past = at(2026, 9, 20, 14, 1);
    const ev = { date: SUN, time: '09:00', end_time: '11:00' };
    expect(pickHappeningNow([ev], boundary).kind).toBe('empty');
    expect(pickHappeningNow([ev], past).kind).toBe('empty');
  });

  it('missing end_time: gone 3h after START', () => {
    const ev = { date: SUN, time: '09:00' }; // treated as ended at 09:00
    expect(pickHappeningNow([ev], at(2026, 9, 20, 11, 59)).kind).toBe('today');
    expect(pickHappeningNow([ev], at(2026, 9, 20, 12, 0)).kind).toBe('empty');
  });

  it('overnight event stays visible after midnight until grace expires', () => {
    const ev = { date: SUN, time: '22:00', end_time: '02:00' };
    expect(pickHappeningNow([ev], at(2026, 9, 20, 23, 30)).kind).toBe('today');
    // Next morning the event no longer has today's date, so it cannot
    // appear — but eventEndDate already pinned the roll itself above.
  });

  it('ignores malformed / unusable entries instead of crashing', () => {
    const now = at(2026, 9, 20, 15, 0);
    const pick = pickHappeningNow([null, undefined, {}, { date: 'bogus' }], now);
    expect(pick.kind).toBe('empty');
    expect(pickHappeningNow(null as unknown as any[], now).kind).toBe('empty');
    expect(pickHappeningNow(undefined as unknown as any[], now).kind).toBe('empty');
  });

  it('returns today\'s events sorted by start time, input order-independent', () => {
    const now = at(2026, 9, 20, 8, 0);
    const events = [
      { date: SUN, time: '21:00', title: 'late' },
      { date: SUN, time: '10:00', title: 'early' },
      { date: SUN, time: '15:00', title: 'mid' },
    ];
    const pick = pickHappeningNow(events, now);
    expect(pick.events.map((e) => e.title)).toEqual(['early', 'mid', 'late']);
  });
});

describe('pickHappeningNow — fallback to the next day with events', () => {
  it('no events left today → returns tomorrow as "later"', () => {
    const now = at(2026, 9, 20, 15, 0);
    const pick = pickHappeningNow([{ date: MON, time: '10:00', title: 'B' }], now);
    expect(pick.kind).toBe('later');
    expect(pick.dateIso).toBe(MON);
    expect(pick.events.map((e) => e.title)).toEqual(['B']);
  });

  it('today\'s only event ended >3h ago → still falls forward', () => {
    const now = at(2026, 9, 20, 15, 0);
    const events = [
      { date: SUN, time: '08:00', end_time: '09:00', title: 'gone' },
      { date: MON, time: '10:00', title: 'next' },
    ];
    const pick = pickHappeningNow(events, now);
    expect(pick.kind).toBe('later');
    expect(pick.dateIso).toBe(MON);
  });

  it('picks the EARLIEST future date, not the largest list', () => {
    const now = at(2026, 9, 20, 15, 0);
    const events = [
      { date: WED, time: '10:00', title: 'w1' },
      { date: WED, time: '11:00', title: 'w2' },
      { date: MON, time: '10:00', title: 'm1' },
    ];
    const pick = pickHappeningNow(events, now);
    expect(pick.kind).toBe('later');
    expect(pick.dateIso).toBe(MON);
    expect(pick.events.map((e) => e.title)).toEqual(['m1']);
  });

  it('future-day events come back sorted by start time', () => {
    const now = at(2026, 9, 20, 15, 0);
    const events = [
      { date: MON, time: '19:00', title: 'late' },
      { date: MON, time: '09:00', title: 'early' },
    ];
    const pick = pickHappeningNow(events, now);
    expect(pick.events.map((e) => e.title)).toEqual(['early', 'late']);
  });

  it('only past days → empty (caller hides the section)', () => {
    const now = at(2026, 9, 20, 15, 0);
    const pick = pickHappeningNow([{ date: '2026-09-19', time: '18:00' }], now);
    expect(pick).toEqual({ kind: 'empty', dateIso: null, events: [] });
  });

  it('no events at all → empty', () => {
    expect(pickHappeningNow([], at(2026, 9, 20, 15, 0))).toEqual({
      kind: 'empty',
      dateIso: null,
      events: [],
    });
  });
});

describe('happeningTitleParts — section title label', () => {
  const now = at(2026, 9, 20, 15, 0); // Sunday

  it('today pick → { type: today }', () => {
    expect(happeningTitleParts({ kind: 'today', dateIso: SUN, events: [] }, now))
      .toEqual({ type: 'today' });
  });

  it('empty pick → { type: today } (never rendered, harmless default)', () => {
    expect(happeningTitleParts({ kind: 'empty', dateIso: null, events: [] }, now))
      .toEqual({ type: 'today' });
    expect(happeningTitleParts(null, now)).toEqual({ type: 'today' });
  });

  it('tomorrow pick → { type: tomorrow }', () => {
    expect(happeningTitleParts({ kind: 'later', dateIso: MON, events: [] }, now))
      .toEqual({ type: 'tomorrow' });
  });

  it('further-out pick → weekday parts for localization', () => {
    const parts = happeningTitleParts({ kind: 'later', dateIso: WED, events: [] }, now);
    expect(parts).toEqual({ type: 'weekday', dayIndex: 3, dayOfMonth: 23, monthIndex: 8 });
  });

  it('tomorrow is computed from NOW, not from today\'s iso', () => {
    const newYearsEve = at(2026, 12, 31, 23, 0);
    const parts = happeningTitleParts({ kind: 'later', dateIso: '2027-01-01', events: [] }, newYearsEve);
    expect(parts).toEqual({ type: 'tomorrow' });
  });
});

describe('nextSaturdayIso — weekend anchor', () => {
  it('today IS Saturday → today', () => {
    expect(nextSaturdayIso(at(2026, 9, 26, 10, 0))).toBe('2026-09-26');
  });

  it('Sunday → the coming Saturday', () => {
    expect(nextSaturdayIso(at(2026, 9, 20, 10, 0))).toBe('2026-09-26');
  });

  it('Monday → the coming Saturday', () => {
    expect(nextSaturdayIso(at(2026, 9, 21, 10, 0))).toBe('2026-09-26');
  });

  it('Friday → tomorrow', () => {
    expect(nextSaturdayIso(at(2026, 9, 25, 23, 0))).toBe('2026-09-26');
  });

  it('crosses month boundaries correctly', () => {
    // Wed 30 Sep 2026 → Sat 3 Oct 2026
    expect(nextSaturdayIso(at(2026, 9, 30, 12, 0))).toBe('2026-10-03');
  });
});

describe('weekendFeedAnchorIso — where the feed window starts on a helg chip', () => {
  it('Sunday → TODAY (the weekend is still on)', () => {
    expect(weekendFeedAnchorIso(at(2026, 9, 20, 15, 0))).toBe(SUN);
  });

  it('Saturday → TODAY', () => {
    expect(weekendFeedAnchorIso(at(2026, 9, 26, 9, 0))).toBe('2026-09-26');
  });

  it('Monday → coming Saturday', () => {
    expect(weekendFeedAnchorIso(at(2026, 9, 21, 9, 0))).toBe('2026-09-26');
  });

  it('Friday → tomorrow (Saturday)', () => {
    expect(weekendFeedAnchorIso(at(2026, 9, 25, 9, 0))).toBe('2026-09-26');
  });
});

describe('nextLocalWeekdayIso — pinned weekday, server semantics (NEVER today)', () => {
  it('Sunday asking for Saturday → coming Saturday', () => {
    expect(nextLocalWeekdayIso(at(2026, 9, 20, 15, 0), 6)).toBe('2026-09-26');
  });

  it('Sunday asking for Sunday → NEXT Sunday (today never counts)', () => {
    expect(nextLocalWeekdayIso(at(2026, 9, 20, 9, 0), 0)).toBe('2026-09-27');
  });

  it('Saturday NIGHT asking for Saturday → next week\'s Saturday', () => {
    // "Gratis på lördag" tapped 23:00 on a Saturday — the day's remaining
    // hours are dead, so the server means next Saturday. Match it.
    expect(nextLocalWeekdayIso(at(2026, 9, 26, 23, 0), 6)).toBe('2026-10-03');
  });

  it('crosses month boundaries', () => {
    // Wed 30 Sep 2026 asking for Friday → 2 Oct 2026
    expect(nextLocalWeekdayIso(at(2026, 9, 30, 12, 0), 5)).toBe('2026-10-02');
  });
});
