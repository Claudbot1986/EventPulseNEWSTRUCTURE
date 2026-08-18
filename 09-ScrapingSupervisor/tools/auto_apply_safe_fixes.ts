/**
 * auto_apply_safe_fixes — bounded deterministic rule for the supervisor.
 *
 * Scope (per `43-Scraping-Tools-Survey-2026-08-19.md` and BACKLOG safety):
 *   - Move sources whose `lastRoutingReason` matches the whitelist into
 *     `sources/_archive/dead-{YYYY-MM-DD}/`.
 *   - Whitelist:
 *       (a) `ENOTFOUND` (DNS dead) — no recovery possible
 *       (b) `http 404` (or `not found`) AND `consecutiveFailures >= 10`
 *           (server explicitly says gone, and we've tried at least 10 times)
 *   - Everything else (redirect loops, schema drift, URL mismatches) goes to
 *     the suggested-fixes queue, never auto-applied.
 *   - Does NOT modify `url` field of any source.
 *   - Does NOT auto-invoke the four manual fix scripts (those are operator-
 *     triggered via the dashboard `gl` key).
 *   - Does NOT modify C-layer code.
 *
 * Idempotency:
 *   - Sources already in any `sources/_archive/dead-<DATE>/` directory are skipped.
 *   - Re-running the supervisor the same day produces no diff (date-stamped
 *     archive dirs).
 *
 * Output:
 *   - Writes `runtime/scraping-supervisor/applied-fixes.log` (append-only).
 *   - Returns a structured ApplyResult for the caller (write_reports).
 */

