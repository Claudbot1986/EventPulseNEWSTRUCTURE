/**
 * A-Runner — Verktyg A för EventPulse
 *
 * Kan ta sources från två giltiga inflöden:
 *   1. preA-queue.jsonl  (högre prioritet) — återinmatade A-fall t.ex. från C
 *   2. sources-main      (lägre prioritet) — alla aldrig körda sources
 *
 * Dublettkontroll: om samma sourceId finns i båda, kör endast en gång.
 * Spårbarhet: varje source loggas med queueOrigin (preA eller sources-main).
 *
 * Usage:
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts           # normal
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --dry     # visa utan att köra
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit N # max N sources
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --status  # visa köstatus
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getAllSources, getSourceStatus, updateSourceStatus, getSource } from '../tools/sourceRegistry';
import { fetchHtml, queueEvents } from '../tools/fetchTools';
import { extractFromJsonLd } from '../F-eventExtraction/extractor';

// ─── Queue File Paths ─────────────────────────────────────────────────────────

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const PREA_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preA-queue.jsonl');
const PREUI_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preUI-queue.jsonl');
const PREB_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preB-queue.jsonl');

// ─── Shared Queue Entry Interface ──────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

// ─── preUI Queue (A success → preUI) ──────────────────────────────────────────

function readPreUIQueue(): QueueEntry[] {
  if (!existsSync(PREUI_QUEUE_FILE)) return [];
  const content = readFileSync(PREUI_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

function writePreUIQueue(entries: QueueEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  // Skapa filen vid första skrivningen (append-sätt för att bevara befintligt innehåll)
  if (!existsSync(PREUI_QUEUE_FILE)) {
    writeFileSync(PREUI_QUEUE_FILE, content, 'utf8');
  } else {
    writeFileSync(PREUI_QUEUE_FILE, content, 'utf8');
  }
}

function addToPreUIQueue(sourceId: string, eventsFound: number, reason: string): void {
  const queue = readPreUIQueue();
  // Dublettkontroll inom samma körning
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'preUI',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: reason,
    workerNotes: `A: ${eventsFound} events`,
  });
  writePreUIQueue(queue);
}

// ─── preB Queue (ej A → preB) ─────────────────────────────────────────────────

function readPreBQueue(): QueueEntry[] {
  if (!existsSync(PREB_QUEUE_FILE)) return [];
  const content = readFileSync(PREB_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

function writePreBQueue(entries: QueueEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  if (!existsSync(PREB_QUEUE_FILE)) {
    writeFileSync(PREB_QUEUE_FILE, content, 'utf8');
  } else {
    writeFileSync(PREB_QUEUE_FILE, content, 'utf8');
  }
}

function addToPreBQueue(sourceId: string, reason: string): void {
  const queue = readPreBQueue();
  // Dublettkontroll inom samma körning
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'preB',
    queuedAt: new Date().toISOString(),
    priority: 2,
    attempt: 1,
    queueReason: reason,
  });
  writePreBQueue(queue);
}

// ─── preA Queue File ───────────────────────────────────────────────────────────

interface PreAEntry {
  sourceId: string;
  addedAt: string;
  addedBy: string;      // 'C', 'B', 'manual', 'system'
  reason: string;        // t.ex. "C verified A-candidate", "reroute from C"
  attempts: number;
}

function readPreAQueue(): PreAEntry[] {
  if (!existsSync(PREA_QUEUE_FILE)) return [];
  const content = readFileSync(PREA_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreAEntry);
}

function writePreAQueue(entries: PreAEntry[]): void {
  writeFileSync(PREA_QUEUE_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function removeFromPreAQueue(sourceId: string): void {
  const queue = readPreAQueue().filter(e => e.sourceId !== sourceId);
  writePreAQueue(queue);
}

function addToPreAQueue(sourceId: string, addedBy: string, reason: string): void {
  const queue = readPreAQueue();
  if (queue.some(e => e.sourceId === sourceId)) return; // redan i kön
  queue.push({ sourceId, addedAt: new Date().toISOString(), addedBy, reason, attempts: 0 });
  writePreAQueue(queue);
}

// ─── Sources-Main Iterator ─────────────────────────────────────────────────────

interface SourceWithOrigin {
  sourceId: string;
  source: ReturnType<typeof getSource>;
  queueOrigin: 'preA' | 'sources-main';
  preAEntry?: PreAEntry;
}

/**
 * Hämta nästa batch av sources att köra genom A.
 *
 * Logik:
 * 1. Läs alla entries från preA-queue.jsonl
 * 2. Läs alla sources från sources/ som är never_run
 * 3. preA-entries har högre prioritet än sources-main
 * 4. Dublettkontroll: om sourceId finns i båda, ta från preA (men kör endast en gång)
 */
