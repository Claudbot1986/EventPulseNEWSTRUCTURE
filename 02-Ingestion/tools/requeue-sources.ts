#!/usr/bin/env node
/**
 * requeue-sources — operatörverktyg för att köra om specifika källor i C-gaten.
 *
 * Bakgrund (2026-10-24). C-gaten bygger sin pool ENDA från
 * `runtime/postB-preC-queue.jsonl` (buildInitialPool i run-dynamic-pool.ts).
 * Yon kring det saknas en väg att köra om en källa som failat:
 *
 *   - A-gatens getNextABatch() väljer bara `status === 'never_run'`, så en
 *     fail-källa körs aldrig om av A.
 *   - B-gaten kör bara det som står i `runtime/preB-queue.jsonl`.
 *   - `run-batch-from-sources.ts --sources=...` parsear argumentet men
 *     använder det bara i en loggrad — batchen läser ändå postB-preC.
 *
 * Resultat: en källa som failat en gång är permanent ur pipelinen. Det här
 * verktyget fyller luckan genom att skriva en köpost till postB-preC och
 * sätta källans status till 'routed' (handoff — inte fel), precis som
 * B-gatens addToPostBPreCQueue() gör.
 *
 * Användning:
 *   npx tsx 02-Ingestion/tools/requeue-sources.ts --sources a,b,c
 *   npx tsx 02-Ingestion/tools/requeue-sources.ts --sources a --url a=https://ny.se/evenemang
 *   npx tsx 02-Ingestion/tools/requeue-sources.ts --sources a,b --dry-run
 *
 * Körningen av C-gaten sker separat:
 *   npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts --sources a,b --workers 1
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSource, updateSourceStatus, updateSourceUrl } from './sourceRegistry';
import { isSkipped } from '../lib/quarantineGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');
const PREC_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
}

export type RequeueOutcome =
  | 'queued'
  | 'already_queued'
  | 'unknown_source'
  | 'lifecycle_skipped'
  | 'no_url';

export interface RequeuePlanEntry {
  sourceId: string;
  outcome: RequeueOutcome;
  detail: string;
  entry?: QueueEntry;
}

export interface RequeueResult {
  requested: string[];
  plan: RequeuePlanEntry[];
  written: number;
  skipped: number;
}

// ─── Pure helpers (testable) ─────────────────────────────────────────────────

/**
 * Bygg en köpost för postB-preC. Formatet måste matcha den B-gaten skriver
 * (runB.ts addToPostBPreCQueue) — C-gatens buildInitialPool läser
 * `entry.sourceId` och `entry.queueReason`.
 */
export function buildQueueEntry(
  sourceId: string,
  reason: string,
  attempt: number,
  now: string = new Date().toISOString(),
): QueueEntry {
  return {
    sourceId,
    queueName: 'postB-preC',
    queuedAt: now,
    priority: 3,
    attempt,
    queueReason: `requeue: ${reason}`,
  };
}

/** Läs en JSONL-fil. Trasiga rader hoppas över (en trasig rad får inte fälla hela kön). */
export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const out: T[] = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* trasig rad — hoppa över */ }
  }
  return out;
}

