/**
 * source_health_report.ts — generate a vault-ready summary of source-review activity.
 *
 * The supervisor calls this once per day and embeds the output as a section
 * in the daily vault note (`02-Operations/scraping-supervisor/YYYY-MM-DD.md`).
 *
 * Sections produced (synthetic, redacted):
 *
 *   ## Source Review (AI)
 *
 *   ### Today's activity
 *   - 8 proposals emitted, 3 auto-applied, 5 queued for human review.
 *   - By action: archive-dead=3, mark-review-needed=4, update-preferred-path=1
 *   - By confidence: high=4, medium=4, low=0
 *
 *   ### Pending human review queue
 *   | sourceId | action | confidence | rationale (truncated) |
 *   | bar      | mark-review-needed | medium | Redirect loop persists (cf=15)... |
 *
 *   ### Outcome tracking (changes from the last 14 days)
 *   | sourceId | action | since | cf_after | events_after | status_after |
 *   | foo      | archive-dead | 7d   |   -    |   -    | archived |
 *
 *   ### Pattern signal
 *   Top failure reasons unchanged for 7d:
 *     - "toolA(preA): no-jsonld-or-no-events" (287 sources)
 *     - "toolA(preA): Fetch failed: getaddrinfo ENOTFOUND" (63 sources)
 *
 * Anti-hallucination: numbers are read directly from the audit log
 * (`readChanges`) and from `runtime/sources_status.jsonl`. We never
 * invent counts.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  readChanges,
  statsFor,
  type SourceChange,
} from './source_changes';

export interface ReportOptions {
  projectRoot: string;
  /** ISO date — the report's "today". Defaults to today UTC. */
  date?: string;
  /** Look-back window for outcome tracking. Default 14 days. */
  outcomeWindowDays?: number;
  /** Max entries shown in pending-review table. Default 20. */
  maxPendingShown?: number;
  /** Max entries shown in outcome table. Default 15. */
  maxOutcomeShown?: number;
}

export interface ReportResult {
  markdown: string;
  appliedCount: number;
  pendingCount: number;
  byAction: Record<string, number>;
}

interface StatusRow {
  sourceId: string;
  status?: string;
  consecutiveFailures?: number;
  lastEventsFound?: number;
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readStatusRows(projectRoot: string): StatusRow[] {
  const path = join(projectRoot, 'runtime/sources_status.jsonl');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return [];
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as StatusRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is StatusRow => r !== null);
}

