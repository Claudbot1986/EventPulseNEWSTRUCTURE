/**
 * Universal Pool Runner — New C-htmlGate Engine
 * 
 * Replaces: run-dynamic-pool.ts (C0→C1→C2→C3 pipeline)
 * Uses:    Universal Scout Engine (Scout → Ranker → MultiExtractor)
 * 
 * Key differences from old pool runner:
 * - Single-pass pipeline (no multi-round)
 * - Scout discovers MANY candidates, not just one winner
 * - MultiExtractor tries top 5 candidates and picks best
 * - No C1/C2 gating — density determines what to try
 * - Source exits to postTestC-UI on any events found
 * - Source exits to manual-review on 0 events (3 rounds exhausted)
 * 
 * Flow:
 * 1. Fill pool from postB-preC (10 sources)
 * 2. Run Universal Scout on each source
 * 3. On events found → postTestC-UI
 * 4. On 0 events after 3 attempts → postTestC-manual-review
 * 5. Refill pool from postB-preC
 * 6. Repeat until queue empty
 */

import { readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runUniversalScout, type UniversalScoutResult } from './index.js';
import type { ParsedEvent } from '../F-eventExtraction/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const REPORTS_DIR = join(__dirname, 'reports');

// ─── Queue paths ─────────────────────────────────────────────────────────────

const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  SOURCES_STATUS: join(RUNTIME_DIR, 'sources_status.jsonl'),
  UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// ─── Types ──────────────────────────────────────────────────────────────────

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
  diversifiers?: string[];
  queueReason?: string;
}

interface UniversalResult {
  sourceId: string;
  url: string;
  eventsFound: number;
  events: ParsedEvent[];
  winnerMethod: string;
  winnerUrl: string | null;
  didConverge: boolean;
  scoutDurationMs: number;
  extractorDurationMs: number;
  totalDurationMs: number;
  failReason: string | null;
  failStage: 'scout' | 'ranker' | 'extractor' | null;
  // Candidate info
  totalCandidatesFound: number;
  topCandidateUrl: string | null;
  swedishPatternHits: string[];
}

interface PoolState {
  poolRoundNumber: number;
  activePool: PoolSource[];
  exited: { source: PoolSource; decision: string; result: UniversalResult | null }[];
  allExitedIds: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => JSON.parse(line) as T);
}

function loadCanonicalUrls(): Map<string, string> {
  const urlMap = new Map<string, string>();
  const SOURCES_DIR = join(PROJECT_ROOT, 'sources');
  try {
    const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(SOURCES_DIR, file), 'utf8').trim();
        if (!content) continue;
        const source = JSON.parse(content);
        if (source.id && source.url) urlMap.set(source.id, source.url);
      } catch { /* skip */ }
    }
  } catch { /* sources dir missing */ }
  return urlMap;
}

function loadAllStatuses(): Map<string, SourceStatus> {
  const map = new Map<string, SourceStatus>();
  try {
    const statuses = parseJsonl<SourceStatus>(QUEUES.SOURCES_STATUS);
    for (const s of statuses) map.set(s.sourceId, s);
  } catch { /* skip */ }
  return map;
}

function buildDiversifiers(status: SourceStatus | undefined): string[] {
  const d: string[] = [];
  if (!status) return d;
  if (status.consecutiveFailures > 0) d.push(`failures_${status.consecutiveFailures}`);
  if (status.lastEventsFound > 0) d.push(`events_${status.lastEventsFound}`);
  if (status.triageResult) d.push(`triage_${status.triageResult}`);
  return d;
}

// ─── Pool Management ────────────────────────────────────────────────────────

