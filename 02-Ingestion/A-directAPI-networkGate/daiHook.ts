/**
 * daiHook.ts — Bridging between Tool A (no-jsonld fail) and Tool D-AI constrained agent
 *
 * When runA finishes a source with status `no-jsonld-or-no-events` (HTML fetched
 * successfully, but no JSON-LD/JSON-ld event data found), the source is enqueued
 * here. After A-batch finishes, runDaiForQueue runs the constrained agent on
 * each queued source, generating a CollectorConfig adapter and saving it to
 * runtime/adapters/{sourceId}.json — which surfaces in the dashboard review tile.
 *
 * Not all A-fails trigger D-AI:
 *   - 'Fetch failed' (network/timeout) → NOT triggered (D-AI needs HTML)
 *   - 'no-jsonld-or-no-events' (HTML OK, no structured data) → TRIGGERED
 *   - 'source not found' (not in sources/) → NOT triggered
 *
 * Idempotency:
 *   - enqueue is dedup within the queue file
 *   - dequeue on A-success: removes source from queue
 *   - runDaiForQueue: skips sourceIds that already have an adapter file
 *
 * Cap:
 *   - default 5 D-AI runs per outer call (cost control)
 *   - configurable via opts.cap
 *
 * Usage:
 *   import { enqueueDAI, dequeueDAI, runDaiForQueue } from './daiHook';
 *   enqueueDAI('source-id', 'https://example.com', 'no-jsonld-or-no-events');
 *   await runDaiForQueue({ cap: 5 });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { runPipeline, saveAdapter, loadAdapter, appendManifest } from '../D-renderGate/constrainedAgent.js';
import { getSource } from '../tools/sourceRegistry.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = (() => {
  try { return decodeURIComponent(new URL(import.meta.url).pathname); } catch { return ''; }
})();

const PROJECT_ROOT = path.resolve(__filename, '../../..');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const ADAPTERS_DIR = path.resolve(RUNTIME_DIR, 'adapters');
const QUEUE_FILE = path.resolve(ADAPTERS_DIR, '_dai-queue.jsonl');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runA-dai-hook-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DaiQueueEntry {
  sourceId: string;
  url: string;
  enqueuedAt: string;
  reason: string; // 'no-jsonld-or-no-events' | 'manual'
  enqueuedBy: string; // 'runA' | 'manual'
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  lastAdapterPath?: string;
}

export interface DaiRunOptions {
  cap?: number;
  rateLimitMs?: number;
  maxTokens?: number;
  skipExisting?: boolean; // skip if runtime/adapters/{sourceId}.json exists
}

export interface DaiRunResult {
  sourceId: string;
  skipped: boolean;
  skipReason?: string;
  validationPassed?: boolean;
  aiConfidence?: number;
  iterations?: number;
  tokens?: { prompt: number; response: number };
  adapterPath?: string;
  error?: string;
}

// ─── Log helper ───────────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  if (existsSync(LOGS_DIR)) {
    appendFileSync(RUN_LOG, line + '\n', 'utf8');
  }
}

// ─── Queue I/O ────────────────────────────────────────────────────────────────

export function readDaiQueue(): DaiQueueEntry[] {
  if (!existsSync(QUEUE_FILE)) return [];
  const content = readFileSync(QUEUE_FILE, 'utf8');
  return content
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as DaiQueueEntry);
}

export function writeDaiQueue(entries: DaiQueueEntry[]): void {
  mkdirSync(ADAPTERS_DIR, { recursive: true });
  if (entries.length === 0) {
    writeFileSync(QUEUE_FILE, '', 'utf8');
  } else {
    writeFileSync(QUEUE_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
}

/**
 * Add a source to the D-AI queue. Idempotent: if sourceId already in queue,
 * increment `attempts` instead of duplicating.
 */
export function enqueueDAI(sourceId: string, url: string, reason: string, enqueuedBy: string = 'runA'): DaiQueueEntry {
  const queue = readDaiQueue();
  const existing = queue.find(e => e.sourceId === sourceId);
  if (existing) {
    existing.attempts++;
    existing.lastAttemptAt = new Date().toISOString();
    existing.reason = reason;
    writeDaiQueue(queue);
    log(`[ENQUEUE] ${sourceId} already in queue (attempts=${existing.attempts})`);
    return existing;
  }
  const entry: DaiQueueEntry = {
    sourceId,
    url,
    enqueuedAt: new Date().toISOString(),
    reason,
    enqueuedBy,
    attempts: 0,
  };
  queue.push(entry);
  writeDaiQueue(queue);
  log(`[ENQUEUE] ${sourceId} → ${url} (reason=${reason})`);
  return entry;
}