function buildStatusIndex(rows: StatusRow[]): Map<string, StatusRow> {
  const m = new Map<string, StatusRow>();
  for (const r of rows) {
    if (typeof r.sourceId === 'string') m.set(r.sourceId, r);
  }
  return m;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Produce the markdown section. Caller appends it to the daily vault note.
 */
export function generateSourceHealthReport(opts: ReportOptions): ReportResult {
  const date = opts.date ?? isoDate();
  const outcomeWindow = opts.outcomeWindowDays ?? 14;
  const maxPending = opts.maxPendingShown ?? 20;
  const maxOutcome = opts.maxOutcomeShown ?? 15;

  const todaysChanges = readChanges(opts.projectRoot, { since: date, until: date });
  const recentChanges = readChanges(opts.projectRoot, {
    until: date,
  }).filter((c) => Math.abs(daysBetween(date, c.date)) <= outcomeWindow);

  const pending = recentChanges.filter((c) => c.reviewStatus === 'pending-review');
  const stats = statsFor(todaysChanges);

  const statusRows = readStatusRows(opts.projectRoot);
  const statusById = buildStatusIndex(statusRows);

  const outcomeRows: Array<{
    sourceId: string;
    action: string;
    daysSince: number;
    cfAfter: string;
    eventsAfter: string;
    statusAfter: string;
  }> = [];
  for (const c of [...recentChanges]
    .filter((c) => c.action !== 'mark-review-needed' && c.action !== 'mark-untouched')
    .sort((a, b) => a.date.localeCompare(b.date))
    .reverse()) {
    const row = statusById.get(c.sourceId);
    outcomeRows.push({
      sourceId: c.sourceId,
      action: c.action,
      daysSince: Math.abs(daysBetween(date, c.date)),
      cfAfter: row?.consecutiveFailures !== undefined ? String(row.consecutiveFailures) : '—',
      eventsAfter: row?.lastEventsFound !== undefined ? String(row.lastEventsFound) : '—',
      statusAfter: row?.status ?? (c.action === 'archive-dead' ? 'archived' : '—'),
    });
    if (outcomeRows.length >= maxOutcome) break;
  }

  const lines: string[] = [];
  lines.push(`## Source Review (AI)`);
  lines.push('');
  lines.push(`### Today's activity`);
  lines.push(
    `- **${todaysChanges.length}** proposals emitted — ` +
      `**${stats.byReviewStatus['auto-applied']}** auto-applied, ` +
      `**${stats.byReviewStatus['pending-review']}** queued for human review.`,
  );
  const actionCounts = Object.entries(stats.byAction)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${a}=${n}`)
    .join(', ');
  if (actionCounts) lines.push(`- By action: ${actionCounts}`);
  const confCounts = Object.entries(stats.byConfidence)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${c}=${n}`)
    .join(', ');
  if (confCounts) lines.push(`- By confidence: ${confCounts}`);
  lines.push('');

  if (pending.length > 0) {
    lines.push(`### Pending human review (${pending.length} total)`);
    lines.push('');
    lines.push('| sourceId | action | confidence | rationale |');
    lines.push('|---|---|---|---|');
    const shown = pending.slice(-maxPending);
    for (const c of shown) {
      lines.push(
        `| \`${escapeCell(c.sourceId)}\` | ${escapeCell(c.action)} | ${escapeCell(c.confidence)} | ${escapeCell(truncate(c.rationale, 80))} |`,
      );
    }
    if (pending.length > maxPending) {
      lines.push(`| _…${pending.length - maxPending} more_ | | | |`);
    }
    lines.push('');
  } else if (todaysChanges.length > 0) {
    lines.push(`### Pending human review`);
    lines.push('');
    lines.push('_None._');
    lines.push('');
  }

  if (outcomeRows.length > 0) {
    lines.push(`### Outcome tracking (changes from last ${outcomeWindow} days)`);
    lines.push('');
    lines.push('| sourceId | action | since | cf_after | events_after | status_after |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of outcomeRows) {
      lines.push(
        `| \`${escapeCell(r.sourceId)}\` | ${escapeCell(r.action)} | ${r.daysSince}d | ${r.cfAfter} | ${r.eventsAfter} | ${escapeCell(r.statusAfter)} |`,
      );
    }
    lines.push('');
  }

  const failCounts = new Map<string, number>();
  for (const r of statusRows) {
    if (r.status === 'fail') {
      failCounts.set('fail', (failCounts.get('fail') ?? 0) + 1);
    }
  }
  if (failCounts.size > 0) {
    lines.push(`### Pattern signal`);
    lines.push('');
    lines.push(
      `- ${failCounts.get('fail') ?? 0} sources currently in \`status: fail\`. See vault note top section for top reasons.`,
    );
    lines.push('');
  }

  return {
    markdown: lines.join('\n'),
    appliedCount: stats.byReviewStatus['auto-applied'],
    pendingCount: pending.length,
    byAction: stats.byAction as Record<string, number>,
  };
}

/**
 * Append the report to the daily vault note. Idempotent at the section level:
 * replaces any existing `## Source Review (AI)` section with the new one.
 */
export function appendOrReplaceSourceReviewSection(
  vaultNotePath: string,
  markdown: string,
): void {
  if (!existsSync(vaultNotePath)) return;
  const text = readFileSync(vaultNotePath, 'utf-8');
  const marker = '## Source Review (AI)';
  const idx = text.indexOf(marker);
  let next: string;
  if (idx === -1) {
    next = text.trimEnd() + '\n\n' + markdown + '\n';
  } else {
    next = text.slice(0, idx).trimEnd() + '\n\n' + markdown + '\n';
  }
  writeFileSync(vaultNotePath, next);
}

export type { SourceChange };