function buildInitialPool(): PoolSource[] {
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = loadAllStatuses();
  const canonicalUrls = loadCanonicalUrls();
  
  const candidates: { entry: QueueEntry; status: SourceStatus | undefined; url: string }[] = [];
  
  for (const entry of queueEntries) {
    const url = canonicalUrls.get(entry.sourceId) ?? null;
    if (url === null) continue;
    const status = allStatuses.get(entry.sourceId);
    candidates.push({ entry, status, url });
  }
  
  // Build diverse pool of 10
  const selected: PoolSource[] = [];
  const usedIds = new Set<string>();
  
  // Round-robin-ish diversity: alternate between different failure buckets
  const buckets: Record<string, PoolSource[]> = {};
  for (const c of candidates) {
    const bucket = c.status?.triageResult ?? (c.status?.consecutiveFailures != null && c.status.consecutiveFailures > 0 ? 'has_failures' : 'no_history');
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push({
      sourceId: c.entry.sourceId,
      url: c.url,
      roundsParticipated: 0,
      diversifiers: buildDiversifiers(c.status),
      queueReason: c.entry.queueReason ?? '',
    });
  }
  
  // Take up to 2 from each bucket
  for (const bucket of Object.values(buckets)) {
    for (const source of bucket.slice(0, 2)) {
      if (selected.length >= 10) break;
      if (!usedIds.has(source.sourceId)) {
        usedIds.add(source.sourceId);
        selected.push(source);
      }
    }
  }
  
  // Drain selected from queue
  const selectedIds = new Set(selected.map(s => s.sourceId));
  const remaining = queueEntries.filter(e => !selectedIds.has(e.sourceId));
  writeFileSync(QUEUES.PREC, remaining.length > 0 ? remaining.map(e => JSON.stringify(e)).join('\n') + '\n' : '');
  
  console.log(`[Pool] Built pool of ${selected.length} sources from ${queueEntries.length} in queue`);
  return selected;
}

function refillPool(currentPool: PoolSource[], allExitedIds: Set<string>): PoolSource[] {
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = loadAllStatuses();
  const canonicalUrls = loadCanonicalUrls();
  
  const activeIds = new Set(currentPool.map(s => s.sourceId));
  
  const candidates: { entry: QueueEntry; status: SourceStatus | undefined; url: string }[] = [];
  
  for (const entry of queueEntries) {
    if (activeIds.has(entry.sourceId) || allExitedIds.has(entry.sourceId)) continue;
    const url = canonicalUrls.get(entry.sourceId) ?? null;
    if (url === null) continue;
    candidates.push({ entry, status: allStatuses.get(entry.sourceId), url });
  }
  
  const needed = 10 - currentPool.length;
  const toAdd = candidates.slice(0, needed).map(c => ({
    sourceId: c.entry.sourceId,
    url: c.url,
    roundsParticipated: 0,
    diversifiers: buildDiversifiers(c.status),
    queueReason: c.entry.queueReason ?? '',
  }));
  
  // Drain from queue
  const addIds = new Set(toAdd.map(s => s.sourceId));
  const remaining = queueEntries.filter(e => !addIds.has(e.sourceId));
  writeFileSync(QUEUES.PREC, remaining.length > 0 ? remaining.map(e => JSON.stringify(e)).join('\n') + '\n' : '');
  
  console.log(`[Pool] Refilled ${toAdd.length} sources, ${remaining.length} remain in queue`);
  return toAdd;
}

// ─── Source Processing ──────────────────────────────────────────────────────

