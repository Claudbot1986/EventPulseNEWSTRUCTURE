/**
 * bridge-pending-queue.ts — flytta källor från pending_render_queue.jsonl → postTestC-D.jsonl
 *
 * Bakgrund (2026-09-23): scheduler.ts skriver PendingRenderCandidate-poster
 * (fält: url, sourceName, signal, reason, ...) till runtime/pending_render_queue.jsonl.
 * runD-scrapingbee.ts läser QueueEntry-poster (fält: sourceId, queueName, queuedAt,
 * priority, attempt, queueReason, ...) från runtime/postTestC-D.jsonl.
 *
 * Fälten överlappar inte rakt av, så denna bridge översätter och appendar.
 *
 * - Default: append-läge (skriver inte över befintliga postTestC-D-rader).
 * - --drain: tömmer pending_render_queue.jsonl efter lyckad migrering
 *   (så att samma källa inte köas två gånger).
 * - --dry-run: skriver inte, loggar bara hur många som skulle flyttas.
 *
 * Användning:
 *   npx tsx 02-Ingestion/D-renderGate/bridge-pending-queue.ts            # append
 *   npx tsx 02-Ingestion/D-renderGate/bridge-pending-queue.ts --drain    # töm källa efter flytt
 *   npx tsx 02-Ingestion/D-renderGate/bridge-pending-queue.ts --dry-run  # logga bara
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

interface PendingRenderCandidate {
  url: string;
  sourceName: string;
  status: 'pending_render_gate';
  reason: string;
  signal: string;
  confidence: number;
  detectedAt: string;
  htmlBytes?: number;
  attemptedPaths: string[];
}

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : path.resolve(__dirname, '../..');
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');
const PENDING_FILE = path.resolve(RUNTIME_DIR, 'pending_render_queue.jsonl');
const TARGET_FILE = path.resolve(RUNTIME_DIR, 'postTestC-D.jsonl');

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`${ts}  ${msg}`);
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function writeJsonl<T>(file: string, entries: T[]): void {
  const content = entries.length === 0 ? '' : entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(file, content, 'utf8');
}

function pendingToQueueEntry(p: PendingRenderCandidate, attempt: number): QueueEntry {
  const workerNotesParts: string[] = [];
  if (p.attemptedPaths.length > 0) workerNotesParts.push(`attempted=${p.attemptedPaths.join(',')}`);
  if (typeof p.htmlBytes === 'number') workerNotesParts.push(`htmlBytes=${p.htmlBytes}`);
  workerNotesParts.push(`confidence=${p.confidence}`);
  workerNotesParts.push(`originalSignal=${p.signal}`);
  workerNotesParts.push(`originalUrl=${p.url}`);

  const queueReason = `[${p.signal}] ${p.reason}`;

  return {
    sourceId: p.sourceName,
    queueName: 'postTestC-D',
    queuedAt: p.detectedAt,
    priority: 1,
    attempt,
    queueReason,
    workerNotes: workerNotesParts.join('; '),
  };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const drain = args.includes('--drain');
  const dryRun = args.includes('--dry-run');

  log(`[bridge] start (dryRun=${dryRun} drain=${drain})`);
  log(`[bridge] src=${path.relative(DATA_ROOT, PENDING_FILE)}`);
  log(`[bridge] dst=${path.relative(DATA_ROOT, TARGET_FILE)}`);

  const pending = readJsonl<PendingRenderCandidate>(PENDING_FILE);
  const existingTarget = readJsonl<QueueEntry>(TARGET_FILE);
  const existingIds = new Set(existingTarget.map((e) => e.sourceId));

  log(`[bridge] pending_render_queue: ${pending.length} entries`);
  log(`[bridge] postTestC-D (existing): ${existingTarget.length} entries`);

  if (pending.length === 0) {
    log(`[bridge] nothing to migrate`);
    return 0;
  }

  // Översätt, men skippa dem som redan finns i target (idempotent)
  const toAdd: QueueEntry[] = [];
  let skippedDupes = 0;
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    if (!p.sourceName || typeof p.sourceName !== 'string') {
      log(`[bridge]   SKIP row ${i}: missing sourceName`);
      continue;
    }
    if (existingIds.has(p.sourceName)) {
      log(`[bridge]   SKIP ${p.sourceName}: already in postTestC-D`);
      skippedDupes++;
      continue;
    }
    const entry = pendingToQueueEntry(p, existingTarget.length + toAdd.length);
    toAdd.push(entry);
    existingIds.add(p.sourceName);
    log(`[bridge]   MIGRATE ${p.sourceName} (signal=${p.signal}, confidence=${p.confidence})`);
  }

  if (dryRun) {
    log(`[bridge] DRY-RUN — would append ${toAdd.length} entries (skip=${skippedDupes})`);
    return 0;
  }

  if (toAdd.length > 0) {
    const newContent = toAdd.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const existingContent = existsSync(TARGET_FILE) ? readFileSync(TARGET_FILE, 'utf8') : '';
    const sep = existingContent.endsWith('\n') || existingContent === '' ? '' : '\n';
    writeFileSync(TARGET_FILE, existingContent + sep + newContent, 'utf8');
    log(`[bridge] wrote ${toAdd.length} entries to postTestC-D.jsonl`);
  } else {
    log(`[bridge] no new entries to write (all ${skippedDupes} skipped as dupes)`);
  }

  if (drain) {
    writeJsonl<PendingRenderCandidate>(PENDING_FILE, []);
    log(`[bridge] DRAIN — pending_render_queue.jsonl cleared`);
  } else {
    log(`[bridge] --drain not set — pending_render_queue.jsonl untouched (re-runnable)`);
  }

  log(`[bridge] done. migrated=${toAdd.length} skipped_dupes=${skippedDupes} drain=${drain}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[bridge] fatal:', err);
    process.exit(1);
  });