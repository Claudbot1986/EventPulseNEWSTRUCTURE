/**
 * metrics_history.ts — append-only history of daily supervisor metrics.
 *
 * Each supervisor run appends a snapshot with the metrics the dashboard
 * sparklines read back. The file is plain JSONL so it is diffable and
 * trivially appendable from concurrent writes (we use a temp-file rename
 * to keep each append atomic).
 *
 * Schema (per line):
 *   {
 *     date: "2026-08-19",          // ISO date (UTC)
 *     sources: { total, working, dead, untouched },
 *     batches: {
 *       attempts: number,         // total trace rows across last 5 batches
 *       success: number,          // trace.success === true
 *       decoy: number,            // success && eventsFound === 0
 *       transportOk: number,      // success && exitReason !== no-events
 *       dataOk: number,           // success && eventsFound >= 1
 *     },
 *     freshnessMedianHours: number | null,    // median mtime of event files
 *     fieldCoverage: {
 *       date: number,             // 0..1 fraction of events with hasDate
 *       venue: number,
 *       title: number,
 *       description: number,
 *     },
 *   }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const REL_PATH = 'runtime/scraping-supervisor/metrics-history.jsonl';

export interface BatchMetrics {
  attempts: number;
  success: number;
  decoy: number;
  transportOk: number;
  dataOk: number;
}

export interface SourceCounts {
  total: number;
  working: number;
  dead: number;
  untouched: number;
}

export interface FieldCoverage {
  date: number;
  venue: number;
  title: number;
  description: number;
}

export interface MetricsSnapshot {
  date: string;
  sources: SourceCounts;
  batches: BatchMetrics;
  freshnessMedianHours: number | null;
  fieldCoverage: FieldCoverage;
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Append a snapshot. The file is created with `[]` if missing. Idempotent at
 * the per-date level: if an entry already exists for `date`, it is overwritten
 * in-place (still append-only on disk; we just rewrite the file once).
 *
 * Returns the snapshot that was written.
 */
export function appendSnapshot(
  projectRoot: string,
  snapshot: MetricsSnapshot,
): MetricsSnapshot {
  const path = join(projectRoot, REL_PATH);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = existsSync(path)
    ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as MetricsSnapshot)
    : [];

  const merged: MetricsSnapshot[] = [...existing.filter((s) => s.date !== snapshot.date), snapshot]
    .sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(path, merged.map((s) => JSON.stringify(s)).join('\n') + '\n');
  return snapshot;
}

/**
 * Read all snapshots, oldest-first. Returns [] if the file does not exist.
 * Bounded retention: caller may pass `keepDays` to trim before returning
 * (the file on disk is NOT trimmed — that's a separate op).
 */
export function readHistory(projectRoot: string, opts?: { keepDays?: number }): MetricsSnapshot[] {
  const path = join(projectRoot, REL_PATH);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return [];
  const all = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as MetricsSnapshot);
  all.sort((a, b) => a.date.localeCompare(b.date));
  if (opts?.keepDays !== undefined && opts.keepDays > 0) {
    return all.slice(-opts.keepDays);
  }
  return all;
}

/**
 * Trim the on-disk history to the last `keepDays` entries. Returns the number
 * removed. Idempotent. Use sparingly (e.g. once per N runs).
 */
export function trimHistory(projectRoot: string, keepDays: number): number {
  const path = join(projectRoot, REL_PATH);
  if (!existsSync(path)) return 0;
  const all = readHistory(projectRoot);
  if (all.length <= keepDays) return 0;
  const kept = all.slice(-keepDays);
  writeFileSync(path, kept.map((s) => JSON.stringify(s)).join('\n') + '\n');
  return all.length - kept.length;
}

/**
 * Convenience builder — wraps appendSnapshot with a default ISO date.
 */
export function snapshotForToday(
  projectRoot: string,
  partial: Omit<MetricsSnapshot, 'date'>,
): MetricsSnapshot {
  const snap: MetricsSnapshot = { date: isoDate(), ...partial };
  return appendSnapshot(projectRoot, snap);
}