import { existsSync, mkdirSync, renameSync, appendFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { SourceHealth } from './collect_state';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ApplyOptions {
  projectRoot: string;
  /** ISO date (YYYY-MM-DD). Default: today (UTC). */
  archiveDate?: string;
  /** Consecutive-failures threshold for http 404 class. Default 10. */
  minFailuresFor404?: number;
  /** Override archive dir name. Default: `dead-{archiveDate}`. */
  archiveDirName?: string;
}

export interface AppliedFix {
  sourceId: string;
  reason: 'enotfound' | 'persistent-404';
  consecutiveFailures: number;
  lastRoutingReason: string | null;
  movedTo: string;
  appliedAt: string;
}

export interface SkippedFix {
  sourceId: string;
  reason: 'already-archived' | 'not-in-whitelist' | 'file-missing' | 'archive-failed';
  detail?: string;
}

export interface ApplyResult {
  applied: AppliedFix[];
  skipped: SkippedFix[];
  archiveDir: string;
  dryRun: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MIN_FAILURES_FOR_404 = 10;
const LOG_REL = 'runtime/scraping-supervisor/applied-fixes.log';

// ─── Helpers (pure) ──────────────────────────────────────────────────────────

function isWhitelistReason(
  lastRoutingReason: string | null,
  consecutiveFailures: number,
  minFailuresFor404: number
): { match: boolean; kind?: 'enotfound' | 'persistent-404' } {
  const r = (lastRoutingReason ?? '').toLowerCase();
  if (r.includes('enotfound')) {
    return { match: true, kind: 'enotfound' };
  }
  if ((r.includes('http 404') || r.includes('not found')) && consecutiveFailures >= minFailuresFor404) {
    return { match: true, kind: 'persistent-404' };
  }
  return { match: false };
}

function isAlreadyArchived(projectRoot: string, sourceId: string): boolean {
  // Walk sources/_archive/dead-*/ for any file with this id. Cheap because
  // archive dirs only contain 1-20 files each.
  const archiveRoot = resolve(projectRoot, 'sources', '_archive');
  if (!existsSync(archiveRoot)) return false;
  for (const entry of readdirSync(archiveRoot)) {
    if (!entry.startsWith('dead-')) continue;
    if (existsSync(resolve(archiveRoot, entry, `${sourceId}.jsonl`))) return true;
  }
  return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function autoApplySafeFixes(
  sources: ReadonlyArray<SourceHealth>,
  opts: ApplyOptions
): ApplyResult {
  const date = opts.archiveDate ?? todayUtc();
  const minFailures = opts.minFailuresFor404 ?? DEFAULT_MIN_FAILURES_FOR_404;
  const archiveDirName = opts.archiveDirName ?? `dead-${date}`;
  const archiveDir = resolve(opts.projectRoot, 'sources', '_archive', archiveDirName);
  const sourceDir = resolve(opts.projectRoot, 'sources');
  const logPath = resolve(opts.projectRoot, LOG_REL);

  mkdirSync(resolve(archiveDir, '..'), { recursive: true });
  // The append-only log lives under runtime/scraping-supervisor/ — make sure
  // the directory exists before the first appendFileSync below.
  mkdirSync(resolve(logPath, '..'), { recursive: true });

  const applied: AppliedFix[] = [];
  const skipped: SkippedFix[] = [];

  for (const s of sources) {
    const whitelist = isWhitelistReason(s.lastRoutingReason, s.consecutiveFailures, minFailures);
    if (!whitelist.match) {
      skipped.push({ sourceId: s.sourceId, reason: 'not-in-whitelist' });
      continue;
    }
    if (isAlreadyArchived(opts.projectRoot, s.sourceId)) {
      skipped.push({ sourceId: s.sourceId, reason: 'already-archived' });
      continue;
    }
    const srcPath = resolve(sourceDir, `${s.sourceId}.jsonl`);
    if (!existsSync(srcPath)) {
      skipped.push({ sourceId: s.sourceId, reason: 'file-missing' });
      continue;
    }
    const destPath = resolve(archiveDir, `${s.sourceId}.jsonl`);

    // Idempotency for the file-move itself
    if (existsSync(destPath)) {
      skipped.push({ sourceId: s.sourceId, reason: 'already-archived' });
      continue;
    }

    try {
      mkdirSync(archiveDir, { recursive: true });
      renameSync(srcPath, destPath);
      const fix: AppliedFix = {
        sourceId: s.sourceId,
        reason: whitelist.kind!,
        consecutiveFailures: s.consecutiveFailures,
        lastRoutingReason: s.lastRoutingReason,
        movedTo: destPath,
        appliedAt: new Date().toISOString(),
      };
      applied.push(fix);

      // Append-only log — never overwrite, never parse (forensic only).
      appendFileSync(logPath, JSON.stringify(fix) + '\n', 'utf-8');
    } catch (e) {
      skipped.push({
        sourceId: s.sourceId,
        reason: 'archive-failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    applied,
    skipped,
    archiveDir,
    dryRun: false,
  };
}

/**
 * Dry-run variant — returns what *would* be applied, without moving files
 * or writing the log. Use this for `write_reports` preview or for the
 * supervisor's "first run" UX.
 */
export function previewAutoApplySafeFixes(
  sources: ReadonlyArray<SourceHealth>,
  opts: ApplyOptions
): ApplyResult {
  const date = opts.archiveDate ?? todayUtc();
  const archiveDirName = opts.archiveDirName ?? `dead-${date}`;
  const archiveDir = resolve(opts.projectRoot, 'sources', '_archive', archiveDirName);
  const minFailures = opts.minFailuresFor404 ?? DEFAULT_MIN_FAILURES_FOR_404;

  const applied: AppliedFix[] = [];
  const skipped: SkippedFix[] = [];

  for (const s of sources) {
    const whitelist = isWhitelistReason(s.lastRoutingReason, s.consecutiveFailures, minFailures);
    if (!whitelist.match) {
      skipped.push({ sourceId: s.sourceId, reason: 'not-in-whitelist' });
      continue;
    }
    if (isAlreadyArchived(opts.projectRoot, s.sourceId)) {
      skipped.push({ sourceId: s.sourceId, reason: 'already-archived' });
      continue;
    }
    const srcPath = resolve(opts.projectRoot, 'sources', `${s.sourceId}.jsonl`);
    if (!existsSync(srcPath)) {
      skipped.push({ sourceId: s.sourceId, reason: 'file-missing' });
      continue;
    }
    applied.push({
      sourceId: s.sourceId,
      reason: whitelist.kind!,
      consecutiveFailures: s.consecutiveFailures,
      lastRoutingReason: s.lastRoutingReason,
      movedTo: resolve(archiveDir, `${s.sourceId}.jsonl`),
      appliedAt: new Date().toISOString(),
    });
  }

  return { applied, skipped, archiveDir, dryRun: true };
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * Pure version of the whitelist rule — no file IO.
 * Returns the matched kind or null.
 */
export function classifyForAutoArchive(
  source: SourceHealth,
  minFailuresFor404: number = DEFAULT_MIN_FAILURES_FOR_404
): 'enotfound' | 'persistent-404' | null {
  return isWhitelistReason(source.lastRoutingReason, source.consecutiveFailures, minFailuresFor404).kind ?? null;
}

/**
 * Sum helper for the daily report.
 */
export function summarizeApplyResult(result: ApplyResult): {
  appliedCount: number;
  skippedCount: number;
  byReason: { enotfound: number; 'persistent-404': number };
} {
  const byReason = { enotfound: 0, 'persistent-404': 0 };
  for (const a of result.applied) byReason[a.reason]++;
  return {
    appliedCount: result.applied.length,
    skippedCount: result.skipped.length,
    byReason,
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}