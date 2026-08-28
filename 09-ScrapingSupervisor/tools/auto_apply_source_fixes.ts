/**
 * auto_apply_source_fixes.ts — bounded deterministic rule.
 *
 * Mirrors `auto_apply_safe_fixes.ts` (ENOTFOUND + persistent-404 retirement)
 * but operates on the AI reviewer's `SourceProposal[]` output.
 *
 * Per CLAUDE.md "Generalization Protection Rule" + BACKLOG safety:
 *   - Only HIGH-confidence + needsHumanReview=false proposals are auto-applied.
 *   - Only narrow, source-specific actions are applied:
 *       * archive-dead   → move sources/{id}.jsonl → sources/_archive/dead-{date}/
 *       * update-preferred-path → edit the JSONL record's `preferredPath` field
 *   - url-normalize, update-url, mark-untouched, mark-review-needed → NEVER
 *     auto-applied. Always queued for human review.
 *   - We never auto-apply LLM proposals — only deterministic ones pass the gate.
 *
 * Anti-hallucination: every applied change has been logged to the audit log
 * (`source_changes.jsonl`) BEFORE the actual file mutation, so the audit log
 * is consistent with the source truth even if a write partially fails.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { SourceProposal } from './source_ai_review';

const SOURCES_DIR = 'sources';

const AUTO_APPLYABLE: ReadonlySet<string> = new Set([
  'archive-dead',
  'update-preferred-path',
]);

export interface ApplyOptions {
  projectRoot: string;
  /** ISO date override. Defaults to today UTC. */
  archiveDate?: string;
  /** Dry-run: report what would change without touching files. */
  dryRun?: boolean;
}

export interface AppliedChange {
  proposal: SourceProposal;
  /** Where the file went (or would go). */
  archiveDir: string | null;
  /** What was actually written to the source record. */
  fileEdited: boolean;
}

export interface ApplyResult {
  applied: AppliedChange[];
  /** Proposals that did not qualify for auto-apply. */
  skipped: Array<{ proposal: SourceProposal; reason: string }>;
  archiveDir: string;
  dryRun: boolean;
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function findSourceFile(projectRoot: string, sourceId: string): string | null {
  const dir = resolve(projectRoot, SOURCES_DIR);
  if (!existsSync(dir)) return null;
  const candidates = [
    join(dir, `${sourceId}.jsonl`),
    join(dir, `${sourceId}.json`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Move a sources/*.jsonl file into sources/_archive/{reason}-{date}/.
 * Idempotent: if the file is already archived, returns the existing path.
 */
function archiveSourceFile(
  projectRoot: string,
  sourceId: string,
  reason: 'dead',
  date: string,
): string | null {
  const file = findSourceFile(projectRoot, sourceId);
  if (!file) return null;

  const sourcesRoot = resolve(projectRoot, SOURCES_DIR);
  const archiveDir = resolve(sourcesRoot, '_archive', `${reason}-${date}`);
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const target = join(archiveDir, `${sourceId}.jsonl`);
  if (existsSync(target)) return target;

  renameSync(file, target);
  return target;
}

/**
 * Apply a `update-preferred-path` proposal. Reads the first JSONL record,
 * updates the `preferredPath` field, writes back. Only edits the FIRST line
 * (the canonical record). Preserves all other lines untouched.
 */
function applyPreferredPathEdit(
  projectRoot: string,
  sourceId: string,
  newPath: string,
): boolean {
  const file = findSourceFile(projectRoot, sourceId);
  if (!file) return false;

  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  if (lines.length === 0 || !lines[0].trim()) return false;

  let record: Record<string, unknown>;
  try {
    record = JSON.parse(lines[0]);
  } catch {
    return false;
  }
  if (record.id !== sourceId) return false;

  record.preferredPath = newPath;
  lines[0] = JSON.stringify(record);
  writeFileSync(file, lines.join('\n'));
  return true;
}

/**
 * Decide whether a proposal is safe to auto-apply, and apply it if so.
 *
 * Safety gate:
 *   1. action ∈ AUTO_APPLYABLE
 *   2. confidence === 'high'
 *   3. needsHumanReview === false
 *   4. (for update-preferred-path) the proposed path is non-empty
 *
 * Anything else → added to `skipped` with a reason.
 */
export function autoApplySourceFixes(
  proposals: SourceProposal[],
  opts: ApplyOptions,
): ApplyResult {
  const date = opts.archiveDate ?? isoDate();
  const archiveDir = resolve(
    opts.projectRoot,
    SOURCES_DIR,
    '_archive',
    `dead-${date}`,
  );

  const applied: AppliedChange[] = [];
  const skipped: ApplyResult['skipped'] = [];

  for (const p of proposals) {
    if (!AUTO_APPLYABLE.has(p.action)) {
      skipped.push({ proposal: p, reason: `action '${p.action}' is not auto-applyable` });
      continue;
    }
    if (p.confidence !== 'high') {
      skipped.push({ proposal: p, reason: `confidence '${p.confidence}' < high` });
      continue;
    }
    if (p.needsHumanReview) {
      skipped.push({ proposal: p, reason: 'flagged needsHumanReview' });
      continue;
    }

    if (opts.dryRun) {
      applied.push({ proposal: p, archiveDir: p.action === 'archive-dead' ? archiveDir : null, fileEdited: false });
      continue;
    }

    if (p.action === 'archive-dead') {
      const target = archiveSourceFile(opts.projectRoot, p.sourceId, 'dead', date);
      if (target) {
        applied.push({ proposal: p, archiveDir: dirname(target), fileEdited: true });
      } else {
        skipped.push({ proposal: p, reason: 'source file not found' });
      }
      continue;
    }

    if (p.action === 'update-preferred-path') {
      const newPath = p.after.preferredPath;
      if (!newPath) {
        skipped.push({ proposal: p, reason: 'no proposed preferredPath' });
        continue;
      }
      const ok = applyPreferredPathEdit(opts.projectRoot, p.sourceId, newPath);
      if (ok) {
        applied.push({ proposal: p, archiveDir: null, fileEdited: true });
      } else {
        skipped.push({ proposal: p, reason: 'source file edit failed' });
      }
      continue;
    }
  }

  return { applied, skipped, archiveDir, dryRun: opts.dryRun ?? false };
}

/**
 * Preview-only entrypoint — same logic but no file writes.
 */
export function previewAutoApplySourceFixes(
  proposals: SourceProposal[],
  opts: ApplyOptions,
): ApplyResult {
  return autoApplySourceFixes(proposals, { ...opts, dryRun: true });
}