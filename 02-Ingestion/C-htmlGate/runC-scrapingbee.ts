/**
 * runC-scrapingbee.ts — Tool ScB
 *
 * ScrapingBee-powered HTML fetching för postB-preC sources.
 * Läser från postB-preC-queue.jsonl, hämtar via ScrapingBee API,
 * extraherar events med universal-extractor, routerar till postTestC-queues.
 *
 * FLÖDE:
 *   postB-preC → ScB-verktyg (parallel)
 *   Utfall:
 *     1. events utvinns → postTestC-UI
 *     2. JS-render signal → postTestC-D
 *     3. blockad/fel → postTestC-manual-review
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts
 *   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --dry
 *   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --limit 50 --workers 12
 *   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --mode=medium --limit 20
 *   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --mode=deep
 *
 * Modes:
 *   --mode=shallow  (default) — homepage only, ~5 ScB credits
 *   --mode=medium            — sitemap + AI + ScB, ~55 ScB credits
 *   --mode=deep              — full 5-step pipeline, ~100 ScB credits
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getSource } from '../tools/sourceRegistry';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';
import { deepCrawl, type CrawlMode, type CrawlResult } from './tools/scrapingBeeDeep';

// ─── Queue File Paths ─────────────────────────────────────────────────────────

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runC-scrapingbee-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const POSTB_PREC_FILE   = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl');
const POSTB_PREC_BACKUP = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl.bak');
const POSTUI_FILE       = path.resolve(RUNTIME_DIR, 'preUI-queue.jsonl');
const POSTTESTC_UI_FILE  = path.resolve(RUNTIME_DIR, 'postTestC-UI.jsonl');
const POSTTESTC_D_FILE   = path.resolve(RUNTIME_DIR, 'postTestC-D.jsonl');
const POSTTESTC_MAN_FILE = path.resolve(RUNTIME_DIR, 'postTestC-manual-review.jsonl');
const EXTRACTED_DIR      = path.resolve(__dirname, '../../../03-Queue/03-extractedevents');

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

// ─── Queue Entry ──────────────────────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

interface ScBResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  exitReason: 'ui' | 'd' | 'manual-review';
  error?: string;
  methodsUsed?: string[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
if (!SCRAPINGBEE_API_KEY) {
  console.error('SCRAPINGBEE_API_KEY saknas i .env!');
  process.exit(1);
}

const SCRAPINGBEE_BASE = 'https://app.scrapingbee.com/api/v1/';
const DEFAULT_WORKERS = 12;
const DEFAULT_LIMIT = 100;
const DEFAULT_MODE: CrawlMode = 'shallow';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readQueue(file: string): QueueEntry[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

function writeQueue(file: string, entries: QueueEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(file, content, 'utf8');
}

function appendQueue(file: string, entries: QueueEntry[]): void {
  if (entries.length === 0) return;
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8');
    writeFileSync(file, existing + content, 'utf8');
  } else {
    writeFileSync(file, content, 'utf8');
  }
}

function writeExtractedEvents(sourceId: string, events: ParsedEvent[]): void {
  mkdirSync(EXTRACTED_DIR, { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  const file = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  writeFileSync(file, lines, 'utf8');
}

async function fetchWithScrapingBee(url: string): Promise<{ html: string; error?: string; statusCode: number }> {
  try {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY!,
      url: url,
      render_js: 'true',
      country_code: 'se',
      block_resources: 'false',
    });
    const response = await axios.get(SCRAPINGBEE_BASE, { params, timeout: 30000 });
    if (response.status === 200) {
      return { html: response.data as string, statusCode: 200 };
    }
    return { html: '', error: `HTTP ${response.status}`, statusCode: response.status };
  } catch (err: any) {
    const msg = err.response?.status
      ? `HTTP ${err.response.status}`
      : err.message || 'unknown';
    return { html: '', error: msg, statusCode: err.response?.status || 0 };
  }
}

function detectJsRender(html: string): boolean {
  const markers = [
    '__NEXT_DATA__',
    'data-reactroot',
    'AppRegistry.registerInitialState',
    '__INITIAL_STATE__',
    'window.__STATE__',
    'hydrate',
  ];
  return markers.some(m => html.includes(m));
}

// ─── Parallel runner ───────────────────────────────────────────────────────────

async function runParallel<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
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

// ─── Per-source processing ────────────────────────────────────────────────────

async function processSource(entry: QueueEntry, mode: CrawlMode): Promise<ScBResult> {
  const { sourceId } = entry;

  const source = getSource(sourceId);
  if (!source) {
    return { sourceId, success: false, eventsFound: 0, exitReason: 'manual-review', error: 'source not found in registry' };
  }

  const url = source.url;
  console.log(`  [ScB] ${sourceId} → ${url} [${mode}]`);

  const onProgress = (msg: string) => console.log(`    ${msg}`);

  const result = await deepCrawl(sourceId, mode, { onProgress });

  if (result.exitReason === 'ui' && result.eventsFound > 0) {
    writeExtractedEvents(sourceId, result.events);
    console.log(`  [ScB] ${sourceId} → ${result.eventsFound} events via ${result.method} (${result.creditsUsed} credits)`);
    return { sourceId, success: true, eventsFound: result.eventsFound, exitReason: 'ui', methodsUsed: [result.method] };
  }

  if (result.exitReason === 'd') {
    console.log(`  [ScB] ${sourceId} → JS-render: ${result.reason || 'detected'}`);
    return { sourceId, success: false, eventsFound: 0, exitReason: 'd' };
  }

  // Show reason for failure to help diagnose
  const reasonStr = result.reason ? ` | ${result.reason}` : '';
  console.log(`  [ScB] ${sourceId} → 0 events via ${result.method} (${result.creditsUsed} credits)${reasonStr}`);
  return { sourceId, success: false, eventsFound: 0, exitReason: 'manual-review', error: result.reason || 'no events found' };
}

// ─── Finalize batch ───────────────────────────────────────────────────────────

function finalizeBatch(
  entries: QueueEntry[],
  results: ScBResult[],
): { newPostUI: QueueEntry[], newPostD: QueueEntry[], newPostMan: QueueEntry[] } {
  const newPostUI: QueueEntry[] = [];
  const newPostD: QueueEntry[] = [];
  const newPostMan: QueueEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const result = results[i];

    if (result.exitReason === 'ui') {
      newPostUI.push({
        sourceId: entry.sourceId,
        queueName: 'postTestC-UI',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolScB: ${result.eventsFound} events extracted via ScrapingBee`,
        workerNotes: result.methodsUsed?.join(', '),
      });
    } else if (result.exitReason === 'd') {
      newPostD.push({
        sourceId: entry.sourceId,
        queueName: 'postTestC-D',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolScB: JS-render signal from ScrapingBee — route to D-stage`,
      });
    } else {
      newPostMan.push({
        sourceId: entry.sourceId,
        queueName: 'postTestC-man',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolScB: ${result.error || 'no events'} — manual review needed`,
      });
    }
  }

  return { newPostUI, newPostD, newPostMan };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --dry');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --limit 50 --workers 12');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --mode=medium');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --mode=deep');
    console.log();
    console.log('Modes:');
    console.log('  --mode=shallow  (default) — homepage only, ~5 ScB credits');
    console.log('  --mode=medium            — sitemap + AI + ScB, ~55 ScB credits');
    console.log('  --mode=deep              — full 5-step pipeline, ~100 ScB credits');
    return;
  }

  const dry = args.includes('--dry');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULT_LIMIT));
  const workers = parseInt(args.find(a => a.startsWith('--workers='))?.split('=')[1] || String(DEFAULT_WORKERS));
  const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1] || DEFAULT_MODE;
  const mode: CrawlMode = (modeArg === 'medium' || modeArg === 'deep') ? modeArg : 'shallow';

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  log('═══════════════════════════════════════════════════════════════════');
  log('  Tool ScB — ScrapingBee HTML Fetch');
  log(`  Workers: ${workers}  |  Limit: ${limit}  |  Mode: ${mode}  |  Dry: ${dry}`);
  log('═══════════════════════════════════════════════════════════════════');

  // Backup original queue
  if (existsSync(POSTB_PREC_FILE)) {
    const backup = readFileSync(POSTB_PREC_FILE, 'utf8');
    writeFileSync(POSTB_PREC_BACKUP, backup, 'utf8');
  }

  // Read queues
  const allEntries = readQueue(POSTB_PREC_FILE);
  const allPostUI = readQueue(POSTUI_FILE);
  const allPostD = readQueue(POSTTESTC_D_FILE);
  const allPostMan = readQueue(POSTTESTC_MAN_FILE);

  // Deduplicate
  const seen = new Set<string>();
  const unique: QueueEntry[] = [];
  for (const e of allEntries) {
    if (!seen.has(e.sourceId)) {
      seen.add(e.sourceId);
      unique.push(e);
    }
  }

  // Take batch
  const batch = unique.slice(0, limit);
  const remaining = unique.slice(limit);

  console.log(`  postB-preC: ${allEntries.length} total | unika: ${unique.length}`);
  console.log(`  Denna kör: ${batch.length} sources`);
  console.log();

  if (batch.length === 0) {
    console.log('  postB-preC är TOM — inget att göra.');
    return;
  }

  if (dry) {
    console.log('  [DRY] Följande sources SKULLE köras:');
    for (const e of batch) {
      const source = getSource(e.sourceId);
      console.log(`    ${e.sourceId} → ${source?.url || 'N/A'}`);
    }
    return;
  }

  // Process in parallel
  console.log(`  Kör ${batch.length} sources med ${workers} workers i ${mode}-läge...`);
  const results = await runParallel(batch, (entry) => processSource(entry, mode), workers);

  // Finalize
  const { newPostUI, newPostD, newPostMan } = finalizeBatch(batch, results);

  // Write queues
  writeQueue(POSTB_PREC_FILE, remaining);
  appendQueue(POSTUI_FILE, newPostUI);
  appendQueue(POSTTESTC_D_FILE, newPostD);
  appendQueue(POSTTESTC_MAN_FILE, newPostMan);

  // Summary
  console.log();
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log(`  postTestC-UI: ${newPostUI.length} (events)`);
  console.log(`  postTestC-D:  ${newPostD.length} (JS-render)`);
  console.log(`  postTestC-man: ${newPostMan.length} (manual review)`);
  console.log(`  postB-preC kvar: ${remaining.length}`);
  console.log('═══════════════════════════════════════════════════════════════════');

  if (remaining.length > 0) {
    console.log();
    console.log(`➡️  Kör igen för att tömma kön (${remaining.length} kvar):`);
    console.log(`   npx tsx 02-Ingestion/C-htmlGate/runC-scrapingbee.ts --limit=${remaining.length}`);
  }
}

main().catch(console.error);
