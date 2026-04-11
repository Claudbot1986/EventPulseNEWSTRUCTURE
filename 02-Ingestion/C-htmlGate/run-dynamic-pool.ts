/**
 * C-htmlGate — Dynamic Test Pool Runner
 *
 * Implements the new canonical model (2026-04-11):
 * - Dynamic test pool of max 10 active C-sources
 * - Each source has its own roundsParticipated (max 3)
 * - Sources leave the pool immediately when exit condition is met
 * - Refill from postB-preC ONLY between rounds
 * - Sources that left the pool cannot rejoin in later rounds
 *
 * Exit conditions:
 * a) events found → postTestC-UI
 * b) high-confidence A/B/D signal → postTestC-A/B/D
 * c) 3 rounds without events → postTestC-manual-review
 *
 * Queue paths (relative to project root):
 * - postB-preC → source of refill
 * - postTestC-UI → extract_success
 * - postTestC-A → A-signal
 * - postTestC-B → B-signal
 * - postTestC-D → D-signal
 * - postTestC-manual-review → after 3 rounds without resolution
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root: two levels up from C-htmlGate/
const PROJECT_ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const SOURCES_DIR = join(PROJECT_ROOT, 'sources');
const REPORTS_DIR = join(__dirname, 'reports');

const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  SOURCES_STATUS: join(RUNTIME_DIR, 'sources_status.jsonl'),
  UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  A: join(RUNTIME_DIR, 'postTestC-A.jsonl'),
  B: join(RUNTIME_DIR, 'postTestC-B.jsonl'),
  D: join(RUNTIME_DIR, 'postTestC-D.jsonl'),
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
}

interface SourceStatus {
  sourceId: string;
  status: string;
  lastPathUsed: string | null;
  lastEventsFound: number;
  consecutiveFailures: number;
  triageResult: string | null;
}

interface PoolSource {
  sourceId: string;
  url: string;
  roundsParticipated: number;
  // Diversifiers from batchmaker
  diversifiers?: string[];
  queueReason?: string;
  enrichedData?: {
    lastPathUsed: string | null;
    lastEventsFound: number;
    consecutiveFailures: number;
    triageResult: string | null;
  };
}

interface CStageResult {
  c0: { candidates: number; winnerUrl: string | null; winnerDensity: number; duration: number; rootFallback: boolean };
  c1: { verdict: string; likelyJsRendered: boolean; timeTagCount: number; dateCount: number; duration: number };
  c2: { verdict: string; score: number; reason: string; duration: number };
  extract: { eventsFound: number; duration: number };
}

interface CResult extends CStageResult {
  sourceId: string;
  url: string;
  winningStage: 'C1' | 'C2' | 'C3' | 'C4-AI';
  outcomeType: 'extract_success' | 'route_success' | 'fail';
  routeSuggestion: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'Fail';
  evidence: string;
  roundNumber: number;
  success: boolean;
  error?: string;
  failType?: string;
  networkFailureSubType?: string;
}

interface PoolState {
  poolRoundNumber: number;
  activePool: PoolSource[];
  exited: { source: PoolSource; decision: string; result: CResult | null }[];
  failed: PoolSource[]; // still in pool, failed this round
  newlyRefilled: PoolSource[];
}

// ---------------------------------------------------------------------------
// Helpers: Parse
// ---------------------------------------------------------------------------

function parseJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => JSON.parse(line) as T);
}

function loadCanonicalUrls(): Map<string, string> {
  const urlMap = new Map<string, string>();
  try {
    const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(SOURCES_DIR, file), 'utf8').trim();
        if (!content) continue;
        const source = JSON.parse(content);
        if (source.id && source.url) {
          urlMap.set(source.id, source.url);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // sources dir missing
  }
  return urlMap;
}

// ---------------------------------------------------------------------------
// Step 1: Build initial pool from postB-preC
// ---------------------------------------------------------------------------

interface QueueSignals {
  errorCount: number;
  has404s: boolean;
}

function parseQueueSignals(reason: string): QueueSignals {
  const errorMatch = reason.match(/(\d+)\s*(?:fel|errors?|404s?)/i);
  const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  const has404s = /\d+\s*404/i.test(reason);
  return { errorCount, has404s };
}

function bucketize(errorCount: number): number {
  if (errorCount === 0) return 0;
  if (errorCount < 10) return 1;
  if (errorCount < 18) return 2;
  return 3;
}

interface DiversityState {
  errorBuckets: Set<number>;
  has404sValues: Set<boolean>;
  consecutiveFailures: Set<number>;
  lastEventsFound: Set<number>;
  lastPathUsed: Set<string>;
  triageResult: Set<string>;
}

function scoreCandidate(
  candidate: { entry: QueueEntry; signals: QueueSignals; status: SourceStatus | undefined; url: string | null },
  state: DiversityState
): number {
  let score = 0;
  const errorBucket = bucketize(candidate.signals.errorCount);
  if (!state.errorBuckets.has(errorBucket)) score += 4;
  if (!state.has404sValues.has(candidate.signals.has404s)) score += 2;
  if (!state.consecutiveFailures.has(candidate.status?.consecutiveFailures ?? -1)) score += 2;
  const hasEvents = (candidate.status?.lastEventsFound ?? 0) > 0 ? 1 : 0;
  if (!state.lastEventsFound.has(hasEvents)) score += 2;
  const path = candidate.status?.lastPathUsed ?? 'none';
  if (!state.lastPathUsed.has(path)) score += 1;
  const triage = candidate.status?.triageResult ?? 'none';
  if (!state.triageResult.has(triage)) score += 1;
  score += Math.random() * 0.4;
  return score;
}

function buildDiversifiers(c: { signals: QueueSignals; status: SourceStatus | undefined }): string[] {
  const d: string[] = [];
  if (c.signals.has404s) d.push('has_404s');
  if (c.signals.errorCount > 0) d.push(`errors_${c.signals.errorCount}`);
  if (c.status) {
    if (c.status.consecutiveFailures > 0) d.push(`failures_${c.status.consecutiveFailures}`);
    if (c.status.lastEventsFound > 0) d.push(`events_${c.status.lastEventsFound}`);
    if (c.status.triageResult) d.push(`triage_${c.status.triageResult}`);
    if (c.status.lastPathUsed) d.push(`path_${c.status.lastPathUsed}`);
  }
  return d;
}

/**
 * Build initial pool of 10 diversifierade C-källor from postB-preC.
 * Returns null if fewer than 10 eligible sources exist.
 */
