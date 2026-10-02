/**
 * DateRangePicker (2026-10-02): pins quickRange / isoOf helpers so
 * search-skärmens "Snabbval" alltid räknar ut rätt datumintervall.
 * Ren, ingen React, ingen mock.
 */

import { describe, it, expect } from 'vitest';
import { quickRange, isoOf, nextWeekday } from './dateRange';

function atLocal(year: number, month: number, day: number, hour = 12): Date {
  // midday local time — undviker DST-rollover vid jämförelser.
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

describe('quickRange', () => {
  it('today returns same day for from + to', () => {
    const today = atLocal(2026, 10, 7);
    const r = quickRange('today', today);
    expect(r.from).toBe('2026-10-07');
    expect(r.to).toBe('2026-10-07');
  });

  it('tomorrow returns next day for both', () => {
    const today = atLocal(2026, 10, 7);
    const r = quickRange('tomorrow', today);
    expect(r.from).toBe('2026-10-08');
    expect(r.to).toBe('2026-10-08');
  });

  it('weekend returns Friday → Sunday when today is mid-week', () => {
    // 2026-10-07 är en onsdag.
    const today = atLocal(2026, 10, 7);
    const r = quickRange('weekend', today);
    expect(r.from).toBe('2026-10-09'); // fredag
    expect(r.to).toBe('2026-10-11');   // söndag
  });

  it('weekend returns same Fri-Sun when today IS Friday', () => {
    // 2026-10-09 är en fredag.
    const today = atLocal(2026, 10, 9);
    const r = quickRange('weekend', today);
    expect(r.from).toBe('2026-10-09');
    expect(r.to).toBe('2026-10-11');
  });

  it('weekend returns PREVIOUS Fri-Sun when today is Sunday', () => {
    // 2026-10-11 är en söndag. Användaren vill fortfarande se
    // innevarande helg → from = föregående fredag.
    const today = atLocal(2026, 10, 11);
    const r = quickRange('weekend', today);
    expect(r.from).toBe('2026-10-09');
    expect(r.to).toBe('2026-10-11');
  });

  it('7days returns today → today+6', () => {
    const today = atLocal(2026, 10, 7);
    const r = quickRange('7days', today);
    expect(r.from).toBe('2026-10-07');
    expect(r.to).toBe('2026-10-13');
  });

  it('30days returns today → today+29', () => {
    const today = atLocal(2026, 10, 7);
    const r = quickRange('30days', today);
    expect(r.from).toBe('2026-10-07');
    expect(r.to).toBe('2026-11-05');
  });

  it('all returns null/null (no range)', () => {
    const today = atLocal(2026, 10, 7);
    const r = quickRange('all', today);
    expect(r).toEqual({ from: null, to: null });
  });

  it('cross-month boundary works', () => {
    const today = atLocal(2026, 10, 31); // 31 okt
    const r = quickRange('7days', today);
    expect(r.from).toBe('2026-10-31');
    expect(r.to).toBe('2026-11-06');
  });

  it('cross-year boundary works', () => {
    const today = atLocal(2026, 12, 28); // 28 dec
    const r = quickRange('7days', today);
    expect(r.from).toBe('2026-12-28');
    expect(r.to).toBe('2027-01-03');
  });
});
