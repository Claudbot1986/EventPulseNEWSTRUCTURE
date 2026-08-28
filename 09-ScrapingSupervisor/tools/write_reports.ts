/**
 * write_reports — three downstream artifacts from one supervisor run.
 *
 * Per `43-Scraping-Tools-Survey-2026-08-19.md`:
 *   1. Vault note (rich): 01-Projects/EventPulse/02-Operations/scraping-supervisor/YYYY-MM-DD.md
 *      - Full breakdown: totals, applied, suggested, schema-drift signals,
 *        top dead/untouched, batch success rates, manual-fix-script summary,
 *        dashboard staleness.
 *      - Marks every claim with [VERIFIED] / [CLAIMED] / [UNVERIFIED] per
 *        vault discipline.
 *   2. Repo doc (concise): docs/scraping-supervisor/YYYY-MM-DD.md
 *      - Totals + applied fixes + top 3 suggested + dashboard issues only.
 *      - One-page read for engineers on the project.
 *   3. Suggested-fixes queue (append-only): runtime/scraping-supervisor/suggested-fixes.jsonl
 *      - One JSON per suggested action. Idempotent re-runs do NOT
 *        duplicate entries (de-duplicated by {date,sourceId,kind}).
 *
 * Anti-scope-drift:
 *   - We never modify C-layer code.
 *   - We never auto-promote a source.
 *   - We never modify the dashboard.
 *   - We never invoke the four manual fix scripts.
 *
 * Failure modes:
 *   - Vault root missing → return error field in WriteReportsResult, do not throw.
 *   - Repo doc dir missing → mkdir -p, then write.
 *   - Manual fix log dir missing → return empty array for that summary.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { SupervisorState } from './collect_state';
import type { AnalysisResult, SuggestedAction } from './analyze_with_llm';
import type { ApplyResult } from './auto_apply_safe_fixes';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ManualFixScriptSummary {
  script: string;
  runsLast7Days: number;
  recoveriesLast7Days: number;
  recoveryRate: number | null;
  lastRunAt: string | null;
}

export interface DashboardStalenessItem {
  dashboardTool: string;
  dashboardLine: string;
  reality: 'exists' | 'wrong-name' | 'missing';
  actualPath: string | null;
}

export interface WriteReportsOptions {
  projectRoot: string;
  vaultRoot: string;
  repoDocDir: string;
  suggestedFixesRelPath: string;
  date?: string;
  skipRepoDoc?: boolean;
}

export interface WriteReportsResult {
  vaultPath: string | null;
  repoDocPath: string | null;
  suggestedFixesWritten: number;
  manualFixScriptSummaries: ManualFixScriptSummary[];
  dashboardStaleness: DashboardStalenessItem[];
  error: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VAULT_RELPATH = '01-Projects/EventPulse/02-Operations/scraping-supervisor';

const MANUAL_FIX_SCRIPTS = [
  'gl-fix-404.py',
  'gl-fix-500.py',
  'scb-404-AI.py',
  'scb-500-AI.py',
] as const;

const DASHBOARD_STALENESS_TABLE: DashboardStalenessItem[] = [
  {
    dashboardTool: 'Tool 7',
    dashboardLine: 'python3 runtime/validate-patterns.py',
    reality: 'missing',
    actualPath: null,
  },
  {
    dashboardTool: 'Tool 9',
    dashboardLine: 'F-eventExtraction/run-minimax.ts',
    reality: 'missing',
    actualPath: null,
  },
  {
    dashboardTool: 'Tool 10',
    dashboardLine: 'C-htmlGate/C4-observer.ts',
    reality: 'wrong-name',
    actualPath: '02-Ingestion/C-htmlGate/C4-ai-analysis.ts',
  },
];

// ─── Pure formatters (exported for tests) ────────────────────────────────────

function evidenceMarker(usedLlm: boolean, sourceIds: string[]): string {
  if (!usedLlm) return '[VERIFIED]';
  if (sourceIds.length === 0) return '[UNVERIFIED]';
  return '[CLAIMED]';
}

function formatSeverity(s: 'low' | 'medium' | 'high'): string {
  return s.toUpperCase();
}

function summarizeReason(apply: ApplyResult, reason: 'enotfound' | 'persistent-404'): number {
  return apply.applied.filter((a) => a.reason === reason).length;
}

function formatFindingsSection(
  analysis: AnalysisResult,
  appliedSourceIds: ReadonlySet<string>
): string {
  if (analysis.findings.length === 0) {
    return '_No findings._\n';
  }
  const lines: string[] = [];
  for (const f of analysis.findings) {
    const tag = evidenceMarker(analysis.usedLlm, f.sourceIds);
    const appliedMarker =
      f.sourceIds.some((id) => appliedSourceIds.has(id)) ? ' _(some already applied today)_' : '';
    const sourcesStr =
      f.sourceIds.length === 0
        ? '_none_'
        : f.sourceIds.slice(0, 5).join(', ') + (f.sourceIds.length > 5 ? ` (+${f.sourceIds.length - 5} more)` : '');
    lines.push(
      `- **[${formatSeverity(f.severity)}] ${f.kind}** ${tag} — ${f.summary}${appliedMarker}\n` +
        `  - Evidence: ${f.evidence}\n` +
        `  - Sources: ${sourcesStr}\n`
    );
  }
  return lines.join('\n');
}

function formatActionsSection(actions: SuggestedAction[]): string {
  if (actions.length === 0) return '_No actions._\n';
  const lines: string[] = [];
  for (const a of actions) {
    lines.push(`- **${a.kind}** (${formatSeverity(a.riskLevel)}) → \`${a.target}\`\n  - ${a.rationale}\n`);
  }
  return lines.join('\n');
}

function formatAppliedSection(apply: ApplyResult): string {
  if (apply.applied.length === 0) {
    return '_No sources archived today._\n';
  }
  const lines: string[] = [];
  for (const a of apply.applied) {
    lines.push(
      `- **${a.sourceId}** (${a.reason}, cf=${a.consecutiveFailures}) → \`${a.movedTo.replace(/^.*\/sources\//, 'sources/')}\``
    );
  }
  return lines.join('\n') + '\n';
}

function formatBatchStatsTable(state: SupervisorState): string {
  if (state.batchStats.length === 0) return '_No batch stats available._\n';
  const rows = ['| Batch | Success rate | Avg events found |', '|-------|--------------|------------------|'];
  for (const b of state.batchStats.slice(0, 10)) {
    rows.push(`| ${b.batch} | ${(b.successRate * 100).toFixed(0)}% | ${b.avgEventsFound.toFixed(1)} |`);
  }
  return rows.join('\n') + '\n';
}

function formatScriptSummariesTable(summaries: ManualFixScriptSummary[]): string {
  if (summaries.length === 0) return '_No manual fix script logs found in `runtime/logs/`._\n';
  const rows = ['| Script | Runs (7d) | Recoveries (7d) | Rate | Last run |', '|--------|-----------|-----------------|------|----------|'];
  for (const s of summaries) {
    const rate = s.recoveryRate === null ? '—' : `${(s.recoveryRate * 100).toFixed(0)}%`;
    const lastRun = s.lastRunAt === null ? '—' : s.lastRunAt.slice(0, 16).replace('T', ' ');
    rows.push(`| \`${s.script}\` | ${s.runsLast7Days} | ${s.recoveriesLast7Days} | ${rate} | ${lastRun} |`);
  }
  return rows.join('\n') + '\n';
}

function formatStalenessTable(items: DashboardStalenessItem[]): string {
  if (items.length === 0) return '_Dashboard references match reality._\n';
  const rows = ['| Tool | Dashboard line | Reality | Actual path |', '|------|----------------|---------|-------------|'];
  for (const i of items) {
    const actual = i.actualPath === null ? '—' : `\`${i.actualPath}\``;
    rows.push(`| ${i.dashboardTool} | \`${i.dashboardLine}\` | **${i.reality}** | ${actual} |`);
  }
  return rows.join('\n') + '\n';
}

// ─── Exported pure formatters ────────────────────────────────────────────────

export function formatVaultNote(args: {
  date: string;
  state: SupervisorState;
  analysis: AnalysisResult;
  apply: ApplyResult;
  scriptSummaries: ManualFixScriptSummary[];
  staleness: DashboardStalenessItem[];
}): string {
  const { date, state, analysis, apply, scriptSummaries, staleness } = args;
  const appliedIds = new Set(apply.applied.map((a) => a.sourceId));
  const llmTag = analysis.usedLlm
    ? `[CLAIMED] LLM (${analysis.modelVersion})`
    : '[VERIFIED] Deterministic fallback';

  return `# Scraping Supervisor Daily Report — ${date}

${llmTag}. Generated by \`09-ScrapingSupervisor/supervisor.ts\`.

## Summary

| Metric | Count |
|--------|-------|
| Total sources | ${state.totals.sources} |
| Stockholm sources | ${state.totals.stockholm} |
| Working | ${state.totals.working} |
| Dead | ${state.totals.dead} |
| Untouched | ${state.totals.untouched} |
| Applied today | ${apply.applied.length} (enotfound=${summarizeReason(apply, 'enotfound')}, persistent-404=${summarizeReason(apply, 'persistent-404')}) |
| Suggested fixes | ${analysis.suggestedActions.length} |

## Findings

${formatFindingsSection(analysis, appliedIds)}

## Suggested actions

${formatActionsSection(analysis.suggestedActions)}

## Applied fixes today

${formatAppliedSection(apply)}

## Schema drift signals (multi-site)

${
  state.schemaDriftSignals.length === 0
    ? '_No schema drift signals (no exitReason repeated 3+ times across batches)._\n'
    : state.schemaDriftSignals
        .slice(0, 5)
        .map((sig) => `- **${sig.exitReason}** — ${sig.count} sources affected`)
        .join('\n') + '\n'
}

## Top dead sources (by consecutiveFailures)

${
  state.deadSources.length === 0
    ? '_None._\n'
    : state.deadSources
        .slice(0, 10)
        .map(
          (s) =>
            `- \`${s.sourceId}\` cf=${s.consecutiveFailures} reason=${s.lastRoutingReason ?? '—'} lastPath=${s.lastPathUsed ?? '—'}`
        )
        .join('\n') + '\n'
}

## Top untouched sources (by consecutiveFailures)

${
  state.untouchedSources.length === 0
    ? '_None._\n'
    : state.untouchedSources
        .slice(0, 10)
        .map((s) => `- \`${s.sourceId}\` cf=${s.consecutiveFailures} reason=${s.lastRoutingReason ?? '—'}`)
        .join('\n') + '\n'
}

## Batch success rate (last 10 batches)

${formatBatchStatsTable(state)}

## Manual fix script performance (last 7 days)

${formatScriptSummariesTable(scriptSummaries)}

## Dashboard staleness

${formatStalenessTable(staleness)}

## Confidence

- [VERIFIED] totals, applied-fixes — derived directly from \`runtime/sources_status.jsonl\` and batch-traces via \`collect_state\`.
- [CLAIMED] LLM-generated findings — sourceIds are intersected against the real input set (anti-hallucination).
- [VERIFIED] Dashboard staleness — fixed table from \`write_reports.ts:DASHBOARD_STALENESS_TABLE\`.
- [CLAIMED] Manual fix script recoveries — counted from \`runtime/logs/{script}-*.log\` when present, omitted otherwise.
`;
}

export function formatRepoDoc(args: {
  date: string;
  state: SupervisorState;
  analysis: AnalysisResult;
  apply: ApplyResult;
  staleness: DashboardStalenessItem[];
}): string {
  const { date, state, analysis, apply, staleness } = args;
  const top3 = analysis.suggestedActions.slice(0, 3);

  return `# Scraping Supervisor — ${date}

## Totals

${state.totals.working} working / ${state.totals.dead} dead / ${state.totals.untouched} untouched (out of ${state.totals.sources}).

## Applied today

- ${summarizeReason(apply, 'enotfound')} ENOTFOUND sources → \`sources/_archive/dead-${date}/\`
- ${summarizeReason(apply, 'persistent-404')} persistent-404 sources → \`sources/_archive/dead-${date}/\`

## Top suggested fixes

${
  top3.length === 0
    ? '_No suggestions._\n'
    : top3
        .map((a, i) => `${i + 1}. **${a.kind}** (${a.riskLevel}) → \`${a.target}\`\n   - ${a.rationale}`)
        .join('\n') + '\n'
}

## Dashboard issues

${
  staleness.length === 0
    ? '_None._\n'
    : staleness
        .map((s) => `- ${s.dashboardTool}: \`${s.dashboardLine}\` — **${s.reality}**${s.actualPath ? ` (actual: \`${s.actualPath}\`)` : ''}`)
        .join('\n') + '\n'
}

## LLM

Used: ${analysis.usedLlm ? `yes (${analysis.modelVersion})` : 'no (deterministic fallback)'}.
`;
}

// ─── IO helpers ──────────────────────────────────────────────────────────────

export function buildSuggestedFixEntries(
  date: string,
  actions: SuggestedAction[]
): Array<Record<string, unknown>> {
  return actions.map((a) => ({
    date,
    sourceId: a.target,
    kind: a.kind,
    target: a.target,
    rationale: a.rationale,
    riskLevel: a.riskLevel,
    recordedAt: new Date().toISOString(),
  }));
}

export function appendSuggestedFixes(
  queuePath: string,
  entries: ReadonlyArray<Record<string, unknown>>
): number {
  mkdirSync(dirname(queuePath), { recursive: true });

  const existing = new Set<string>();
  if (existsSync(queuePath)) {
    for (const line of readFileSync(queuePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const key = `${obj.date}|${obj.sourceId}|${obj.kind}`;
        existing.add(key);
      } catch {
        // skip malformed
      }
    }
  }

  let written = 0;
  for (const entry of entries) {
    const key = `${entry.date}|${entry.sourceId}|${entry.kind}`;
    if (existing.has(key)) continue;
    appendFileSync(queuePath, JSON.stringify(entry) + '\n', 'utf-8');
    existing.add(key);
    written++;
  }
  return written;
}

export function summarizeManualFixScripts(
  projectRoot: string,
  logsRelDir: string = 'runtime/logs',
  now: Date = new Date()
): ManualFixScriptSummary[] {
  const logsDir = resolve(projectRoot, logsRelDir);
  if (!existsSync(logsDir)) return [];

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const out: ManualFixScriptSummary[] = [];
  for (const script of MANUAL_FIX_SCRIPTS) {
    let runs = 0;
    let recoveries = 0;
    let lastMtimeMs = 0;
    let lastRunAt: string | null = null;

    let entries: string[] = [];
    try {
      entries = readdirSync(logsDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      // Match by basename without the .py suffix — log files look like
      // `gl-fix-404-2026-08-19.log`, `gl-fix-404.py-2026-08-19.log`, etc.
      const scriptBase = script.replace(/\.py$/, '');
      if (!entry.includes(scriptBase)) continue;
      const dateMatch = entry.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch || dateMatch[1] < cutoff) continue;

      const fullPath = resolve(logsDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      runs++;
      if (stat.mtimeMs > lastMtimeMs) {
        lastMtimeMs = stat.mtimeMs;
        lastRunAt = stat.mtime.toISOString();
      }

      try {
        const text = readFileSync(fullPath, 'utf-8');
        for (const line of text.split('\n')) {
          if (/\bRecovered\b/.test(line)) recoveries++;
          else if (/\bOK\b/.test(line) && !/not ok/i.test(line)) recoveries++;
          else if (/^✓/.test(line.trim())) recoveries++;
        }
      } catch {
        // skip malformed
      }
    }

    out.push({
      script,
      runsLast7Days: runs,
      recoveriesLast7Days: recoveries,
      recoveryRate: runs === 0 ? null : recoveries / runs,
      lastRunAt,
    });
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function writeReports(
  state: SupervisorState,
  analysis: AnalysisResult,
  apply: ApplyResult,
  opts: WriteReportsOptions
): WriteReportsResult {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  const vaultDir = resolve(opts.vaultRoot, VAULT_RELPATH);
  const vaultPath = resolve(vaultDir, `${date}.md`);

  const repoDocPath = opts.skipRepoDoc
    ? null
    : resolve(opts.projectRoot, opts.repoDocDir, `${date}.md`);

  const suggestedFixesPath = resolve(opts.projectRoot, opts.suggestedFixesRelPath);

  let vaultErr: string | null = null;

  try {
    mkdirSync(vaultDir, { recursive: true });
    const scriptSummaries = summarizeManualFixScripts(opts.projectRoot);
    const vaultBody = formatVaultNote({
      date,
      state,
      analysis,
      apply,
      scriptSummaries,
      staleness: DASHBOARD_STALENESS_TABLE,
    });
    writeFileSync(vaultPath, vaultBody, 'utf-8');
  } catch (e) {
    vaultErr = e instanceof Error ? e.message : String(e);
  }

  if (repoDocPath !== null) {
    try {
      mkdirSync(dirname(repoDocPath), { recursive: true });
      const repoBody = formatRepoDoc({
        date,
        state,
        analysis,
        apply,
        staleness: DASHBOARD_STALENESS_TABLE,
      });
      writeFileSync(repoDocPath, repoBody, 'utf-8');
    } catch {
      // Repo doc failures are non-fatal — keep the vault note.
    }
  }

  const entries = buildSuggestedFixEntries(date, analysis.suggestedActions);
  const written = appendSuggestedFixes(suggestedFixesPath, entries);

  return {
    vaultPath: vaultErr === null ? vaultPath : null,
    repoDocPath,
    suggestedFixesWritten: written,
    manualFixScriptSummaries: summarizeManualFixScripts(opts.projectRoot),
    dashboardStaleness: DASHBOARD_STALENESS_TABLE,
    error: vaultErr,
  };
}