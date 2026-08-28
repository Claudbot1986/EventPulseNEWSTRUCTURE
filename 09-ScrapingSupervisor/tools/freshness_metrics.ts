/**
 * freshness_metrics.ts — compute data-quality metrics the dashboard surfaces.
 *
 * Three metrics:
 *
 *  1. Freshness — median of `(now - fileMtime)` in hours, across all event
 *     files under `03-Queue/03-extractedevents/`. Lower is fresher.
 *
 *  2. Field coverage — fraction (0..1) of event records that have a truthy
 *     value for {date, venue, title, description}. Two confidence schemas
 *     exist in the corpus:
 *       - `{ confidence: { hasDate, hasVenue, ... } }`   (jazz-i-lund, junibacken)
 *       - `{ confidence: { fields: { date, venue, ... } } }` (debaser)
 *     We accept either, falling back to non-empty top-level fields.
 *
 *  3. Batch metrics — over the last N batch dirs (default 5):
 *       - attempts:  total trace rows
 *       - success:   trace.success === true
 *       - decoy:     success && eventsFound === 0
 *       - transportOk: success
 *       - dataOk:    success && eventsFound >= 1
 *
 * Pure (read-only). Errors-as-data: missing dirs/files yield zeros, not throws.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type {
  BatchMetrics,
  FieldCoverage,
} from './metrics_history';

const EVENT_DIR_CANDIDATES = [
  '03-Queue/03-extractedevents',
  '03-Queue/extractedevents',
  'queue/extracted-events',
];

const BATCH_DIR_CANDIDATES = [
  '02-Ingestion/C-htmlGate/reports',
  '02-Ingestion/reports',
];

export interface ComputeOptions {
  /** Override event directory (default: first candidate that exists). */
  eventDir?: string;
  /** Override batch-traces directory (default: first candidate that exists). */
  batchDir?: string;
  /** Last N batch dirs to include (default 5). */
  recentBatches?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

function findExistingDir(projectRoot: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const p = join(projectRoot, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function listEventFiles(eventDir: string): string[] {
  const files: string[] = [];
  if (!existsSync(eventDir)) return files;
  const entries = readdirSync(eventDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(join(eventDir, entry.name));
    } else if (entry.isDirectory()) {
      const sub = join(eventDir, entry.name);
      const subEntries = readdirSync(sub, { withFileTypes: true });
      for (const se of subEntries) {
        if (se.isFile() && se.name.endsWith('.jsonl')) {
          files.push(join(sub, se.name));
        }
      }
    }
  }
  return files;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Median age (hours) of event files. `null` if no files.
 */
export function computeFreshnessMedianHours(
  projectRoot: string,
  opts?: ComputeOptions,
): number | null {
  const eventDir =
    opts?.eventDir
      ? join(projectRoot, opts.eventDir)
      : findExistingDir(projectRoot, EVENT_DIR_CANDIDATES);
  if (!eventDir) return null;
  const files = listEventFiles(eventDir);
  if (files.length === 0) return null;

  const now = (opts?.now ?? new Date()).getTime();
  const agesHours = files
    .map((f) => {
      try {
        return (now - statSync(f).mtimeMs) / 3_600_000;
      } catch {
        return null;
      }
    })
    .filter((v): v is number => v !== null && v >= 0);

  if (agesHours.length === 0) return null;
  return percentile(agesHours, 50);
}

interface EventRecord {
  title?: string;
  date?: string;
  venue?: string;
  description?: string;
  url?: string;
  confidence?: {
    score?: number;
    hasTitle?: boolean;
    hasDate?: boolean;
    hasVenue?: boolean;
    hasUrl?: boolean;
    hasDescription?: boolean;
    fields?: {
      title?: number;
      date?: number;
      venue?: number;
      description?: number;
    };
  };
}

function eventHasField(rec: EventRecord, field: 'date' | 'venue' | 'title' | 'description'): boolean {
  const c = rec.confidence;
  if (c) {
    if (field === 'date' && (c.hasDate === true || (c.fields?.date ?? 0) >= 1)) return true;
    if (field === 'venue' && (c.hasVenue === true || (c.fields?.venue ?? 0) >= 1)) return true;
    if (field === 'title' && (c.hasTitle === true || (c.fields?.title ?? 0) >= 1)) return true;
    if (field === 'description' && (c.hasDescription === true || (c.fields?.description ?? 0) >= 1)) return true;
  }
  const top = rec[field];
  if (typeof top === 'string') {
    const t = top.trim();
    return t.length > 0 && t.toLowerCase() !== 'unknown';
  }
  return false;
}

/**
 * Field coverage in [0,1] across all event records under the event dir.
 * Returns zeros for the four fields if the dir is missing or empty.
 */
export function computeFieldCoverage(
  projectRoot: string,
  opts?: ComputeOptions,
): FieldCoverage {
  const zero: FieldCoverage = { date: 0, venue: 0, title: 0, description: 0 };
  const eventDir =
    opts?.eventDir
      ? join(projectRoot, opts.eventDir)
      : findExistingDir(projectRoot, EVENT_DIR_CANDIDATES);
  if (!eventDir) return zero;
  const files = listEventFiles(eventDir);
  if (files.length === 0) return zero;

  const counts = { date: 0, venue: 0, title: 0, description: 0, total: 0 };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec: EventRecord;
      try {
        rec = JSON.parse(line) as EventRecord;
      } catch {
        continue;
      }
      counts.total++;
      if (eventHasField(rec, 'date')) counts.date++;
      if (eventHasField(rec, 'venue')) counts.venue++;
      if (eventHasField(rec, 'title')) counts.title++;
      if (eventHasField(rec, 'description')) counts.description++;
    }
  }
  if (counts.total === 0) return zero;
  return {
    date: counts.date / counts.total,
    venue: counts.venue / counts.total,
    title: counts.title / counts.total,
    description: counts.description / counts.total,
  };
}