function buildInitialPool(): { pool: PoolSource[]; eligibleInPrec: number } | null {
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = parseJsonl<SourceStatus>(QUEUES.SOURCES_STATUS);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) statusMap.set(s.sourceId, s);
  const canonicalUrls = loadCanonicalUrls();

  // Build candidate list
  const candidates = queueEntries.map(entry => {
    const signals = parseQueueSignals(entry.queueReason);
    const status = statusMap.get(entry.sourceId);
    const url = canonicalUrls.get(entry.sourceId) ?? null;
    return { entry, signals, status, url };
  }).filter(c => c.url !== null);

  const BATCH_SIZE = 10;
  const selected: PoolSource[] = [];
  const usedIds = new Set<string>();

  const diversityState: DiversityState = {
    errorBuckets: new Set(),
    has404sValues: new Set(),
    consecutiveFailures: new Set(),
    lastEventsFound: new Set(),
    lastPathUsed: new Set(),
    triageResult: new Set(),
  };

  const remaining = [...candidates];

  while (selected.length < BATCH_SIZE && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (usedIds.has(remaining[i].entry.sourceId)) continue;
      const score = scoreCandidate(remaining[i], diversityState);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const chosen = remaining.splice(bestIdx, 1)[0];
    usedIds.add(chosen.entry.sourceId);

    const errorBucket = bucketize(chosen.signals.errorCount);
    diversityState.errorBuckets.add(errorBucket);
    diversityState.has404sValues.add(chosen.signals.has404s);
    if (chosen.status) {
      diversityState.consecutiveFailures.add(chosen.status.consecutiveFailures);
      diversityState.lastEventsFound.add(chosen.status.lastEventsFound > 0 ? 1 : 0);
      if (chosen.status.lastPathUsed) diversityState.lastPathUsed.add(chosen.status.lastPathUsed);
      if (chosen.status.triageResult) diversityState.triageResult.add(chosen.status.triageResult);
    }

    selected.push({
      sourceId: chosen.entry.sourceId,
      url: chosen.url!,
      roundsParticipated: 0,
      diversifiers: buildDiversifiers(chosen),
      queueReason: chosen.entry.queueReason,
      enrichedData: {
        lastPathUsed: chosen.status?.lastPathUsed ?? null,
        lastEventsFound: chosen.status?.lastEventsFound ?? 0,
        consecutiveFailures: chosen.status?.consecutiveFailures ?? 0,
        triageResult: chosen.status?.triageResult ?? null,
      },
    });
  }

  if (selected.length === 0) return null;
  return { pool: selected, eligibleInPrec: candidates.length };
}