/**
 * Remove a source from the D-AI queue (e.g. when A finally succeeds).
 * Returns true if removed, false if not in queue.
 */
export function dequeueDAI(sourceId: string): boolean {
  const queue = readDaiQueue();
  const filtered = queue.filter(e => e.sourceId !== sourceId);
  if (filtered.length === queue.length) return false;
  writeDaiQueue(filtered);
  log(`[DEQUEUE] ${sourceId} removed from queue`);
  return true;
}

// ─── Pipeline runner ──────────────────────────────────────────────────────────

/**
 * Process a single sourceId: runs D-AI pipeline + saves adapter.
 * Returns a result struct describing what happened.
 */
export async function processOneDAI(sourceId: string, url: string, opts: { maxTokens?: number; rateLimitMs?: number } = {}): Promise<DaiRunResult> {
  // Skip if adapter already exists
  if (loadAdapter(sourceId)) {
    log(`[SKIP] ${sourceId} already has adapter at runtime/adapters/${sourceId}.json`);
    return { sourceId, skipped: true, skipReason: 'adapter-already-exists' };
  }

  log(`[PROCESS] ${sourceId} → ${url}`);
  try {
    const result = await runPipeline({
      sourceId,
      url,
      maxTokens: opts.maxTokens ?? 2000,
      rateLimitMs: opts.rateLimitMs ?? 1500,
    });
    const cfg = result.config;
    const file = saveAdapter(cfg);
    appendManifest({
      sourceId,
      savedAt: new Date().toISOString(),
      type: cfg.type as 'search' | 'list' | 'detail' | 'api' | 'interactive' | 'file',
      aiConfidence: cfg.aiConfidence,
      validationPassed: !!cfg.validationPassed,
      validationNotes: cfg.validationNotes,
      iterations: result.iterations,
      tokens: { prompt: result.promptTokens, response: result.responseTokens },
      file,
    });
    log(`[OK] ${sourceId} → ${file} (pass=${cfg.validationPassed} conf=${cfg.aiConfidence} iterations=${result.iterations})`);
    return {
      sourceId,
      skipped: false,
      validationPassed: !!cfg.validationPassed,
      aiConfidence: cfg.aiConfidence,
      iterations: result.iterations,
      tokens: { prompt: result.promptTokens, response: result.responseTokens },
      adapterPath: file,
    };
  } catch (e: unknown) {
    const errMsg = (e as Error).message ?? String(e);
    log(`[FAIL] ${sourceId}: ${errMsg}`);
    return { sourceId, skipped: false, error: errMsg };
  }
}

/**
 * Process the D-AI queue sequentially up to `cap` items.
 * Successful items are removed from the queue; failed items stay (attempts++).
 */
export async function runDaiForQueue(opts: DaiRunOptions = {}): Promise<DaiRunResult[]> {
  const cap = opts.cap ?? 5;
  const queue = readDaiQueue();
  if (queue.length === 0) {
    log('[QUEUE] empty — nothing to do');
    return [];
  }

  log(`═══════════════════════════════════════════════════════════════════`);
  log(`D-AI HOOK — processing ${Math.min(cap, queue.length)}/${queue.length} queued sources`);
  log(`═══════════════════════════════════════════════════════════════════`);

  const targets = queue.slice(0, cap);
  const results: DaiRunResult[] = [];

  for (const entry of targets) {
    const source = getSource(entry.sourceId);
    const url = source?.url ?? entry.url;
    if (!url) {
      results.push({ sourceId: entry.sourceId, skipped: true, skipReason: 'no-url-in-registry-or-queue' });
      dequeueDAI(entry.sourceId);
      continue;
    }

    const result = await processOneDAI(entry.sourceId, url, {
      maxTokens: opts.maxTokens,
      rateLimitMs: opts.rateLimitMs,
    });
    results.push(result);

    // Update entry state
    const updatedQueue = readDaiQueue();
    const idx = updatedQueue.findIndex(e => e.sourceId === entry.sourceId);
    if (idx >= 0) {
      updatedQueue[idx].attempts += 1;
      updatedQueue[idx].lastAttemptAt = new Date().toISOString();
      if (result.error) {
        updatedQueue[idx].lastError = result.error;
      }
      if (result.adapterPath) {
        updatedQueue[idx].lastAdapterPath = result.adapterPath;
      }
      if (result.validationPassed) {
        updatedQueue.splice(idx, 1);
      }
      writeDaiQueue(updatedQueue);
    }
  }

  const ok = results.filter(r => r.validationPassed).length;
  const failed = results.filter(r => r.error).length;
  const skipped = results.filter(r => r.skipped).length;
  log(`[SUMMARY] ok=${ok} failed=${failed} skipped=${skipped} total=${results.length}`);

  return results;
}
