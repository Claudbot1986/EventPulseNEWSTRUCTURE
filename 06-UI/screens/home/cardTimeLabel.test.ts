/**
 * Pins the Hem card time-label format (2026-09-21, user direction via
 * annotated screenshot): every card in the GRATIS and För dig sections —
 * and, consistently, the weekend sections — shows the DAY on the time line,
 * after the time, separated by a real round bullet:
 *
 *     display: "17:30 • LÖR"     spoken: "Lördag 17:30"
 *
 * display uses the short day name in uppercase (no-op for zh-Hans); spoken
 * uses the full day name for screen readers. Missing pieces degrade
 * gracefully: no time → day only, no date → time only, neither → empty
 * strings (the card renders its existing '—' fallback).
 *
 * Run:  npx vitest run 06-UI/screens/home/cardTimeLabel.test.ts
 */

import { describe, it, expect } from 'vitest';

import { dayTimeLabel } from './cardTimeLabel';

describe('dayTimeLabel — "17:30 • LÖR" format', () => {
  it('time first, round bullet, uppercase short day (sv)', () => {
    const out = dayTimeLabel({ date: '2026-09-19', time: '17:30' }, 'sv');
    expect(out).toEqual({ display: '17:30 • LÖR', spoken: 'Lördag 17:30' });
  });

  it('localizes per language (en)', () => {
    const out = dayTimeLabel({ date: '2026-09-19', time: '17:30' }, 'en');
    expect(out).toEqual({ display: '17:30 • SAT', spoken: 'Saturday 17:30' });
  });

  it('uppercase is a no-op for zh-Hans', () => {
    const out = dayTimeLabel({ date: '2026-09-19', time: '17:30' }, 'zh-Hans');
    expect(out.display).toBe('17:30 • 周六');
    expect(out.spoken).toBe('星期六 17:30');
  });

  it('unknown language falls back to en (same chain as translate)', () => {
    expect(dayTimeLabel({ date: '2026-09-19', time: '17:30' }, 'xx').display).toBe('17:30 • SAT');
  });

  it('tolerates datetime-shaped dates', () => {
    expect(dayTimeLabel({ date: '2026-09-19T17:30:00', time: '17:30' }, 'sv').display)
      .toBe('17:30 • LÖR');
  });

  it('missing time → day only', () => {
    const out = dayTimeLabel({ date: '2026-09-19' }, 'sv');
    expect(out).toEqual({ display: 'LÖR', spoken: 'Lördag' });
  });

  it('missing/unparseable date → time only', () => {
    expect(dayTimeLabel({ time: '17:30' }, 'sv')).toEqual({ display: '17:30', spoken: '17:30' });
    expect(dayTimeLabel({ date: 'not-a-date', time: '17:30' }, 'sv').display).toBe('17:30');
  });

  it('both missing / garbage input → empty strings', () => {
    expect(dayTimeLabel({}, 'sv')).toEqual({ display: '', spoken: '' });
    expect(dayTimeLabel(null, 'sv')).toEqual({ display: '', spoken: '' });
    expect(dayTimeLabel(undefined)).toEqual({ display: '', spoken: '' });
  });
});
