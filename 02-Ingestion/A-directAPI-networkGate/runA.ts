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
 * Parallell körning: --workers N (default 50).
 * Alla queue-skrivningar görs i batch i slutet för att undvika race conditions.
 *
 * Usage:
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts              # normal
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --dry       # visa utan att köra
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit N   # max N sources
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --workers N # N parallella workers (default 50)
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --status    # visa köstatus
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --auto-dai  # kör D-AI auto-hook på misslyckade
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getAllSources, getSourceStatus, updateSourceStatus, getSource } from '../tools/sourceRegistry';
import { isSkipped } from '../lib/quarantineGuard.js';
import { fetchHtml, queueEvents } from '../tools/fetchTools';
import { extractFromJsonLd } from '../F-eventExtraction/extractor';
import { enqueueDAI, dequeueDAI, runDaiForQueue } from './daiHook';
import { findAdapterForSource } from './adapters';

// ─── Queue File Paths ─────────────────────────────────────────────────────────

const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : path.resolve(__dirname, '../..');
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runA-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const PREA_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preA-queue.jsonl');
const PREUI_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preUI-queue.jsonl');
const PREB_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preB-queue.jsonl');
const POSTA_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'postA-queue.jsonl');
const EXTRACTED_DIR = path.resolve(DATA_ROOT, '03-Queue/03-extractedevents');

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

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

// ─── preUI Queue ───────────────────────────────────────────────────────────────

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

// ─── postA Queue (A success → postA) ────────────────────────────────────────