// ---------------------------------------------------------------------------
// Step 2: Refill pool from postB-preC
// ---------------------------------------------------------------------------

/**
 * Refill pool to max 10 from postB-preC.
 * Excludes sources already in pool or already exited.
 */
function refillPool(
  currentPool: PoolSource[],
  exitedIds: Set<string>,
  allExitedIds: Set<string>
): { newSources: PoolSource[]; refillCount: number; availableInPrec: number } {
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = parseJsonl<SourceStatus>(QUEUES.SOURCES_STATUS);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) statusMap.set(s.sourceId, s);
  const canonicalUrls = loadCanonicalUrls();

  // Filter: eligible, not in pool, not already exited
  const activeIds = new Set(currentPool.map(s => s.sourceId));
  const eligible = queueEntries
    .filter(entry => !activeIds.has(entry.sourceId) && !allExitedIds.has(entry.sourceId))
    .map(entry => {
      const signals = parseQueueSignals(entry.queueReason);
      const status = statusMap.get(entry.sourceId);
      const url = canonicalUrls.get(entry.sourceId) ?? null;
      return { entry, signals, status, url };
    })
    .filter(c => c.url !== null);

  const needed = 10 - currentPool.length;
  const toSelect = eligible.slice(0, needed);

  const newSources: PoolSource[] = toSelect.map(chosen => ({
    sourceId: chosen.entry.sourceId,
    url: chosen.url!,
    roundsParticipated: 0,
    diversifiers: buildDiversifiers(chosen),
    queueReason: chosen.entry.queueReason,
    enrichedData: {
      lastPathUsed: chosen.status?.lastPathUsed ?? null,
      lastEventsFound: chosen.status?.lastEventsFound ?? 0,
      consecutiveFailures: chosen.status?.consecutiveFailures ?? 0,
      triageResult: chosen.status?.triageResult ?? null,
    },
  }));

  return {
    newSources,
    refillCount: newSources.length,
    availableInPrec: eligible.length,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Run C1→C2→C3 on a single source
// ---------------------------------------------------------------------------

async function runSourceOnPool(source: PoolSource, roundNum: number): Promise<CResult> {
  console.log(`\n=== ${source.sourceId} (round ${roundNum}) ===`);

  const result: CResult = {
    sourceId: source.sourceId,
    url: source.url,
    c0: { candidates: 0, winnerUrl: null, winnerDensity: 0, duration: 0, rootFallback: false },
    c1: { verdict: 'unknown', likelyJsRendered: false, timeTagCount: 0, dateCount: 0, duration: 0 },
    c2: { verdict: 'unknown', score: 0, reason: '', duration: 0 },
    extract: { eventsFound: 0, duration: 0 },
    winningStage: 'C3',
    outcomeType: 'fail',
    routeSuggestion: 'Fail',
    evidence: '',
    roundNumber: roundNum,
    success: false,
  };

  try {
    // C0 (Canonical C1) — Discovery/Frontier
    const c0Start = Date.now();
    const c0 = await discoverEventCandidates(source.url);
    result.c0 = {
      candidates: c0?.candidatesFound || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
      rootFallback: false,
    };
    console.log(`C0: ${c0?.candidatesFound || 0} candidates, winner=${c0?.winner?.url || 'none'}`);

    const targetUrl = c0?.winner?.url || source.url;

    // C1 (Canonical C2) — Grov HTML-screening
    const c1Start = Date.now();
    const c1 = await screenUrl(targetUrl);
    result.c1 = {
      verdict: c1.verdict,
      likelyJsRendered: c1.likelyJsRendered,
      timeTagCount: c1.timeTagCount,
      dateCount: c1.dateCount,
      duration: Date.now() - c1Start,
    };
    console.log(`C1: likelyJsRendered=${c1.likelyJsRendered} verdict=${c1.verdict}`);

    // C2 — HTML Gate
    const c2Start = Date.now();
    const c2 = await evaluateHtmlGate(targetUrl, 'no-jsonld', 2);
    result.c2 = {
      verdict: c2.verdict,
      score: c2.score,
      reason: c2.reason,
      duration: Date.now() - c2Start,
    };
    console.log(`C2: verdict=${c2.verdict} score=${c2.score}`);

    // C3 — HTML Extraction
    const extStart = Date.now();
    const ext = await extractFromHtml(targetUrl, source.sourceId, source.url);
    result.extract = {
      eventsFound: ext.events.length,
      duration: Date.now() - extStart,
    };
    console.log(`C3: ${ext.events.length} events extracted`);

    // Determine outcome
    determineOutcome(result);

  } catch (e: any) {
    result.error = e.message;
    result.success = false;
    result.evidence = `error: ${e.message}`;
    result.outcomeType = 'fail';
    result.routeSuggestion = 'Fail';
    console.log(`ERROR: ${e.message}`);
  }

  return result;
}

function determineOutcome(result: CResult): void {
  // Extract success
  if (result.extract.eventsFound > 0) {
    result.outcomeType = 'extract_success';
    result.winningStage = 'C3';
    result.routeSuggestion = 'UI';
    result.evidence = `extracted ${result.extract.eventsFound} events from HTML`;
    result.success = true;
    return;
  }

  // Check for routing signal (A/B/D) from C2
  // A signal: strong feed/API pattern detected
  // B signal: structured data pattern detected
  // D signal: likelyJsRendered=true with high density
  if (result.c1.likelyJsRendered) {
    result.outcomeType = 'route_success';
    result.winningStage = 'C1';
    result.routeSuggestion = 'D';
    result.evidence = 'C1: likelyJsRendered=true — content requires D-render';
    result.success = false;
    return;
  }

  // No extraction, no routing signal → fail
  result.outcomeType = 'fail';
  result.winningStage = 'C3';
  result.routeSuggestion = 'Fail';

  if (result.c0.winnerUrl === null && result.c0.candidates === 0) {
    result.evidence = 'C0: no internal event candidates discovered';
    result.failType = 'discovery_failure';
  } else if (result.c2.verdict === 'unclear' || result.c2.verdict === 'blocked') {
    result.evidence = `C2: verdict=${result.c2.verdict}, score=${result.c2.score} too low`;
    result.failType = 'screening_failure';
  } else {
    result.evidence = `C3: extraction returned 0 events despite C2 promising (score=${result.c2.score})`;
    result.failType = 'extraction_failure';
  }
  result.success = false;
}

// ---------------------------------------------------------------------------
// Step 4: Route result to appropriate queue
// ---------------------------------------------------------------------------

function routeResult(result: CResult, roundsParticipated: number): string {
  const queueEntry = {
    sourceId: result.sourceId,
    queueName: '',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: result.evidence,
    workerNotes: `${result.winningStage}: ${result.outcomeType}`,
    winningStage: result.winningStage,
    outcomeType: result.outcomeType,
    routeSuggestion: result.routeSuggestion,
    roundNumber: result.roundNumber,
    roundsParticipated,
  };

  let queuePath: string;
  let queueName: string;

  switch (result.routeSuggestion) {
    case 'UI':
      queuePath = QUEUES.UI;
      queueName = 'postTestC-UI';
      break;
    case 'A':
      queuePath = QUEUES.A;
      queueName = 'postTestC-A';
      break;
    case 'B':
      queuePath = QUEUES.B;
      queueName = 'postTestC-B';
      break;
    case 'D':
      queuePath = QUEUES.D;
      queueName = 'postTestC-D';
      break;
    default:
      // Check if this source has now participated in 3 rounds
      if (roundsParticipated >= 3) {
        queuePath = QUEUES.MANUAL_REVIEW;
        queueName = 'postTestC-manual-review';
      } else {
        // Fail but not yet at 3 rounds — stays in pool (logged, not queued)
        queuePath = '';
        queueName = 'STAYS_IN_POOL';
      }
  }

  if (queuePath) {
    queueEntry.queueName = queueName;
    appendFileSync(queuePath, JSON.stringify(queueEntry) + '\n');
  }

  return queueName;
}

// ---------------------------------------------------------------------------
// Step 5: Clear output queues
// ---------------------------------------------------------------------------

function clearOutputQueues(): void {
  for (const q of [QUEUES.UI, QUEUES.A, QUEUES.B, QUEUES.D, QUEUES.MANUAL_REVIEW]) {
    writeFileSync(q, '');
  }
}

// ---------------------------------------------------------------------------
// Step 6: Main pool loop
// ---------------------------------------------------------------------------

async function runPoolRound(state: PoolState): Promise<{
  results: CResult[];
  exits: { source: PoolSource; decision: string; result: CResult }[];
  fails: PoolSource[];
}> {
  const { activePool, poolRoundNumber } = state;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ROUND ${poolRoundNumber} — ${activePool.length} active sources`);
  console.log(`${'='.repeat(60)}\n`);

  const results: CResult[] = [];
  const exits: { source: PoolSource; decision: string; result: CResult }[] = [];
  const fails: PoolSource[] = [];

  for (const source of activePool) {
    const newRounds = source.roundsParticipated + 1;
    const result = await runSourceOnPool(source, poolRoundNumber);
    results.push(result);

    const decision = routeResult(result, newRounds);

    if (decision === 'STAYS_IN_POOL') {
      // Increment rounds and keep in pool
      source.roundsParticipated = newRounds;
      fails.push(source);
      console.log(`  → STAYS IN POOL (round ${newRounds}/3)`);
    } else {
      // Source exited the pool
      exits.push({ source, decision, result });
      console.log(`  → EXITED: ${decision}`);
    }
  }

  return { results, exits, fails };
}

// ---------------------------------------------------------------------------
// Step 7: Report generation
// ---------------------------------------------------------------------------

function writeReports(
  state: PoolState,
  roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[],
  batchNum: number
): void {
  const batchDir = join(REPORTS_DIR, `batch-${batchNum}`);
  mkdirSync(join(batchDir, 'source-reports'), { recursive: true });

  // --- Layer 1: Batch Report ---
  let totalExtractSuccess = 0;
  let totalRouteSuccess = 0;
  let totalFail = 0;
  let totalEvents = 0;
  const allResults: CResult[] = [];

  for (const round of roundResults) {
    totalExtractSuccess += round.results.filter(r => r.outcomeType === 'extract_success').length;
    totalRouteSuccess += round.results.filter(r => r.outcomeType === 'route_success').length;
    totalFail += round.results.filter(r => r.outcomeType === 'fail').length;
    totalEvents += round.results.reduce((s, r) => s + r.extract.eventsFound, 0);
    allResults.push(...round.results);
  }

  const poolSummary = `
## Batch Report batch-${batchNum}

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| poolRoundNumber | ${state.poolRoundNumber} |
| inputQueue | postB-preC |
| sourcesIn | ${state.activePool.length + state.exited.length + state.newlyRefilled.length} |
| extractSuccess | ${totalExtractSuccess} |
| routeSuccess | ${totalRouteSuccess} |
| fail | ${totalFail} |
| totalEventsExtracted | ${totalEvents} |
| exits | ${state.exited.length} |
| stopReason | ${state.poolRoundNumber >= 3 || state.activePool.length === 0 ? 'max-rounds-reached-or-pool-exhausted' : 'incomplete'} |

### Queue distribution (exits)
${state.exited.map(e => `- ${e.source.sourceId}: ${e.decision}`).join('\n')}

### Pool state at end
- Active pool: ${state.activePool.length} sources
- Exited: ${state.exited.length} sources
- Total rounds run: ${state.poolRoundNumber}
`.trim();

  writeFileSync(join(batchDir, 'batch-report.md'), poolSummary);

  // --- Layer 2: Source Reports ---
  let roundIdx = 1;
  for (const round of roundResults) {
    for (const result of round.results) {
      const sourceReport = `
## Source Report: ${result.sourceId}

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| roundNumber | ${roundIdx} |
| sourceId | ${result.sourceId} |
| url | ${result.url} |
| winningStage | ${result.winningStage} |
| outcomeType | ${result.outcomeType} |
| routeSuggestion | ${result.routeSuggestion} |
| failType | ${result.failType ?? 'N/A'} |
| evidence | ${result.evidence} |
| eventsFound | ${result.extract.eventsFound} |
| c0Candidates | ${result.c0.candidates} |
| winnerUrl | ${result.c0.winnerUrl ?? 'null'} |
| c2Verdict | ${result.c2.verdict} |
| c2Score | ${result.c2.score} |
| error | ${result.error ?? 'none'} |
`.trim();
      writeFileSync(join(batchDir, 'source-reports', `${result.sourceId}-round-${roundIdx}.md`), sourceReport);
    }
    roundIdx++;
  }

  // --- Layer 3: Round Reports ---
  roundIdx = 1;
  for (const round of roundResults) {
    const extractSuccess = round.results.filter(r => r.outcomeType === 'extract_success').length;
    const routeSuccess = round.results.filter(r => r.outcomeType === 'route_success').length;
    const failCount = round.results.filter(r => r.outcomeType === 'fail').length;
    const eventsTotal = round.results.reduce((s, r) => s + r.extract.eventsFound, 0);
    const failedSources = round.fails.map(s => s.sourceId);

    const roundReport = `
## Round Report round-${roundIdx} (batch-${batchNum})

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| roundNumber | ${roundIdx} |
| inputQueue | postB-preC |
| sourcesIn | ${round.results.length} |
| extractSuccess | ${extractSuccess} |
| routeSuccess | ${routeSuccess} |
| fail | ${failCount} |
| totalEvents | ${eventsTotal} |

### Sources that failed (stay in pool for next round)
${failedSources.length > 0 ? failedSources.map(s => `- ${s}`).join('\n') : '(none)'}

### Sources that exited
${round.exits.map(e => `- ${e.source.sourceId}: ${e.decision}`).join('\n')}
`.trim();
    writeFileSync(join(batchDir, `round-${roundIdx}-report.md`), roundReport);
    roundIdx++;
  }

  // --- Layer 4: C4-AI Learnings (placeholder — requires AI analysis) ---
  const c4Report = `
## C4-AI Learnings batch-${batchNum}

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| observedPattern | (not yet analyzed — requires AI step) |
| hypothesis | (not yet formulated) |
| decision | unclear |
`.trim();
  writeFileSync(join(batchDir, 'c4-ai-learnings.md'), c4Report);

  console.log(`\nReports written to: ${batchDir}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const BATCH_NUM = 13; // Next batch number

  console.log('='.repeat(60));
  console.log('DYNAMIC TEST POOL — NEW CANONICAL MODEL');
  console.log('='.repeat(60));

  // Step 0: Clear output queues
  clearOutputQueues();

  // Step 1: Build initial pool
  console.log('\n[Step 1] Building initial pool from postB-preC...');
  const initial = buildInitialPool();

  if (!initial || initial.pool.length === 0) {
    console.error('ERROR: No eligible sources in postB-preC. Aborting.');
    return;
  }

  console.log(`  Selected ${initial.pool.length} sources (eligible in postB-preC: ${initial.eligibleInPrec})`);

  const state: PoolState = {
    poolRoundNumber: 0,
    activePool: initial.pool,
    exited: [],
    failed: [],
    newlyRefilled: [],
  };

  const allExitedIds = new Set<string>();
  const roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[] = [];

  // Step 2: Run rounds
  while (state.activePool.length > 0 && state.poolRoundNumber < 3) {
    state.poolRoundNumber++;

    const roundOutput = await runPoolRound(state);
    roundResults.push(roundOutput);

    // Update exited list
    for (const exit of roundOutput.exits) {
      state.exited.push(exit);
      allExitedIds.add(exit.source.sourceId);
    }

    // Update active pool — only sources that stayed in pool
    state.activePool = roundOutput.fails;

    console.log(`\nAfter round ${state.poolRoundNumber}:`);
    console.log(`  Active pool: ${state.activePool.length}`);
    console.log(`  Exited: ${state.exited.length}`);
    console.log(`  Newly exited this round: ${roundOutput.exits.length}`);

    // Step 3: Refill between rounds (if more rounds will follow)
    if (state.poolRoundNumber < 3 && state.activePool.length > 0) {
      const refill = refillPool(state.activePool, new Set(state.activePool.map(s => s.sourceId)), allExitedIds);
      if (refill.newSources.length > 0) {
        state.activePool.push(...refill.newSources);
        state.newlyRefilled = refill.newSources;
        console.log(`  Refilled ${refill.newSources.length} new sources (available in postB-preC: ${refill.availableInPrec})`);
      } else {
        console.log(`  No eligible sources available for refill (available: ${refill.availableInPrec})`);
      }
    }
  }

  // Step 4: Final report
  console.log(`\n${'='.repeat(60)}`);
  console.log('DYNAMIC POOL RUN COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Rounds completed: ${state.poolRoundNumber}`);
  console.log(`Total exited: ${state.exited.length}`);
  console.log(`Active pool at end: ${state.activePool.length}`);

  // Queue summary
  const queueSummary: Record<string, number> = {
    'postTestC-UI': 0,
    'postTestC-A': 0,
    'postTestC-B': 0,
    'postTestC-D': 0,
    'postTestC-manual-review': 0,
  };
  for (const exit of state.exited) {
    const q = exit.decision;
    if (q in queueSummary) queueSummary[q]++;
  }

  console.log('\nExit queue distribution:');
  for (const [queue, count] of Object.entries(queueSummary)) {
    console.log(`  ${queue}: ${count}`);
  }

  // Write reports
  writeReports(state, roundResults, BATCH_NUM);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
