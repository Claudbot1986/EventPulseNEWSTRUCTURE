/**
 * collect_state.ts — pure read.
 *
 * Reads runtime/*.jsonl + last N batch-traces + sources/*.jsonl and produces
 * a structured `SupervisorState` for the supervisor to analyze.
 *
 * Pure function — no writes, no network calls. Idempotent.
 *
 * Pattern follows 08-Agent/tools/* (errors-as-data, never thrown).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Paths (configurable via opts) ───────────────────────────────────────────

export interface CollectOptions {
  projectRoot: string;
  /** How many recent batch directories to scan. Default 5. */
  recentBatches?: number;
}

const DEFAULT_RECENT_BATCHES = 5;

// ─── Public types ────────────────────────────────────────────────────────────

export interface BatchStats {
  batch: string;
  successRate: number;
  totalSources: number;
  successes: number;
  avgEventsFound: number;
}

export interface SourceHealth {
  sourceId: string;
  status: string | null;
  consecutiveFailures: number;
  lastRoutingReason: string | null;
  lastPathUsed: string | null;
  outcomeType: string | null;
  preferredPath: string | null;
  city: string | null;
}

export interface SchemaDriftSignal {
  exitReason: string;
  count: number;
  affectedSourceIds: string[];
}

export interface SupervisorState {
  timestamp: string;
  totals: {
    sources: number;
    stockholm: number;
    dead: number;        // consecutiveFailures > 0 with no successes in batch-traces
    working: number;     // has batch-traces with eventsFound > 0
    untouched: number;   // no batch-traces
  };
  failureModes: Record<string, number>;
  batchStats: BatchStats[];
  schemaDriftSignals: SchemaDriftSignal[];
  deadSources: SourceHealth[];
  workingSources: SourceHealth[];
  untouchedSources: SourceHealth[];
  priorityQueueHead: { sourceId: string; priority: number; reason: string }[];
}

// ─── File paths ──────────────────────────────────────────────────────────────

const SOURCES_DIR = (root: string) => resolve(root, 'sources');
const STATUS_FILE = (root: string) => resolve(root, 'runtime', 'sources_status.jsonl');
const PRIORITY_FILE = (root: string) => resolve(root, 'runtime', 'sources_priority_queue.jsonl');
const REPORTS_DIR = (root: string) =>
  resolve(root, '02-Ingestion', 'C-htmlGate', 'reports');

const BATCH_DIR_RE = /^(batch-\d{3,})$/;

// ─── Loaders ─────────────────────────────────────────────────────────────────

function loadJsonl<T = unknown>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed line — don't throw
    }
  }
  return out;
}

