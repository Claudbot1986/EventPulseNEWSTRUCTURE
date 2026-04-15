/**
 * C-htmlGate Batch 012 Runner — BASELINE FOR ROUND-2
 *
 * Kör C0→C1→C2→C3 på samma 10 källor som batch-011
 * för att skapa en ny baseline inför 123 round-2
 *
 * Sources: brommapojkarna, varmland, svenska-hockeyligan-shl, nykoping,
 *          liseberg-n-je, medeltidsmuseet, ik-sirius, kth,
 *          helsingborg-arena, g-teborgs-posten
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { appendFileSync } from 'fs';

const ROUND_NUMBER = 1; // Baseline for new batch

// Queue paths (relative to project root, resolved from C-htmlGate/)
const QUEUES = {
  UI: '../../runtime/postTestC-UI.jsonl',
  A: '../../runtime/postTestC-A.jsonl',
  B: '../../runtime/postTestC-B.jsonl',
  D: '../../runtime/postTestC-D.jsonl',
  FAIL_ROUND1: '../../runtime/postTestC-Fail-batch012-round1.jsonl',
};

interface SourceEntry {
  sourceId: string;
  url: string;
}

interface CResult {
  sourceId: string;
  url: string;
  // Stage results
  c0: { candidates: number; winnerUrl: string | null; winnerDensity: number; duration: number; rootFallback: boolean };
  c1: { verdict: string; likelyJsRendered: boolean; timeTagCount: number; dateCount: number; duration: number };
  c2: { verdict: string; score: number; reason: string; duration: number };
  extract: { eventsFound: number; duration: number };
  // Step-4 result fields
  winningStage: 'C1' | 'C2' | 'C3' | 'C4-AI';
  outcomeType: 'extract_success' | 'route_success' | 'fail';
  routeSuggestion: 'UI' | 'A' | 'B' | 'D' | 'Fail';
  evidence: string;
  roundNumber: number;
  success: boolean;
  error?: string;
}

// Samma 10 källor som batch-011
const SOURCES: SourceEntry[] = [
  { sourceId: 'brommapojkarna', url: 'https://bpxf.se/' },
  { sourceId: 'varmland', url: 'https://varmland.se/' },
  { sourceId: 'svenska-hockeyligan-shl', url: 'https://shl.se/' },
  { sourceId: 'nykoping', url: 'https://nykoping.se/' },
  { sourceId: 'liseberg-n-je', url: 'https://liseberg.se/' },
  { sourceId: 'medeltidsmuseet', url: 'https://medeltidsmuseet.se/' },
  { sourceId: 'ik-sirius', url: 'https://iksirius.se/' },
  { sourceId: 'kth', url: 'https://kth.se/evenemang' },
  { sourceId: 'helsingborg-arena', url: 'https://helsingborgarena.se/' },
  { sourceId: 'g-teborgs-posten', url: 'https://gp.se/evenemang' },
];

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

  // No extraction success, no route signal → fail
  result.outcomeType = 'fail';
  result.winningStage = 'C3'; // Last stage attempted
  result.routeSuggestion = 'Fail';

  // Generate evidence
  if (result.c0.winnerUrl === null && result.c0.candidates === 0) {
    result.evidence = 'C0: no internal event candidates discovered, root fallback also failed';
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
      queueName = 'postTestC-Fail-batch012-round1';
  }

  entry.queueName = queueName;
  appendFileSync(queuePath, JSON.stringify(entry) + '\n');
}

async function runSource(entry: SourceEntry): Promise<CResult> {
  console.log(`\n=== ${entry.sourceId} (${entry.url}) ===`);

  const result: CResult = {
    sourceId: entry.sourceId,
    url: entry.url,
    c0: { candidates: 0, winnerUrl: null, winnerDensity: 0, duration: 0, rootFallback: false },
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
      candidates: c0?.candidatesFound || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
      rootFallback: false,
    };
    console.log(`C0: ${c0?.candidatesFound || 0} candidates, winner=${c0?.winner?.url || 'none'}`);

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
  console.log('=== BATCH 012 — BASELINE RUN ===\n');
  console.log(`Sources: ${SOURCES.length}\n`);

  const results: CResult[] = [];

  // Clear output queue
  writeFileSync(QUEUES.FAIL_ROUND1, '');

  for (const src of SOURCES) {
    const r = await runSource(src);
    results.push(r);
  }

  // Save results
  const reportDir = './reports/batch-012';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/batch-012-baseline-results.jsonl`, JSON.stringify(results, null, 2));

  // Summary
  const extractSuccess = results.filter(r => r.outcomeType === 'extract_success').length;
  const routeSuccess = results.filter(r => r.outcomeType === 'route_success').length;
  const failCount = results.filter(r => r.outcomeType === 'fail').length;
  const eventsTotal = results.reduce((sum, r) => sum + r.extract.eventsFound, 0);

  console.log('\n=== BATCH 012 BASELINE SUMMARY ===');
  console.log(`Extract success (UI): ${extractSuccess}/${SOURCES.length}`);
  console.log(`Route success (A/B/D): ${routeSuccess}/${SOURCES.length}`);
  console.log(`Fail: ${failCount}/${SOURCES.length}`);
  console.log(`Events total: ${eventsTotal}`);

  // Queue distribution
  const queueCounts = {
    'postTestC-UI': results.filter(r => r.routeSuggestion === 'UI').length,
    'postTestC-A': results.filter(r => r.routeSuggestion === 'A').length,
    'postTestC-B': results.filter(r => r.routeSuggestion === 'B').length,
    'postTestC-D': results.filter(r => r.routeSuggestion === 'D').length,
    'postTestC-Fail-batch012-round1': results.filter(r => r.routeSuggestion === 'Fail').length,
  };
  console.log('\nQueue distribution:');
  for (const [queue, count] of Object.entries(queueCounts)) {
    console.log(`  ${queue}: ${count}`);
  }

  // Per-source summary
  console.log('\nPer-source results:');
  for (const r of results) {
    console.log(`  ${r.sourceId}: ${r.outcomeType} → ${r.routeSuggestion} (${r.winningStage}) — ${r.extract.eventsFound} events`);
    console.log(`    winnerUrl=${r.c0.winnerUrl}, candidates=${r.c0.candidates}, c2_verdict=${r.c2.verdict}, c2_score=${r.c2.score}`);
  }

  console.log('\n=== BATCH 012 BASELINE COMPLETE ===');
}

main().catch(console.error);
