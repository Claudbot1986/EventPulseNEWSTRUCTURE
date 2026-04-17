/**
 * B-Runner — Verktyg B för EventPulse
 *
 * Läser från preB-queue.jsonl (ej A-fall från A-spåret).
 * Kör Network Gate för att avgöra om Network Path är öppen.
 * Försöker extrahera events från öppna API:er.
 *
 * Flöde enligt RebuildPlan:
 *   preB → B-verktyg
 *   Utfall:
 *     1. events utvinns → postB
 *     2. stark B-kandidat men ej full extraction → postB
 *     3. ej B → postB-preC
 *
 * Usage:
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts              # normal
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --dry      # visa utan att köra
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --limit N  # max N sources
 *   npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --status   # visa köstatus
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getSource, getSourceStatus, updateSourceStatus } from '../tools/sourceRegistry';
import { evaluateNetworkGate, summarizeNetworkGateResult } from './A-networkGate';
import { extractFromApi } from './networkEventExtractor';
import { inspectUrl } from './networkInspector';
import { queueEvents } from '../tools/fetchTools';
import { toRawEventInput } from '../F-eventExtraction';
import type { RawEventInput } from '@eventpulse/shared';

// ─── Queue File Paths ─────────────────────────────────────────────────────────

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const PREB_QUEUE_FILE    = path.resolve(RUNTIME_DIR, 'preB-queue.jsonl');
const PREUI_QUEUE_FILE   = path.resolve(RUNTIME_DIR, 'preUI-queue.jsonl');
const POSTB_QUEUE_FILE   = path.resolve(RUNTIME_DIR, 'postB-queue.jsonl');
const POSTB_PREC_FILE   = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl');

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

// ─── Queue Operations ─────────────────────────────────────────────────────────

function readPreBQueue(): PreBEntry[] {
  if (!existsSync(PREB_QUEUE_FILE)) return [];
  const content = readFileSync(PREB_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function writePreBQueue(entries: PreBEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(PREB_QUEUE_FILE, content, 'utf8');
}

function removeFromPreBQueue(sourceId: string): void {
  const queue = readPreBQueue().filter(e => e.sourceId !== sourceId);
  writePreBQueue(queue);
}

// preUI (B success)
function readPreUIQueue(): PreBEntry[] {
  if (!existsSync(PREUI_QUEUE_FILE)) return [];
  const content = readFileSync(PREUI_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function addToPreUIQueue(sourceId: string, eventsFound: number, reason: string): void {
  const queue = readPreUIQueue();
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'preUI',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: reason,
    workerNotes: `B: ${eventsFound} events`,
  });
  writeFileSync(PREUI_QUEUE_FILE, queue.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

// postB (stark B-kandidat, ej full extraction)
function readPostBQueue(): PreBEntry[] {
  if (!existsSync(POSTB_QUEUE_FILE)) return [];
  const content = readFileSync(POSTB_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function addToPostBQueue(sourceId: string, reason: string, inspectorVerdict?: string): void {
  const queue = readPostBQueue();
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'postB',
    queuedAt: new Date().toISOString(),
    priority: 2,
    attempt: 1,
    queueReason: reason,
    workerNotes: inspectorVerdict,
  });
  writeFileSync(POSTB_QUEUE_FILE, queue.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

// postB-preC (ej B → C)
function readPostBPreCQueue(): PreBEntry[] {
  if (!existsSync(POSTB_PREC_FILE)) return [];
  const content = readFileSync(POSTB_PREC_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreBEntry);
}

function addToPostBPreCQueue(sourceId: string, reason: string): void {
  const queue = readPostBPreCQueue();
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'postB-preC',
    queuedAt: new Date().toISOString(),
    priority: 3,
    attempt: 1,
    queueReason: reason,
  });
  writeFileSync(POSTB_PREC_FILE, queue.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  // [FIX] Update sources_status with preferredPath=html and status=eligible
  // This ensures the source is recognized as an eligible C-pool candidate
  updateSourceStatus(sourceId, {
    success: false,
    eventsFound: 0,
    preferredPath: 'html',
    ingestionStage: 'B',
    lastRoutingReason: `postB-preC: ${reason}`,
    lastRoutingSource: 'runtime_status',
  });
}

// ─── B Tool Execution ─────────────────────────────────────────────────────────

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
  // Try likely candidates first, then possible candidates if none found
  const inspectorResult = gateResult.inspectorResult;
  const likely = inspectorResult?.candidates.filter(c => c.label === 'likely_event_api') ?? [];
  const possible = inspectorResult?.candidates.filter(c => c.label === 'possible_api') ?? [];

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
  const allExtractedEvents: ParsedEvent[] = [];

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

// ─── Status Update ───────────────────────────────────────────────────────────

function finalizeSource(entry: PreBEntry, result: BResult): void {
  const { sourceId } = entry;

  updateSourceStatus(sourceId, {
    success: result.success,
    eventsFound: result.eventsFound,
    pathUsed: 'network',
    ingestionStage: result.ingestionStage,
    lastRoutingReason: `toolB(preB): ${result.success ? `${result.eventsFound} events` : result.error}`,
    lastRoutingSource: 'runtime_status',
  });

  if (result.success && result.eventsFound > 0) {
    addToPostBQueue(sourceId, `toolB(preB): ${result.eventsFound} events`, result.inspectorVerdict);
  } else if (result.nextPath === 'network' && result.inspectorVerdict === 'promising') {
    addToPostBQueue(sourceId, `toolB(preB): ${result.error ?? 'no events'}`, result.inspectorVerdict);
  } else {
    addToPostBPreCQueue(sourceId, `toolB(preB): ${result.error ?? 'not network-accessible'}`);
  }

  removeFromPreBQueue(sourceId);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts        # normal');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --dry   # visa utan att köra');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --limit N # max N sources');
    console.log('  npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts --status # visa köstatus');
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
      for (const e of preB) {
        console.log(`  ${e.sourceId}: ${e.queueReason}`);
      }
    }
    return;
  }

  // ── Dry run ──────────────────────────────────────────────────────────────
  const dry = args.includes('--dry');

  // ── Limit (default: 100 — was 10, too small for 255+ sources) ──────────────
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 100;

  // ── Read queue ───────────────────────────────────────────────────────────
  const queue = readPreBQueue();

  if (queue.length === 0) {
    console.log('[B-runner] preB-queue is empty. Nothing to run.');
    return;
  }

  const batch = queue.slice(0, limit);
  console.log(`═══ B-RUNNER ═══`);
  console.log(`preB-queue: ${batch.length} sources (of ${queue.length} total)\n`);

  if (dry) {
    console.log('DRY RUN — inga sources körs:\n');
    for (const entry of batch) {
      const source = getSource(entry.sourceId);
      console.log(`  ${entry.sourceId}: ${source?.url ?? 'N/A'} | ${entry.queueReason}`);
    }
    return;
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  const results: BResult[] = [];

  for (const entry of batch) {
    const result = await runBOnSource(entry);
    finalizeSource(entry, result);
    results.push(result);

    const icon = result.success ? '✅' : result.nextPath === 'network' && result.inspectorVerdict === 'promising' ? '⚠️' : '❌';
    console.log(`  ${icon} ${entry.sourceId}: ${result.success ? `${result.eventsFound} events` : result.error}`);
  }

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
}

// Allow top-level execution
if (import.meta.url === process.argv[1] || process.argv[1]?.endsWith(fileURLToPath(import.meta.url))) {
  main().catch(console.error);
}