function loadSourceTruth(root: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const dir = SOURCES_DIR(root);
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.jsonl')) continue;
    if (entry.startsWith('_')) continue; // skip _archive/
    const path = resolve(dir, entry);
    const text = readFileSync(path, 'utf-8');
    const firstLine = text.split('\n').find((l) => l.trim());
    if (!firstLine) continue;
    try {
      const record = JSON.parse(firstLine) as Record<string, unknown>;
      if (typeof record.id === 'string') {
        out.set(record.id, record);
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}

function listRecentBatches(root: string, n: number): string[] {
  const reportsDir = REPORTS_DIR(root);
  if (!existsSync(reportsDir)) return [];
  const dirs = readdirSync(reportsDir)
    .filter((name) => BATCH_DIR_RE.test(name))
    .map((name) => {
      const numMatch = name.match(/^batch-(\d+)$/);
      return { name, num: numMatch ? parseInt(numMatch[1], 10) : -1 };
    })
    .filter((d) => d.num >= 0)
    .sort((a, b) => b.num - a.num)
    .slice(0, n)
    .map((d) => d.name);
  return dirs;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function collectState(opts: CollectOptions): SupervisorState {
  const root = opts.projectRoot;
  const recent = opts.recentBatches ?? DEFAULT_RECENT_BATCHES;

  const sourceTruth = loadSourceTruth(root);
  const status = loadJsonl<Record<string, unknown>>(STATUS_FILE(root));
  const priority = loadJsonl<Record<string, unknown>>(PRIORITY_FILE(root));

  const statusById = new Map<string, Record<string, unknown>>();
  for (const s of status) {
    if (typeof s.sourceId === 'string') {
      statusById.set(s.sourceId, s);
    }
  }

  // Collect batch traces from recent batches.
  // listRecentBatches returns newest-first by number; we want the LATEST batch
  // per source to win, so iterate OLDEST-first and overwrite the map each pass.
  const batchesNewestFirst = listRecentBatches(root, recent);
  const batches = [...batchesNewestFirst].reverse();
  const batchTraceBySource = new Map<string, { eventsFound: number; success: boolean; exitReason: string | null; batch: string }>();
  const failureModeCounts = new Map<string, number>();
  const failureModeSources = new Map<string, Set<string>>();
  // batchStats: only emit a stat row for batches that actually have a trace file.
  // An empty dir means "prepared but never ran" — not enough signal to summarise.
  const batchStats: BatchStats[] = [];

  for (const batchName of batches) {
    const tracePath = resolve(REPORTS_DIR(root), batchName, 'batch-traces.jsonl');
    if (!existsSync(tracePath)) continue;
    const traces = loadJsonl<Record<string, unknown>>(tracePath);
    let successes = 0;
    let totalEvents = 0;
    for (const t of traces) {
      const sid = t.sourceId;
      if (typeof sid !== 'string') continue;
      const eventsFound = typeof t.eventsFound === 'number' ? t.eventsFound : 0;
      const success = t.success === true;
      const exitReason = typeof t.exitReason === 'string' ? t.exitReason : null;
      if (success) successes++;
      totalEvents += eventsFound;

      // Track per-source (latest batch wins — iteration goes oldest→newest)
      batchTraceBySource.set(sid, { eventsFound, success, exitReason, batch: batchName });

      if (exitReason) {
        failureModeCounts.set(exitReason, (failureModeCounts.get(exitReason) ?? 0) + 1);
        const set = failureModeSources.get(exitReason) ?? new Set<string>();
        set.add(sid);
        failureModeSources.set(exitReason, set);
      }
    }
    batchStats.push({
      batch: batchName,
      successRate: traces.length > 0 ? successes / traces.length : 0,
      totalSources: traces.length,
      successes,
      avgEventsFound: traces.length > 0 ? totalEvents / traces.length : 0,
    });
  }
  // Re-sort batchStats to newest-first for the consumer
  batchStats.sort((a, b) => (b.batch > a.batch ? 1 : b.batch < a.batch ? -1 : 0));

  // Build per-source health, classifying each (Stockholm only — supervisor focuses on Stockholm per MASTERPLAN §2)
  const dead: SourceHealth[] = [];
  const working: SourceHealth[] = [];
  const untouched: SourceHealth[] = [];

  for (const [sid, truth] of sourceTruth) {
    const st = statusById.get(sid) ?? {};
    const tr = batchTraceBySource.get(sid);
    const isStockholm = (truth.city as string | undefined)?.toLowerCase() === 'stockholm';
    if (!isStockholm) continue;

    const health: SourceHealth = {
      sourceId: sid,
      status: (st.status as string | undefined) ?? null,
      consecutiveFailures: (st.consecutiveFailures as number | undefined) ?? 0,
      lastRoutingReason: (st.lastRoutingReason as string | undefined) ?? null,
      lastPathUsed: (st.lastPathUsed as string | undefined) ?? null,
      outcomeType: (st.outcomeType as string | undefined) ?? null,
      preferredPath: (truth.preferredPath as string | undefined) ?? null,
      city: (truth.city as string | undefined) ?? null,
    };

    if (!tr) {
      untouched.push(health);
    } else if (tr.success && tr.eventsFound > 0) {
      working.push(health);
    } else {
      dead.push(health);
    }
  }

  dead.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
  working.sort((a, b) => a.consecutiveFailures - b.consecutiveFailures);
  untouched.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);

  // Schema drift: exitReasons appearing in 3+ recent batches
  const schemaDriftSignals: SchemaDriftSignal[] = [];
  for (const [exitReason, count] of failureModeCounts.entries()) {
    const affectedSourceIds = Array.from(failureModeSources.get(exitReason) ?? []);
    if (affectedSourceIds.length >= 3) {
      schemaDriftSignals.push({ exitReason, count, affectedSourceIds });
    }
  }
  schemaDriftSignals.sort((a, b) => b.count - a.count);

  const priorityQueueHead = priority
    .slice(0, 10)
    .map((p) => ({
      sourceId: p.sourceId as string,
      priority: (p.priority as number | undefined) ?? 0,
      reason: (p.reason as string | undefined) ?? '',
    }))
    .filter((p) => typeof p.sourceId === 'string');

  const failureModes: Record<string, number> = {};
  for (const [k, v] of failureModeCounts.entries()) {
    failureModes[k] = v;
  }

  return {
    timestamp: new Date().toISOString(),
    totals: {
      sources: sourceTruth.size,
      stockholm: dead.length + working.length + untouched.length,
      dead: dead.length,
      working: working.length,
      untouched: untouched.length,
    },
    failureModes,
    batchStats,
    schemaDriftSignals,
    deadSources: dead,
    workingSources: working,
    untouchedSources: untouched,
    priorityQueueHead,
  };
}