function readPostAQueue(): QueueEntry[] {
  if (!existsSync(POSTA_QUEUE_FILE)) return [];
  const content = readFileSync(POSTA_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

function addToPostAQueue(sourceId: string, eventsFound: number, reason: string): void {
  const queue = readPostAQueue();
  if (queue.some(e => e.sourceId === sourceId)) return;
  queue.push({
    sourceId,
    queueName: 'postA',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: reason,
    workerNotes: `A: ${eventsFound} events`,
  });
  writeFileSync(POSTA_QUEUE_FILE, queue.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
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

// ─── Cross-Queue Dedup Helper ──────────────────────────────────────────────────
//
// Flytta bort sourceId från alla andra runtime-queue-filer innan den skrivs till
// sin nya kö. Förhindrar att samma källa finns i både postA och EVENTPULSE-APP,
// eller kvar i preB efter att den lyckats i A. EVENTPULSE-APP rörs inte
// (historisk arkiv enligt queue-mem.py-policyn).

const CROSS_QUEUE_DEDUP_FILES: readonly string[] = [
  PREA_QUEUE_FILE,
  PREB_QUEUE_FILE,
  POSTA_QUEUE_FILE,
  path.resolve(RUNTIME_DIR, 'postB-queue.jsonl'),
  // 2026-10-21 — postB-preC-queue.jsonl UTELÄMNAD. Filen skrivs av B-gates
  // (runB.ts:46, runB-parallel.ts:58) och läses av C-gates pool
  // (run-dynamic-pool.ts:113). När A raderade en källa ur den raderade den
  // den ur C-kön utan att B lagt in den — en källa som B aldrig hanterat
  // försvann ur C-spåret. A har ingen affär i en fil den inte producerar.
];

function removeSourceFromOtherQueues(sourceId: string, exceptFile: string): void {
  for (const file of CROSS_QUEUE_DEDUP_FILES) {
    if (file === exceptFile) continue;
    if (!existsSync(file)) continue;
    let entries: unknown[];
    try {
      const raw = readFileSync(file, 'utf8');
      entries = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    } catch {
      continue; // trasig JSON eller oläsbar fil — lämna ifred
    }
    const filtered = entries.filter((e: any) => e && e.sourceId !== sourceId);
    if (filtered.length !== entries.length) {
      const content = filtered.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(file, content, 'utf8');
    }
  }
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
 * 3. Läs alla sources som har en API-adapter (preferredPath='api')
 * 4. preA-entries har högre prioritet än sources-main
 * 5. Dublettkontroll: om sourceId finns i båda, ta från preA (men kör endast en gång)
 *
 * 2026-10-23 — steg 3 tillkom. En källa med en verifierad API-adapter ska
 * köras varje natt via adaptern, oavsett vad HTML-spåret gav tidigare.
 * Utan det låg ticketmaster/KMH fast i "fail" och kördes aldrig igen.
 */
function getNextABatch(limit: number = 10): SourceWithOrigin[] {
  const preAQueue = readPreAQueue();
  const preAIds = new Set<string>(preAQueue.map(e => e.sourceId));

  // Hämta alla never_run sources från sources/
  const allSources = getAllSources();

  // API-adapter-källor — de har en egen, verifierad väg in i databasen.
  const apiAdapterSources = allSources.filter(s => isApiAdapterSource(s));
  const apiAdapterIds = new Set(apiAdapterSources.map(s => s.id));

  const neverRunSources = allSources.filter(s => {
    if (apiAdapterIds.has(s.id)) return false; // API-spåret har företräde
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

  // Sedan: API-adapter-källor (verifierad egen väg, ska inte svältas)
  for (const source of apiAdapterSources) {
    if (result.length >= limit) break;
    if (preAIds.has(source.id)) continue; // redan körd från preA
    result.push({ sourceId: source.id, source, queueOrigin: 'sources-main' });
  }

  // Sist: sources-main (aldrig körda, inte i preA)
  for (const source of sourcesMainOnly) {
    if (result.length >= limit) break;
    result.push({ sourceId: source.id, source, queueOrigin: 'sources-main' });
  }

  return result;
}

/**
 * Är källan en API-adapter-källa?
 *
 * Sanningen avgörs av registret (adapters/index.ts): en källa kan peka på en
 * adapter explicit via metadata.sourceAdapter, eller automatiskt via sin URL.
 * Finns ingen adapter faller källan tillbaka till HTML-spåret — precis som
 * innan.
 */
function isApiAdapterSource(source: ReturnType<typeof getSource>): boolean {
  return findAdapterForSource(source) !== null;
}

// ─── A Tool Execution ──────────────────────────────────────────────────────────

interface AResult {
  sourceId: string;
  queueOrigin: 'preA' | 'sources-main';
  success: boolean;
  eventsFound: number;
  pathUsed: 'jsonld' | 'api';
  error?: string;
  status: 'never_run' | 'success' | 'fail' | 'error';
  ingestionStage: 'A' | 'completed' | 'failed';
}

/**
 * Kör en API-adapter för en källa och skriver raderna till extractedevents/.
 *
 * 2026-10-23 — nya vägen för källor med en verifierad API-adapter. Före detta
 * fanns dispatchen i runA-extract.ts (T0099) men den vägen är död: preUI-kön
 * fylls bara av den gamla C-gaten, så adaptern kördes aldrig. Här körs
 * adaptern från Tool A, som är den gate som väljer ut källor att köra.
 *
 * Antalet events som rapporteras är det FAKTISKA antalet rader — inte en
 * heartbeat. Rader som skrivs till extractedevents/ går sedan vidare via
 * importToEventPulse → raw_events → worker → Supabase.
 */
async function runApiAdapterOnSource(
  sourceId: string,
  source: NonNullable<ReturnType<typeof getSource>>,
  queueOrigin: 'preA' | 'sources-main',
  adapterName: string,
): Promise<AResult> {
  console.log(`[A-runner] ${sourceId} (from ${queueOrigin}) — API-adapter: ${adapterName}`);

  const found = findAdapterForSource(source);
  if (!found) {
    return {
      sourceId,
      queueOrigin,
      success: false,
      eventsFound: 0,
      pathUsed: 'api',
      error: `adapter '${adapterName}' finns inte i registret`,
      status: 'error',
      ingestionStage: 'failed',
    };
  }

  try {
    const result = await found.adapter.run(source);

    if (result.status !== 'completed') {
      return {
        sourceId,
        queueOrigin,
        success: false,
        eventsFound: 0,
        pathUsed: 'api',
        error: result.error ?? `adapter '${adapterName}' misslyckades`,
        status: 'fail',
        ingestionStage: 'failed',
      };
    }

    if (result.events.length > 0) {
      mkdirSync(EXTRACTED_DIR, { recursive: true });
      const lines = result.events.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(`${EXTRACTED_DIR}/${sourceId}.jsonl`, lines, 'utf-8');
      console.log(`         → wrote ${result.events.length} events to extractedevents/ (${adapterName})`);
    }

    return {
      sourceId,
      queueOrigin,
      success: result.events.length > 0,
      eventsFound: result.events.length,
      pathUsed: 'api',
      status: result.events.length > 0 ? 'success' : 'fail',
      ingestionStage: result.events.length > 0 ? 'completed' : 'failed',
      error: result.events.length > 0 ? undefined : `adapter '${adapterName}' gav 0 events`,
    };
  } catch (err: any) {
    return {
      sourceId,
      queueOrigin,
      success: false,
      eventsFound: 0,
      pathUsed: 'api',
      error: `adapter '${adapterName}' kastade: ${err?.message ?? err}`,
      status: 'error',
      ingestionStage: 'failed',
    };
  }
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

  // 2026-10-23 — API-adapter-spår. Källan har en verifierad adapter →
  // kör adaptern i stället för HTML-fetch. Saknas adapter faller vi
  // tillbaka till HTML-spåret (oförändrat beteende).
  const adapterMatch = findAdapterForSource(source);
  if (adapterMatch) {
    return runApiAdapterOnSource(sourceId, source, queueOrigin, adapterMatch.adapter.name);
  }

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

  // Write to extractedevents/ instead of queueEvents
  mkdirSync(EXTRACTED_DIR, { recursive: true });
  const lines = extractResult.events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(`${EXTRACTED_DIR}/${sourceId}.jsonl`, lines, 'utf-8');
  console.log(`         → wrote ${eventsFound} events to extractedevents/`);

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
    pathUsed: result.pathUsed,
    ingestionStage: result.ingestionStage,
    // En API-adapter är det bestämda spåret för källan — spara det så att
    // routingen inte senare skickar tillbaka den till HTML.
    ...(result.pathUsed === 'api' ? { preferredPath: 'api' as const } : {}),
    lastRoutingReason: `toolA(${queueOrigin}): ${result.success ? `${result.eventsFound} events` : result.error}`,
    lastRoutingSource: 'runtime_status',
  });

  // ── Queue-hop baserat på utfall ──────────────────────────────────────────
  if (result.success && result.eventsFound > 0) {
    // A success → postA (rensa bort från andra köer först)
    removeSourceFromOtherQueues(sourceId, POSTA_QUEUE_FILE);
    addToPostAQueue(sourceId, result.eventsFound, `toolA(${queueOrigin}): ${result.eventsFound} events`);
    // Hook: om A plötsligt fungerar behöver vi inte D-AI för denna källa
    dequeueDAI(sourceId);
  } else {
    // ej A / fail → preB (rensa bort från andra köer först)
    removeSourceFromOtherQueues(sourceId, PREB_QUEUE_FILE);
    addToPreBQueue(sourceId, `toolA(${queueOrigin}): ${result.error ?? 'no events'}`);
    // Hook: om sidan parsas men saknar JSON-LD → D-AI kan hitta strukturen
    if (result.error === 'no-jsonld-or-no-events' && item.source?.url) {
      enqueueDAI(sourceId, item.source.url, 'no-jsonld-or-no-events', 'runA');
    }
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
    console.log('  npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --auto-dai # kör D-AI auto-hook på misslyckade');
    console.log('');
    console.log('Queue priority:');
    console.log('  1. preA-queue.jsonl (högst prioritet)');
    console.log('  2. API-adapter-källor (preferredPath=api + registrerad source-adapter)');
    console.log('  3. sources-main (alla never_run, inte redan i preA)');
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
  // 0 = unlimited (kör alla aldrig körda + preA)
  const limitIdx = args.indexOf('--limit');
  const limitFromArgs = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 0;
  // useNumber() ger Infinity för 0 → kör alla
  const limit = limitFromArgs || Infinity;

  // ── Get batch ────────────────────────────────────────────────────────────
  const batch = getNextABatch(limit);

  if (batch.length === 0) {
    log('[A-runner] Both preA-queue and sources-main are empty. Nothing to run.');
    return;
  }

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  log(`═══ A-RUNNER ═══`);
  log(`preA-queue: ${batch.filter(b => b.queueOrigin === 'preA').length} entries`);
  log(`sources-main: ${batch.filter(b => b.queueOrigin === 'sources-main').length} entries`);
  log(`total: ${batch.length} sources`);

  if (dry) {
    log('DRY RUN — inga sources körs:');
    for (const item of batch) {
      log(`  [${item.queueOrigin}] ${item.sourceId}: ${item.source?.url ?? 'N/A'}`);
    }
    return;
  }

  // ── Run — parallellt med semaphore ────────────────────────────────────────
  const DEFAULT_WORKERS = 50;
  const workersIdx = args.indexOf('--workers');
  const CONCURRENCY = workersIdx !== -1 && args[workersIdx + 1]
    ? parseInt(args[workersIdx + 1], 10)
    : DEFAULT_WORKERS;

  const results: AResult[] = [];

  async function runWithConcurrency(items: SourceWithOrigin[], concurrency: number): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map(item => runAOnSource(item)));
      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const result = chunkResults[j];
        results.push(result);
        finalizeSource(item, result);
        const icon = result.success ? '✅' : '❌';
        log(`  ${icon} ${item.sourceId}: ${result.success ? `${result.eventsFound} events` : result.error}`);
      }
      log(`  ── chunk ${Math.floor(i / concurrency) + 1} klart (${chunk.length} källor)`);
    }
  }

  log(`Kör ${batch.length} sources med ${CONCURRENCY} parallella workers...`);

  // ─── Source Lifecycle: skip-check ───────────────────────────────
  // Filtrerar bort källor som är quarantined eller retired.
  // Loggas + audit-rad, INGA fetchHttp-anrop.
  const skippedInBatch: Array<{ sourceId: string; reason: string; reasonCode: string }> = [];
  const filteredBatch = batch.filter(item => {
    const skip = isSkipped(item.sourceId);
    if (!skip.skip) return true;
    skippedInBatch.push({
      sourceId: item.sourceId,
      reason: skip.reason ?? 'unknown',
      reasonCode: skip.entry?.reasonCode ?? '',
    });
    log(`[A-skip] ${item.sourceId} (${skip.reason}: ${skip.entry?.reasonCode ?? ''})`);
    try {
      appendFileSync(
        path.resolve(RUNTIME_DIR, 'sources_audit.jsonl'),
        JSON.stringify({
          event: 'gate_skip',
          sourceId: item.sourceId,
          gate: 'A',
          reason: skip.reason,
          reasonCode: skip.entry?.reasonCode ?? '',
          at: new Date().toISOString(),
        }) + '\n',
        'utf8',
      );
    } catch { /* audit-log misslyckades */ }
    return false;
  });
  if (skippedInBatch.length > 0) {
    log(`Skip: ${skippedInBatch.length} källor (quarantined/retired) — kör ${filteredBatch.length} kvar`);
  }

  await runWithConcurrency(filteredBatch, CONCURRENCY);

  // ── Hook: auto-D-AI för källor utan JSON-LD ─────────────────────────────
  if (args.includes('--auto-dai')) {
    log('');
    log('─── Auto-D-AI hook: processar queue (cap=5) ───');
    const daiResults = await runDaiForQueue({ cap: 5 });
    log(`[hook] D-AI körningar: ${daiResults.length} (ok=${daiResults.filter(r => r.validationPassed).length})`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const success = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  const totalEvents = results.reduce((s, r) => s + r.eventsFound, 0);

  log('');
  log('═══ A-RUNNER SUMMARY ═══');
  log(`  Total:  ${batch.length}`);
  log(`  ✅ success: ${success}`);
  log(`  ❌ fail:   ${fail}`);
  log(`  Events: ${totalEvents}`);

  if (success === 0 && fail > 0) {
    log(`⚠️  Alla ${fail} sources misslyckades.`);
    log(`   Nästa steg: kör verktyg B (network/API) på misslyckade sources.`);
  }
}

main().catch(console.error);
