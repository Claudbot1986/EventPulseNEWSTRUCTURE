/**
 * watchdog.test.ts — unit tests for the autonomous-loop health watchdog.
 *
 * Exercises pure helpers (parseLoopLogConsecutiveBudgetExceeded,
 * ageMinutes) against synthetic data written to os.tmpdir(). Does NOT
 * touch the real wrapper — that would risk killing the live loop.
 */

import { describe, it, expect } from 'vitest';

import { parseLoopLogConsecutiveBudgetExceeded, ageMinutes } from './watchdog-helpers';

describe('parseLoopLogConsecutiveBudgetExceeded', () => {
  it('returns 0 when loop.log is missing', () => {
    expect(parseLoopLogConsecutiveBudgetExceeded('/nonexistent/loop.log')).toBe(0);
  });
  it('counts trailing budget-exhausted iters only', () => {
    const fakePath = '/tmp/ep-watch-test-' + Math.random().toString(36).slice(2) + '.log';
    require('node:fs').writeFileSync(
      fakePath,
      [
        'iter=10 exit=0 success',
        'iter=11 budget exhausted',
        'iter=12 budget exhausted',
        'iter=13 budget exhausted',
      ].join('\n') + '\n'
    );
    try {
      expect(parseLoopLogConsecutiveBudgetExceeded(fakePath)).toBe(3);
    } finally {
      require('node:fs').unlinkSync(fakePath);
    }
  });
  it('stops counting at first success', () => {
    const fakePath = '/tmp/ep-watch-test-' + Math.random().toString(36).slice(2) + '.log';
    require('node:fs').writeFileSync(
      fakePath,
      [
        'iter=10 budget exhausted',
        'iter=11 budget exhausted',
        'iter=12 exit=0 success',
        'iter=13 budget exhausted',
        'iter=14 budget exhausted',
      ].join('\n') + '\n'
    );
    try {
      expect(parseLoopLogConsecutiveBudgetExceeded(fakePath)).toBe(2);
    } finally {
      require('node:fs').unlinkSync(fakePath);
    }
  });
});

describe('ageMinutes', () => {
  it('returns null for null input', () => {
    expect(ageMinutes(null)).toBe(null);
  });
  it('returns null for unparseable input', () => {
    expect(ageMinutes('not a date')).toBe(null);
  });
  it('returns ~1.0 for an ISO timestamp 60 seconds in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const age = ageMinutes(past);
    expect(age).not.toBe(null);
    expect(age!).toBeGreaterThan(0.9);
    expect(age!).toBeLessThan(1.1);
  });
});
