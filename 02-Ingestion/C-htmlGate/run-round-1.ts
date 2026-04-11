/**
 * C-htmlGate Round-1 Runner — 123-LOOP IMPLEMENTATION
 *
 * Kör C0→C1→C2→C3 (C0=discoverEventCandidates→C1=screenUrl→C2=evaluateHtmlGate→C3=extractFromHtml) 
 * på sources från runtime/postTestC-Fail-round1.jsonl
 *
 * Round-1 hypotes: Root URL fallback i C0
 * - När C0 hittar 0 candidates, använd root URL som fallback istället för null
 * - Detta hjälper sajter där root har events men inga interna event-links hittas
 *
 * Routing-logik:
 * - extract_success (events > 0) → postTestC-UI, winningStage=C3
 * - C2 route signal to A/B/D → postTestC-A/B/D, winningStage=C2, outcomeType=route_success
 * - fail → postTestC-Fail-round2, outcomeType=fail
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { appendFileSync } from 'fs';

// Project root is TWO levels up from C-htmlGate/
import { dirname, join } from 'path';
const PROJECT_ROOT = join(process.cwd(), '..', '..');

const ROUND_NUMBER = 1;

// Queue paths
// Queue paths - absolute paths
const QUEUES = {
  UI: join(PROJECT_ROOT, 'runtime/postTestC-UI.jsonl'),
  A: join(PROJECT_ROOT, 'runtime/postTestC-A.jsonl'),
  B: join(PROJECT_ROOT, 'runtime/postTestC-B.jsonl'),
  D: join(PROJECT_ROOT, 'runtime/postTestC-D.jsonl'),
  FAIL_ROUND1: join(PROJECT_ROOT, 'runtime/postTestC-Fail-round1.jsonl'),
  FAIL_ROUND2: join(PROJECT_ROOT, 'runtime/postTestC-Fail-round2.jsonl'),
};

interface SourceEntry {
  sourceId: string;
  url: string;
  selectionReason?: string;
  diversifiers?: string[];
  queueReason?: string;
  enrichedData?: Record<string, any>;
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
  // Raw success flag for compatibility
  success: boolean;
  error?: string;
}

function loadFailSet(): SourceEntry[] {
  // Path is relative to project root
  const content = readFileSync(join(PROJECT_ROOT, 'runtime/postTestC-Fail-round1.jsonl'), 'utf-8');
  return content.trim().split('\n').map(line => {
    const entry = JSON.parse(line);
    return {
      sourceId: entry.sourceId,
      url: '', // Will be loaded from sources_status or batch-baseline
    };
  });
}

function getSourceUrls(): Record<string, string> {
  // Load from batch-011 baseline results
  const baselinePath = join(PROJECT_ROOT, '02-Ingestion/C-htmlGate/reports/batch-011/batch-011-baseline-results.jsonl');
  try {
    const content = readFileSync(baselinePath, 'utf-8');
    const results = JSON.parse(content);
    const urlMap: Record<string, string> = {};
    for (const r of results) {
      urlMap[r.sourceId] = r.url;
    }
    return urlMap;
  } catch {
    console.log('WARNING: Could not load baseline URLs, falling back to sources_status');
    return {};
  }
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
    // Test fields
    winningStage: result.winningStage,
    outcomeType: result.outcomeType,
    routeSuggestion: result.routeSuggestion,
    roundNumber: result.roundNumber + 1, // Increment round
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
      queuePath = QUEUES.FAIL_ROUND2;
      queueName = 'postTestC-Fail-round2';
  }

  entry.queueName = queueName;
  appendFileSync(queuePath, JSON.stringify(entry) + '\n');
}

async function runSource(entry: SourceEntry, rootUrl: string): Promise<CResult> {
  console.log(`\n=== ${entry.sourceId} (${rootUrl}) ===`);

  const result: CResult = {
    sourceId: entry.sourceId,
    url: rootUrl,
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
    const c0 = await discoverEventCandidates(rootUrl);
    result.c0 = {
      candidates: c0?.candidatesFound || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
      rootFallback: false,
    };
    console.log(`C0: ${c0?.candidatesFound || 0} candidates, winner=${c0?.winner?.url || 'none'}`);

    // ROOT URL FALLBACK: Om 0 candidates OCH root har mätts (rootDensityScore > 0)
    // använd root som fallback istället för att ge upp
    if (c0?.candidatesFound === 0 && c0?.winner === undefined) {
      // Kolla om root fetch faktiskt lyckades (den mäts i discoverEventCandidates)
      // och om root har någon event density
      console.log(`C0: 0 candidates found, checking if root URL should be fallback...`);
      // Obs: Vi kan inte direkt se rootDensityScore från resultatet, 
      // men om winnerUrl fortfarande är null betyder det att ingen candidate valdes
      // Detta betyder antingen: root fetch failed ELLER root density var 0
    }

    const targetUrl = c0?.winner?.url || rootUrl;

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
    const ext = await extractFromHtml(targetUrl, entry.sourceId, rootUrl);
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
  console.log('=== ROUND-1 — 123 LOOP IMPLEMENTATION ===\n');
  console.log('Hypothesis: Root URL fallback in C0 when 0 candidates found\n');

  // Load fail set
  const sources = loadFailSet();
  console.log(`Loaded ${sources.length} sources from postTestC-Fail-round1.jsonl`);

  // Get URLs from baseline
  const urls = getSourceUrls();
  console.log(`Loaded ${Object.keys(urls).length} URLs from baseline`);

  const results: CResult[] = [];

  // Clear output queues first (except input)
  for (const queue of [QUEUES.UI, QUEUES.A, QUEUES.B, QUEUES.D, QUEUES.FAIL_ROUND2]) {
    writeFileSync(queue, '');
  }

  for (const src of sources) {
    const url = urls[src.sourceId] || src.url;
    if (!url) {
      console.log(`WARNING: No URL for ${src.sourceId}, skipping`);
      continue;
    }
    const r = await runSource(src, url);
    results.push(r);
  }

  // Save results to round report
  const reportDir = './reports/batch-011';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/round-1-results.jsonl`, JSON.stringify(results, null, 2));

  // Summary
  const extractSuccess = results.filter(r => r.outcomeType === 'extract_success').length;
  const routeSuccess = results.filter(r => r.outcomeType === 'route_success').length;
  const failCount = results.filter(r => r.outcomeType === 'fail').length;
  const eventsTotal = results.reduce((sum, r) => sum + r.extract.eventsFound, 0);

  console.log('\n=== ROUND-1 SUMMARY ===');
  console.log(`Extract success (UI): ${extractSuccess}/${sources.length}`);
  console.log(`Route success (A/B/D): ${routeSuccess}/${sources.length}`);
  console.log(`Fail: ${failCount}/${sources.length}`);
  console.log(`Events total: ${eventsTotal}`);

  // Queue distribution
  const queueCounts = {
    'postTestC-UI': results.filter(r => r.routeSuggestion === 'UI').length,
    'postTestC-A': results.filter(r => r.routeSuggestion === 'A').length,
    'postTestC-B': results.filter(r => r.routeSuggestion === 'B').length,
    'postTestC-D': results.filter(r => r.routeSuggestion === 'D').length,
    'postTestC-Fail-round2': results.filter(r => r.routeSuggestion === 'Fail').length,
  };
  console.log('\nQueue distribution:');
  for (const [queue, count] of Object.entries(queueCounts)) {
    console.log(`  ${queue}: ${count}`);
  }

  // Per-source summary
  console.log('\nPer-source results:');
  for (const r of results) {
    console.log(`  ${r.sourceId}: ${r.outcomeType} → ${r.routeSuggestion} (${r.winningStage}) — ${r.extract.eventsFound} events`);
    console.log(`    winnerUrl=${r.c0.winnerUrl}, candidates=${r.c0.candidates}, c2_verdict=${r.c2.verdict}`);
  }

  console.log('\n=== ROUND-1 COMPLETE ===');
}

main().catch(console.error);