async function processSource(source: PoolSource, roundNum: number): Promise<UniversalResult> {
  console.log(`\n=== ${source.sourceId} (round ${roundNum}) ===`);
  
  const scoutResult = await runUniversalScout(source.sourceId, source.url);
  
  if (scoutResult.extractor) {
    console.log(`  Scout: ${scoutResult.scout?.totalCandidatesFound ?? 0} candidates, ${scoutResult.scout?.swedishPatternHits?.length ?? 0} pattern hits`);
    console.log(`  Ranker: top=${scoutResult.ranker?.topCandidates[0]?.href ?? 'none'}`);
    console.log(`  MultiExtract: ${scoutResult.extractor.totalEvents} events via ${scoutResult.extractor.winnerMethod}`);
    console.log(`  Winner: ${scoutResult.winnerUrl ?? 'none'}`);
    console.log(`  Duration: ${scoutResult.totalDurationMs}ms`);
  } else if (scoutResult.failReason) {
    console.log(`  FAILED: ${scoutResult.failReason}`);
  }
  
  return {
    sourceId: scoutResult.sourceId,
    url: scoutResult.url,
    eventsFound: scoutResult.eventsFound,
    events: scoutResult.extractor?.allEvents ?? [],
    winnerMethod: scoutResult.winnerMethod,
    winnerUrl: scoutResult.winnerUrl,
    didConverge: scoutResult.didConverge,
    scoutDurationMs: scoutResult.scoutDurationMs,
    extractorDurationMs: scoutResult.extractorDurationMs,
    totalDurationMs: scoutResult.totalDurationMs,
    failReason: scoutResult.failReason,
    failStage: scoutResult.failStage,
    totalCandidatesFound: scoutResult.scout?.totalCandidatesFound ?? 0,
    topCandidateUrl: scoutResult.ranker?.topCandidates[0]?.url ?? null,
    swedishPatternHits: scoutResult.scout?.swedishPatternHits ?? [],
  };
}

function routeResult(result: UniversalResult, rounds: number): string {
  const entry = {
    sourceId: result.sourceId,
    queueName: '',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: result.didConverge
      ? `${result.eventsFound} events found via ${result.winnerMethod} from ${result.winnerUrl}`
      : `failed: ${result.failReason ?? 'no events found'}`,
    workerNotes: `universal:${result.winnerMethod || (result.failStage ?? 'unknown')}`,
    winningStage: 'UniversalScout',
    outcomeType: result.didConverge ? 'extract_success' : 'fail',
    routeSuggestion: result.didConverge ? 'UI' : 'manual-review',
    roundNumber: rounds,
    roundsParticipated: rounds,
  };
  
  let queuePath: string;
  let queueName: string;
  
  if (result.didConverge) {
    queuePath = QUEUES.UI;
    queueName = 'postTestC-UI';
  } else if (rounds >= 3) {
    queuePath = QUEUES.MANUAL_REVIEW;
    queueName = 'postTestC-manual-review';
  } else {
    // Stay in pool
    return 'STAYS_IN_POOL';
  }
  
  entry.queueName = queueName;
  appendFileSync(queuePath, JSON.stringify(entry) + '\n');
  
  return queueName;
}

// ─── Batch Reporting ────────────────────────────────────────────────────────