interface BatchTrace {
  success?: boolean;
  eventsFound?: number;
  exitReason?: string;
  c1Fetchable?: boolean;
}

/**
 * Batch-level metrics over the last N batch dirs.
 */
export function computeBatchMetrics(
  projectRoot: string,
  opts?: ComputeOptions,
): BatchMetrics {
  const zero: BatchMetrics = {
    attempts: 0,
    success: 0,
    decoy: 0,
    transportOk: 0,
    dataOk: 0,
  };
  const batchDir =
    opts?.batchDir
      ? join(projectRoot, opts.batchDir)
      : findExistingDir(projectRoot, BATCH_DIR_CANDIDATES);
  if (!batchDir || !existsSync(batchDir)) return zero;

  const limit = opts?.recentBatches ?? 5;
  const dirs = readdirSync(batchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
    .slice(0, limit);

  const counts = { ...zero };
  for (const batchName of dirs) {
    const tracePath = join(batchDir, batchName, 'batch-traces.jsonl');
    if (!existsSync(tracePath)) continue;
    let text: string;
    try {
      text = readFileSync(tracePath, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec: BatchTrace;
      try {
        rec = JSON.parse(line) as BatchTrace;
      } catch {
        continue;
      }
      counts.attempts++;
      const ok = rec.success === true;
      if (ok) counts.success++;
      const ev = Number(rec.eventsFound ?? 0);
      if (ok && ev === 0) counts.decoy++;
      if (ok) counts.transportOk++;
      if (ok && ev >= 1) counts.dataOk++;
    }
  }
  return counts;
}

/**
 * Convenience: compute all three at once.
 */
export function computeAll(projectRoot: string, opts?: ComputeOptions): {
  freshnessMedianHours: number | null;
  fieldCoverage: FieldCoverage;
  batchMetrics: BatchMetrics;
} {
  return {
    freshnessMedianHours: computeFreshnessMedianHours(projectRoot, opts),
    fieldCoverage: computeFieldCoverage(projectRoot, opts),
    batchMetrics: computeBatchMetrics(projectRoot, opts),
  };
}