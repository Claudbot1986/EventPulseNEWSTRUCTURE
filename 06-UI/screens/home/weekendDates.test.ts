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
import { upcomingWeekendIsoSet } from './weekendDates';

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
