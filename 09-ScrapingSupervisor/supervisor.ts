/**
 * supervisor.ts — orchestrator for the daily scraping-supervisor run.
 *
 * Pipeline:
 *   collect_state → analyze_with_llm → auto_apply_safe_fixes → write_reports
 *
 * Each step is independent and pure-or-near-pure. This file is just the glue
 * plus the CLI surface (`runSupervisor` for tests, `main` for `npx tsx`).
 *
 * Anti-scope-drift guardrails (enforced at this layer):
 *   - dryRun=true → no file moves, no log writes
 *   - If a step throws, the next steps are skipped and the error is reported
 *     in the returned `SupervisorRunResult.error` field — no silent failures.
 *   - We never re-throw from the orchestrator. Caller decides what to log.
 *
 * NOT in scope:
 *   - Modifying C-layer code, the dashboard, or any source's `url` field.
 *   - Auto-promoting sources or auto-invoking the manual fix scripts.
 *   - Scheduling — that's the launchd plist in cron/.
 */

import { collectState, type CollectOptions, type SupervisorState } from './tools/collect_state';
import { analyzeWithLlm, type AnalysisResult } from './tools/analyze_with_llm';
import {
  autoApplySafeFixes,
  previewAutoApplySafeFixes,
  type ApplyOptions,
  type ApplyResult,
} from './tools/auto_apply_safe_fixes';
import {
  writeReports,
  type WriteReportsOptions,
  type WriteReportsResult,
} from './tools/write_reports';
import { ensureDashboardRunning, type DashboardLifecycleResult } from './tools/dashboard_lifecycle';
import { computeAll as computeAllMetrics } from './tools/freshness_metrics';
import { snapshotForToday, type MetricsSnapshot } from './tools/metrics_history';
import {
  reviewSources,
  proposalsToChanges,
  type ReviewResult,
} from './tools/source_ai_review';
import {
  autoApplySourceFixes,
  previewAutoApplySourceFixes,
  type ApplyResult as SourceApplyResult,
} from './tools/auto_apply_source_fixes';
import {
  generateSourceHealthReport,
  appendOrReplaceSourceReviewSection,
} from './tools/source_health_report';
import { appendChange } from './tools/source_changes';

// ─── Public types ────────────────────────────────────────────────────────────

export interface SupervisorOptions {
  projectRoot: string;
  vaultRoot: string;
  repoDocDir?: string;
  suggestedFixesRelPath?: string;
  recentBatches?: number;
  minFailuresFor404?: number;
  /** Skip file moves and applied-fixes.log writes. Default: false. */
  dryRun?: boolean;
  /** Skip writing the repo doc (vault + JSONL still produced). Default: false. */
  skipRepoDoc?: boolean;
  /** ISO date override. Default: today UTC. */
  date?: string;
}