function getNextABatch(limit: number = 10): SourceWithOrigin[] {
  const preAQueue = readPreAQueue();
  const preAIds = new Set<string>(preAQueue.map(e => e.sourceId));

  // Hämta alla never_run sources från sources/
  const allSources = getAllSources();
  const neverRunSources = allSources.filter(s => {
    const status = getSourceStatus(s.id);
    return status.status === 'never_run';
  });

  // Sources som inte redan är i preA
  const sourcesMainIds = new Set<string>(neverRunSources.map(s => s.id));
  const sourcesMainOnly = neverRunSources.filter(s => !preAIds.has(s.id));

  const result: SourceWithOrigin[] = [];

  // Först: alla preA-entries (högsta prioritet)
  for (const entry of preAQueue) {
    if (result.length >= limit) break;
    const source = getSource(entry.sourceId);
    if (!source) {
      // Source saknas i sources/ — ta bort från preA
      removeFromPreAQueue(entry.sourceId);
      continue;
    }
    result.push({ sourceId: entry.sourceId, source, queueOrigin: 'preA', preAEntry: entry });
  }

  // Sedan: sources-main (aldrig körda, inte i preA)
  for (const source of sourcesMainOnly) {
    if (result.length >= limit) break;
    result.push({ sourceId: source.id, source, queueOrigin: 'sources-main' });
  }

  return result;
}

// ─── A Tool Execution ──────────────────────────────────────────────────────────

interface AResult {
  sourceId: string;
  queueOrigin: 'preA' | 'sources-main';
  success: boolean;
  eventsFound: number;
  pathUsed: 'jsonld';
  error?: string;
  status: 'never_run' | 'success' | 'fail' | 'error';
  ingestionStage: 'A' | 'completed' | 'failed';
}

async function runAOnSource(item: SourceWithOrigin): Promise<AResult> {
  const { sourceId, source, queueOrigin } = item;
  if (!source) {
    return {
      sourceId,
      queueOrigin,
      success: false,
      eventsFound: 0,
      pathUsed: 'jsonld',
      error: 'source not found in sources/',
      status: 'error',
      ingestionStage: 'failed',
    };
  }

  console.log(`[A-runner] ${sourceId} (from ${queueOrigin}) — ${source.url}`);

  // Fetch HTML
  const fetchResult = await fetchHtml(source.url, { timeout: 20000 });

  if (!fetchResult.success || !fetchResult.html) {
    return {
      sourceId,
      queueOrigin,
      success: false,
      eventsFound: 0,
      pathUsed: 'jsonld',
      error: `Fetch failed: ${fetchResult.error ?? 'unknown'}`,
      status: 'fail',
      ingestionStage: 'failed',
    };
  }

  // Extract JSON-LD
  const extractResult = extractFromJsonLd(fetchResult.html, sourceId, source.url);
  const eventsFound = extractResult.events.length;

  if (eventsFound === 0) {
    return {
      sourceId,
      queueOrigin,
      success: false,
      eventsFound: 0,
      pathUsed: 'jsonld',
      error: 'no-jsonld-or-no-events',
      status: 'fail',
      ingestionStage: 'A',
    };
  }

  // Queue events
  const rawEvents = extractResult.events.map(e => ({
    ...e,
    source: sourceId,
    source_url: source.url,
    detected_language: 'sv' as const,
    raw_payload: e as unknown as Record<string, unknown>,
  }));
  const { queued } = await queueEvents(sourceId, rawEvents as any);

  return {
    sourceId,
    queueOrigin,
    success: true,
    eventsFound,
    pathUsed: 'jsonld',
    status: 'success',
    ingestionStage: 'completed',
  };
}

// ─── Status Update ─────────────────────────────────────────────────────────────

