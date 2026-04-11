/**
 * C-htmlGate Batch 011 Runner — STEP 4 IMPLEMENTATION
 *
 * Kör C1→C2→C3 (C0→C1→C2→extract) på sources från current-batch.jsonl
 *
 * Steg 4: Bygg manuell C-testkedja med:
 * - Tydliga resultatfält: winningStage, outcomeType, routeSuggestion, evidence, roundNumber
 * - Exakt en utfallskö per source: postTestC-UI, postTestC-A, postTestC-B, postTestC-D, postTestC-Fail-round1
 *
 * Routing-logik:
 * - extract_success (events > 0) → postTestC-UI, winningStage=C3
 * - C2 route signal to A/B/D → postTestC-A/B/D, winningStage=C2, outcomeType=route_success
 * - fail → postTestC-Fail-round1, outcomeType=fail
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { appendFileSync } from 'fs';

const ROUND_NUMBER = 1;

// Queue paths (relative to project root, resolved from C-htmlGate/)
const QUEUES = {
  UI: '../../runtime/postTestC-UI.jsonl',
  A: '../../runtime/postTestC-A.jsonl',
  B: '../../runtime/postTestC-B.jsonl',
  D: '../../runtime/postTestC-D.jsonl',
  FAIL_ROUND1: '../../runtime/postTestC-Fail-round1.jsonl',
};

interface SourceEntry {
  sourceId: string;
  url: string;
  selectionReason: string;
  diversifiers?: string[];
  queueReason?: string;
  enrichedData?: Record<string, any>;
}

interface CResult {
  sourceId: string;
  url: string;
  // Stage results
  c0: { candidates: number; winnerUrl: string | null; winnerDensity: number; duration: number };
  c1: { verdict: string; likelyJsRendered: boolean; timeTagCount: number; dateCount: number; duration: number };
  c2: { verdict: string; score: number; reason: string; duration: number };
  extract: { eventsFound: number; duration: number };
  // Step-4 result fields
  winningStage: 'C1' | 'C2' | 'C3' | 'C4-AI';
  outcomeType: 'extract_success' | 'route_success' | 'fail';
  routeSuggestion: 'UI' | 'A' | 'B' | 'D' | 'Fail';
  evidence: string;
  roundNumber: number;
  // Raw success flag for compatibility
  success: boolean;
  error?: string;
}

function loadBatch(): SourceEntry[] {
  const content = readFileSync('./batchmaker/current-batch.jsonl', 'utf-8');
  return content.trim().split('\n').map(line => JSON.parse(line));
}

function determineOutcome(result: CResult): void {
  // Extract success: events found
  if (result.extract.eventsFound > 0) {
    result.outcomeType = 'extract_success';
    result.winningStage = 'C3';
    result.routeSuggestion = 'UI';
    result.evidence = `extracted ${result.extract.eventsFound} events from HTML`;
    result.success = true;
    return;
  }

  // C2 detected strong A/B/D signal - check for route signals in verdict/reason
  const c2reason = result.c2.reason.toLowerCase();

  // Note: Current C2 doesn't explicitly route to A/B/D, so we default to fail
  // Future: detect api-signal, json-signal, render-signal in C2

  // No extraction success, no route signal → fail
  result.outcomeType = 'fail';
  result.winningStage = 'C3'; // Last stage attempted
  result.routeSuggestion = 'Fail';

  // Generate evidence
  if (result.c0.winnerUrl === null && result.c0.candidates === 0) {
    result.evidence = 'C0: no internal event candidates discovered';
  } else if (result.c2.verdict === 'unclear' || result.c2.verdict === 'blocked') {
    result.evidence = `C2: verdict=${result.c2.verdict}, score=${result.c2.score} too low`;
  } else if (result.c1.likelyJsRendered) {
    result.evidence = 'C1: likelyJsRendered=true, content may require D-render';
  } else {
    result.evidence = `C3: extraction returned 0 events despite C2 promising (score=${result.c2.score})`;
  }
  result.success = false;
}

function routeToQueue(result: CResult): void {
  const entry = {
    sourceId: result.sourceId,
    queueName: '', // filled below
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: result.evidence,
    workerNotes: `${result.winningStage}: ${result.outcomeType}`,
    // Test fields
    winningStage: result.winningStage,
    outcomeType: result.outcomeType,
    routeSuggestion: result.routeSuggestion,
    roundNumber: result.roundNumber,
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
      queuePath = QUEUES.FAIL_ROUND1;
      queueName = 'postTestC-Fail-round1';
  }

  entry.queueName = queueName;
  appendFileSync(queuePath, JSON.stringify(entry) + '\n');
}

async function runSource(entry: SourceEntry): Promise<CResult> {
  console.log(`\n=== ${entry.sourceId} ===`);

  const result: CResult = {
    sourceId: entry.sourceId,
    url: entry.url,
    c0: { candidates: 0, winnerUrl: null, winnerDensity: 0, duration: 0 },
    c1: { verdict: 'unknown', likelyJsRendered: false, timeTagCount: 0, dateCount: 0, duration: 0 },
    c2: { verdict: 'unknown', score: 0, reason: '', duration: 0 },
    extract: { eventsFound: 0, duration: 0 },
    winningStage: 'C3',
    outcomeType: 'fail',
    routeSuggestion: 'Fail',
    evidence: '',
    roundNumber: ROUND_NUMBER,
    success: false,
  };

  try {
    // C0 (Canonical C1) — Discovery/Frontier
    const c0Start = Date.now();
    const c0 = await discoverEventCandidates(entry.url);
    result.c0 = {
      candidates: c0?.candidates?.length || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
    };
    console.log(`C0: ${c0?.candidates?.length || 0} candidates, winner=${c0?.winner?.url || 'none'}`);

    const targetUrl = c0?.winner?.url || entry.url;

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

    // C2 (Canonical C2) — HTML Gate
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
    const ext = await extractFromHtml(targetUrl, entry.sourceId, entry.url);
    result.extract = {
      eventsFound: ext.events.length,
      duration: Date.now() - extStart,
    };
    console.log(`C3: ${ext.events.length} events extracted`);

    // Determine outcome and route
    determineOutcome(result);

  } catch (e: any) {
    result.error = e.message;
    result.success = false;
    result.evidence = `error: ${e.message}`;
    result.outcomeType = 'fail';
    result.routeSuggestion = 'Fail';
    console.log(`ERROR: ${e.message}`);
  }

  // Route to appropriate queue
  routeToQueue(result);

  return result;
}

async function main() {
  console.log('=== BATCH 011 — STEP 4 IMPLEMENTATION ===\n');

  // Load sources from current-batch.jsonl
  const sources = loadBatch();
  console.log(`Loaded ${sources.length} sources from current-batch.jsonl`);

  const results: CResult[] = [];

  for (const src of sources) {
    const r = await runSource(src);
    results.push(r);
  }

  // Save results to batch report
  const reportDir = './reports/batch-011';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/batch-011-baseline-results.jsonl`, JSON.stringify(results, null, 2));

  // Summary
  const extractSuccess = results.filter(r => r.outcomeType === 'extract_success').length;
  const routeSuccess = results.filter(r => r.outcomeType === 'route_success').length;
  const failCount = results.filter(r => r.outcomeType === 'fail').length;
  const eventsTotal = results.reduce((sum, r) => sum + r.extract.eventsFound, 0);

  console.log('\n=== BATCH 011 SUMMARY ===');
  console.log(`Extract success (UI): ${extractSuccess}/10`);
  console.log(`Route success (A/B/D): ${routeSuccess}/10`);
  console.log(`Fail: ${failCount}/10`);
  console.log(`Events total: ${eventsTotal}`);

  // Queue distribution
  const queueCounts = {
    'postTestC-UI': results.filter(r => r.routeSuggestion === 'UI').length,
    'postTestC-A': results.filter(r => r.routeSuggestion === 'A').length,
    'postTestC-B': results.filter(r => r.routeSuggestion === 'B').length,
    'postTestC-D': results.filter(r => r.routeSuggestion === 'D').length,
    'postTestC-Fail-round1': results.filter(r => r.routeSuggestion === 'Fail').length,
  };
  console.log('\nQueue distribution:');
  for (const [queue, count] of Object.entries(queueCounts)) {
    console.log(`  ${queue}: ${count}`);
  }

  // Per-source summary
  console.log('\nPer-source results:');
  for (const r of results) {
    console.log(`  ${r.sourceId}: ${r.outcomeType} → ${r.routeSuggestion} (${r.winningStage}) — ${r.extract.eventsFound} events`);
  }

  // Update batch-state
  const batchStatePath = './reports/batch-state.jsonl';
  const batchState = JSON.parse(readFileSync(batchStatePath, 'utf-8'));
  batchState.currentBatch = 4;
  batchState.status = 'completed';
  batchState.preRunResults = { extractSuccess, routeSuccess, failCount, eventsTotal };
  batchState.postRunResults = {
    successCount: extractSuccess,
    eventsTotal,
    sources: results.map(r => ({
      sourceId: r.sourceId,
      outcomeType: r.outcomeType,
      routeSuggestion: r.routeSuggestion,
      winningStage: r.winningStage,
      eventsFound: r.extract.eventsFound,
    })),
  };
  writeFileSync(batchStatePath, JSON.stringify(batchState, null, 2));
  console.log(`\nBatch state updated: batch=4, status=completed`);

  console.log('\n=== STEP 4 COMPLETE ===');
  console.log('postTestC queues populated with round-1 results');
}

main().catch(console.error);