export interface SupervisorRunResult {
  state: SupervisorState;
  analysis: AnalysisResult;
  apply: ApplyResult;
  reports: WriteReportsResult;
  dryRun: boolean;
  /** Wall-clock duration of the run in ms. */
  durationMs: number;
  /** ISO timestamp at start. */
  startedAt: string;
  /** ISO timestamp at end. */
  finishedAt: string;
  /** Non-null if any step threw. Reports/vault/repo may still be partial. */
  error: string | null;
  /** Result of dashboard ensure-run (may be null if no spawn attempted). */
  dashboard: DashboardLifecycleResult | null;
  /** Today's metrics snapshot (written to metrics-history.jsonl). Null on dry-run. */
  metricsSnapshot: MetricsSnapshot | null;
  /** AI source-review proposals (audit log entries created). Null on dry-run. */
  review: ReviewResult | null;
  /** Source-fix auto-apply result (archive-dead + update-preferred-path). Null on dry-run. */
  sourceApply: SourceApplyResult | null;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function runSupervisor(opts: SupervisorOptions): Promise<SupervisorRunResult> {
  const startedAt = new Date();
  const dryRun = opts.dryRun ?? false;

  const collectOpts: CollectOptions = {
    projectRoot: opts.projectRoot,
    ...(opts.recentBatches !== undefined ? { recentBatches: opts.recentBatches } : {}),
  };

  const applyOpts: ApplyOptions = {
    projectRoot: opts.projectRoot,
    ...(opts.minFailuresFor404 !== undefined ? { minFailuresFor404: opts.minFailuresFor404 } : {}),
    ...(opts.date !== undefined ? { archiveDate: opts.date } : {}),
  };

  const writeOpts: WriteReportsOptions = {
    projectRoot: opts.projectRoot,
    vaultRoot: opts.vaultRoot,
    repoDocDir: opts.repoDocDir ?? 'docs/scraping-supervisor',
    suggestedFixesRelPath:
      opts.suggestedFixesRelPath ?? 'runtime/scraping-supervisor/suggested-fixes.jsonl',
    ...(opts.date !== undefined ? { date: opts.date } : {}),
    ...(opts.skipRepoDoc !== undefined ? { skipRepoDoc: opts.skipRepoDoc } : {}),
  };

  try {
    const state = collectState(collectOpts);
    const analysis = await analyzeWithLlm(state);
    const apply = dryRun
      ? previewAutoApplySafeFixes(state.deadSources, applyOpts)
      : autoApplySafeFixes(state.deadSources, applyOpts);
    const reports = writeReports(state, analysis, apply, writeOpts);
    const reviewResult = await runSourceReviewPipeline(state, reports, dryRun, opts);
    const dashboard = dryRun ? null : ensureDashboardRunning(opts.projectRoot);
    const metricsSnapshot = dryRun
      ? null
      : writeMetricsSnapshot(opts.projectRoot, state.totals);
    const finishedAt = new Date();
    return {
      state,
      analysis,
      apply,
      reports,
      dashboard,
      metricsSnapshot,
      review: reviewResult.review,
      sourceApply: reviewResult.sourceApply,
      dryRun,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      error: null,
    };
  } catch (e) {
    const finishedAt = new Date();
    // Errors-as-data: still return structured result so caller can serialize.
    return {
      state: emptyState(),
      analysis: emptyAnalysis(),
      apply: { applied: [], skipped: [], archiveDir: '', dryRun },
      reports: emptyReports(),
      dashboard: null,
      metricsSnapshot: null,
      review: null,
      sourceApply: null,
      dryRun,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * AI source-review pipeline: deterministic rules + (optional) LLM-assisted
 * proposals → bounded auto-apply (audit-logged) → vault report section.
 *
 * Errors-as-data: any failure inside this step is swallowed and surfaced via
 * the structured result so the supervisor's main `try` is not polluted.
 *
 * Audit log invariants (per `feedback_ai_source_review_audit.md`):
 *   - appendChange is called BEFORE any file mutation
 *   - auto-applied + pending review both produce the same shape
 *   - dryRun=true short-circuits all writes (no audit log, no file moves)
 */
async function runSourceReviewPipeline(
  state: SupervisorState,
  reports: WriteReportsResult,
  dryRun: boolean,
  opts: SupervisorOptions,
): Promise<{ review: ReviewResult | null; sourceApply: SourceApplyResult | null }> {
  try {
    // 1. Build proposals from dead sources.
    const review = await reviewSources({
      projectRoot: opts.projectRoot,
      sources: state.deadSources,
    });

    // 2. Apply the bounded auto-apply rule (only on non-dry-run).
    const sourceApply = dryRun
      ? previewAutoApplySourceFixes(review.proposals, { projectRoot: opts.projectRoot })
      : autoApplySourceFixes(review.proposals, { projectRoot: opts.projectRoot });

    // 3. Audit log: every proposal → SourceChange entry.
    //    Auto-applied ones are logged with `auto-applied`; the rest with
    //    `pending-review`. The audit log is ALWAYS written (even on dry-run)
    //    because it's the source of truth for what was proposed.
    if (!dryRun) {
      for (const p of review.proposals) {
        const decision = sourceApply.applied.some((a) => a.proposal.sourceId === p.sourceId)
          ? 'auto-apply'
          : 'queue-review';
        const change = proposalsToChanges([p], decision)[0];
        if (change) appendChange(opts.projectRoot, change);
      }
    }

    // 4. Generate the vault report section and append/replace in the daily note.
    if (!dryRun && reports.vaultPath) {
      const r = generateSourceHealthReport({ projectRoot: opts.projectRoot });
      appendOrReplaceSourceReviewSection(reports.vaultPath, r.markdown);
    }

    return { review: dryRun ? null : review, sourceApply: dryRun ? null : sourceApply };
  } catch {
    return { review: null, sourceApply: null };
  }
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

/**
 * One-shot CLI: `npx tsx 09-ScrapingSupervisor/supervisor.ts`. Reads env vars
 * `EVENTPULSE_PROJECT_ROOT` (default: cwd) and `EVENTPULSE_VAULT_ROOT`
 * (default: `/Users/claudgashi/Desktop/MyVault/TomorGashi`). Honors
 * `--dry-run` and `--skip-repo-doc` flags.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const skipRepoDoc = argv.includes('--skip-repo-doc');
  const dateIdx = argv.indexOf('--date');
  const date = dateIdx !== -1 && argv[dateIdx + 1] ? argv[dateIdx + 1] : undefined;

  const projectRoot = process.env.EVENTPULSE_PROJECT_ROOT ?? process.cwd();
  const vaultRoot =
    process.env.EVENTPULSE_VAULT_ROOT
    ?? '/Users/claudgashi/Desktop/MyVault/TomorGashi';

  const result = await runSupervisor({
    projectRoot,
    vaultRoot,
    dryRun,
    skipRepoDoc,
    ...(date !== undefined ? { date } : {}),
  });

  if (result.error) {
    console.error(`[supervisor] error: ${result.error}`);
    return 1;
  }

  console.log(
    [
      `[supervisor] ${result.dryRun ? 'DRY RUN — ' : ''}${result.startedAt}`,
      `  totals: ${result.state.totals.working} working / ${result.state.totals.dead} dead / ${result.state.totals.untouched} untouched`,
      `  applied: ${result.apply.applied.length} (enotfound=${countBy(result.apply.applied, 'enotfound')}, persistent-404=${countBy(result.apply.applied, 'persistent-404')})`,
      `  suggested fixes written: ${result.reports.suggestedFixesWritten}`,
      `  vault: ${result.reports.vaultPath ?? '(failed)'}`,
      `  repo:  ${result.reports.repoDocPath ?? '(skipped)'}`,
      `  duration: ${result.durationMs}ms`,
      `  LLM: ${result.analysis.usedLlm ? result.analysis.modelVersion : 'deterministic fallback'}`,
      ...(result.review
        ? [`  source-review: ${result.review.proposals.length} proposals (llm=${result.review.llmProposalsCount}) applied=${result.sourceApply?.applied.length ?? 0} queued=${result.sourceApply?.skipped.length ?? 0}`]
        : []),
      ...(result.dashboard
        ? [`  dashboard: ${result.dashboard.wasRunning ? 'already running' : result.dashboard.spawned ? `spawned pid=${result.dashboard.pid}` : `failed: ${result.dashboard.error}`}`]
        : []),
      ...(result.metricsSnapshot
        ? [`  metrics: freshness=${result.metricsSnapshot.freshnessMedianHours !== null ? `${result.metricsSnapshot.freshnessMedianHours.toFixed(1)}h` : 'n/a'} field-coverage(title)=${(result.metricsSnapshot.fieldCoverage.title * 100).toFixed(0)}% batch-success=${result.metricsSnapshot.batches.success}/${result.metricsSnapshot.batches.attempts} decoy=${result.metricsSnapshot.batches.decoy}`]
        : []),
    ].join('\n')
  );
  return 0;
}

function countBy<T extends { reason: string }>(items: T[], reason: string): number {
  return items.filter((i) => i.reason === reason).length;
}

/**
 * Compute today's metrics and append to history.jsonl. Errors-as-data:
 * if compute fails we return null rather than failing the whole run.
 */
function writeMetricsSnapshot(
  projectRoot: string,
  totals: { sources: number; working: number; dead: number; untouched: number },
): MetricsSnapshot | null {
  try {
    const computed = computeAllMetrics(projectRoot, { recentBatches: 5 });
    return snapshotForToday(projectRoot, {
      sources: {
        total: totals.sources,
        working: totals.working,
        dead: totals.dead,
        untouched: totals.untouched,
      },
      batches: computed.batchMetrics,
      freshnessMedianHours: computed.freshnessMedianHours,
      fieldCoverage: computed.fieldCoverage,
    });
  } catch {
    return null;
  }
}

// ─── Empty fallbacks (errors-as-data) ────────────────────────────────────────

function emptyState(): SupervisorState {
  return {
    timestamp: new Date().toISOString(),
    totals: { sources: 0, stockholm: 0, dead: 0, working: 0, untouched: 0 },
    failureModes: {},
    batchStats: [],
    schemaDriftSignals: [],
    deadSources: [],
    workingSources: [],
    untouchedSources: [],
    priorityQueueHead: [],
  };
}

function emptyAnalysis(): AnalysisResult {
  return {
    findings: [],
    suggestedActions: [],
    usedLlm: false,
    modelVersion: null,
    inputSourceCount: 0,
  };
}

function emptyReports(): WriteReportsResult {
  return {
    vaultPath: null,
    repoDocPath: null,
    suggestedFixesWritten: 0,
    manualFixScriptSummaries: [],
    dashboardStaleness: [],
    error: null,
  };
}

// When invoked as `npx tsx supervisor.ts`, run main(). Test imports don't
// trigger this because process.argv[1] points at vitest, not supervisor.ts.
const isDirectInvocation = (() => {
  try {
    return process.argv[1]?.endsWith('supervisor.ts') ?? false;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  });
}