/** Skriv en JSONL-fil atomärt (tmp + rename) så en avbruten körning inte lämnar halv fil. */
export function writeJsonlAtomic(filePath: string, rows: unknown[]): void {
  const tmp = `${filePath}.tmp.${process.pid}`;
  const content = rows.length ? rows.map(r => JSON.stringify(r)).join('\n') + '\n' : '';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Planera vilka källor som kan köras om.
 *
 * - Okänd källa (ingen fil i sources/) → 'unknown_source'
 * - Källa i karantän/arkiverad → 'lifecycle_skipped' (ska återställas först)
 * - Källa utan URL → 'no_url'
 * - Redan i kön → 'already_queued'
 */
export function planRequeue(
  sourceIds: string[],
  existingQueue: QueueEntry[],
  lookup: {
    getUrl: (id: string) => string | null;
    isSkipped: (id: string) => { skip: boolean; reason: string | null };
  },
  now: string = new Date().toISOString(),
  reason: string = 'operator requeue',
): RequeuePlanEntry[] {
  const queued = new Map<string, QueueEntry>();
  for (const e of existingQueue) queued.set(e.sourceId, e);

  return sourceIds.map((sourceId) => {
    // Lifecycle-kontrollen kommer FÖR källfil-kontrollen: en karantänerad
    // källa har flyttats ur sources/, så getSource() ger null — utan den
    // ordningen skulle operatören få "unknown_source" i stället för
    // beskedet att källan ska återställas först.
    const skip = lookup.isSkipped(sourceId);
    if (skip.skip) {
      return {
        sourceId,
        outcome: 'lifecycle_skipped',
        detail: `${skip.reason} — återställ med lifecycle-admin restore innan körning`,
      };
    }
    const url = lookup.getUrl(sourceId);
    if (url === null) {
      return { sourceId, outcome: 'unknown_source', detail: 'ingen källfil i sources/' };
    }
    if (!url) {
      return { sourceId, outcome: 'no_url', detail: 'källan saknar url' };
    }
    const existing = queued.get(sourceId);
    if (existing) {
      return {
        sourceId,
        outcome: 'already_queued',
        detail: `redan i postB-preC (försök ${existing.attempt})`,
        entry: existing,
      };
    }
    return {
      sourceId,
      outcome: 'queued',
      detail: `kö postB-preC (${url})`,
      entry: buildQueueEntry(sourceId, reason, 1, now),
    };
  });
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  sourceIds: string[];
  reason: string;
  urlOverrides: Record<string, string>;
  dryRun: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const sourceIds: string[] = [];
  const urlOverrides: Record<string, string> = {};
  let reason = 'operator requeue';
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sources' && argv[i + 1]) {
      sourceIds.push(...argv[i + 1].split(',').map(s => s.trim()).filter(Boolean));
      i++;
    } else if (arg.startsWith('--sources=')) {
      sourceIds.push(...arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg === '--reason' && argv[i + 1]) {
      reason = argv[i + 1];
      i++;
    } else if (arg.startsWith('--reason=')) {
      reason = arg.split('=').slice(1).join('=');
    } else if (arg === '--url' && argv[i + 1]) {
      const [id, ...rest] = argv[i + 1].split('=');
      if (id && rest.length) urlOverrides[id] = rest.join('=');
      i++;
    } else if (arg.startsWith('--url=')) {
      const [id, ...rest] = arg.split('=').slice(1).join('=').split('=');
      if (id && rest.length) urlOverrides[id] = rest.join('=');
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceIds: [...new Set(sourceIds)], reason, urlOverrides, dryRun };
}

export function runRequeue(options: {
  sourceIds: string[];
  reason: string;
  urlOverrides?: Record<string, string>;
  dryRun?: boolean;
  now?: string;
}): RequeueResult {
  const existingQueue = readJsonl<QueueEntry>(PREC_QUEUE_FILE);
  const plan = planRequeue(
    options.sourceIds,
    existingQueue,
    {
      getUrl: (id) => {
        const src = getSource(id);
        return src ? (src.url ?? null) : null;
      },
      isSkipped: (id) => {
        const r = isSkipped(id);
        return { skip: r.skip, reason: r.reason };
      },
    },
    options.now,
    options.reason,
  );

  const toQueue = plan.filter(p => p.outcome === 'queued');
  const written = toQueue.length;

  if (!options.dryRun) {
    // 1) Eventuell URL-ompekning (källspecifik konfiguration, inte C-lager).
    for (const [id, url] of Object.entries(options.urlOverrides ?? {})) {
      if (!getSource(id)) {
        console.error(`[requeue] kan inte peka om ${id}: källan finns inte i sources/`);
        continue;
      }
      const ok = updateSourceUrl(id, url);
      console.error(`[requeue] ${ok ? 'pekade om' : 'kunde inte peka om'} ${id} → ${url}`);
    }

    // 2) Köpost.
    if (written > 0) {
      const next = [...existingQueue, ...toQueue.map(p => p.entry!)];
      writeJsonlAtomic(PREC_QUEUE_FILE, next);
    }

    // 3) Status: 'routed' (handoff = inte fel). Nollställer felräknaren.
    for (const p of toQueue) {
      updateSourceStatus(p.sourceId, {
        success: false,
        eventsFound: 0,
        pathUsed: 'html',
        ingestionStage: 'B',
        preferredPath: 'html',
        pendingNextTool: 'C-htmlGate',
        lastRoutingReason: `requeue: ${options.reason}`,
        lastRoutingSource: 'runtime_status',
        error: `requeued: ${options.reason}`,
      });
    }
  }

  return {
    requested: options.sourceIds,
    plan,
    written,
    skipped: plan.length - written,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.sourceIds.length === 0) {
    console.error('Usage: npx tsx 02-Ingestion/tools/requeue-sources.ts --sources a,b,c [--reason "..."] [--url id=https://...] [--dry-run]');
    process.exit(1);
  }

  const result = runRequeue({
    sourceIds: options.sourceIds,
    reason: options.reason,
    urlOverrides: options.urlOverrides,
    dryRun: options.dryRun,
  });

  for (const p of result.plan) {
    console.log(`[requeue] ${p.sourceId}: ${p.outcome} — ${p.detail}`);
  }
  console.log(JSON.stringify({
    requested: result.requested.length,
    queued: result.written,
    skipped: result.skipped,
    dryRun: options.dryRun,
  }));
  process.exit(0);
}
