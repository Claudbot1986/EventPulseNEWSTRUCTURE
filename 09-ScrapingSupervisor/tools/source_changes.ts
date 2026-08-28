/**
 * source_changes.ts — append-only audit log of source-level changes.
 *
 * Inspired by:
 *   - NIST SP 800-53 AU family (audit & accountability) — every action logged
 *     with timestamp, actor, action, evidence.
 *   - W3C PROV-O (provenance) — track entity (source), activity (review),
 *     agent (AI / human / auto-rule).
 *   - ISO 8000-8 (data quality) — outcome field captures quality dimensions
 *     after a change (cf_after, events_found_after, status_after).
 *
 * Append-only JSONL at `runtime/scraping-supervisor/source-changes.jsonl`.
 * Each line is one change. Schema (synthetic):
 *
 *   {
 *     timestamp: "2026-08-19T12:00:00.000Z",
 *     date: "2026-08-19",
 *     sourceId: "kungstradgarden",
 *     action: "update-preferred-path" | "archive-dead" | "mark-untouched" |
 *             "mark-review-needed" | "url-normalize",
 *     before: { url?, preferredPath?, status? },
 *     after:  { url?, preferredPath?, status? },
 *     rationale: "ENOTFOUND for 30+ consecutive attempts; DNS lookup fails consistently.",
 *     evidence: "toolA: Fetch failed: getaddrinfo ENOTFOUND foo.example; cf=15",
 *     confidence: "high" | "medium" | "low",
 *     appliedBy: "ai-reviewer" | "human" | "auto-rule",
 *     reviewStatus: "auto-applied" | "pending-review" |
 *                   "human-approved" | "human-rejected",
 *     outcome?: { cfAfter?, eventsFoundAfter?, statusAfter?, measuredAt? },
 *   }
 *
 * The log is idempotent at the (date, sourceId, action) level — same triple
 * overwrites the prior entry rather than creating duplicates.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const REL_PATH = 'runtime/scraping-supervisor/source-changes.jsonl';

export type SourceAction =
  | 'url-normalize'
  | 'update-url'
  | 'update-preferred-path'
  | 'archive-dead'
  | 'mark-untouched'
  | 'mark-review-needed';

export type AppliedBy = 'ai-reviewer' | 'human' | 'auto-rule';
export type ReviewStatus =
  | 'auto-applied'
  | 'pending-review'
  | 'human-approved'
  | 'human-rejected';
export type Confidence = 'high' | 'medium' | 'low';

export interface SourceChangeBefore {
  url?: string;
  preferredPath?: string;
  status?: string;
}

export interface SourceChange {
  timestamp: string;
  date: string;
  sourceId: string;
  action: SourceAction;
  before: SourceChangeBefore;
  after: SourceChangeBefore;
  rationale: string;
  evidence: string;
  confidence: Confidence;
  appliedBy: AppliedBy;
  reviewStatus: ReviewStatus;
  outcome?: {
    cfAfter?: number;
    eventsFoundAfter?: number;
    statusAfter?: string;
    measuredAt?: string;
  };
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Append (or overwrite by (date, sourceId, action) triple). Idempotent.
 * Returns the change that was persisted.
 */
export function appendChange(
  projectRoot: string,
  change: SourceChange,
): SourceChange {
  const path = join(projectRoot, REL_PATH);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = existsSync(path)
    ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as SourceChange)
    : [];

  const filtered = existing.filter(
    (c) => !(c.date === change.date && c.sourceId === change.sourceId && c.action === change.action),
  );
  const merged = [...filtered, change].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  writeFileSync(path, merged.map((c) => JSON.stringify(c)).join('\n') + '\n');
  return change;
}

/**
 * Read all changes, oldest-first. Optional filters.
 */
export interface ReadOptions {
  sourceId?: string;
  reviewStatus?: ReviewStatus;
  since?: string;
  until?: string;
  limit?: number;
}

export function readChanges(
  projectRoot: string,
  opts?: ReadOptions,
): SourceChange[] {
  const path = join(projectRoot, REL_PATH);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return [];
  const all: SourceChange[] = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SourceChange);
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let filtered = all;
  if (opts?.sourceId) filtered = filtered.filter((c) => c.sourceId === opts.sourceId);
  if (opts?.reviewStatus) filtered = filtered.filter((c) => c.reviewStatus === opts.reviewStatus);
  if (opts?.since) filtered = filtered.filter((c) => c.date >= opts.since!);
  if (opts?.until) filtered = filtered.filter((c) => c.date <= opts.until!);

  if (opts?.limit !== undefined && opts.limit > 0) {
    return filtered.slice(-opts.limit);
  }
  return filtered;
}

/**
 * Patch the `outcome` field of the latest matching change for a sourceId.
 * Idempotent — caller may call repeatedly as new measurements arrive.
 * Returns true if a record was updated.
 */
export function recordOutcome(
  projectRoot: string,
  sourceId: string,
  outcome: NonNullable<SourceChange['outcome']>,
): boolean {
  const path = join(projectRoot, REL_PATH);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return false;
  const all: SourceChange[] = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SourceChange);

  let touched = false;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].sourceId === sourceId && all[i].outcome === undefined) {
      all[i].outcome = { ...outcome, measuredAt: outcome.measuredAt ?? new Date().toISOString() };
      touched = true;
      break;
    }
  }
  if (touched) {
    writeFileSync(path, all.map((c) => JSON.stringify(c)).join('\n') + '\n');
  }
  return touched;
}

/**
 * Convenience builder for a change entry. Auto-fills timestamp and date.
 */
export function makeChange(
  partial: Omit<SourceChange, 'timestamp' | 'date'>,
  now: Date = new Date(),
): SourceChange {
  return {
    timestamp: now.toISOString(),
    date: isoDate(now),
    ...partial,
  };
}

/**
 * Statistics over a window of changes — used by the health report.
 */
export interface ChangeStats {
  total: number;
  byAction: Record<SourceAction, number>;
  byReviewStatus: Record<ReviewStatus, number>;
  byConfidence: Record<Confidence, number>;
  pendingReviewCount: number;
}

export function statsFor(changes: SourceChange[]): ChangeStats {
  const byAction = {
    'url-normalize': 0,
    'update-url': 0,
    'update-preferred-path': 0,
    'archive-dead': 0,
    'mark-untouched': 0,
    'mark-review-needed': 0,
  } as Record<SourceAction, number>;
  const byReviewStatus = {
    'auto-applied': 0,
    'pending-review': 0,
    'human-approved': 0,
    'human-rejected': 0,
  } as Record<ReviewStatus, number>;
  const byConfidence = { high: 0, medium: 0, low: 0 } as Record<Confidence, number>;

  for (const c of changes) {
    byAction[c.action] = (byAction[c.action] ?? 0) + 1;
    byReviewStatus[c.reviewStatus] = (byReviewStatus[c.reviewStatus] ?? 0) + 1;
    byConfidence[c.confidence] = (byConfidence[c.confidence] ?? 0) + 1;
  }
  return {
    total: changes.length,
    byAction,
    byReviewStatus,
    byConfidence,
    pendingReviewCount: byReviewStatus['pending-review'],
  };
}