function finalizeSource(item: SourceWithOrigin, result: AResult): void {
  const { sourceId, queueOrigin } = item;

  // Uppdatera runtime status
  updateSourceStatus(sourceId, {
    success: result.success,
    eventsFound: result.eventsFound,
    pathUsed: 'jsonld',
    ingestionStage: result.ingestionStage,
    lastRoutingReason: `toolA(${queueOrigin}): ${result.success ? `${result.eventsFound} events` : result.error}`,
    lastRoutingSource: 'runtime_status',
  });

  // ── Queue-hop baserat på utfall ──────────────────────────────────────────
  if (result.success && result.eventsFound > 0) {
    // A success → preUI
    addToPreUIQueue(sourceId, result.eventsFound, `toolA(${queueOrigin}): ${result.eventsFound} events`);
  } else {
    // ej A / fail → preB
    addToPreBQueue(sourceId, `toolA(${queueOrigin}): ${result.error ?? 'no events'}`);
  }

  // Ta bort från preA-queue om det kom därifrån
  if (queueOrigin === 'preA') {
    removeFromPreAQueue(sourceId);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts           # normal');
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --dry     # visa utan att köra');
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit N # max N sources');
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --status  # visa köstatus');
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --add SOURCE_ID REASON # lägg till i preA');
    console.log('');
    console.log('Queue priority:');
    console.log('  1. preA-queue.jsonl (högst prioritet)');
    console.log('  2. sources-main (alla never_run, inte redan i preA)');
    console.log('');
    console.log('Deduplication: om samma sourceId finns i båda, körs den endast en gång (från preA).');
    return;
  }

  // ── Status ──────────────────────────────────────────────────────────────
  if (args.includes('--status')) {
    const preA = readPreAQueue();
    const allSources = getAllSources();
    const neverRun = allSources.filter(s => getSourceStatus(s.id).status === 'never_run');
    const preAIds = new Set(preA.map(e => e.sourceId));
    const inBoth = [...preAIds].filter(id => neverRun.some(s => s.id === id)).length;

    console.log('═══ A-RUNNER STATUS ═══');
    console.log(`preA-queue:   ${preA.length} entries`);
    console.log(`sources-main:  ${neverRun.length} never_run sources`);
    console.log(`in both:      ${inBoth} (deduplicated)`);
    console.log(`total to run: ${preA.length + neverRun.filter(s => !preAIds.has(s.id)).length}`);

    if (preA.length > 0) {
      console.log('\n─── preA-queue entries ───');
      for (const e of preA) {
        console.log(`  ${e.sourceId}: addedBy=${e.addedBy}, reason=${e.reason}`);
      }
    }
    return;
  }

  // ── Add to preA ──────────────────────────────────────────────────────────
  const addIdx = args.indexOf('--add');
  if (addIdx !== -1 && args[addIdx + 1]) {
    const sourceId = args[addIdx + 1];
    const reason = args[addIdx + 2] ?? 'manual';
    addToPreAQueue(sourceId, 'manual', reason);
    console.log(`Added ${sourceId} to preA-queue (reason: ${reason})`);
    return;
  }

  // ── Dry run ──────────────────────────────────────────────────────────────
  const dry = args.includes('--dry');

  // ── Limit ────────────────────────────────────────────────────────────────
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 10;

  // ── Get batch ────────────────────────────────────────────────────────────
  const batch = getNextABatch(limit);

  if (batch.length === 0) {
    console.log('[A-runner] Both preA-queue and sources-main are empty. Nothing to run.');
    return;
  }

  console.log(`═══ A-RUNNER ═══`);
  console.log(`preA-queue: ${batch.filter(b => b.queueOrigin === 'preA').length} entries`);
  console.log(`sources-main: ${batch.filter(b => b.queueOrigin === 'sources-main').length} entries`);
  console.log(`total: ${batch.length} sources\n`);

  if (dry) {
    console.log('DRY RUN — inga sources körs:\n');
    for (const item of batch) {
      console.log(`  [${item.queueOrigin}] ${item.sourceId}: ${item.source?.url ?? 'N/A'}`);
    }
    return;
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  const results: AResult[] = [];

  for (const item of batch) {
    const result = await runAOnSource(item);
    finalizeSource(item, result);
    results.push(result);

    const icon = result.success ? '✅' : '❌';
    console.log(`  ${icon} ${item.sourceId}: ${result.success ? `${result.eventsFound} events` : result.error}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const success = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  const totalEvents = results.reduce((s, r) => s + r.eventsFound, 0);

  console.log(`\n═══ A-RUNNER SUMMARY ═══`);
  console.log(`  Total:  ${batch.length}`);
  console.log(`  ✅ success: ${success}`);
  console.log(`  ❌ fail:   ${fail}`);
  console.log(`  Events: ${totalEvents}`);

  if (success === 0 && fail > 0) {
    console.log(`\n⚠️  Alla ${fail} sources misslyckades.`);
    console.log(`   Nästa steg: kör verktyg B (network/API) på misslyckade sources.`);
  }
}

main().catch(console.error);
