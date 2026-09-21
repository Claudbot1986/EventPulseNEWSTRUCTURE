/**
 * Pins the Din helg weekend-window semantics (2026-09-20):
 *   - Mon–Thu  → the COMING Fri–Sun
 *   - Fri/Sat/Sun → THIS Fri–Sun (today included)
 * All in local time; the week of 2026-09-14 (Mon) anchors the fixtures.
 *
 * Run with: npx vitest run 06-UI/screens/home/weekendDates.test.ts (repo root)
 */

import { describe, expect, it } from 'vitest';

// JS module — tsc resolves it via allowJs, so no directive needed.
import { compareDayTimeAsc, dayLabelForIso, upcomingWeekendIsoSet } from './weekendDates';

const D = (iso: string) => new Date(`${iso}T12:00:00`);

describe('upcomingWeekendIsoSet', () => {
  it('Mon–Thu all point at the coming Fri–Sun', () => {
    const expected = new Set(['2026-09-18', '2026-09-19', '2026-09-20']);
    expect(upcomingWeekendIsoSet(D('2026-09-14'))).toEqual(expected); // Mon
    expect(upcomingWeekendIsoSet(D('2026-09-15'))).toEqual(expected); // Tue
    expect(upcomingWeekendIsoSet(D('2026-09-16'))).toEqual(expected); // Wed
    expect(upcomingWeekendIsoSet(D('2026-09-17'))).toEqual(expected); // Thu
  });

  it('Fri/Sat/Sun keep the current weekend (today included)', () => {
    const expected = new Set(['2026-09-18', '2026-09-19', '2026-09-20']);
    expect(upcomingWeekendIsoSet(D('2026-09-18'))).toEqual(expected); // Fri
    expect(upcomingWeekendIsoSet(D('2026-09-19'))).toEqual(expected); // Sat
    expect(upcomingWeekendIsoSet(D('2026-09-20'))).toEqual(expected); // Sun
  });

  it('crosses month boundaries correctly', () => {
    // Thu 2026-10-01 → Fri Oct 2, Sat Oct 3, Sun Oct 4.
    expect(upcomingWeekendIsoSet(D('2026-10-01'))).toEqual(
      new Set(['2026-10-02', '2026-10-03', '2026-10-04']),
    );
    // Sun 2027-01-31 (a Sunday) → this weekend Fri Jan 29 – Sun Jan 31.
    expect(upcomingWeekendIsoSet(D('2027-01-31'))).toEqual(
      new Set(['2027-01-29', '2027-01-30', '2027-01-31']),
    );
  });
});

// Per-card day + ordering (2026-09-21 user request): every weekend card
// shows its day, and cards run Friday → Saturday → Sunday even when the
// server ranking would have interleaved them.
describe('compareDayTimeAsc — Friday before Saturday, regardless of time', () => {
  it('orders by date first (a late Friday beats an early Saturday)', () => {
    const events = [
      { id: 'sun-early', date: '2026-09-20', time: '09:00' },
      { id: 'sat-late', date: '2026-09-19', time: '22:00' },
      { id: 'fri-late', date: '2026-09-18', time: '23:00' },
      { id: 'sat-early', date: '2026-09-19', time: '10:00' },
    ];
    const sorted = [...events].sort(compareDayTimeAsc).map((e) => e.id);
    expect(sorted).toEqual(['fri-late', 'sat-early', 'sat-late', 'sun-early']);
  });

  it('orders by time within the same day; missing time goes last', () => {
    const events = [
      { id: 'no-time', date: '2026-09-19' },
      { id: 'late', date: '2026-09-19', time: '22:00' },
      { id: 'early', date: '2026-09-19', time: '10:00' },
    ];
    const sorted = [...events].sort(compareDayTimeAsc).map((e) => e.id);
    expect(sorted).toEqual(['early', 'late', 'no-time']);
  });

  it('tolerates datetime-shaped dates and garbage rows', () => {
    const events = [
      { id: 'no-date', title: 'x' },
      { id: 'dt', date: '2026-09-19T19:00:00', time: '19:00' },
      { id: 'plain', date: '2026-09-18', time: '00:00' },
      null,
      { id: 'same', date: '2026-09-18', time: '00:00' },
    ];
    const sorted = [...events].sort(compareDayTimeAsc).map((e) => e?.id ?? 'null');
    expect(sorted).toEqual(['plain', 'same', 'dt', 'no-date', 'null']);
    expect(compareDayTimeAsc(undefined, undefined)).toBe(0);
  });
});

describe('dayLabelForIso — localized short day name', () => {
  it('2026-09-18 is a Friday', () => {
    expect(dayLabelForIso('2026-09-18', 'sv')).toBe('Fre');
    expect(dayLabelForIso('2026-09-18', 'en')).toBe('Fri');
  });

  it('Saturday and Sunday resolve per language', () => {
    expect(dayLabelForIso('2026-09-19', 'sv')).toBe('Lör');
    expect(dayLabelForIso('2026-09-20', 'sv')).toBe('Sön');
    expect(dayLabelForIso('2026-09-19', 'en')).toBe('Sat');
    expect(dayLabelForIso('2026-09-20', 'en')).toBe('Sun');
  });

  it('tolerates datetime-shaped input and falls back for unknown language', () => {
    expect(dayLabelForIso('2026-09-18T23:00:00', 'sv')).toBe('Fre');
    expect(dayLabelForIso('2026-09-18', 'xx')).toBe('Fri'); // unknown → en fallback
  });

  it('garbage input gives an empty label (card renders time only)', () => {
    expect(dayLabelForIso('', 'sv')).toBe('');
    expect(dayLabelForIso('not-a-date', 'sv')).toBe('');
    expect(dayLabelForIso(null as unknown as string, 'sv')).toBe('');
  });
});
