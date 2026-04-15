/**
 * run-dynamic-pool.ts — Unit Tests
 * ==================================
 * Tests for pool management, routing logic, and exit conditions.
 * Run: npx vitest run 02-Ingestion/C-htmlGate/run-dynamic-pool.test.ts
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure logic extracted from run-dynamic-pool.ts
// ---------------------------------------------------------------------------

function bucketize(errorCount: number): number {
  if (errorCount === 0) return 0;
  if (errorCount < 10) return 1;
  if (errorCount < 18) return 2;
  return 3;
}

function parseQueueSignals(reason: string | undefined | null): { errorCount: number; has404s: boolean } {
  const safeReason = reason ?? '';
  // Match: <num> <keyword>  OR  <keyword>: <num>
  const errorMatch = safeReason.match(/(?:(\d+)\s*(?:fel|errors?)|(\d+)\s*404)/i)
    || safeReason.match(/(?:fel|errors?|404)\s*:\s*(\d+)/i);
  let errorCount = 0;
  if (errorMatch) {
    errorCount = parseInt((errorMatch[1] ?? errorMatch[2] ?? errorMatch[3] ?? '0'), 10);
  }
  const has404s = /\d+\s*404/i.test(safeReason);
  return { errorCount, has404s };
}

type Outcome = 'extract_success' | 'route_success' | 'fail';

interface CResult {
  sourceId: string;
  outcomeType: Outcome;
  routeSuggestion: string;
  eventsFound: number;
  c0: { candidates: number; winnerUrl: string | null };
  c2: { verdict: string; score: number };
  c1: { likelyJsRendered: boolean; timeTagCount: number; dateCount: number; categorization: string };
  derivedRuleApplied?: { ruleKey: string };
}

function determineOutcome(result: CResult): void {
  if (result.eventsFound > 0) {
    result.outcomeType = 'extract_success';
    result.routeSuggestion = 'UI';
    return;
  }
  if (result.c1.likelyJsRendered) {
    result.outcomeType = 'route_success';
    result.routeSuggestion = 'D';
    return;
  }
  result.outcomeType = 'fail';
  if (result.c0.winnerUrl === null && result.c0.candidates === 0) {
    result.routeSuggestion = 'manual-review';
  } else if (result.c2.verdict === 'unclear' || result.c2.verdict === 'blocked') {
    result.routeSuggestion = 'manual-review';
  } else {
    result.routeSuggestion = 'manual-review';
  }
}

interface PoolSource {
  sourceId: string;
  roundsParticipated: number;
}

function routeResult(result: CResult, roundsParticipated: number): string {
  // SAFETY: extract_success MUST go to UI — no exceptions
  if (result.outcomeType === 'extract_success') {
    return 'postTestC-UI';
  }
  switch (result.routeSuggestion) {
    case 'UI': return 'postTestC-UI';
    case 'A': return 'postTestC-A';
    case 'B': return 'postTestC-B';
    case 'D': return 'postTestC-D';
    default:
      if (roundsParticipated >= 3) return 'postTestC-manual-review';
      return 'STAYS_IN_POOL';
  }
}

// Pool refill diversity scoring
interface DiversityState {
  errorBuckets: Set<number>;
  has404sValues: Set<boolean>;
  consecutiveFailures: Set<number>;
  lastEventsFound: Set<number>;
}

interface QueueEntry {
  sourceId: string;
  routingReason?: string;
  queueReason?: string;
}

interface Candidate {
  entry: QueueEntry;
  signals: { errorCount: number; has404s: boolean };
  status: { consecutiveFailures: number; lastEventsFound: number } | undefined;
}

function scoreCandidate(candidate: Candidate, state: DiversityState): number {
  let score = 0;
  const errorBucket = bucketize(candidate.signals.errorCount);
  if (!state.errorBuckets.has(errorBucket)) score += 4;
  if (!state.has404sValues.has(candidate.signals.has404s)) score += 2;
  if (!state.consecutiveFailures.has(candidate.status?.consecutiveFailures ?? -1)) score += 2;
  const hasEvents = (candidate.status?.lastEventsFound ?? 0) > 0 ? 1 : 0;
  if (!state.lastEventsFound.has(hasEvents)) score += 2;
  // Deterministic: use sourceId length as tiebreaker
  score += candidate.entry.sourceId.length * 0.01;
  return score;
}

// ---------------------------------------------------------------------------
// TESTS: bucketize
// ---------------------------------------------------------------------------

describe('bucketize', () => {
  it('returns 0 for 0 errors', () => {
    expect(bucketize(0)).toBe(0);
  });

  it('returns 1 for 1-9 errors', () => {
    expect(bucketize(1)).toBe(1);
    expect(bucketize(5)).toBe(1);
    expect(bucketize(9)).toBe(1);
  });

  it('returns 2 for 10-17 errors', () => {
    expect(bucketize(10)).toBe(2);
    expect(bucketize(15)).toBe(2);
    expect(bucketize(17)).toBe(2);
  });

  it('returns 3 for 18+ errors', () => {
    expect(bucketize(18)).toBe(3);
    expect(bucketize(100)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TESTS: parseQueueSignals
// ---------------------------------------------------------------------------

describe('parseQueueSignals', () => {
  it('parses error counts from routingReason', () => {
    expect(parseQueueSignals('10 errors detected')).toEqual({ errorCount: 10, has404s: false });
    expect(parseQueueSignals('5 fel')).toEqual({ errorCount: 5, has404s: false });
  });

  it('detects 404s', () => {
    expect(parseQueueSignals('2 404s found')).toEqual({ errorCount: 2, has404s: true });
    expect(parseQueueSignals('no 404s, 1 error')).toEqual({ errorCount: 1, has404s: false });
  });

  it('handles null/undefined/empty', () => {
    expect(parseQueueSignals(null)).toEqual({ errorCount: 0, has404s: false });
    expect(parseQueueSignals(undefined)).toEqual({ errorCount: 0, has404s: false });
    expect(parseQueueSignals('')).toEqual({ errorCount: 0, has404s: false });
  });

  it('returns 0 errorCount when no number found', () => {
    expect(parseQueueSignals('network timeout')).toEqual({ errorCount: 0, has404s: false });
  });
});

// ---------------------------------------------------------------------------
// TESTS: determineOutcome
// ---------------------------------------------------------------------------

describe('determineOutcome', () => {
  const makeResult = (overrides: Partial<CResult> = {}): CResult => ({
    sourceId: 'test',
    outcomeType: 'fail',
    routeSuggestion: 'manual-review',
    eventsFound: 0,
    c0: { candidates: 0, winnerUrl: null },
    c2: { verdict: 'unknown', score: 0 },
    c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' },
    ...overrides,
  });

  it('marks extract_success when events found', () => {
    const r = makeResult({ eventsFound: 5 });
    determineOutcome(r);
    expect(r.outcomeType).toBe('extract_success');
    expect(r.routeSuggestion).toBe('UI');
  });

  it('marks route_success with likelyJsRendered=true', () => {
    const r = makeResult({ eventsFound: 0, c1: { likelyJsRendered: true, timeTagCount: 0, dateCount: 0, categorization: 'noise' } });
    determineOutcome(r);
    expect(r.outcomeType).toBe('route_success');
    expect(r.routeSuggestion).toBe('D');
  });

  it('marks fail with no candidates and no winner', () => {
    const r = makeResult({ eventsFound: 0, c0: { candidates: 0, winnerUrl: null }, c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' }, c2: { verdict: 'blocked', score: 0 } });
    determineOutcome(r);
    expect(r.outcomeType).toBe('fail');
    expect(r.routeSuggestion).toBe('manual-review');
  });
});

// ---------------------------------------------------------------------------
// TESTS: routeResult
// ---------------------------------------------------------------------------

describe('routeResult', () => {
  const makeResult = (overrides: Partial<CResult> = {}): CResult => ({
    sourceId: 'test',
    outcomeType: 'fail',
    routeSuggestion: 'manual-review',
    eventsFound: 0,
    c0: { candidates: 0, winnerUrl: null },
    c2: { verdict: 'unknown', score: 0 },
    c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' },
    ...overrides,
  });

  it('extract_success ALWAYS goes to UI regardless of routeSuggestion', () => {
    const r = makeResult({ outcomeType: 'extract_success', routeSuggestion: 'D' });
    expect(routeResult(r, 1)).toBe('postTestC-UI');
  });

  it('routeSuggestion A/B/D routes correctly', () => {
    expect(routeResult(makeResult({ outcomeType: 'route_success', routeSuggestion: 'A' }), 1)).toBe('postTestC-A');
    expect(routeResult(makeResult({ outcomeType: 'route_success', routeSuggestion: 'B' }), 1)).toBe('postTestC-B');
    expect(routeResult(makeResult({ outcomeType: 'route_success', routeSuggestion: 'D' }), 1)).toBe('postTestC-D');
  });

  it('fail with roundsParticipated < 3 stays in pool', () => {
    const r = makeResult({ outcomeType: 'fail', routeSuggestion: 'manual-review' });
    expect(routeResult(r, 1)).toBe('STAYS_IN_POOL');
    expect(routeResult(r, 2)).toBe('STAYS_IN_POOL');
  });

  it('fail with roundsParticipated >= 3 goes to manual-review', () => {
    const r = makeResult({ outcomeType: 'fail', routeSuggestion: 'manual-review' });
    expect(routeResult(r, 3)).toBe('postTestC-manual-review');
    expect(routeResult(r, 4)).toBe('postTestC-manual-review');
  });
});

// ---------------------------------------------------------------------------
// TESTS: diversity scoring
// ---------------------------------------------------------------------------

describe('Diversity Scoring', () => {
  it('prefers sources from unseen error buckets', () => {
    const state: DiversityState = {
      errorBuckets: new Set([0]),
      has404sValues: new Set([false]),
      consecutiveFailures: new Set([-1]),
      lastEventsFound: new Set([0]),
    };

    const candidate1: Candidate = {
      entry: { sourceId: 'a' },
      signals: { errorCount: 5, has404s: false },
      status: { consecutiveFailures: 0, lastEventsFound: 0 },
    };

    const candidate2: Candidate = {
      entry: { sourceId: 'b' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: -1, lastEventsFound: 0 },
    };

    // candidate1's bucket (1) is NOT in state → score bonus
    // candidate2's bucket (0) IS in state → no bonus
    const score1 = scoreCandidate(candidate1, state);
    const score2 = scoreCandidate(candidate2, state);
    expect(score1).toBeGreaterThan(score2);
  });

  it('prefers sources with different has404s values', () => {
    const state: DiversityState = {
      errorBuckets: new Set([0]),
      has404sValues: new Set([false]),
      consecutiveFailures: new Set([-1]),
      lastEventsFound: new Set([0]),
    };

    const with404: Candidate = {
      entry: { sourceId: 'a' },
      signals: { errorCount: 0, has404s: true },
      status: { consecutiveFailures: -1, lastEventsFound: 0 },
    };

    const without404: Candidate = {
      entry: { sourceId: 'b' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: -1, lastEventsFound: 0 },
    };

    const scoreWith = scoreCandidate(with404, state);
    const scoreWithout = scoreCandidate(without404, state);
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('prefers sources with different consecutiveFailure values', () => {
    const state: DiversityState = {
      errorBuckets: new Set([0]),
      has404sValues: new Set([false]),
      consecutiveFailures: new Set([0]),
      lastEventsFound: new Set([0]),
    };

    const withFailure: Candidate = {
      entry: { sourceId: 'a' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: 2, lastEventsFound: 0 },
    };

    const noFailure: Candidate = {
      entry: { sourceId: 'b' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: 0, lastEventsFound: 0 },
    };

    const scoreWith = scoreCandidate(withFailure, state);
    const scoreWithout = scoreCandidate(noFailure, state);
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('prefers sources with different lastEventsFound values', () => {
    const state: DiversityState = {
      errorBuckets: new Set([0]),
      has404sValues: new Set([false]),
      consecutiveFailures: new Set([-1]),
      lastEventsFound: new Set([0]),
    };

    const hasEvents: Candidate = {
      entry: { sourceId: 'a' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: -1, lastEventsFound: 5 },
    };

    const noEvents: Candidate = {
      entry: { sourceId: 'b' },
      signals: { errorCount: 0, has404s: false },
      status: { consecutiveFailures: -1, lastEventsFound: 0 },
    };

    const scoreHas = scoreCandidate(hasEvents, state);
    const scoreNo = scoreCandidate(noEvents, state);
    expect(scoreHas).toBeGreaterThan(scoreNo);
  });
});

// ---------------------------------------------------------------------------
// TESTS: exit conditions
// ---------------------------------------------------------------------------

describe('Pool Exit Conditions', () => {
  // PoolSource for testing
  const makePoolSource = (roundsParticipated: number): PoolSource => ({
    sourceId: 'test',
    roundsParticipated,
  });

  it('source exits after 3 rounds without meeting exit conditions', () => {
    // After 3 rounds, even if roundsParticipated >= 3, if not extract_success it goes to manual-review
    const r: CResult = {
      sourceId: 'test',
      outcomeType: 'fail',
      routeSuggestion: 'manual-review',
      eventsFound: 0,
      c0: { candidates: 0, winnerUrl: null },
      c2: { verdict: 'blocked', score: 0 },
      c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' },
    };
    expect(routeResult(r, 3)).toBe('postTestC-manual-review');
  });

  it('source with eventsFound > 0 exits immediately to UI', () => {
    const r: CResult = {
      sourceId: 'test',
      outcomeType: 'extract_success',
      routeSuggestion: 'UI',
      eventsFound: 3,
      c0: { candidates: 5, winnerUrl: '/events' },
      c2: { verdict: 'promising', score: 90 },
      c1: { likelyJsRendered: false, timeTagCount: 10, dateCount: 5, categorization: 'events' },
    };
    expect(routeResult(r, 1)).toBe('postTestC-UI');
  });
});

// ---------------------------------------------------------------------------
// TESTS: C2 verdict → manual-review mapping
// ---------------------------------------------------------------------------

describe('C2 Verdict → Exit Mapping', () => {
  it('verdict=unclear → manual-review', () => {
    const r: CResult = {
      sourceId: 'test',
      outcomeType: 'fail',
      routeSuggestion: 'manual-review',
      eventsFound: 0,
      c0: { candidates: 3, winnerUrl: '/events' },
      c2: { verdict: 'unclear', score: 10 },
      c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' },
    };
    determineOutcome(r);
    expect(r.routeSuggestion).toBe('manual-review');
  });

  it('verdict=blocked → manual-review', () => {
    const r: CResult = {
      sourceId: 'test',
      outcomeType: 'fail',
      routeSuggestion: 'manual-review',
      eventsFound: 0,
      c0: { candidates: 3, winnerUrl: '/events' },
      c2: { verdict: 'blocked', score: 5 },
      c1: { likelyJsRendered: false, timeTagCount: 0, dateCount: 0, categorization: 'unknown' },
    };
    determineOutcome(r);
    expect(r.routeSuggestion).toBe('manual-review');
  });
});
