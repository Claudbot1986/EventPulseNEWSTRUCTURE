/**
 * B-Runner PARALLEL — High-throughput B-spår for EventPulse
 *
 * KEY IMPROVEMENTS over runB.ts:
 * 1. PARALLEL EXECUTION: Controlled concurrency (default 20 workers)
 * 2. BATCH I/O: Read preB queue ONCE, write output queues ONCE per batch
 * 3. HIGHER DEFAULT LIMIT: 100 (vs 10 in runB.ts) — processes more sources per run
 * 4. MINIMAL FILE I/O: In-memory state, single write at end
 * 5. PROPER postB-preC DRAIN: All non-B sources written to postB-preC in one operation
 *
 * ROOT CAUSE FIXES:
 * - Sequential `for (const entry of batch) { await runBOnSource(entry) }` → p-limit pool
 * - Queue read/write per source (2-3 file ops each) → batched writes
 * - limit=10 too small for 255+ sources → limit=100
 *
 * FLÖDE:
 *   preB → B-verktyg (parallel)
 *   Utfall:
 *     1. events utvinns → postB
 *     2. stark B-kandidat men ej full extraction → postB
 *     3. ej B → postB-preC
 *
 * Usage:
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts              # normal (100 sources)
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --dry        # visa utan att köra
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --limit 50   # 50 sources
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --workers 10 # 10 parallel workers
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --status     # visa köstatus
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getSource, updateSourceStatus } from '../tools/sourceRegistry';
import { evaluateNetworkGate, summarizeNetworkGateResult } from './A-networkGate';
import { extractFromApi } from './networkEventExtractor';
import { queueEvents } from '../tools/fetchTools';
import { toRawEventInput } from '../F-eventExtraction';
import type { RawEventInput } from '@eventpulse/shared';

// ─── Queue File Paths ─────────────────────────────────────────────────────────

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const PREB_QUEUE_FILE    = path.resolve(RUNTIME_DIR, 'preB-queue.jsonl');
const PREUI_QUEUE_FILE    = path.resolve(RUNTIME_DIR, 'preUI-queue.jsonl');
const POSTB_QUEUE_FILE    = path.resolve(RUNTIME_DIR, 'postB-queue.jsonl');
const POSTB_PREC_FILE     = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl');
const SOURCES_STATUS_FILE = path.resolve(RUNTIME_DIR, 'sources_status.jsonl');

// ─── Queue Entry ──────────────────────────────────────────────────────────────

interface PreBEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

interface BResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  nextPath: 'network' | 'html' | 'blocked-review';
  inspectorVerdict?: string;
  error?: string;
  status: 'never_run' | 'success' | 'fail' | 'error';
  ingestionStage: 'B' | 'completed' | 'failed';
}

interface SourceStatus {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  consecutiveFailures: number;
  lastRoutingReason: string;
  lastRoutingSource: string;
  ingestionStage: string;
}

// ─── Queue Readers (read once at startup) ──────────────────────────────────────

function readPreBQueue(): PreBEntry[] {
  if (!existsSync(PREB_QUEUE_FILE)) return [];
  const content = readFileSync(PREB_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function readPreUIQueue(): PreBEntry[] {
  if (!existsSync(PREUI_QUEUE_FILE)) return [];
  const content = readFileSync(PREUI_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function readPostBQueue(): PreBEntry[] {
  if (!existsSync(POSTB_QUEUE_FILE)) return [];
  const content = readFileSync(POSTB_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function readPostBPreCQueue(): PreBEntry[] {
  if (!existsSync(POSTB_PREC_FILE)) return [];
  const content = readFileSync(POSTB_PREC_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function readSourcesStatus(): SourceStatus[] {
  if (!existsSync(SOURCES_STATUS_FILE)) return [];
  const content = readFileSync(SOURCES_STATUS_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as SourceStatus);
}

// ─── Batch I/O Writers (write ONCE at end) ───────────────────────────────────

function writePreBQueue(entries: PreBEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(PREB_QUEUE_FILE, content, 'utf8');
}

function writePreUIQueue(entries: PreBEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(PREUI_QUEUE_FILE, content, 'utf8');
}

function writePostBQueue(entries: PreBEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(POSTB_QUEUE_FILE, content, 'utf8');
}

function writePostBPreCQueue(entries: PreBEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(POSTB_PREC_FILE, content, 'utf8');
}

function writeSourcesStatus(statuses: SourceStatus[]): void {
  const content = statuses.map(s => JSON.stringify(s)).join('\n') + '\n';
  writeFileSync(SOURCES_STATUS_FILE, content, 'utf8');
}

// ─── B Tool Execution (unchanged logic from runB.ts) ──────────────────────────

async function runBOnSource(entry: PreBEntry): Promise<BResult> {
  const { sourceId } = entry;
  const source = getSource(sourceId);

  if (!source) {
    return {
      sourceId,
      success: false,
      eventsFound: 0,
      nextPath: 'blocked-review',
      error: 'source not found in sources/',
      status: 'error',
      ingestionStage: 'failed',
    };
  }

  console.log(`[B-runner] ${sourceId} — ${source.url}`);

  // Run Network Gate evaluation (breadth mode = phase 2)
  const gateResult = await evaluateNetworkGate(source.url, 'no-jsonld', 2);
  console.log(`         gate → ${summarizeNetworkGateResult(gateResult)}`);

  if (gateResult.nextPath !== 'network') {
    return {
      sourceId,
      success: false,
      eventsFound: 0,
      nextPath: gateResult.nextPath,
      inspectorVerdict: gateResult.inspectorVerdict,
      error: gateResult.reason,
      status: 'fail',
      ingestionStage: 'B',
    };
  }

  // Network path is open — try to extract events
  const inspectorResult = gateResult.inspectorResult;
  const likely = inspectorResult?.candidates.filter((c: any) => c.label === 'likely_event_api') ?? [];
  const possible = inspectorResult?.candidates.filter((c: any) => c.label === 'possible_api') ?? [];

  const candidatesToTry = likely.length > 0 ? likely.slice(0, 3) : possible.slice(0, 5);

  if (candidatesToTry.length === 0) {
    return {
      sourceId,
      success: false,
      eventsFound: 0,
      nextPath: 'network',
      inspectorVerdict: gateResult.inspectorVerdict,
      error: 'no likely or possible API candidates despite open network path',
      status: 'fail',
      ingestionStage: 'B',
    };
  }

  // Try extraction on top candidates
  let totalEvents = 0;
  const triedUrls: string[] = [];
  const allExtractedEvents: any[] = [];

  for (const candidate of candidatesToTry) {
    triedUrls.push(candidate.url);
    try {
      const extractResult = await extractFromApi(candidate.url, sourceId);
      totalEvents += extractResult.events.length;
      allExtractedEvents.push(...extractResult.events);
      if (extractResult.events.length > 0) {
        console.log(`         extracted ${extractResult.events.length} events from ${candidate.url}`);
      }
    } catch (err: any) {
      console.log(`         extract failed for ${candidate.url}: ${err.message}`);
    }
  }

  if (totalEvents === 0) {
    return {
      sourceId,
      success: false,
      eventsFound: 0,
      nextPath: 'network',
      inspectorVerdict: gateResult.inspectorVerdict,
      error: `tried ${triedUrls.length} endpoints, 0 events`,
      status: 'fail',
      ingestionStage: 'B',
    };
  }

  // Persist events to BullMQ/Redis queue
  const rawEvents: RawEventInput[] = allExtractedEvents.map(e => {
    const raw = toRawEventInput(e);
    raw.source = sourceId;
    raw.detected_language = 'sv';
    return raw;
  });
  const { queued } = await queueEvents(sourceId, rawEvents);

  return {
    sourceId,
    success: true,
    eventsFound: queued,
    nextPath: 'network',
    inspectorVerdict: gateResult.inspectorVerdict,
    status: 'success',
    ingestionStage: 'completed',
  };
}

// ─── Parallel Runner ──────────────────────────────────────────────────────────

async function runParallel<BEntry, BOut>(
  items: BEntry[],
  worker: (item: BEntry) => Promise<BOut>,
  concurrency: number
): Promise<BOut[]> {
  const results: BOut[] = new Array(items.length);
  let idx = 0;

  async function workerLoop() {
    while (true) {
      const currentIdx = idx++;
      if (currentIdx >= items.length) break;
      results[currentIdx] = await worker(items[currentIdx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, workerLoop);
  await Promise.all(workers);
  return results;
}

// ─── Status Update (in-memory, batched) ─────────────────────────────────────

function finalizeSourceBatch(
  entries: PreBEntry[],
  results: BResult[],
  existingPreUI: PreBEntry[],
  existingPostB: PreBEntry[],
  existingPostBPreC: PreBEntry[],
  existingStatuses: SourceStatus[]
): {
  newPreUI: PreBEntry[];
  newPostB: PreBEntry[];
  newPostBPreC: PreBEntry[];
  newStatuses: SourceStatus[];
} {
  // Build status map
  const statusMap = new Map<string, SourceStatus>();
  for (const s of existingStatuses) statusMap.set(s.sourceId, s);

  // Build result map
  const resultMap = new Map<string, BResult>();
  for (const r of results) resultMap.set(r.sourceId, r);

  // Track which sourceIds we've seen in each output queue (avoid duplicates)
  const preUIMap = new Map<string, PreBEntry>();
  for (const e of existingPreUI) preUIMap.set(e.sourceId, e);

  const postBMap = new Map<string, PreBEntry>();
  for (const e of existingPostB) postBMap.set(e.sourceId, e);

  const postBPreCMap = new Map<string, PreBEntry>();
  for (const e of existingPostBPreC) postBPreCMap.set(e.sourceId, e);

  const newPreUI: PreBEntry[] = [];
  const newPostB: PreBEntry[] = [];
  const newPostBPreC: PreBEntry[] = [];
  const newStatuses: SourceStatus[] = [...existingStatuses];

  const newStatusMap = new Map<string, SourceStatus>();
  for (const s of newStatuses) newStatusMap.set(s.sourceId, s);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const result = resultMap.get(entry.sourceId);
    if (!result) continue;

    // Update or create status
    const existingStatus = newStatusMap.get(entry.sourceId);
    const statusEntry: SourceStatus = {
      sourceId: entry.sourceId,
      success: result.success,
      eventsFound: result.eventsFound,
      consecutiveFailures: result.success ? 0 : (existingStatus?.consecutiveFailures ?? 0) + 1,
      lastRoutingReason: `toolB(preB): ${result.success ? `${result.eventsFound} events` : result.error}`,
      lastRoutingSource: 'runtime_status',
      ingestionStage: result.ingestionStage,
    };
    newStatusMap.set(entry.sourceId, statusEntry);

    if (result.success && result.eventsFound > 0) {
      // B success → postB queue
      if (!postBMap.has(entry.sourceId) && ![...newPostB].some(e => e.sourceId === entry.sourceId)) {
        newPostB.push({
          sourceId: entry.sourceId,
          queueName: 'postB',
          queuedAt: new Date().toISOString(),
          priority: 2,
          attempt: 1,
          queueReason: `toolB(preB): ${result.eventsFound} events`,
          workerNotes: result.inspectorVerdict,
        });
      }
    } else if (result.nextPath === 'network' && result.inspectorVerdict === 'promising') {
      // Strong B candidate → postB queue
      if (!postBMap.has(entry.sourceId) && ![...newPostB].some(e => e.sourceId === entry.sourceId)) {
        newPostB.push({
          sourceId: entry.sourceId,
          queueName: 'postB',
          queuedAt: new Date().toISOString(),
          priority: 2,
          attempt: 1,
          queueReason: `toolB(preB): ${result.error ?? 'no events'}`,
          workerNotes: result.inspectorVerdict,
        });
      }
    } else {
      // Not B → postB-preC queue
      if (!postBPreCMap.has(entry.sourceId) && ![...newPostBPreC].some(e => e.sourceId === entry.sourceId)) {
        newPostBPreC.push({
          sourceId: entry.sourceId,
          queueName: 'postB-preC',
          queuedAt: new Date().toISOString(),
          priority: 3,
          attempt: 1,
          queueReason: `toolB(preB): ${result.error ?? 'not network-accessible'}`,
        });
        // Also update preferredPath=html in status
        statusEntry.consecutiveFailures = 0;
        statusEntry.lastRoutingReason = `postB-preC: ${result.error ?? 'not network-accessible'}`;
        statusEntry.lastRoutingSource = 'runtime_status';
      }
    }
  }

  return {
    newPreUI,
    newPostB,
    newPostBPreC,
    newStatuses,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts        # normal (100 sources, 20 workers)');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --dry   # visa utan att köra');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --limit N  # max N sources');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --workers N # N parallel workers');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --status # visa köstatus');
    return;
  }

  // ── Status ──────────────────────────────────────────────────────────────
  if (args.includes('--status')) {
    const preB = readPreBQueue();
    const postB = readPostBQueue();
    const postBPreC = readPostBPreCQueue();
    console.log('═══ B-RUNNER STATUS ═══');
    console.log(`preB-queue:    ${preB.length} entries`);
    console.log(`postB-queue:   ${postB.length} entries`);
    console.log(`postB-preC:    ${postBPreC.length} entries`);
    if (preB.length > 0) {
      console.log('\n─── preB-queue entries ───');
      for (const e of preB.slice(0, 20)) {
        console.log(`  ${e.sourceId}: ${e.queueReason}`);
      }
      if (preB.length > 20) console.log(`  ... and ${preB.length - 20} more`);
    }
    return;
  }

  // ── Dry run ──────────────────────────────────────────────────────────────
  const dry = args.includes('--dry');

  // ── Limit (default: 100 — 10x the old default of 10) ─────────────────────
  const limitIdx = args.indexOf('--limit');
  const LIMIT = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 100;

  // ── Concurrency (default: 20 workers) ─────────────────────────────────────
  const workersIdx = args.indexOf('--workers');
  const WORKERS = workersIdx !== -1 && args[workersIdx + 1] ? parseInt(args[workersIdx + 1], 10) : 20;

  // ── Read ALL queues ONCE at startup ───────────────────────────────────────
  const startTime = Date.now();
  console.log('═══ B-RUNNER PARALLEL ═══');
  console.log(`Reading queues...`);

  const allPreB = readPreBQueue();
  const allPreUI = readPreUIQueue();
  const allPostB = readPostBQueue();
  const allPostBPreC = readPostBPreCQueue();
  const allStatuses = readSourcesStatus();

  if (allPreB.length === 0) {
    console.log('[B-runner] preB-queue is empty. Nothing to run.');
    return;
  }

  // Deduplicate preB by sourceId (keep first occurrence)
  const seenPreB = new Set<string>();
  const preBUnique: PreBEntry[] = [];
  for (const e of allPreB) {
    if (!seenPreB.has(e.sourceId)) {
      seenPreB.add(e.sourceId);
      preBUnique.push(e);
    }
  }

  const batch = preBUnique.slice(0, LIMIT);
  const remaining = preBUnique.slice(LIMIT);

  console.log(`preB-queue: ${batch.length} sources this run (of ${preBUnique.length} unique, ${allPreB.length} total)`);
  console.log(`Workers: ${WORKERS} (concurrency)`);
  console.log(`\nQueue state at start:`);
  console.log(`  preB-queue:   ${allPreB.length} (unique: ${preBUnique.length})`);
  console.log(`  postB-queue:  ${allPostB.length}`);
  console.log(`  postB-preC:   ${allPostBPreC.length}`);

  if (dry) {
    console.log('\nDRY RUN — inga sources körs:\n');
    for (const entry of batch) {
      const source = getSource(entry.sourceId);
      console.log(`  ${entry.sourceId}: ${source?.url ?? 'N/A'} | ${entry.queueReason}`);
    }
    return;
  }

  // ── Run B in parallel ────────────────────────────────────────────────────
  console.log(`\nRunning ${batch.length} sources with ${WORKERS} workers...`);

  const results = await runParallel(batch, runBOnSource, WORKERS);

  // ── Finalize: batch update all queues in ONE operation each ─────────────
  console.log('\nFinalizing batch...');

  const {
    newPreUI,
    newPostB,
    newPostBPreC,
    newStatuses,
  } = finalizeSourceBatch(batch, results, allPreUI, allPostB, allPostBPreC, allStatuses);

  // Build complete output queues (append new entries to existing)
  const finalPreUI = [...allPreUI, ...newPreUI];
  const finalPostB = [...allPostB, ...newPostB];
  const finalPostBPreC = [...allPostBPreC, ...newPostBPreC];

  // Write remaining preB (unprocessed sources stay in queue)
  writePreBQueue(remaining);
  // Write output queues
  writePreUIQueue(finalPreUI);
  writePostBQueue(finalPostB);
  writePostBPreCQueue(finalPostBPreC);
  writeSourcesStatus(newStatuses);

  const elapsed = Date.now() - startTime;

  // ── Summary ──────────────────────────────────────────────────────────────
  const success = results.filter(r => r.success).length;
  const strongCandidate = results.filter(r => !r.success && r.nextPath === 'network' && r.inspectorVerdict === 'promising').length;
  const toC = results.filter(r => !r.success && !(r.nextPath === 'network' && r.inspectorVerdict === 'promising')).length;
  const totalEvents = results.reduce((s, r) => s + r.eventsFound, 0);

  console.log(`\n═══ B-RUNNER SUMMARY ═══`);
  console.log(`  Total:          ${batch.length}`);
  console.log(`  ✅ success:     ${success}`);
  console.log(`  ⚠️  postB:      ${strongCandidate} (stark B-kandidat)`);
  console.log(`  ❌ → preC:     ${toC}`);
  console.log(`  Events:         ${totalEvents}`);
  console.log(`  Elapsed:        ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  Throughput:      ${(batch.length / (elapsed / 1000)).toFixed(1)} sources/sec`);
  console.log(`\nQueue state at end:`);
  console.log(`  preB-queue:    ${remaining.length} (unprocessed)`);
  console.log(`  postB-queue:   +${newPostB.length} → ${finalPostB.length}`);
  console.log(`  postB-preC:    +${newPostBPreC.length} → ${finalPostBPreC.length}`);
}

// Allow top-level execution
if (import.meta.url === process.argv[1] || process.argv[1]?.endsWith(fileURLToPath(import.meta.url))) {
  main().catch(console.error);
}

export { runBOnSource, runParallel };