function ensureBatchDir(batchNum: number): string {
  const dir = join(REPORTS_DIR, `batch-${batchNum}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBatchReport(
  batchNum: number,
  results: UniversalResult[],
  exits: { source: PoolSource; decision: string; result: UniversalResult }[],
  fails: PoolSource[],
): void {
  const batchDir = ensureBatchDir(batchNum);
  
  const totalEvents = results.reduce((s, r) => s + r.eventsFound, 0);
  const extractSuccess = results.filter(r => r.didConverge).length;
  const failCount = results.filter(r => !r.didConverge).length;
  const withCandidates = results.filter(r => r.totalCandidatesFound > 0).length;
  const swedishHits = results.filter(r => r.swedishPatternHits.length > 0).length;
  
  const eventsByMethod: Record<string, number> = {};
  for (const r of results) {
    if (r.winnerMethod) {
      eventsByMethod[r.winnerMethod] = (eventsByMethod[r.winnerMethod] || 0) + r.eventsFound;
    }
  }
  
  const report = `
## Universal Scout — Batch ${batchNum} Report

### Summary
| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| sourcesProcessed | ${results.length} |
| extractSuccess | ${extractSuccess} |
| fail | ${failCount} |
| totalEvents | ${totalEvents} |
| sourcesWithCandidates | ${withCandidates} |
| swedishPatternHits | ${swedishHits} |
| poolRemaining | ${fails.length} |

### Events by Method
${Object.entries(eventsByMethod).map(([m, n]) => `- ${m}: ${n} events`).join('\n')}

### Sources with Events
${results.filter(r => r.didConverge).map(r =>
  `- ${r.sourceId}: ${r.eventsFound} events via ${r.winnerMethod} (${r.winnerUrl})`
).join('\n') || '(none)'}

### Failed Sources
${results.filter(r => !r.didConverge).map(r =>
  `- ${r.sourceId}: ${r.failReason ?? 'no events'} (stage: ${r.failStage ?? 'unknown'})`
).join('\n') || '(none)'}

### Swedish Pattern Hits
${results.filter(r => r.swedishPatternHits.length > 0).map(r =>
  `- ${r.sourceId}: ${r.swedishPatternHits.join(', ')}`
).join('\n') || '(none)'}

### Stayed in Pool
${fails.map(s => `- ${s.sourceId} (round ${s.roundsParticipated}/3)`).join('\n') || '(none)'}
`.trim();
  
  writeFileSync(join(batchDir, 'batch-report.md'), report);
  
  // Write JSONL for all results
  for (const r of results) {
    appendFileSync(join(batchDir, 'results.jsonl'), JSON.stringify(r) + '\n');
  }
  
  console.log(`\n[Report] Written to ${batchDir}/batch-report.md`);
}

// ─── Main Pool Loop ────────────────────────────────────────────────────────

export async function runUniversalPoolBatch(batchNum: number = 99): Promise<void> {
  console.log('='.repeat(60));
  console.log('UNIVERSAL SCOUT POOL RUNNER');
  console.log('='.repeat(60));
  
  ensureBatchDir(batchNum);
  
  // Step 1: Build initial pool
  let pool = buildInitialPool();
  if (pool.length === 0) {
    console.log('[Pool] Queue empty — nothing to do');
    return;
  }
  
  const exited: { source: PoolSource; decision: string; result: UniversalResult }[] = [];
  const allExitedIds = new Set<string>();
  let poolRound = 0;
  
  // Max 3 rounds
  while (pool.length > 0 && poolRound < 3) {
    poolRound++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ROUND ${poolRound} — ${pool.length} active sources`);
    console.log(`${'='.repeat(60)}`);
    
    const roundResults: UniversalResult[] = [];
    const roundExits: { source: PoolSource; decision: string; result: UniversalResult }[] = [];
    const roundFails: PoolSource[] = [];
    
    // Process all pool sources
    for (const source of pool) {
      const newRounds = source.roundsParticipated + 1;
      const result = await processSource(source, newRounds);
      roundResults.push(result);
      
      const decision = routeResult(result, newRounds);
      
      if (decision === 'STAYS_IN_POOL') {
        source.roundsParticipated = newRounds;
        roundFails.push(source);
      } else {
        roundExits.push({ source, decision, result });
        allExitedIds.add(source.sourceId);
      }
    }
    
    exited.push(...roundExits);
    
    // Report this round
    writeBatchReport(batchNum, roundResults, roundExits, roundFails);
    
    // Refill pool
    const newSources = refillPool(roundFails, allExitedIds);
    pool = [...roundFails, ...newSources];
    
    console.log(`\nRound ${poolRound} complete: ${roundExits.length} exits, ${roundFails.length} stays, ${newSources.length} refilled`);
    
    if (pool.length === 0) break;
  }
  
  // Final report
  const allResults = exited.map(e => e.result).filter(Boolean) as UniversalResult[];
  writeBatchReport(batchNum, allResults, exited, []);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('POOL COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total processed: ${exited.length}`);
  console.log(`Total events: ${allResults.reduce((s, r) => s + r.eventsFound, 0)}`);
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const batchNum = parseInt(process.argv[2] ?? '99', 10);
  runUniversalPoolBatch(batchNum).catch(console.error);
}
