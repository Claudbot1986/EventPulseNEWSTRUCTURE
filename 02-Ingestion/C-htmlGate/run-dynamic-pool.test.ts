/**
 * run-dynamic-pool.ts — Unit Tests
 * ==================================
 * Tests for pool management, routing logic, and exit conditions.
 * Run: npx vitest run 02-Ingestion/C-htmlGate/run-dynamic-pool.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  deriveCliBatchNumber,
  deriveCompletedBatchToReconcile,
  determineOutcome,
  hasUnfinalizedCompletedActivePool,
  parseBatchNumberFromId,
  resolveRoute,
  type CResult,
} from './run-dynamic-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

interface PoolSource {
  sourceId: string;
  roundsParticipated: number;
}

// ---------------------------------------------------------------------------
// CResult-fabrik
//
// Testerna testar den FAKTISKA koden i run-dynamic-pool.ts. Tidigare fanns
// här en egen, förenklad kopia av determineOutcome/routeResult — den kunde
// inte upptäcka en regression i den riktiga koden, bara bekräfta att
//kopian gjorde vad kopian gjorde.
// ---------------------------------------------------------------------------

const BASE_C0: CResult['c0'] = {
  candidates: 3,
  winnerUrl: 'https://example.se/events',
  winnerDensity: 1,
  duration: 10,
  rootFallback: false,
  ruleAppliedSource: 'link-discovery',
  ruleAppliedPaths: ['/events'],
  ruleWinnerPath: '/events',
};

const BASE_C1: CResult['c1'] = {
  verdict: 'strong',
  likelyJsRendered: false,
  timeTagCount: 0,
  dateCount: 0,
  duration: 10,
  htmlBytes: 1000,
  fetchable: true,
};

const BASE_C2: CResult['c2'] = {
  verdict: 'promising',
  score: 10,
  reason: 'test',
  duration: 10,
  htmlBytes: 1000,
};

const BASE_C3: CResult['c3'] = {
  universalEventsFound: 0,
  universalMethodsUsed: [],
  universalMethodBreakdown: {},
  duration: 10,
};

const BASE_EXTRACT: CResult['extract'] = {
  eventsFound: 0,
  datedEventsFound: 0,
  duration: 10,
  htmlSize: 1000,
};

function makeCResult(overrides: Partial<CResult> = {}): CResult {
  const c0 = { ...BASE_C0, ...(overrides.c0 ?? {}) } as CResult['c0'];
  const c1 = { ...BASE_C1, ...(overrides.c1 ?? {}) } as CResult['c1'];
  const c2 = { ...BASE_C2, ...(overrides.c2 ?? {}) } as CResult['c2'];
  const c3 = { ...BASE_C3, ...(overrides.c3 ?? {}) } as CResult['c3'];
  const extract = { ...BASE_EXTRACT, ...(overrides.extract ?? {}) } as CResult['extract'];

  const base: CResult = {
    sourceId: 'test',
    sourceUrl: 'https://example.se',
    winningStage: 'C3',
    outcomeType: 'fail',
    routeSuggestion: 'manual-review',
    evidence: '',
    roundNumber: 1,
    success: false,
    exitReason: 'ALL_ROUNDS_EXHAUSTED',
    exitReasonDetail: '',
    c0,
    effectiveProcessingUrl: 'https://example.se/events',
    effectiveProcessingUrlReason: 'test',
    c1,
    c2,
    c3,
    extract,
    trace: {
      sourceId: 'test',
      sourceUrl: 'https://example.se',
      round: 1,
      c0Candidates: c0.candidates,
      c0WinnerUrl: c0.winnerUrl,
      c0WinnerDensity: c0.winnerDensity,
      c0RuleSource: c0.ruleAppliedSource,
      c0RulePathsTested: c0.ruleAppliedPaths,
      c0RuleWinnerPath: c0.ruleWinnerPath,
      effectiveUrl: 'https://example.se/events',
      effectiveUrlReason: 'test',
      c1Verdict: c1.verdict as CResult['trace']['c1Verdict'],
      c1LikelyJsRendered: c1.likelyJsRendered,
      c1TimeTagCount: c1.timeTagCount,
      c1DateCount: c1.dateCount,
      c1HtmlBytes: c1.htmlBytes,
      c1Fetchable: c1.fetchable,
      c1BestSubpageFound: null,
      c1SubpagesTested: [],
      c2Verdict: c2.verdict as CResult['trace']['c2Verdict'],
      c2Score: c2.score,
      c2Reason: c2.reason,
      c2HtmlBytes: c2.htmlBytes,
      c3EventsFound: c3.universalEventsFound,
      c3MethodsUsed: c3.universalMethodsUsed,
      c3MethodBreakdown: c3.universalMethodBreakdown,
      c3AiVerdict: c3.aiVerdict,
      c3AiEventsFound: c3.aiEventsFound,
      c3AiDuration: c3.aiDuration,
      eventsFound: extract.eventsFound,
      datedEventsFound: extract.datedEventsFound,
      outcomeType: 'fail',
      routeSuggestion: 'manual-review',
      exitReason: 'ALL_ROUNDS_EXHAUSTED',
      exitReasonDetail: '',
      winningStage: 'C3',
      success: false,
      derivedRuleApplied: false,
    },
  };

  return { ...base, ...overrides, c0, c1, c2, c3, extract };
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

describe('effective URL mutation guard', () => {
  it('keeps effectiveUrl mutable because C0/C1 can replace the processing URL', () => {
    const source = readFileSync(path.join(__dirname, 'run-dynamic-pool.ts'), 'utf8');
    expect(source).toContain('let effectiveUrl = urlVariant.url');
    expect(source).not.toContain('const effectiveUrl = urlVariant.url');
  });

});

describe('CLI batch-state helpers', () => {
  it('parses strict batch ids only', () => {
    expect(parseBatchNumberFromId('batch-42')).toBe(42);
    expect(parseBatchNumberFromId('batch-nope')).toBeNull();
    expect(parseBatchNumberFromId('42')).toBeNull();
    expect(parseBatchNumberFromId(null)).toBeNull();
  });

  it('advances after a run-completion entry without relying on source text assertions', () => {
    expect(deriveCliBatchNumber({ currentBatch: 17, type: 'run-completion' }, null)).toBe(18);
    expect(deriveCliBatchNumber({ batchId: 'batch-17', type: 'run-completion' }, null)).toBe(18);
    expect(deriveCliBatchNumber({ currentBatch: 17, type: 'batch-start' }, null)).toBe(17);
    expect(deriveCliBatchNumber({ currentBatch: 17, type: 'run-completion' }, 99)).toBe(99);
  });

  it('detects completed saved states that still need active-pool finalization', () => {
    expect(hasUnfinalizedCompletedActivePool({ poolRoundNumber: 3, activePool: [{}] }, 3)).toBe(true);
    expect(hasUnfinalizedCompletedActivePool({ poolRoundNumber: 2, activePool: [{}] }, 3)).toBe(false);
    expect(hasUnfinalizedCompletedActivePool({ poolRoundNumber: 3, activePool: [] }, 3)).toBe(false);
    expect(hasUnfinalizedCompletedActivePool(null, 3)).toBe(false);
  });

  it('selects the completed batch for recovery before advancing to the next batch', () => {
    expect(deriveCompletedBatchToReconcile({ currentBatch: 17, type: 'run-completion' }, null)).toBe(17);
    expect(deriveCompletedBatchToReconcile({ batchId: 'batch-17', type: 'run-completion' }, null)).toBe(17);
    expect(deriveCompletedBatchToReconcile({ currentBatch: 17, type: 'batch-start' }, null)).toBeNull();
    expect(deriveCompletedBatchToReconcile({ currentBatch: 17, type: 'run-completion' }, 99)).toBeNull();
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
  it('marks extract_success when events found', () => {
    const r = makeCResult({ extract: { ...BASE_EXTRACT, eventsFound: 5, datedEventsFound: 5 } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('extract_success');
    expect(r.routeSuggestion).toBe('UI');
    expect(r.exitReason).toBe('EXTRACT_SUCCESS');
  });

  // 2026-10-24 — framgång kräver SPARBARA datum. En rad utan datum
  // (eller med ett förflutet datum) kastas bort av importen, så en källa
  // som bara ger sådana rader har inte lyckats.
  it('FAIL: rader utan användbart datum är inte extract_success', () => {
    const r = makeCResult({ extract: { ...BASE_EXTRACT, eventsFound: 8, datedEventsFound: 0 } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('fail');
    expect(r.success).toBe(false);
    expect(r.exitReason).toBe('EXTRACTION_ZERO_NO_USABLE_DATE');
    expect(r.routeSuggestion).toBe('manual-review');
  });

  it('FAIL: blandade rader räknas bara de med datum', () => {
    const r = makeCResult({ extract: { ...BASE_EXTRACT, eventsFound: 8, datedEventsFound: 3 } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('extract_success');
    expect(r.exitReasonDetail).toContain('3 sparbara events');
  });

  // Routing-signalen ska vinna över "inga sparbara datum": en JS-renderad
  // sida ska skickas till D-gaten (render), inte begravas.
  it('FAIL: JS-renderad källa routas till D även utan sparbara datum', () => {
    const r = makeCResult({
      extract: { ...BASE_EXTRACT, eventsFound: 4, datedEventsFound: 0 },
      c1: { ...BASE_C1, likelyJsRendered: true },
    });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('D');
    expect(r.exitReason).toBe('C1_LIKELY_JS_RENDER_ROOT');
  });

  it('marks route_success with likelyJsRendered=true', () => {
    const r = makeCResult({ c1: { ...BASE_C1, likelyJsRendered: true } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('route_success');
    expect(r.routeSuggestion).toBe('D');
  });

  it('marks fail with no candidates and no winner', () => {
    const r = makeCResult({
      c0: { ...BASE_C0, candidates: 0, winnerUrl: null },
      c2: { ...BASE_C2, verdict: 'blocked', score: 0 },
    });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('fail');
    expect(r.routeSuggestion).toBe('manual-review');
  });
});

// ---------------------------------------------------------------------------
// TESTS: resolveRoute
// ---------------------------------------------------------------------------

describe('resolveRoute', () => {
  it('extract_success ALWAYS goes to UI regardless of routeSuggestion', () => {
    const r = makeCResult({ outcomeType: 'extract_success', routeSuggestion: 'D' });
    expect(resolveRoute(r, 1).queueName).toBe('postTestC-UI');
  });

  it('routeSuggestion A/B/D routes correctly', () => {
    expect(resolveRoute(makeCResult({ outcomeType: 'route_success', routeSuggestion: 'A' }), 1).queueName).toBe('postTestC-A');
    expect(resolveRoute(makeCResult({ outcomeType: 'route_success', routeSuggestion: 'B' }), 1).queueName).toBe('postTestC-B');
    expect(resolveRoute(makeCResult({ outcomeType: 'route_success', routeSuggestion: 'D' }), 1).queueName).toBe('postTestC-D');
  });

  it('fail with roundsParticipated < 3 stays in pool', () => {
    const r = makeCResult({ outcomeType: 'fail', routeSuggestion: 'manual-review' });
    expect(resolveRoute(r, 1).queueName).toBe('STAYS_IN_POOL');
    expect(resolveRoute(r, 2).queueName).toBe('STAYS_IN_POOL');
  });

  it('fail with roundsParticipated >= 3 goes to manual-review', () => {
    const r = makeCResult({ outcomeType: 'fail', routeSuggestion: 'manual-review' });
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-manual-review');
    expect(resolveRoute(r, 4).queueName).toBe('postTestC-manual-review');
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
    const r = makeCResult({
      outcomeType: 'fail',
      routeSuggestion: 'manual-review',
      c0: { ...BASE_C0, candidates: 0, winnerUrl: null },
      c2: { ...BASE_C2, verdict: 'blocked', score: 0 },
    });
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-manual-review');
  });

  it('source with eventsFound > 0 exits immediately to UI', () => {
    const r = makeCResult({
      outcomeType: 'extract_success',
      routeSuggestion: 'UI',
      extract: { ...BASE_EXTRACT, eventsFound: 3 },
      c0: { ...BASE_C0, candidates: 5 },
      c2: { ...BASE_C2, score: 90 },
      c1: { ...BASE_C1, timeTagCount: 10, dateCount: 5 },
    });
    expect(resolveRoute(r, 1).queueName).toBe('postTestC-UI');
  });
});

// ---------------------------------------------------------------------------
// TESTS: C2 verdict → manual-review mapping
// ---------------------------------------------------------------------------

describe('C2 Verdict → Exit Mapping', () => {
  it('verdict=unclear → manual-review', () => {
    const r = makeCResult({ c2: { ...BASE_C2, verdict: 'unclear', score: 10 } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('manual-review');
    expect(r.exitReason).toBe('C2_UNCLEAR');
  });

  it('verdict=blocked → manual-review', () => {
    const r = makeCResult({ c2: { ...BASE_C2, verdict: 'blocked', score: 5 } });
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('manual-review');
    expect(r.exitReason).toBe('C2_BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// TESTS: C3-AI "needs_render" → D-renderGate
//
// Fix 2026-10-24: C3-AI kan uttrycka att sidan BEHÖVER renderas
// (AiVerdict = 'needs_render'). Det är D-gatens signal, inte ett
// extraktionsfel — men signalen ignorerades, så källorna hamnade i
// manual-review (dvs. begravdes) i stället för att få en riktig render.
//
// Bevis (Generalization Protection Rule — 4 orelaterade domäner, samtliga
// med C2-score UNDER tröskeln 20 som annars skickat dem till manual-review):
//   vasamuseet.se (12) · www.vasamuseet.se (9) · www.botaniska.se (8) ·
//   svenskfotboll.se (12)
// Kontroll: samma AI-verdict med HÖG C2-score (lth 26, thatsup 46/47,
// kalmar 55, modernamuseet 39) gick redan till D via OPTIMIZATION B och
// ledde till 1–7 events via UI — ingen av dem begravdes.
// ---------------------------------------------------------------------------

describe('C3-AI needs_render → D-renderGate', () => {
  /** Ett resultat som når "C2=promising men 0 events"-grenen. */
  const promisingZero = (aiVerdict: 'success' | 'partial' | 'failed' | 'needs_render' | undefined, score = 12) =>
    makeCResult({
      c2: { ...BASE_C2, verdict: 'promising', score },
      c3: { ...BASE_C3, aiVerdict, aiEventsFound: 0 },
    });

  it('routes needs_render to D-renderGate, not to manual-review', () => {
    const r = promisingZero('needs_render');
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.outcomeType).toBe('route_success');
    expect(r.routeSuggestion).toBe('D');
    expect(r.exitReason).toBe('C3_AI_NEEDS_RENDER_D_SIGNAL');
    expect(r.winningStage).toBe('C3-AI');
  });

  it('lands in the postTestC-D queue — the routing that actually matters', () => {
    const r = promisingZero('needs_render');
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-D');
  });

  it('works below the C2 score threshold (the bug: score 12 < 20)', () => {
    // OPTIMIZATION B (score >= 20) är en separat väg. needs_render ska
    // fungera oberoende av C2-score — annars faller källorna med låg
    // score tillbaka till manual-review, vilket var hela felet.
    const r = promisingZero('needs_render', 8);
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('D');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-D');
  });

  // ── Negativa kontroller ────────────────────────────────────────────────
  // Utan dessa skulle testet ovan kunna passera på en regel som aldrig
  // fyrar — t.ex. om 'D' nåddes av ett annat skäl.

  it('NEGATIVE: aiVerdict=failed still goes to manual-review', () => {
    const r = promisingZero('failed');
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.exitReason).toBe('EXTRACTION_ZERO_C3_AI_ZERO');
    expect(r.routeSuggestion).toBe('manual-review');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-manual-review');
  });

  it('NEGATIVE: aiVerdict=partial still goes to manual-review', () => {
    const r = promisingZero('partial');
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('manual-review');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-manual-review');
  });

  it('NEGATIVE: no AI verdict at all still goes to manual-review', () => {
    const r = promisingZero(undefined);
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.exitReason).toBe('EXTRACTION_ZERO_PROMISING_HTML');
    expect(r.routeSuggestion).toBe('manual-review');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-manual-review');
  });

  it('NEGATIVE: needs_render with a HIGH c2 score still lands in D (not double-routed)', () => {
    // Kontrollfall: hög score gick redan till D via OPTIMIZATION B. Den
    // nya regeln får inte ändra utfallet där.
    const r = promisingZero('needs_render', 46);
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.routeSuggestion).toBe('D');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-D');
  });

  it('NEGATIVE: a failed verdict with a HIGH c2 score goes to D via OPTIMIZATION B', () => {
    // Positiv kontroll för OPTIMIZATION B: score >= 20 skickar till D även
    // utan needs_render. Bevisar att D-vägen i manual-review-testerna ovan
    // beror på exitReason, inte på något annat.
    const r = promisingZero('failed', 46);
    determineOutcome(r, r.sourceUrl, 1, false);
    expect(r.exitReason).toBe('EXTRACTION_ZERO_C3_AI_ZERO');
    expect(resolveRoute(r, 3).queueName).toBe('postTestC-D');
  });
});
