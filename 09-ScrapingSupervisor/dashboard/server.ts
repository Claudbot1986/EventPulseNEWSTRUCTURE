/**
 * Scraping Supervisor Dashboard — tiny HTTP server on port 7777.
 *
 * Serves a static HTML page that auto-refreshes, plus a /api/status JSON
 * endpoint the page can poll. Reads the same runtime/ files the supervisor
 * writes — no parallel state, no cache.
 *
 * Run: `npx tsx 09-ScrapingSupervisor/dashboard/server.ts`
 * Env: PORT (default 7777), EVENTPULSE_PROJECT_ROOT (default cwd)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, appendFileSync, writeFileSync, renameSync, openSync, closeSync } from 'fs';
import { spawn, execFile, execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  computeFreshnessMedianHours,
  computeFieldCoverage,
  computeBatchMetrics,
} from '../tools/freshness_metrics';
import { readHistory, type MetricsSnapshot } from '../tools/metrics_history';
import {
  collectKpis,
  collectDbSources,
  collectTimeSeries,
  collectExtractionOverview,
  collectUnsynced,
  collectAnalyticsEvents,
  collectUserInteractions,
  collectLinkHealth,
  summarizeUserInteractions,
  summarizeTileTaps,
  type Kpis,
  type DbSourceRow,
  type TimeSeries,
  type LayerExtractionOverview,
  type UnsyncedReport,
  type UserInteractionSummary,
  type LinkHealthReport,
} from './db';
import {
  listPending,
  resolvePending,
  submitForReview,
  type ReviewDecision,
} from '../../02-Ingestion/C-htmlGate/manual-review/index.js';
import {
  loadQuarantineIndex,
  loadRetiredIndex,
  type LifecycleEntry,
} from '../../02-Ingestion/lib/quarantineGuard.js';
import { readRecentIngestionRuns } from '../../02-Ingestion/tools/runRecorder';
import { loadCoverageState, reconcileFromDisk } from '../../BFL-generator/lib/zoom-coverage-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT_ROOT = process.env.EVENTPULSE_PROJECT_ROOT ?? process.cwd();
const PUBLIC_DIR = resolve(__dirname, 'public');
const VAULT_PATH = join(
  process.env.EVENTPULSE_VAULT_ROOT ?? '/Users/claudgashi/Desktop/MyVault/TomorGashi',
  '01-Projects/EventPulse/02-Operations/scraping-supervisor'
);

// ─── Data gathering ──────────────────────────────────────────────────────────

interface SourceRow {
  sourceId: string;
  status: string;
  consecutiveFailures: number;
  lastRoutingReason: string | null;
  lastPathUsed: string | null;
  city: string | null;
}

export interface DashboardData {
  generatedAt: string;
  lastRunIso: string | null;
  nextRunAt: string;
  sources: {
    total: number;
    working: number;
    dead: number;
    untouched: number;
  };
  appliedToday: number;
  appliedRecent: Array<{ timestamp: string; sourceId: string; reason: string }>;
  topDead: Array<{ sourceId: string; cf: number; reason: string }>;
  topUntouched: Array<{ sourceId: string; cf: number; reason: string }>;
  schemaDrift: Array<{ reason: string; count: number }>;
  suggestedActions: Array<{ sourceId: string; kind: string; rationale: string }>;
  vaultNotePath: string | null;
  freshnessMedianHours: number | null;
  fieldCoverage: { date: number; venue: number; title: number; description: number };
  batchMetrics: { attempts: number; success: number; decoy: number; transportOk: number; dataOk: number };
  metricsHistory: MetricsSnapshot[];
  // New: KPI strip + DB-fed sources + time-series (Phase 1+3 of dashboard extension)
  kpis: Kpis;
  dbSources: DbSourceRow[];
  timeSeries: TimeSeries;
  // Per-layer time-series (from JSONL — no Supabase needed) for Group 3 charts
  toolATimeSeries: {
    attemptsPerDay: Array<{ date: string; success: number; fail: number }>;
    workingPerDay: Array<{ date: string; value: number }>;
  };
  batchTimeSeries: Array<{ date: string; attempts: number; success: number; rate: number }>;
  // Per-layer extraction funnel summary (Phase 4)
  layers: LayerSummary;
  // Per-layer extraction overview (Task 3a): historical total + latest run
  extractionOverview: LayerExtractionOverview;
  // Unsynced vs Supabase (Task 3b)
  unsynced: UnsyncedReport;
  // Manual review queue (postTestC-manual-review.jsonl) — sources awaiting
  // human investigation. Drives the red sidebar tab. URL is the exact URL
  // last investigated (resolved from the per-source JSONL's sourceUrl, with
  // a couple of fallbacks). Click handlers in the frontend turn each URL
  // into a Google search.
  manualReview: ManualReviewSummary;
  // Live state (Phase 5): BullMQ + 08-Agent
  bullmq: BullmqSummary;
  agent: AgentMetrics;
  // BFL credit balance (header box — left of analytics)
  bflCredits: BflCredits;
  // 10-Analytics server status (header box — right of analytics)
  analyticsServer: AnalyticsServerStatus;
  // Per-source link health (live/dead/unknown) — migration 20260927-0003.
  linkHealth: LinkHealthReport;
}

export interface LayerSummary {
  A: { working: number; dead: number; total: number; untouched: number };
  B: { queueDepth: number; note: string };
  C: { batchesTotal: number; byStatus: Record<string, number>; lastBatch: string | null; lastStatus: string | null };
  D: { pendingCount: number; note: string };
  F: { sourceCount: number; eventsTotalApprox: number };
  G: { available: boolean; note: string };
  H: { backlogSize: number; note: string };
  AI: { logFilesTotal: number; latestIso: string | null; callsLatest: number };
  Push: { totalJobs: number; last7dJobs: number; topSources: Array<{ sourceId: string; count: number }> };
}

// Manual review queue summary — surfaces runtime/postTestC-manual-review.jsonl
// so the sidebar tab can show a count + red state when items are pending.
// Each row carries the EXACT URL that the pipeline last investigated for
// that source (resolved from 03-Queue/03-extractedevents/<source>.jsonl's
// `sourceUrl` field — the same field the auto-extractor wrote when it
// produced events for that source). Frontend renders each row as a link
// whose href is a Google search for that URL (per user spec).
export interface ManualReviewRow {
  sourceId: string;
  /** Exact URL the pipeline last investigated for this source. May be
   *  empty if we couldn't resolve one — frontend falls back to searching
   *  on the sourceId instead. */
  url: string;
  queuedAt: string;
  winningStage: string | null;
  workerNotes: string | null;
  roundNumber: number | null;
  /** "ok" | "no-url" — only used for empty-state messaging, not displayed. */
  urlResolution: 'ok' | 'no-url';
  /** Source of the entry: 'auto' = C-pipelinen, 'cli' = lifecycle-admin markForReview.
   *  Frontend använder detta för att rendera 4-knapps-beslut för cli-rader. */
  kind?: 'auto' | 'cli';
  /** Stabilt id för cli-rader (saknas för auto-rader). Används av POST /api/review/resolve. */
  entryId?: string;
  /** Orsaks-kod (ReasonCode från 02-Ingestion/lib/sourceLifecycle.ts) eller fri text. */
  reasonCode?: string;
  /** Kort notering som hör ihop med reasonCode. */
  note?: string;
}

export interface ManualReviewSummary {
  /** Distinct sourceIds currently in the manual review queue. */
  count: number;
  /** Total rows in the file (sources can appear multiple times across
   *  rounds — sidebar shows the distinct count). */
  totalRows: number;
  rows: ManualReviewRow[];
  fetchedAt: string;
}

// BullMQ queue counts — fetched with 1.5s timeout; null on failure.
export interface BullmqSummary {
  ok: boolean;
  error?: string;
  raw_events?: { waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number };
  ingestion_smoke?: { waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number };
  search_sync?: { waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number };
  fetchedAt?: string;
}

// 08-Agent metrics — proxied from agent server with 2s timeout + 25s cache.
export interface AgentMetrics {
  ok: boolean;
  error?: string;
  impressions?: number;
  clicks?: number;
  outbounds?: number;
  saves?: number;
  ctr?: number;
  totalRows?: number;
  fetchedAt?: string;
}

// BFL credit balance — proxied from autoGenServer with 4s timeout + 60s cache.
// `ok=true` betyder att BFL-credits är > 0 senaste kollen. Rutan i headern
// blir grön när ok=true, röd vid ok=false. credits=null innebär "okänt".
export interface BflCredits {
  ok: boolean;
  credits?: number | null;
  error?: string;
  fetchedAt?: string;
  // BFL ingestion-error-spårning (användarbeslut 2026-10-08): logga fel
  // till runtime/scraping-supervisor/bfl-errors.jsonl och visa "inga krediter
  // under ingestion" om det finns ≥1 fel senaste 24h.
  ingestionErrors24h?: number;
  lastIngestionErrorAt?: string | null;
  lastIngestionErrorMsg?: string | null;
}

// 10-Analytics server (port 7778) status — proxied med 3s timeout + 10s cache.
// `ok=true` betyder att /health svarar på 7778. Styr färgen på toggle-knappen
// i headern och avgör om ett klick startar eller stoppar servern.
export interface AnalyticsServerStatus {
  ok: boolean;
  pid?: number | null;
  port?: number | null;
  error?: string;
  fetchedAt?: string;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

function readDirListing(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(suffix));
}

// Set of sourceIds that have a hand-tuned adapter under
// `02-Ingestion/F-eventExtraction/adapters/`. Drives the "site-specific"
// badge on the DB-fed sources list. Empty set if the dir is missing or
// has no .ts files (e.g. partial checkout).
function buildAdapterSet(root: string): Set<string> {
  const adapterDir = join(root, '02-Ingestion/F-eventExtraction/adapters');
  if (!existsSync(adapterDir)) return new Set();
  return new Set(
    readdirSync(adapterDir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'))
      .map((f) => f.slice(0, -3))
  );
}

export async function collect(): Promise<DashboardData> {
  const statusRows = readJsonl<SourceRow>(join(PROJECT_ROOT, 'runtime/sources_status.jsonl'));
  // Status field uses 'success' (not 'ok') in sources_status.jsonl — match both
  // defensively in case legacy rows used a different convention.
  const isWorking = (s: string | null | undefined) => s === 'ok' || s === 'success';
  const sources = {
    total: statusRows.length,
    working: statusRows.filter((r) => isWorking(r.status)).length,
    dead: statusRows.filter((r) => r.status === 'fail').length,
    untouched: statusRows.filter((r) => !isWorking(r.status) && r.status !== 'fail').length,
  };

  let lastRunIso: string | null = null;
  let vaultNotePath: string | null = null;
  if (existsSync(VAULT_PATH)) {
    const notes = readDirListing(VAULT_PATH, '.md')
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    if (notes.length > 0) {
      const latest = notes.sort().reverse()[0];
      vaultNotePath = join(VAULT_PATH, latest);
      try {
        lastRunIso = statSync(vaultNotePath).mtime.toISOString();
      } catch { /* ignore */ }
    }
  }

  const logPath = join(PROJECT_ROOT, 'runtime/scraping-supervisor/applied-fixes.log');
  const logLines = readJsonl<{ timestamp: string; sourceId: string; reason: string }>(logPath);
  const today = new Date().toISOString().slice(0, 10);
  const appliedToday = logLines.filter((l) => l.timestamp?.startsWith(today)).length;
  const appliedRecent = logLines.slice(-5).reverse();

  const suggPath = join(PROJECT_ROOT, 'runtime/scraping-supervisor/suggested-fixes.jsonl');
  const suggestedRaw = readJsonl<{ sourceId: string; kind: string; rationale: string }>(suggPath);
  const suggestedActions = suggestedRaw
    .filter((s) => s.kind !== 'archive-candidate')
    .slice(0, 5);

  const topDead = statusRows
    .filter((r) => r.status === 'fail' && r.consecutiveFailures >= 5)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    .slice(0, 5)
    .map((r) => ({
      sourceId: r.sourceId,
      cf: r.consecutiveFailures,
      reason: (r.lastRoutingReason ?? 'unknown').slice(0, 60),
    }));
  const topUntouched = statusRows
    .filter((r) => !isWorking(r.status) && r.status !== 'fail' && r.consecutiveFailures >= 10)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    .slice(0, 5)
    .map((r) => ({
      sourceId: r.sourceId,
      cf: r.consecutiveFailures,
      reason: (r.lastRoutingReason ?? 'unknown').slice(0, 60),
    }));

  const reportsDir = join(PROJECT_ROOT, '02-Ingestion/C-htmlGate/reports');
  const batchDirs = readDirListing(reportsDir, '').sort().reverse().slice(0, 5);
  const driftMap = new Map<string, number>();
  for (const batch of batchDirs) {
    const tracePath = join(reportsDir, batch, 'batch-traces.jsonl');
    const traces = readJsonl<{ exitReason?: string; success: boolean }>(tracePath);
    for (const t of traces) {
      if (t.success) continue;
      const reason = t.exitReason ?? 'UNKNOWN';
      driftMap.set(reason, (driftMap.get(reason) ?? 0) + 1);
    }
  }
  const schemaDrift = Array.from(driftMap.entries())
    .filter(([reason]) => reason !== 'SUCCESS' && reason !== 'ENOTFOUND')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  // ── New: per-day time-series from JSONL (Tool A + batch) ──
  const toolATimeSeries = buildToolATimeSeries(statusRows);
  const batchTimeSeries = buildBatchTimeSeries(reportsDir);

  // ── New: Supabase KPIs + DB sources + DB time-series (Phase 1) ──
  const [kpis, dbSources, timeSeries, linkHealth] = await Promise.all([
    collectKpis(),
    collectDbSources(),
    collectTimeSeries(120),
    collectLinkHealth(),
  ]);

  // Annotate DB-fed sources with site-specific flag from the adapter dir.
  const adapterSet = buildAdapterSet(PROJECT_ROOT);
  for (const row of dbSources) row.hasAdapter = adapterSet.has(row.source);

  // Build the URL map once and feed both the manual-review summary and any
  // future consumers that need per-source URLs.
  const sourceUrlMap = buildSourceUrlMap(PROJECT_ROOT);
  const manualReview = collectManualReview(PROJECT_ROOT, sourceUrlMap);

  // Fill the one field that lives in JSONL not DB
  let lastSuccessIso: string | null = null;
  for (const r of statusRows) {
    if (r.status === 'success' && (r as { lastSuccess?: string }).lastSuccess) {
      const ls = (r as { lastSuccess?: string }).lastSuccess!;
      if (!lastSuccessIso || ls > lastSuccessIso) lastSuccessIso = ls;
    }
  }
  kpis.lastToolASuccessIso = lastSuccessIso;

  return {
    generatedAt: now.toISOString(),
    lastRunIso,
    nextRunAt: next.toISOString(),
    sources,
    appliedToday,
    appliedRecent,
    topDead,
    topUntouched,
    schemaDrift,
    suggestedActions,
    vaultNotePath,
    freshnessMedianHours: computeFreshnessMedianHours(PROJECT_ROOT),
    fieldCoverage: computeFieldCoverage(PROJECT_ROOT),
    batchMetrics: computeBatchMetrics(PROJECT_ROOT, { recentBatches: 5 }),
    metricsHistory: readHistory(PROJECT_ROOT, { keepDays: 14 }),
    kpis,
    dbSources,
    timeSeries,
    toolATimeSeries,
    batchTimeSeries,
    layers: collectLayers(PROJECT_ROOT, sources),
    extractionOverview: collectExtractionOverview(PROJECT_ROOT),
    unsynced: await collectUnsynced(PROJECT_ROOT),
    manualReview,
    bullmq: await collectBullmq(),
    agent: await collectAgent(),
    bflCredits: await collectBflCredits(),
    analyticsServer: await collectAnalyticsServer(),
    linkHealth,
  };
}

// ── Time-series builders (Phase 1, no Supabase) ─────────────────────────────

interface ToolARow { lastRun?: string; lastSuccess?: string; status?: string }
function buildToolATimeSeries(rows: ToolARow[]): {
  attemptsPerDay: Array<{ date: string; success: number; fail: number }>;
  workingPerDay: Array<{ date: string; value: number }>;
} {
  const attempts: Record<string, { success: number; fail: number }> = {};
  const working: Record<string, Set<string>> = {};
  for (const r of rows) {
    if (r.lastRun) {
      const d = r.lastRun.slice(0, 10);
      if (!attempts[d]) attempts[d] = { success: 0, fail: 0 };
      if (r.status === 'success') attempts[d].success++;
      else attempts[d].fail++;
    }
    if (r.lastSuccess) {
      const d = r.lastSuccess.slice(0, 10);
      if (!working[d]) working[d] = new Set();
      working[d].add((r as { sourceId?: string }).sourceId ?? '?');
    }
  }
  return {
    attemptsPerDay: Object.keys(attempts).sort().map((d) => ({
      date: d,
      success: attempts[d].success,
      fail: attempts[d].fail,
    })),
    workingPerDay: Object.keys(working).sort().map((d) => ({ date: d, value: working[d].size })),
  };
}

function buildBatchTimeSeries(reportsDir: string): Array<{
  date: string; attempts: number; success: number; rate: number;
}> {
  if (!existsSync(reportsDir)) return [];
  const dayMap: Record<string, { attempts: number; success: number }> = {};
  for (const batch of readdirSync(reportsDir).filter((d) => /^batch-\d+$/.test(d))) {
    const tracePath = join(reportsDir, batch, 'batch-traces.jsonl');
    if (!existsSync(tracePath)) continue;
    let day: string;
    try {
      day = statSync(tracePath).mtime.toISOString().slice(0, 10);
    } catch { continue; }
    if (!dayMap[day]) dayMap[day] = { attempts: 0, success: 0 };
    const traces = readJsonl<{ success: boolean }>(tracePath);
    for (const t of traces) {
      dayMap[day].attempts++;
      if (t.success) dayMap[day].success++;
    }
  }
  return Object.keys(dayMap).sort().map((d) => {
    const { attempts, success } = dayMap[d];
    return { date: d, attempts, success, rate: attempts ? success / attempts : 0 };
  });
}

// ── Per-layer extraction funnel (Phase 4) ──────────────────────────────────

function collectLayers(root: string, sources: { working: number; dead: number; untouched: number; total: number }): LayerSummary {
  // Tool A — already computed by `sources`
  const A = { working: sources.working, dead: sources.dead, untouched: sources.untouched, total: sources.total };

  // Tool B — queue depth from runtime/postB-queue.jsonl
  const toolBQueue = readJsonl<unknown>(join(root, 'runtime/postB-queue.jsonl'));
  const B = { queueDepth: toolBQueue.length, note: toolBQueue.length === 0 ? 'queue empty' : 'depth' };

  // Tool C — batches meta
  const toolCMeta = readJsonl<{ batch?: number; name?: string; status?: string; count?: number }>(
    join(root, '02-Ingestion/C-candidates-batches-meta.jsonl')
  );
  const byStatus: Record<string, number> = {};
  for (const b of toolCMeta) {
    const s = b.status ?? 'unknown';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const lastC = toolCMeta[toolCMeta.length - 1] ?? null;
  const C = {
    batchesTotal: toolCMeta.length,
    byStatus,
    lastBatch: lastC?.name ?? null,
    lastStatus: lastC?.status ?? null,
  };

  // Tool D — pending render queue
  const toolDPending = readJsonl<unknown>(join(root, 'runtime/pending_render_queue.jsonl'));
  const D = { pendingCount: toolDPending.length, note: toolDPending.length === 0 ? 'queue empty' : 'pending' };

  // Tool F — extracted events directory
  const fDir = join(root, '03-Queue/03-extractedevents');
  let fCount = 0, fSizeBytes = 0;
  if (existsSync(fDir)) {
    for (const f of readdirSync(fDir).filter((n) => n.endsWith('.jsonl'))) {
      try {
        const st = statSync(join(fDir, f));
        fCount++;
        fSizeBytes += st.size;
      } catch { /* skip */ }
    }
  }
  // ~250 bytes per row avg → rough estimate (file size / 250).
  const F = { sourceCount: fCount, eventsTotalApprox: fSizeBytes ? Math.round(fSizeBytes / 250) : 0 };

  // Tool G — universal scout (no results.jsonl yet; report availability only)
  const gDir = join(root, '02-Ingestion/G-universalScout');
  const gResultsPath = join(gDir, 'results.jsonl');
  const G = existsSync(gResultsPath)
    ? { available: true, note: 'results.jsonl present (read separately if needed)' }
    : { available: false, note: 'no results.jsonl yet' };

  // Tool H — manual review backlog
  const hDir = join(root, '02-Ingestion/H-manualReview/H-queue');
  let hCount = 0;
  if (existsSync(hDir)) {
    try { hCount = readdirSync(hDir).length; } catch { hCount = 0; }
  }
  const H = { backlogSize: hCount, note: hCount === 0 ? 'queue empty' : `${hCount} pending` };

  // AI — deeptrace-d-*.json logs
  const logsDir = join(root, 'runtime/logs');
  let aiLogs: string[] = [];
  if (existsSync(logsDir)) {
    aiLogs = readdirSync(logsDir).filter((f) => /^deeptrace-d-.*\.json$/.test(f)).sort();
  }
  let aiLatestIso: string | null = null;
  let aiLatestCalls = 0;
  if (aiLogs.length > 0) {
    const latestFile = aiLogs[aiLogs.length - 1];
    const latestPath = join(logsDir, latestFile);
    try {
      const st = statSync(latestPath);
      aiLatestIso = st.mtime.toISOString();
    } catch { /* ignore */ }
    // Parse the file's `results[].status` length and `totalCandidates`
    try {
      const text = readFileSync(latestPath, 'utf-8');
      const parsed = JSON.parse(text) as { totalCandidates?: number; results?: unknown[] };
      aiLatestCalls = (parsed.results?.length ?? 0) + (parsed.totalCandidates ?? 0);
    } catch { /* ignore */ }
  }
  const AI = {
    logFilesTotal: aiLogs.length,
    latestIso: aiLatestIso,
    callsLatest: aiLatestCalls,
  };

  // Push — EVENTPULSE-APP-queue.jsonl grouped by sourceId
  const pushRows = readJsonl<{ sourceId?: string; queuedAt?: string; queueReason?: string }>(
    join(root, 'runtime/EVENTPULSE-APP-queue.jsonl')
  );
  const sourceCounts: Record<string, number> = {};
  let last7d = 0;
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  for (const r of pushRows) {
    const id = r.sourceId ?? 'unknown';
    sourceCounts[id] = (sourceCounts[id] ?? 0) + 1;
    if (r.queuedAt && new Date(r.queuedAt).getTime() >= sevenDaysAgo) last7d++;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sourceId, count]) => ({ sourceId, count }));
  const Push = { totalJobs: pushRows.length, last7dJobs: last7d, topSources };

  return { A, B, C, D, F, G, H, AI, Push };
}

// ── Live state collectors (Phase 5) ────────────────────────────────────────

/**
 * Build a per-source URL map. Three-tier fallback:
 *   1. Per-source JSONL in 03-Queue/03-extractedevents/<sourceId>.jsonl —
 *      the EXACT URL the extractor last fetched for that source (from the
 *      row's `sourceUrl` field). Preferred because it reflects what the
 *      pipeline actually worked against, which is what a human wants to
 *      verify.
 *   2. `sources/<sourceId>.jsonl` (sourceRegistry truth) — the registered
 *      URL for every source. Used as fallback for sources that never
 *      produced events (so they have no extractedevents file).
 *   3. `runtime/audit-*-source-cleanup.jsonl` — URLs of sources that have
 *      since been archived. The manual-review queue often contains
 *      long-dead sources whose only surviving URL is in the cleanup audit.
 *      SourceId without a URL still surfaces in the modal — the frontend
 *      falls back to searching on the sourceId instead.
 */
export function buildSourceUrlMap(root: string): Map<string, string> {
  const out = new Map<string, string>();

  // Tier 1: per-source JSONL in 03-Queue/03-extractedevents/.
  const extractedDir = join(root, '03-Queue/03-extractedevents');
  if (existsSync(extractedDir)) {
    for (const f of readdirSync(extractedDir).filter((n) => n.endsWith('.jsonl'))) {
      const source = f.replace(/\.jsonl$/, '');
      const path = join(extractedDir, f);
      try {
        const text = readFileSync(path, 'utf-8');
        const firstLine = text.split('\n').find((l) => l.trim());
        if (!firstLine) continue;
        const row = JSON.parse(firstLine) as { sourceUrl?: string; url?: string };
        const url = (row.sourceUrl ?? row.url ?? '').trim();
        if (url) out.set(source, url);
      } catch { /* skip unreadable file */ }
    }
  }

  // Tier 2: source registry — every source has a `url` field here.
  const registryDir = join(root, 'sources');
  if (existsSync(registryDir)) {
    for (const f of readdirSync(registryDir).filter((n) => n.endsWith('.jsonl'))) {
      const source = f.replace(/\.jsonl$/, '');
      if (out.has(source)) continue; // tier 1 already filled it
      const path = join(registryDir, f);
      try {
        const text = readFileSync(path, 'utf-8');
        const firstLine = text.split('\n').find((l) => l.trim());
        if (!firstLine) continue;
        const row = JSON.parse(firstLine) as { url?: string };
        const url = (row.url ?? '').trim();
        if (url) out.set(source, url);
      } catch { /* skip unreadable file */ }
    }
  }

  // Tier 3: cleanup audit — covers sources archived on 2026-08-19 and
  // similar future cleanup runs. Only `*source-cleanup*.jsonl` is read
  // (the orphan-cleanup variant doesn't carry URLs).
  const runtimeDir = join(root, 'runtime');
  if (existsSync(runtimeDir)) {
    for (const f of readdirSync(runtimeDir).filter((n) => /^audit-.*source-cleanup.*\.jsonl$/.test(n))) {
      const path = join(runtimeDir, f);
      try {
        const text = readFileSync(path, 'utf-8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line) as { sourceId?: string; url?: string };
            const sid = (row.sourceId ?? '').trim();
            const url = (row.url ?? '').trim();
            if (sid && url && !out.has(sid)) out.set(sid, url);
          } catch { /* skip malformed line */ }
        }
      } catch { /* skip unreadable file */ }
    }
  }

  return out;
}

/**
 * Collect the manual-review queue summary.
 *
 * Source: `runtime/postTestC-manual-review.jsonl`. Each row is one queued
 * investigation for a source. The same sourceId may appear multiple times
 * across rounds; the sidebar count shows the distinct count.
 *
 * URL resolution per source:
 *   1. First non-empty `sourceUrl` from the per-source JSONL in
 *      03-Queue/03-extractedevents/<sourceId>.jsonl — the exact URL the
 *      extractor last worked against.
 *   2. Empty (frontend falls back to Google-search on the sourceId).
 *
 * Sorted by queuedAt desc so the most-recent investigations are at the
 * top. Capped at 500 rows to keep the response payload bounded.
 */
export function collectManualReview(root: string, sourceUrlMap: Map<string, string>): ManualReviewSummary {
  const path = join(root, 'runtime/postTestC-manual-review.jsonl');
  const empty: ManualReviewSummary = {
    count: 0,
    totalRows: 0,
    rows: [],
    fetchedAt: new Date().toISOString(),
  };
  // Slå ihop CLI-pending (från 02-Ingestion/C-htmlGate/manual-review/pending.jsonl)
  // med auto-pending (runtime/postTestC-manual-review.jsonl). CLI-rader visas
  // först eftersom de är manuellt flaggade och viktigare.
  const cliPending = (() => {
    try { return listPending(root).filter(p => p.queue === 'cli-pending'); } catch { return []; }
  })();
  const cliRows: ManualReviewRow[] = cliPending.map(p => {
    const url = sourceUrlMap.get(p.sourceId) ?? '';
    return {
      sourceId: p.sourceId,
      url,
      queuedAt: p.queuedAt,
      winningStage: null,
      workerNotes: null,
      roundNumber: null,
      urlResolution: url ? 'ok' : 'no-url',
      kind: 'cli',
      entryId: p.entryId,
      reasonCode: String(p.reasonCode ?? ''),
      note: String(p.note ?? ''),
    };
  });

  if (!existsSync(path)) {
    // Bara CLI-pending finns
    return {
      count: cliRows.length,
      totalRows: cliRows.length,
      rows: cliRows,
      fetchedAt: new Date().toISOString(),
    };
  }
  let raw: Array<{
    sourceId?: string;
    queuedAt?: string;
    winningStage?: string;
    workerNotes?: string;
    roundNumber?: number;
  }>;
  try {
    raw = readJsonl<{
      sourceId?: string;
      queuedAt?: string;
      winningStage?: string;
      workerNotes?: string;
      roundNumber?: number;
    }>(path);
  } catch {
    // Auto-kön trasig — returnera bara CLI-pending
    return {
      count: cliRows.length,
      totalRows: cliRows.length,
      rows: cliRows,
      fetchedAt: new Date().toISOString(),
    };
  }
  const totalRows = raw.length + cliRows.length;
  const seen = new Set<string>();
  const rows: ManualReviewRow[] = [...cliRows];
  // Markera CLI-sourceIds som redan sedda
  for (const r of cliRows) seen.add(r.sourceId);

  // Newest first (auto-kön)
  const sorted = raw.slice().sort((a, b) => {
    const at = a.queuedAt ?? '';
    const bt = b.queuedAt ?? '';
    return bt.localeCompare(at);
  });
  // Cap applies to BOTH rows.length and the distinct-source count so the
  // contract with the frontend (sidebar badge = count) holds even when
  // the underlying queue has more than `MAX_ROWS` distinct sources.
  const MAX_ROWS = 500;
  for (const r of sorted) {
    const sourceId = (r.sourceId ?? '').trim();
    if (!sourceId) continue;
    if (seen.has(sourceId)) continue;
    if (seen.size >= MAX_ROWS) break;
    seen.add(sourceId);
    const url = sourceUrlMap.get(sourceId) ?? '';
    rows.push({
      sourceId,
      url,
      queuedAt: r.queuedAt ?? '',
      winningStage: r.winningStage ?? null,
      workerNotes: r.workerNotes ?? null,
      roundNumber: typeof r.roundNumber === 'number' ? r.roundNumber : null,
      urlResolution: url ? 'ok' : 'no-url',
      kind: 'auto',
    });
  }
  return {
    count: seen.size,
    totalRows,
    rows,
    fetchedAt: new Date().toISOString(),
  };
}

async function collectBullmq(): Promise<BullmqSummary> {
  // Dynamic import via file URL — keeps BullMQ out of cold-start path if Redis is down.
  // Use absolute path to dodge tsx relative-path quirks with hyphen/space in cwd.
  try {
    const queueUrl = pathToFileURL(join(PROJECT_ROOT, '03-Queue/queue.ts')).href;
    const mod: any = await import(queueUrl);
    const { rawEventsQueue, smokeTestQueue, searchSyncQueue } = mod;
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    const [raw, smoke, search] = (await Promise.all([
      withTimeout(rawEventsQueue.getJobCounts()),
      withTimeout(smokeTestQueue.getJobCounts()),
      withTimeout(searchSyncQueue.getJobCounts()),
    ])) as [
      NonNullable<BullmqSummary['raw_events']>,
      NonNullable<BullmqSummary['ingestion_smoke']>,
      NonNullable<BullmqSummary['search_sync']>,
    ];
    return {
      ok: true,
      raw_events: raw,
      ingestion_smoke: smoke,
      search_sync: search,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

// 25s in-process cache so 30s page refresh doesn't hammer the agent server.
let _agentCache: { data: AgentMetrics; ts: number } | null = null;
async function collectAgent(): Promise<AgentMetrics> {
  const now = Date.now();
  if (_agentCache && now - _agentCache.ts < 25_000) return _agentCache.data;
  const url = process.env.AGENT_METRICS_URL ?? 'http://localhost:8787/agent/metrics';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const data: AgentMetrics = { ok: false, error: `agent ${res.status}`, fetchedAt: new Date().toISOString() };
      _agentCache = { data, ts: now };
      return data;
    }
    const j = (await res.json()) as Partial<AgentMetrics>;
    const data: AgentMetrics = {
      ok: true,
      impressions: j.impressions ?? 0,
      clicks: j.clicks ?? 0,
      outbounds: j.outbounds ?? 0,
      saves: j.saves ?? 0,
      ctr: j.ctr ?? 0,
      totalRows: (j as any).totalRows ?? (j as any).total_rows ?? 0,
      fetchedAt: new Date().toISOString(),
    };
    _agentCache = { data, ts: now };
    return data;
  } catch (err) {
    const data: AgentMetrics = { ok: false, error: String((err as Error)?.message ?? err), fetchedAt: new Date().toISOString() };
    _agentCache = { data, ts: now };
    return data;
  }
}

// BFL credits — proxied from autoGenServer (port 7790) ELLER direkt mot BFL API.
// 60s in-process cache så 15-min meta-refresh inte hamrar BFL API:t.
// autoGenServer cachar i sin tur ingenting; anropet dit har 5s server-side timeout.
let _bflCreditsCache: { data: BflCredits; ts: number } | null = null;

// BFL ingestion-error-spårning (användarbeslut 2026-10-08). Logga varje
// misslyckat BFL-anrop under ingestion till en JSONL-fil. Klienten visar en
// liten rad "inga krediter under ingestion" om det finns ≥1 fel senaste 24h.
const BFL_ERROR_LOG = join(PROJECT_ROOT, 'runtime/scraping-supervisor/bfl-errors.jsonl');
const BFL_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

interface BflErrorEntry {
  timestamp: string;
  source: 'api-fetch' | 'ingestion';
  error: string;
  statusCode?: number;
}

function readBflErrors(windowMs = BFL_ERROR_WINDOW_MS): BflErrorEntry[] {
  if (!existsSync(BFL_ERROR_LOG)) return [];
  const cutoff = Date.now() - windowMs;
  const out: BflErrorEntry[] = [];
  for (const line of readFileSync(BFL_ERROR_LOG, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(line) as BflErrorEntry;
      if (new Date(e.timestamp).getTime() >= cutoff) out.push(e);
    } catch { /* ignorera korrupta rader */ }
  }
  return out;
}

function appendBflError(entry: BflErrorEntry): void {
  const dir = join(PROJECT_ROOT, 'runtime/scraping-supervisor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(BFL_ERROR_LOG, JSON.stringify(entry) + '\n');
}

/**
 * Direkt-fetch av BFL-credits. Används om AUTOGEN_URL inte svarar.
 * Returnerar {ok, credits} om BFL svarar, {ok:false, error} annars.
 */
async function fetchBflCreditsDirect(): Promise<BflCredits> {
  const key = process.env.BFL_API_KEY;
  if (!key) {
    return { ok: false, error: 'BFL_API_KEY not configured', fetchedAt: new Date().toISOString() };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch('https://api.bfl.ai/v1/credits', {
        method: 'GET',
        headers: { 'x-key': key, accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const errMsg = `BFL ${res.status}`;
      appendBflError({ timestamp: new Date().toISOString(), source: 'api-fetch', error: errMsg, statusCode: res.status });
      return { ok: false, error: errMsg, fetchedAt: new Date().toISOString() };
    }
    const j = (await res.json()) as { credits?: number };
    return { ok: typeof j.credits === 'number' && j.credits > 0, credits: j.credits ?? null, fetchedAt: new Date().toISOString() };
  } catch (err) {
    const errMsg = String((err as Error)?.message ?? err);
    appendBflError({ timestamp: new Date().toISOString(), source: 'api-fetch', error: errMsg });
    return { ok: false, error: errMsg, fetchedAt: new Date().toISOString() };
  }
}

async function collectBflCredits(): Promise<BflCredits> {
  const now = Date.now();
  if (_bflCreditsCache && now - _bflCreditsCache.ts < 60_000) {
    // Uppdatera bara ingestion-error-räknare (lättare data)
    const errs = readBflErrors();
    return {
      ..._bflCreditsCache.data,
      ingestionErrors24h: errs.length,
      lastIngestionErrorAt: errs.length > 0 ? errs[errs.length - 1].timestamp : null,
      lastIngestionErrorMsg: errs.length > 0 ? errs[errs.length - 1].error : null,
    };
  }
  const url = process.env.AUTOGEN_URL ?? 'http://localhost:7790/bfl-credits';
  let data: BflCredits;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      data = { ok: false, error: `autoGenServer ${res.status}`, fetchedAt: new Date().toISOString() };
    } else {
      const j = (await res.json()) as Partial<BflCredits>;
      data = {
        ok: Boolean(j.ok),
        credits: j.credits ?? null,
        error: j.error,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    // autoGenServer nere — prova direkt mot BFL som fallback (om key finns)
    if (process.env.BFL_API_KEY) {
      data = await fetchBflCreditsDirect();
    } else {
      data = { ok: false, error: String((err as Error)?.message ?? err), fetchedAt: new Date().toISOString() };
      appendBflError({ timestamp: new Date().toISOString(), source: 'api-fetch', error: data.error });
    }
  }
  _bflCreditsCache = { data, ts: now };

  // Lägg till ingestion-error-stat (24h fönster)
  const errs = readBflErrors();
  return {
    ...data,
    ingestionErrors24h: errs.length,
    lastIngestionErrorAt: errs.length > 0 ? errs[errs.length - 1].timestamp : null,
    lastIngestionErrorMsg: errs.length > 0 ? errs[errs.length - 1].error : null,
  };
}

// ─── BFL orchestrate helpers (2026-10-12) ────────────────────────────────
// Wrapper runt scripts/bfl_orchestrate.ts — dashboard-knappen spawnar
// subprocess och läser samma tmp/bfl_runs/<runId>.json som CLI:n skriver.

interface BflCategoryRow {
  slug: string;
  libraryCount: number;
}

async function collectBflCategories(): Promise<BflCategoryRow[]> {
  // Hämta distinct kategorier från image_library + räkna rader per kategori.
  // PostgREST ger oss group via select(category_slug, count) men för enkelhetens
  // skull frågor vi events-tabellen (image_library saknar groupby-API i PostgREST).
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/KEY saknas');
  const res = await fetch(
    `${url}/rest/v1/image_library?select=category_slug&limit=10000`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`image_library fetch ${res.status}`);
  const rows = (await res.json()) as Array<{ category_slug: string | null }>;
  const byCat = new Map<string, number>();
  for (const r of rows) {
    if (!r.category_slug) continue;
    byCat.set(r.category_slug, (byCat.get(r.category_slug) ?? 0) + 1);
  }
  return [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, libraryCount]) => ({ slug, libraryCount }));
}

interface StartBflOrchestratorInput {
  category: string;
  count: number;
  maxCredits?: number;
  mockPrompts?: boolean;
}

interface StartBflOrchestratorResult {
  ok: boolean;
  runId: string;
  pid: number;
  estimatedCredits: number;
  runJsonPath: string;
}

function newBflRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function startBflOrchestrator(input: StartBflOrchestratorInput): StartBflOrchestratorResult {
  const runId = newBflRunId();
  const estimated = 4 * input.count;
  const args = [
    '--env-file=.env', '--import', 'tsx',
    'scripts/bfl_orchestrate.ts',
    `--category=${input.category}`,
    `--count=${input.count}`,
    `--run-id=${runId}`,
  ];
  if (input.maxCredits) args.push(`--max-credits=${input.maxCredits}`);
  if (input.mockPrompts) args.push('--mock-prompts');

  const child = spawn('node', args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // Starta detached så child överlever om dashboard-servern startas om.
  child.stdout?.on('data', () => {}); // tyst — orchestrator skriver till run-JSON
  child.stderr?.on('data', () => {});
  child.unref();

  const pid = child.pid ?? -1;
  return {
    ok: pid > 0,
    runId,
    pid,
    estimatedCredits: estimated,
    runJsonPath: join(PROJECT_ROOT, 'tmp', 'bfl_runs', `${runId}.json`),
  };
}

function readBflRunState(runId: string): unknown | null {
  // Säkerhets-validera runId (förhindra path traversal)
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
  const path = join(PROJECT_ROOT, 'tmp', 'bfl_runs', `${runId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

interface CancelBflRunResult {
  ok: boolean;
  cancelled: boolean;
  reason?: string;
}

function cancelBflRun(runId: string): CancelBflRunResult {
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return { ok: false, cancelled: false, reason: 'invalid runId' };
  const state = readBflRunState(runId) as { status?: string } | null;
  if (!state) return { ok: false, cancelled: false, reason: 'run not found' };
  if (state.status === 'success' || state.status === 'failed' || state.status === 'cancelled') {
    return { ok: false, cancelled: false, reason: `run already ${state.status}` };
  }
  // Hitta orchestrator-processen via pid-filen i runJsonPath
  // Vi har bara runId — orchestrator skrev pid till runJsonPath. Använde
  // process.pid (=dashboard-pid) i sin initiala record. Bättre: orchestrator
  // kan uppdatera med child-pid. För nu: returnera "use SIGTERM via pid 0".
  // Implementation: orchestrator skriver pid i sin egen run-JSON (se
  // scripts/bfl_orchestrate.ts:initResult — process.pid). För att verkligen
  // kunna cancel behöver vi orchestratorns child-pid, inte dashboard-pid.
  // HACK: orchestrator-pid = parent pid av om spawn kör i `tsx`-träd. Vi
  // försöker `pgrep -f bfl_orchestrate.ts --category=${category}` via subprocess.
  try {
    // Enklaste strategin: kör `pkill -TERM -f bfl_orchestrate.ts`. Risken är
    // att vi dödar andra pågående orchestrator-körningar. För dashboard-
    // användning räcker detta — det finns sällan >1 samtidig körning.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync('pkill -TERM -f "bfl_orchestrate.ts"', { stdio: 'ignore' });
    return { ok: true, cancelled: true };
  } catch {
    return { ok: false, cancelled: false, reason: 'no orchestrator process to kill' };
  }
}

// 10-Analytics server (port 7778) — direkt fetch mot /health, 10s cache.
// Bestämmer färgen på toggle-knappen i headern. Använder lsof för att få PID
// om servern körs (för visning i title-text).
let _analyticsServerCache: { data: AnalyticsServerStatus; ts: number } | null = null;
async function collectAnalyticsServer(): Promise<AnalyticsServerStatus> {
  const now = Date.now();
  if (_analyticsServerCache && now - _analyticsServerCache.ts < 10_000) {
    return _analyticsServerCache.data;
  }
  const port = 7778;
  const url = `http://localhost:${port}/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    // Vilken HTTP-status som helst betyder att servern svarar. fetch() kastar
    // vid nätverksfel (ECONNREFUSED / timeout) → hamnar i catch nedan.
    let pid: number | null = null;
    try {
      const { execSync } = await import('child_process');
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -1`, {
        encoding: 'utf8',
        timeout: 1500,
      }).trim();
      pid = out ? Number(out) : null;
    } catch { /* ignore — pid är bara kosmetiskt */ }
    const data: AnalyticsServerStatus = {
      ok: true,
      pid,
      port,
      fetchedAt: new Date().toISOString(),
    };
    _analyticsServerCache = { data, ts: now };
    return data;
  } catch (err) {
    const data: AnalyticsServerStatus = {
      ok: false,
      port,
      error: String((err as Error)?.message ?? err),
      fetchedAt: new Date().toISOString(),
    };
    _analyticsServerCache = { data, ts: now };
    return data;
  }
}

// Toggle endpoint — startar/stoppar 10-Analytics-servern. Dashboarden blir
// ansvarig för processen (child process). Användaren klickar → script startas
// eller PID dödas. Hålls enkel: inget launchd, ingen wrapper.
//
// Säkerhet:
//   - Endast POST, ingen payload behövs
//   - Hardcodade kommandon (inga shell-injections)
//   - Cache invalideras efter toggle så UI ser ny status direkt
async function toggleAnalyticsServer(): Promise<{
  ok: boolean;
  action: 'started' | 'stopped' | 'noop';
  pid?: number | null;
  error?: string;
}> {
  const port = 7778;
  const logFile = join(PROJECT_ROOT, 'runtime/analytics-server.log');
  const { execSync, spawn } = await import('child_process');

  // 2026-10-28 — launchd-ägarskap. Analytics-servern har ett eget
  // launchd-jobb (com.eventpulse.analytics) så att den startar om efter
  // reboot och inte dödar med dashboarden. Utan det låg servern som ett
  // barn av dashboarden och försvann vid varje omstart — användaren
  // fick trycka på knappen manuellt (se 2026-10-28-rebooten).
  //
  // Knappen och launchd får INTE båda äga porten: om launchd startar om
  // servern direkt efter att knappen dödat den blir det en flip-flop.
  // Därför: stopp → bootout, start → bootstrap.
  const LAUNCHD_LABEL = 'com.eventpulse.analytics';
  const launchdTarget = `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`;
  const launchdPlist = join(
    process.env.HOME ?? '/Users/claudgashi',
    'Library/LaunchAgents',
    `${LAUNCHD_LABEL}.plist`,
  );

  const isLaunchdLoaded = (): boolean => {
    try {
      const out = execSync(`launchctl print ${launchdTarget} 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 1500,
      });
      return out.includes(LAUNCHD_LABEL);
    } catch {
      return false;
    }
  };

  // PIDs som just nu lyssnar på porten (kan vara flera vid omstartsrace —
  // dödar vi bara den första kan en orphan behålla porten).
  const listenerPids = (): number[] => {
    try {
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 1500,
      });
      return out
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    } catch {
      return [];
    }
  };

  const existing = listenerPids();
  if (existing.length > 0) {
    // Stoppa: SIGTERM alla lyssnare, VERIFIERA att porten släpps, SIGKILL
    // de som vägrar. Sanningen är lsof — inte tilltro till kill-anropet.
    //
    // 2026-10-28 — om launchd äger servern måste jobbet tas ner FÖRST,
    // annars startar KeepAlive om den direkt och porten släpps aldrig.
    if (isLaunchdLoaded()) {
      try {
        execSync(`launchctl bootout ${launchdTarget} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      } catch { /* jobbet kan redan vara avlastat — fortsätt ändå */ }
    }
    for (const pid of existing) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* redan död */ }
    }
    await new Promise((r) => setTimeout(r, 1500));
    const stragglers = listenerPids();
    for (const pid of stragglers) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* redan död */ }
    }
    if (stragglers.length > 0) await new Promise((r) => setTimeout(r, 500));
    const left = listenerPids();
    if (left.length > 0) {
      return { ok: false, action: 'noop', error: `port ${port} släppte inte (PID kvar: ${left.join(', ')})` };
    }
    _analyticsServerCache = null;
    return { ok: true, action: 'stopped', pid: existing[0] };
  }

  // Starta. Samma mönster som launchd-jobbet för den här dashboarden:
  // node <root>/node_modules/tsx/dist/cli.mjs 10-Analytics/server.ts
  //
  // INTE 'npx': den här processen ärvs ofta från launchd vars PATH är
  // minimal (/usr/bin:/bin:...), och spawn('npx', …) utan shell löser
  // inte PATH → ENOENT som tyst dödade barnet (start-grenen var trasig).
  // tsx-binärens shebang 'env node' kräver också PATH. process.execPath +
  // absolut cli-sökväg eliminerar alla PATH-beroenden.
  try {
    mkdirSync(join(PROJECT_ROOT, 'runtime'), { recursive: true });
    const tsxCli = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const serverEntry = join(PROJECT_ROOT, '10-Analytics', 'server.ts');
    if (!existsSync(tsxCli) || !existsSync(serverEntry)) {
      return { ok: false, action: 'noop', error: `saknas: ${!existsSync(tsxCli) ? tsxCli : serverEntry}` };
    }

    // 2026-10-28 — om launchd-jobbet finns är det bättre ägare än en
    // spawnad child: det startar om servern efter krasch och efter reboot.
    // Då ska vi INTE också spawna — två processer på samma port ger
    // EADDRINUSE för den andra. Fallback (spawn) behålls för miljöer där
    // jobbet inte är installerat.
    let launchdStarted = false;
    if (existsSync(launchdPlist)) {
      // `launchctl bootstrap <domain-target> <service-path>` — domänen är
      // "gui/<uid>", INTE "gui/<uid>/<label>". Med fel domän svarar
      // launchctl "Usage: …" (rc 64) och inget händer.
      const domain = `gui/${process.getuid?.() ?? 501}`;
      try {
        execSync(`launchctl bootstrap ${domain} ${launchdPlist} 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 5000,
        });
        launchdStarted = true;
      } catch {
        // Redan laddat — då räcker en kickstart.
        try {
          execSync(`launchctl kickstart -k ${launchdTarget} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
          launchdStarted = true;
        } catch { /* fall tillbaka på spawn nedan */ }
      }
    }

    let child: ReturnType<typeof spawn> | undefined;
    let spawnError: string | null = null;
    if (!launchdStarted) {
      const { openSync, closeSync } = await import('fs');
      const logFd = openSync(logFile, 'a');
      try {
        child = spawn(
          process.execPath,
          [tsxCli, serverEntry],
          {
            cwd: PROJECT_ROOT,
            detached: true, // egen processgrupp → hela barnkedjan dör med kill(-pid)
            stdio: ['ignore', logFd, logFd],
            // PORT-isolation: dashboardens egen PORT (7777) får inte ärvas —
            // analytics-serverns default läser process.env.PORT || 7778, så utan
            // explicit override försöker den lyssna på 7777 och kraschar med
            // EADDRINUSE.
            env: { ...process.env, PORT: String(port) },
          },
        );
        // spawn-fel (ENOENT etc.) kommer asynkront via 'error' — utan lyssnare
        // dog de tyst och toggle rapporterade fel hälsokoll istället för orsak.
        child.on('error', (err: NodeJS.ErrnoException) => { spawnError = String(err?.message ?? err); });
      } finally {
        closeSync(logFd); // barnet har egna fd:ar — läck inte vår kopia
      }
      child.unref();
    }

    // Liveness: polla /api/health var 500 ms, max 12 s. tsx-kallstart +
    // dotenv + supabase-init tar några sekunder (4,4 s sedda i loggen) — den
    // gamla fasta 1,2 s + 1,5 s-proben mördade en frisk server under boot.
    const deadline = Date.now() + 12_000;
    let healthy = false;
    while (Date.now() < deadline && !spawnError) {
      await new Promise((r) => setTimeout(r, 500));
      const controller = new AbortController();
      const probeTimer = setTimeout(() => controller.abort(), 1200);
      try {
        const res = await fetch(`http://localhost:${port}/api/health`, { signal: controller.signal });
        if (res.ok) { healthy = true; break; }
      } catch { /* inte uppe än */ } finally { clearTimeout(probeTimer); }
    }
    if (healthy) {
      _analyticsServerCache = null;
      return { ok: true, action: 'started', pid: child?.pid ?? listenerPids()[0] ?? null };
    }
    // Haveri — städa hela den egna processgruppen (barnet är group leader)
    // och rapportera den verkliga orsaken, inte en gissning.
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* redan död */ }
      }
    }
    if (launchdStarted) {
      // launchd äger servern — stanna inte kvar med ett halvdant jobb.
      try {
        execSync(`launchctl bootout ${launchdTarget} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      } catch { /* redan avlastat */ }
    }
    return {
      ok: false,
      action: 'noop',
      error: spawnError ?? `servern svarade inte på /api/health inom 12 s (se ${logFile})`,
    };
  } catch (err) {
    return { ok: false, action: 'noop', error: String((err as Error)?.message ?? err) };
  }
}

// ─── Ingestion cron toggle (port 7777 dashboard button) ────────────────────
//
// Läser runtime/ingestion-cron.status.json (skrivs av ingestion-cron.ts).
// Startar/stoppar samma entry-point som launchd använder på natten
// (scripts/ingestion-cron.ts). Returnerar alltid sanning från statusfilen
// — knappen visar alltid rätt färg oavsett vilken process som startade jobbet.
//
// Säkerhet:
//   - Endast POST
//   - Hardcodade kommandon (inga shell-injections)
//   - Detached spawn så jobbet överlever dashboardens livscykel
//   - Sanningskontroll via statusfilen, inte PID-cache
async function toggleIngestionCron(action: 'start' | 'stop'): Promise<{
  ok: boolean;
  action: 'started' | 'stopped' | 'noop';
  status: Record<string, unknown>;
  pid?: number | null;
  error?: string;
}> {
  const statusFile = join(PROJECT_ROOT, 'runtime/ingestion-cron.status.json');
  const logFile = join(PROJECT_ROOT, 'runtime/ingestion-cron.out.log');
  const { spawn } = await import('child_process');
  const { readFileSync, existsSync, writeFileSync } = await import('fs');

  // Läs nuvarande status (eller default)
  let status: Record<string, unknown> = {
    running: false, pid: null, startedAt: null, finishedAt: null,
    exitCode: null, durationMs: null, steps: [], totalEventsExtracted: 0, lastError: null,
  };
  if (existsSync(statusFile)) {
    try { status = JSON.parse(readFileSync(statusFile, 'utf8')); } catch { /* ignore */ }
  }

  if (action === 'stop') {
    const pid = (status as { pid?: number | null }).pid;
    if (!status.running || !pid) {
      return { ok: true, action: 'noop', status };
    }
    try {
      process.kill(pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      const updated = existsSync(statusFile)
        ? JSON.parse(readFileSync(statusFile, 'utf8'))
        : status;
      return { ok: true, action: 'stopped', status: updated, pid };
    } catch (err) {
      return { ok: false, action: 'noop', status, error: String((err as Error)?.message ?? err) };
    }
  }

  // action === 'start'
  if (status.running) {
    return { ok: true, action: 'noop', status };
  }

  // Starta: skriv running=true OMEDELBART (så dashboard ser grön även innan
  // subprocessen hunnit skriva sin egen statusrad). Subprocessen uppdaterar
  // filen med sitt riktiga pid och steg-för-steg-progress.
  const newStatus = {
    ...status,
    running: true,
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
  };
  writeFileSync(statusFile, JSON.stringify(newStatus, null, 2), 'utf8');

  try {
    mkdirSync(join(PROJECT_ROOT, 'runtime'), { recursive: true });
    const { openSync } = await import('fs');
    const logFd = openSync(logFile, 'a');
    const child = spawn(
      'npx',
      ['tsx', 'scripts/ingestion-cron.ts'],
      {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PROJECT_ROOT },
      },
    );
    child.unref();

    // Vänta lite så subprocessen hinner skriva sitt egna pid i statusfilen
    await new Promise((r) => setTimeout(r, 250));
    const updated = existsSync(statusFile)
      ? JSON.parse(readFileSync(statusFile, 'utf8'))
      : newStatus;

    return { ok: true, action: 'started', status: updated, pid: child.pid ?? null };
  } catch (err) {
    const failed = { ...newStatus, running: false, lastError: String((err as Error)?.message ?? err) };
    writeFileSync(statusFile, JSON.stringify(failed, null, 2), 'utf8');
    return { ok: false, action: 'noop', status: failed, error: String((err as Error)?.message ?? err) };
  }
}

function readIngestionCronStatus(): Record<string, unknown> {
  const statusFile = join(PROJECT_ROOT, 'runtime/ingestion-cron.status.json');
  const emptyStatus = {
    running: false, pid: null, startedAt: null, finishedAt: null,
    exitCode: null, durationMs: null, steps: [], totalEventsExtracted: 0, lastError: null,
  };
  if (!existsSync(statusFile)) {
    return emptyStatus;
  }
  try {
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    // 2026-10-18: "running:true sedan 2.7 dagar" såg ut som stale flagga, men
    // var i själva verket en långkörd ingestion-cron mitt i en 10-min sitemap-step.
    // Visa "alive for Xd Yh" + heartbeat-age istället. Om heartbeat > 2h gammal
    // OCH PID inte lever → flagga stale och flippa running→false.
    const now = Date.now();
    const startedAt = typeof status.startedAt === 'string' ? new Date(status.startedAt).getTime() : null;
    const lastHeartbeatAt = typeof status.lastHeartbeatAt === 'string'
      ? new Date(status.lastHeartbeatAt).getTime()
      : startedAt;
    const heartbeatAgeMs = lastHeartbeatAt !== null ? now - lastHeartbeatAt : null;
    const uptimeMs = startedAt !== null ? now - startedAt : null;
    const pid = typeof status.pid === 'number' ? status.pid : null;
    let pidAlive: boolean | null = null;
    if (pid !== null) {
      try { process.kill(pid, 0); pidAlive = true; }
      catch { pidAlive = false; }
    }
    const STALE_HEARTBEAT_MS = 2 * 60 * 60 * 1000;
    const stale = status.running === true && (
      pidAlive === false ||
      (heartbeatAgeMs !== null && heartbeatAgeMs > STALE_HEARTBEAT_MS)
    );
    return {
      ...status,
      uptimeMs,
      lastHeartbeatAgeMs: heartbeatAgeMs,
      pidAlive,
      stale,
      running: stale ? false : status.running,
    };
  } catch {
    return { ...emptyStatus, lastError: 'status-file-corrupt' };
  }
}

// ─── Per-source health diagnostics (Phase 1) ────────────────────────────────

export type ErrorCategory = 'timeout' | '404' | '500' | 'redirect' | 'antibot' | 'parse' | 'other' | null;
export type SourceHealthStatus = 'healthy' | 'irregular' | 'failed';

export interface SourceHealthRow {
  id: string;
  status: SourceHealthStatus;
  lastSuccess: string | null;
  lastFail: string | null;
  lastErrorCategory: ErrorCategory;
  lastError: string | null;
  successRate: number; // lifetime proxy: (attempts - consecutiveFailures) / attempts
  consecutiveFailures: number;
  attempts: number;
  preferredPath: string | null;
  lastPathUsed: string | null;
}

export interface SourceHealthReport {
  summary: {
    total: number;
    healthy: number;
    irregular: number;
    failed: number;
    lastRunAt: string | null;
  };
  sources: SourceHealthRow[];
  errorCategories: Record<string, number>;
  generatedAt: string;
}

/**
 * Categorize a free-form routing-reason string into a small, stable set of
 * error buckets. Order matters: more specific patterns (antibot, parse)
 * come before generic network/timeout so they aren't mis-classified.
 *
 * Categories:
 *   timeout    — request timed out (ETIMEDOUT, AbortError, httpTimeout)
 *   antibot    — Cloudflare / Datadome / Just a moment / Captcha / 403
 *   parse      — JSON-LD missing, schema mismatch, empty feed
 *   redirect   — 3xx redirect loop or unexpected redirect chain
 *   404        — resource not found / DNS failure / connection refused
 *   500        — server-side HTTP error (5xx)
 *   other      — anything else (incl. "Unknown", generic fetch failures)
 *   null       — no lastError recorded (source never attempted OR last run ok)
 */
export function categorizeError(reason: string | null | undefined): ErrorCategory {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (/timeout|timed out|etimedout|aborted|http[s]?timeout/.test(r)) return 'timeout';
  if (/antibot|cloudflare|datadome|just a moment|captcha|access denied|forbidden|\b403\b/.test(r)) return 'antibot';
  if (/no-jsonld|no-events|schema|parse|invalid json|empty feed|0 events/.test(r)) return 'parse';
  if (/301|302|308|redirect|too many redirects|redirection/.test(r)) return 'redirect';
  if (/404|not found|enotfound|getaddrinfo|econnrefused/.test(r)) return '404';
  if (/\b5\d\d\b/.test(r) || /server error|bad gateway|service unavailable/.test(r)) return '500';
  return 'other';
}

/**
 * Compute a single source's health bucket.
 *
 * Thresholds (see MASTERPLAN Phase 1 dashboard):
 *   healthy   — lastSuccess within 24h AND proxy successRate >= 0.8
 *   failed    — proxy successRate < 0.1 (catastrophic), OR
 *               lastSuccess older than 7d, OR proxy rate < 0.3
 *   irregular — the middle band (lastSuccess 1–7d, rate 0.3–0.8)
 *
 * NOTE: We don't have a true sliding 7d/30d success rate (no per-attempt
 * history), so we use a lifetime proxy:
 *   proxy = max(0, attempts - consecutiveFailures) / attempts
 * This counts the trailing run as one attempt; historical successes equal
 * the difference between total attempts and the trailing consecutive-failure
 * streak. Good enough to bucket sources; not good enough to time-bound.
 */
function classifyHealth(
  lastSuccessIso: string | null,
  successRate: number,
  attempts: number,
  now: number,
): SourceHealthStatus {
  const ageH = lastSuccessIso
    ? (now - new Date(lastSuccessIso).getTime()) / 3600000
    : Infinity;
  if (attempts > 0 && successRate < 0.1) return 'failed';
  if (ageH <= 24 && successRate >= 0.8) return 'healthy';
  if (ageH > 24 * 7 || successRate < 0.3) return 'failed';
  return 'irregular';
}

export function collectSourceHealth(root: string): SourceHealthReport {
  const rows = readJsonl<{
    sourceId?: string;
    status?: string;
    lastSuccess?: string;
    lastRun?: string;
    lastRoutingReason?: string;
    consecutiveFailures?: number;
    attempts?: number;
    preferredPath?: string;
    lastPathUsed?: string;
  }>(join(root, 'runtime/sources_status.jsonl'));

  const now = Date.now();
  const sources: SourceHealthRow[] = [];
  const errorCategories: Record<string, number> = {};
  let healthy = 0, irregular = 0, failed = 0;
  let lastRunAt: string | null = null;

  for (const r of rows) {
    const id = r.sourceId ?? '?';
    const lastSuccess = r.lastSuccess ?? null;
    const lastRun = r.lastRun ?? null;
    if (lastRun && (!lastRunAt || lastRun > lastRunAt)) lastRunAt = lastRun;

    const attempts = Math.max(0, r.attempts ?? 0);
    const cf = Math.max(0, r.consecutiveFailures ?? 0);
    // Proxy success rate: assume the trailing streak reflects current state,
    // so historical successes ≈ attempts - trailing consecutiveFailures.
    // Clamped to [0, 1]. attempts == 0 → rate = 0 (unknown -> irregular via
    // classifyHealth fallthrough).
    const proxySuccess = attempts > 0 ? Math.max(0, attempts - cf) / attempts : 0;
    const lastError = r.lastRoutingReason ?? null;
    const lastErrorCategory = categorizeError(lastError);
    if (lastErrorCategory) {
      errorCategories[lastErrorCategory] = (errorCategories[lastErrorCategory] ?? 0) + 1;
    }

    const status = classifyHealth(lastSuccess, proxySuccess, attempts, now);
    if (status === 'healthy') healthy++;
    else if (status === 'irregular') irregular++;
    else failed++;

    sources.push({
      id,
      status,
      lastSuccess,
      lastFail: lastRun,
      lastErrorCategory,
      lastError,
      successRate: Number(proxySuccess.toFixed(3)),
      consecutiveFailures: cf,
      attempts,
      preferredPath: r.preferredPath ?? null,
      lastPathUsed: r.lastPathUsed ?? null,
    });
  }

  return {
    summary: {
      total: sources.length,
      healthy,
      irregular,
      failed,
      lastRunAt,
    },
    sources,
    errorCategories,
    generatedAt: new Date().toISOString(),
  };
}

// ─── User activity (10-Analytics: Supabase primary + JSONL fallback) ────────
//
// The Expo app (06-UI/services/analyticsClient.js) posts user-activity events
// to the 10-Analytics server on port 7778, which persists them to the
// Supabase `analytics_events` table (Fas B primary store) with
// runtime/events.jsonl as the fallback (30-day retention, GDPR: no PII —
// only a pseudonymous device_id_hash). This collector aggregates BOTH
// sources per test profile across three depths (today / last 7d / last
// 30d) so the dashboard can show what the three fictitious test users
// actually did.
//
// The 10-Analytics read API needs a bearer token (ephemeral-random when the
// env is unset), so — like the rest of this dashboard — we read the sources
// directly: analytics_events via db.ts (errors-as-data: [] when
// unconfigured/failed) and the JSONL file from disk. An event lives in
// exactly ONE store (Supabase when its insert succeeded, JSONL only when
// it failed), so the two row sets concat without dedup. Windows are
// computed per call; volumes are tiny, no caching.

// Test profiles mirrored from analyticsClient.js TEST_USERS.
const UA_TEST_USERS = [
  { id: 'tomorg1', label: 'Tomor G. — Alpha' },
  { id: 'tomorg2', label: 'Tomor G. — Beta' },
  { id: 'tomorg3', label: 'Tomor G. — Gamma' },
];

/** Mirror of analyticsClient.js hashToHex64 (djb2-based, deterministic 64-hex
 *  from the seed `eventpulse-user:<userId>:v1`). NOT cryptographic — the app
 *  uses it only as a stable pseudonymous id, and we mirror it to map hashes
 *  back to readable profile labels. */
function uaHashToHex64(input: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 * 33) ^ c) >>> 0;
  }
  const seed = `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  let out = '';
  let s = seed;
  while (out.length < 64) {
    let acc = 0;
    for (let i = 0; i < s.length; i++) {
      acc = ((acc << 5) - acc + s.charCodeAt(i)) >>> 0;
    }
    out += acc.toString(16).padStart(8, '0');
    s = `${acc}${s}`;
  }
  return out.slice(0, 64);
}

export type UaDepth = 'today' | 'd7' | 'd30';
export const UA_DEPTHS: UaDepth[] = ['today', 'd7', 'd30'];

export interface UaDepthStats {
  events: number;
  sessions: number; // unique session_id within the window
  byType: Record<string, number>;
  lastActive: string | null;
}

export interface UaProfileRow {
  id: string;
  label: string;
  hash: string | null;
  known: boolean; // false = hash not in the test-profile map
  totalEvents: number; // all rows in the file for this profile
  perDepth: Record<UaDepth, UaDepthStats>;
  daily: Array<{ date: string; events: number; sessions: number }>; // last 30 days, oldest first
}

export interface UserActivityReport {
  ok: boolean;
  reason?: string; // populated when ok === false (file missing / unreadable)
  generatedAt: string;
  profiles: UaProfileRow[];
  kpis: Record<UaDepth, { events: number; activeProfiles: number; sessions: number }>;
  /** Fas E: agent-activity KPIs from 08-Agent's user_interactions +
   *  tile_tap analytics rows. Zeros are honest — never invented. */
  interactions: UserActivityInteractionsBlock;
}

/** UserInteractionSummary + the tile-tap counts (from analytics rows). */
export interface UserActivityInteractionsBlock extends UserInteractionSummary {
  /** Utforska-tile-tryck per canonical tile word, last 30 days. */
  tileTapsByWord: Record<string, number>;
}

interface UaEventRow {
  event_type?: string;
  device_id_hash?: string;
  session_id?: string;
  payload?: Record<string, unknown> | null;
  ts?: string;
  received_at?: string;
}

function uaEmptyDepthStats(): UaDepthStats {
  return { events: 0, sessions: 0, byType: {}, lastActive: null };
}

function uaLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function collectUserActivity(root: string): Promise<UserActivityReport> {
  const generatedAt = new Date().toISOString();
  const filePath = join(root, 'runtime/events.jsonl');
  const emptyKpis: UserActivityReport['kpis'] = {
    today: { events: 0, activeProfiles: 0, sessions: 0 },
    d7: { events: 0, activeProfiles: 0, sessions: 0 },
    d30: { events: 0, activeProfiles: 0, sessions: 0 },
  };
  const emptyInteractions: UserActivityInteractionsBlock = {
    totalRows: 0,
    activeUsers7d: 0,
    byType: {},
    dwellBySource: {},
    chatQueriesDaily: [],
    tileTapsByWord: {},
  };

  // Fas B: Supabase analytics_events is the primary store; [] when
  // unconfigured or unreadable — then the JSONL fallback must carry the
  // report alone (and honestly say so when it can't).
  const supabaseRows = await collectAnalyticsEvents();

  // Fas E: 08-Agent's user_interactions — the app's real interaction
  // signals (impressions, saves, dwell, outbound…). Independent of the
  // analytics sources: the report is ok:true as long as ANY source has
  // data, and this block shows honest zeros when it is empty.
  const interactionRows = await collectUserInteractions();
  const now = new Date();
  const interactionSummary = summarizeUserInteractions(interactionRows, now);

  let jsonlRows: UaEventRow[] = [];
  let jsonlMissing = false;
  let jsonlError: string | null = null;
  if (!existsSync(filePath)) {
    jsonlMissing = true;
  } else {
    try {
      jsonlRows = readJsonl<UaEventRow>(filePath);
    } catch (err) {
      jsonlError = `kunde inte läsa events.jsonl: ${String((err as Error)?.message ?? err)}`;
    }
  }

  if (jsonlMissing && supabaseRows.length === 0 && interactionSummary.totalRows === 0) {
    return {
      ok: false,
      reason:
        'varken analytics_events (Supabase) eller runtime/events.jsonl har några events ännu. Kontrollera SUPABASE-konfigurationen eller starta 10-Analytics (port 7778) via headerns toggle.',
      generatedAt,
      profiles: [],
      kpis: emptyKpis,
      interactions: emptyInteractions,
    };
  }

  if (jsonlError && supabaseRows.length === 0 && interactionSummary.totalRows === 0) {
    return {
      ok: false,
      reason: jsonlError,
      generatedAt,
      profiles: [],
      kpis: emptyKpis,
      interactions: emptyInteractions,
    };
  }

  // Disjoint by construction (an event lives in exactly ONE store — see
  // the header comment): concat without dedup. The aggregation below is
  // order-insensitive (counters/sets/max), so no sort is needed.
  const rows: UaEventRow[] = [...jsonlRows, ...supabaseRows];

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d7Start = now.getTime() - 7 * 24 * 3600 * 1000;
  const d30Start = now.getTime() - 30 * 24 * 3600 * 1000;
  const depthStarts: Record<UaDepth, number> = {
    today: todayStart,
    d7: d7Start,
    d30: d30Start,
  };

  // Last 30 local dates, oldest first.
  const dailyDates: string[] = [];
  for (let i = 29; i >= 0; i--) {
    dailyDates.push(uaLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }

  const knownHashes = new Map<string, { id: string; label: string }>();
  for (const u of UA_TEST_USERS) {
    knownHashes.set(uaHashToHex64(`eventpulse-user:${u.id}:v1`), u);
  }

  interface UaAcc {
    id: string;
    label: string;
    hash: string | null;
    known: boolean;
    totalEvents: number;
    perDepth: Record<UaDepth, UaDepthStats>;
    sessionsByDepth: Record<UaDepth, Set<string>>;
    dailyMap: Map<string, { events: number; sessions: Set<string> }>;
  }

  // Pre-create the three known profiles so they show even with zero events.
  const accs = new Map<string, UaAcc>();
  for (const u of UA_TEST_USERS) {
    accs.set(u.id, {
      id: u.id,
      label: u.label,
      hash: uaHashToHex64(`eventpulse-user:${u.id}:v1`),
      known: true,
      totalEvents: 0,
      perDepth: { today: uaEmptyDepthStats(), d7: uaEmptyDepthStats(), d30: uaEmptyDepthStats() },
      sessionsByDepth: { today: new Set(), d7: new Set(), d30: new Set() },
      dailyMap: new Map(),
    });
  }

  for (const r of rows) {
    const hash = typeof r.device_id_hash === 'string' && r.device_id_hash.length > 0 ? r.device_id_hash : null;
    const known = hash ? knownHashes.get(hash) : undefined;
    const key = known ? known.id : `unknown:${hash ? hash.slice(0, 8) : 'nohash'}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        id: known ? known.id : (hash ? hash.slice(0, 8) : 'nohash'),
        label: known ? known.label : (hash ? `Okänd enhet (${hash.slice(0, 8)}…)` : 'Okänd (utan hash)'),
        hash,
        known: !!known,
        totalEvents: 0,
        perDepth: { today: uaEmptyDepthStats(), d7: uaEmptyDepthStats(), d30: uaEmptyDepthStats() },
        sessionsByDepth: { today: new Set(), d7: new Set(), d30: new Set() },
        dailyMap: new Map(),
      };
      accs.set(key, acc);
    }

    const type = r.event_type && r.event_type.length > 0 ? r.event_type : 'unknown';
    const sid = r.session_id ?? null;
    const tsStr = r.received_at ?? r.ts ?? null;
    const t = tsStr ? new Date(tsStr).getTime() : NaN;

    acc.totalEvents += 1;

    if (Number.isNaN(t)) continue; // untimed row: counts toward totals only

    const tsIso = new Date(t).toISOString();
    for (const depth of UA_DEPTHS) {
      if (t < depthStarts[depth]) continue;
      const ds = acc.perDepth[depth];
      ds.events += 1;
      ds.byType[type] = (ds.byType[type] ?? 0) + 1;
      if (!ds.lastActive || tsIso > ds.lastActive) ds.lastActive = tsIso;
      if (sid) acc.sessionsByDepth[depth].add(sid);
    }

    const dateKey = uaLocalDate(new Date(t));
    let day = acc.dailyMap.get(dateKey);
    if (!day) {
      day = { events: 0, sessions: new Set() };
      acc.dailyMap.set(dateKey, day);
    }
    day.events += 1;
    if (sid) day.sessions.add(sid);
  }

  const profiles: UaProfileRow[] = [];
  const kpis: UserActivityReport['kpis'] = {
    today: { events: 0, activeProfiles: 0, sessions: 0 },
    d7: { events: 0, activeProfiles: 0, sessions: 0 },
    d30: { events: 0, activeProfiles: 0, sessions: 0 },
  };

  for (const acc of accs.values()) {
    const perDepth: Record<UaDepth, UaDepthStats> = {
      today: acc.perDepth.today,
      d7: acc.perDepth.d7,
      d30: acc.perDepth.d30,
    };
    for (const depth of UA_DEPTHS) {
      perDepth[depth].sessions = acc.sessionsByDepth[depth].size;
      kpis[depth].events += perDepth[depth].events;
      kpis[depth].sessions += perDepth[depth].sessions;
      if (perDepth[depth].events > 0) kpis[depth].activeProfiles += 1;
    }
    profiles.push({
      id: acc.id,
      label: acc.label,
      hash: acc.hash,
      known: acc.known,
      totalEvents: acc.totalEvents,
      perDepth,
      daily: dailyDates.map((date) => {
        const day = acc.dailyMap.get(date);
        return { date, events: day ? day.events : 0, sessions: day ? day.sessions.size : 0 };
      }),
    });
  }

  // Zero-event known profiles contribute nothing to the KPIs — but unknown
  // hashes with zero events can't exist, so no extra filtering needed here.

  // Fas E: the interactions block — user_interactions KPIs plus tile taps
  // counted over the same concatenated analytics rows (JSONL rows carry
  // payload too — readJsonl parses the whole stored line).
  const interactions: UserActivityInteractionsBlock = {
    ...interactionSummary,
    tileTapsByWord: summarizeTileTaps(rows, now),
  };

  return { ok: true, generatedAt, profiles, kpis, interactions };
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  let filePath: string;
  if (url === '/' || url === '/index.html') {
    filePath = join(PUBLIC_DIR, 'index.html');
  } else if (url === '/style.css') {
    filePath = join(PUBLIC_DIR, 'style.css');
  } else if (url === '/app.js') {
    filePath = join(PUBLIC_DIR, 'app.js');
  } else {
    return false;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
  const contentType = filePath.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : filePath.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'application/javascript; charset=utf-8';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  res.end(readFileSync(filePath, 'utf-8'));
  return true;
}

async function serveJson(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '/';
  if (url === '/api/status') {
    try {
      const data = await collect();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return true;
  }
  if (url === '/api/source-health') {
    try {
      const data = collectSourceHealth(PROJECT_ROOT);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url === '/api/user-activity') {
    // User-activity panel — aggregates 10-Analytics' Supabase
    // analytics_events (primary) + runtime/events.jsonl (fallback) per
    // test profile across today/7d/30d depths, PLUS (Fas E) the
    // interactions block from 08-Agent's user_interactions: aktiva
    // användare 7d, interaktionstyper, dwell per källa, unika frågor/dag
    // and Utforska-tile-tryck per ord. Returns HTTP 200 with ok:false
    // when ALL sources are empty so the panel can render an honest muted
    // state instead of fabricated numbers.
    try {
      const data = await collectUserActivity(PROJECT_ROOT);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url && url.startsWith('/api/runs')) {
    // Ingestion runs log — en rad per batch/cykel (e2e/daily/scheduler).
    // Stöder ?limit=N (default 50, max 500). Tom fil → HTTP 200 med count:0.
    try {
      const qIdx = url.indexOf('?');
      let limit = 50;
      if (qIdx !== -1) {
        const params = new URLSearchParams(url.slice(qIdx + 1));
        const raw = Number(params.get('limit') ?? 50);
        if (Number.isFinite(raw) && raw > 0) {
          limit = Math.min(500, Math.floor(raw));
        }
      }
      const runs = readRecentIngestionRuns(limit);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ count: runs.length, runs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url === '/api/review/adapters') {
    try {
      const data = collectAdaptersForReview(PROJECT_ROOT);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url === '/api/review/discovery-candidates') {
    try {
      const data = collectDiscoveryCandidates(PROJECT_ROOT);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  // ─── Source Lifecycle (quarantine / retired / manual review resolve) ─────
  //
  // GET /api/lifecycle/quarantined → sources/_quarantine/INDEX.json
  // GET /api/lifecycle/retired     → sources/_retired/INDEX.json
  // GET /api/lifecycle/auto-quarantined → från runtime/sources_audit.jsonl (event='auto_quarantined')
  // POST /api/review/resolve       → resolvePending(entryId, decision, by, note)
  // POST /api/review/submit        → submitForReview(sourceId, reasonCode, note, by)
  if (url === '/api/lifecycle/quarantined') {
    try {
      const idx = loadQuarantineIndex();
      const entries: LifecycleEntry[] = Array.from(idx.values());
      const data = { count: entries.length, rows: entries, fetchedAt: new Date().toISOString() };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (url === '/api/lifecycle/retired') {
    try {
      const idx = loadRetiredIndex();
      const entries: LifecycleEntry[] = Array.from(idx.values());
      const data = { count: entries.length, rows: entries, fetchedAt: new Date().toISOString() };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  if (req.method === 'POST' && url === '/api/review/resolve') {
    try {
      // Läs body
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        entryId?: string;
        decision?: string;
        decidedBy?: string;
        note?: string;
      };
      const entryId = String(body.entryId ?? '').trim();
      const decision = String(body.decision ?? '').trim() as ReviewDecision;
      const decidedBy = String(body.decidedBy ?? '').trim() || 'dashboard';
      if (!entryId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'entryId required' })); return true; }
      if (!['approve', 'quarantine', 'retire', 're_probe'].includes(decision)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `invalid decision: ${decision}` }));
        return true;
      }
      const result = resolvePending(entryId, decision, decidedBy, body.note, PROJECT_ROOT);
      const status = result.ok ? 200 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }
  if (req.method === 'POST' && url === '/api/review/submit') {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        sourceId?: string;
        reasonCode?: string;
        note?: string;
        submittedBy?: string;
      };
      const sourceId = String(body.sourceId ?? '').trim();
      const reasonCode = String(body.reasonCode ?? 'unknown').trim();
      const note = String(body.note ?? '').trim();
      const submittedBy = String(body.submittedBy ?? '').trim() || 'dashboard';
      if (!sourceId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'sourceId required' })); return true; }
      if (!note) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'note required' })); return true; }
      const result = submitForReview(sourceId, reasonCode, note, submittedBy, PROJECT_ROOT);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // ─── Ingestion cron endpoints ───────────────────────────────────────────────
  //
  // GET  /api/ingestion/status → runtime/ingestion-cron.status.json (sanning)
  // POST /api/ingestion/start  → spawn detached ingestion-cron.ts
  // POST /api/ingestion/stop   → SIGTERM till PID i statusfilen
  if (url === '/api/ingestion/status') {
    try {
      const data = readIngestionCronStatus();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }
  // POST /api/bfl-error — logga ett BFL-anrop-fel under ingestion.
  // Body: { error: string, statusCode?: number }
  if (req.method === 'POST' && url === '/api/bfl-error') {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const parsed = JSON.parse(body || '{}');
      if (typeof parsed.error !== 'string' || parsed.error.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing .error string' }));
        return true;
      }
      appendBflError({
        timestamp: new Date().toISOString(),
        source: 'ingestion',
        error: parsed.error.slice(0, 200),
        statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined,
      });
      _bflCreditsCache = null; // invalidera så dashboard-refresh ser direkt
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }
  // GET /api/bfl-credits — direkt-fetch (för test/debug).
  if (url === '/api/bfl-credits' && req.method === 'GET') {
    try {
      const data = await collectBflCredits();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return true;
  }
  if (req.method === 'POST' && url === '/api/ingestion/start') {
    try {
      const result = await toggleIngestionCron('start');
      res.writeHead(result.ok ? 200 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }
  if (req.method === 'POST' && url === '/api/ingestion/stop') {
    try {
      const result = await toggleIngestionCron('stop');
      res.writeHead(result.ok ? 200 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // Toggle endpoint — startar/stoppar 10-Analytics-servern (port 7778).
  // Trycker man på knappen i headern blir denna route triggad.
  if (req.method === 'POST' && url === '/api/analytics-server/toggle') {
    try {
      const result = await toggleAnalyticsServer();
      res.writeHead(result.ok ? 200 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, action: 'noop', error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // ─── BFL orchestrate endpoints (2026-10-12) ────────────────────────────
  // Möjliggör knapp-kontrollerad BFL-bildgenerering direkt från dashboard.
  // GET  /api/bfl/categories  — distinct kategorier från image_library
  // POST /api/bfl/run         — starta orchestrator (returnerar runId + pid)
  // GET  /api/bfl/run/:id/status — läs senaste state från tmp/bfl_runs/<id>.json
  // POST /api/bfl/run/:id/cancel — SIGTERM till orchestrator-processen

  if (req.method === 'GET' && url === '/api/bfl/categories') {
    try {
      const cats = await collectBflCategories();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ok: true, categories: cats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  if (req.method === 'POST' && url === '/api/bfl/run') {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const parsed = JSON.parse(body || '{}') as {
        category?: string;
        count?: number;
        maxCredits?: number;
        mockPrompts?: boolean;
      };
      if (typeof parsed.category !== 'string' || parsed.category.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing category' }));
        return true;
      }
      if (typeof parsed.count !== 'number' || parsed.count <= 0 || parsed.count > 2000) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'count must be 1-2000' }));
        return true;
      }
      const estimated = 4 * parsed.count;
      const cap = parsed.maxCredits ?? estimated;
      if (estimated > cap) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `credit-spärr: ${estimated} > ${cap}` }));
        return true;
      }
      // Kolla tillgängliga credits om vi kan (för att ge en tydligare 400)
      let available: number | null = null;
      try {
        const credits = await collectBflCredits();
        if (typeof credits.credits === 'number') available = credits.credits;
      } catch {
        /* ignore — tillåt körning ändå */
      }
      if (available !== null && estimated > available) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `BFL-credits otillräckligt: behov=${estimated}, tillgängligt=${available}` }));
        return true;
      }
      const run = startBflOrchestrator(parsed);
      _bflCreditsCache = null; // invalidate — körningen kan påverka framtida kredit-räkning
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // /api/bfl/run/:id/status
  const statusMatch = url.match(/^\/api\/bfl\/run\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'GET') {
    const runId = statusMatch[1];
    const state = readBflRunState(runId);
    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'run not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ok: true, result: state }));
    return true;
  }

  // /api/bfl/run/:id/cancel
  const cancelMatch = url.match(/^\/api\/bfl\/run\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const runId = cancelMatch[1];
    const cancelled = cancelBflRun(runId);
    res.writeHead(cancelled.ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cancelled));
    return true;
  }

  // ─── BFL zoom-run endpoints (2026-10-18) ────────────────────────────
// NY pipeline (parallell med befintlig /api/bfl/run, rör INTE den).
// Genererar bilder med 10 zoomdjup × 3 pose × 3 ljus variation,
// MiniMax-modell, AI-stämpling, 2-fas kvotfyllnad (se docs).

interface ZoomRunState {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
  count: number;
  categories: string[];
  model: string;
  variant: string;
  out: string;
  pid: number | null;
  exitCode: number | null;
  log: string[];
  imageCount: number;
}

const ZOOM_RUNS_DIR = join(PROJECT_ROOT, 'tmp', 'bfl_runs');

/**
 * Auto-fill: beräkna count baserat på quota + state (truth = disk).
 *
 * Pipeline (användarens ordning 2026-10-19):
 *   1. Ladda state från disk
 *   2. Synka state mot FAKTISKA .webp-filer (reconcileFromDisk) — disk är sanningen
 *   3. Persista synkad state till state/zoom-coverage.json
 *   4. Räkna events per kategori (från Supabase)
 *   5. Räkna disk-filer (för verifiering / defensiv cross-check)
 *   6. För varje kategori: target = 20 + ceil((events-600)/30)
 *      gap = max(0, target - state.totals[cat])
 *      Saknade kombinationer = 90 - state.combos[cat][tag].length, summerat
 *   7. count = min(200, gap + min(50, missingCombos))
 *
 * Returnerar 0 om inget behövs.
 */
async function computeAutoFillCount(
  categoriesFilter?: string[],
): Promise<number> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return 10;

  // 1. Ladda state från disk (eller ny tom state)
  let state = loadCoverageState(PROJECT_ROOT);

  // 2. Synka state mot FAKTISKA .webp-filer (disk är sanningen).
  // Användaren bestämde 2026-10-19 att state ska reflektera disk FÖRE beräkning
  // av behov — annars drar state ifrån verkligheten och auto-fill genererar dubletter.
  const stampedDir = join(PROJECT_ROOT, 'local_image_library_stamped');
  const sync = reconcileFromDisk(state, PROJECT_ROOT);
  if (sync.added > 0) {
    sync.next.totals = (() => {
      // Bygg om totals från combos (single source of truth: combos -> totals)
      const totals: Record<string, number> = {};
      for (const [cat, byTag] of Object.entries(sync.next.combos)) {
        let n = 0;
        for (const arr of Object.values(byTag)) n += arr.length;
        totals[cat] = n;
      }
      return totals;
    })();
    sync.next.lastUpdated = new Date().toISOString();
    writeFileSync(
      join(PROJECT_ROOT, 'state', 'zoom-coverage.json'),
      JSON.stringify(sync.next, null, 2),
    );
    console.log(
      `[auto-fill] reconcileFromDisk: ${sync.added} nya kombos tillagda, ${sync.skipped} hoppade (av ${sync.scanned} filer på disk)`,
    );
  }
  state = sync.next;

  // 3. Hämta events per kategori
  const eventsMap = new Map<string, number>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?select=category_slug&offset=${offset}&limit=${PAGE}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!r.ok) break;
    const rows = (await r.json()) as Array<{ category_slug: string | null }>;
    if (!rows.length) break;
    for (const row of rows) {
      if (row.category_slug) {
        eventsMap.set(row.category_slug, (eventsMap.get(row.category_slug) ?? 0) + 1);
      }
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // 4. Räkna FAKTISKA bilder på disk (truth-of-source, cross-check mot state.totals).
  // image_library-tabellen i Supabase är inte komplett — många zoom-pipeline-filer
  // registrerades aldrig där. Disk är den enda sanningen för vad som faktiskt finns.
  const diskMap = new Map<string, number>();
  if (existsSync(stampedDir)) {
    for (const cat of readdirSync(stampedDir)) {
      const catDir = join(stampedDir, cat);
      if (!statSync(catDir).isDirectory()) continue;
      const webps = readdirSync(catDir).filter((f) => f.endsWith('.webp') && f.startsWith('zoom_'));
      diskMap.set(cat, webps.length);
    }
  }

  // 5. Beräkna gap + saknade kombinationer per kategori.
  // Vi använder state.totals (NU synkad) som library-räknare — diskMap är cross-check.
  let totalGap = 0;
  let totalMissingCombos = 0;
  const allCats = new Set([...eventsMap.keys(), ...diskMap.keys(), ...Object.keys(state.totals)]);
  for (const cat of allCats) {
    if (categoriesFilter && categoriesFilter.length > 0 && !categoriesFilter.includes(cat)) continue;
    const ev = eventsMap.get(cat) ?? 0;
    if (ev === 0) continue;
    // library-count: state.totals (synkad) — fallback till diskMap om state saknar cat
    const lib = state.totals[cat] ?? diskMap.get(cat) ?? 0;
    // Använd användarens quota-formel
    const target = 20 + Math.max(0, Math.ceil((ev - 600) / 30));
    const gap = Math.max(0, target - lib);
    totalGap += gap;
    // Saknade kombinationer i state för denna kategori (summerat över tags)
    const catCombos = state.combos[cat] ?? {};
    for (const tag of Object.keys(catCombos)) {
      const missing = Math.max(0, 90 - (catCombos[tag]?.length ?? 0));
      totalMissingCombos += missing;
    }
  }
  // 6. Cap vid rimlig mängd för att inte bränna för mycket credits
  return Math.min(200, totalGap + Math.min(50, totalMissingCombos));
}

function readZoomRunState(runId: string): ZoomRunState | null {
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
  const p = join(ZOOM_RUNS_DIR, `zoom_${runId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as ZoomRunState; }
  catch { return null; }
}

// POST /api/bfl/zoom-run
if (req.method === 'POST' && url === '/api/bfl/zoom-run') {
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    const parsed = JSON.parse(body || '{}') as {
      count?: number;
      categories?: string[];
      model?: string;
      variant?: 'legacy' | 'small';
      out?: string;
      auto?: boolean;  // NY: auto-fill baserat på quota + state
      maxCount?: number; // NY: input-rutan-cap för auto-fill (annars fri)
      resetState?: boolean;  // NY: töm state/zoom-coverage.json före körning
    };
    let count = Math.max(1, Math.min(500, parsed.count ?? 10));
    let autoNote = '';
    let cappedByInput = false;
    if (parsed.auto) {
      // Auto-fill: beräkna count baserat på quota + saknade kombinationer.
      // Läser state/zoom-coverage.json och quota-formeln.
      count = await computeAutoFillCount(parsed.categories);
      autoNote = ` (auto-fill: count beräknat till ${count} baserat på 1/30-quota + saknade kombinationer)`;
      // input-rutan fungerar som MAX-CAP när auto-fill är aktivt.
      if (typeof parsed.maxCount === 'number' && parsed.maxCount >= 1) {
        const cap = Math.min(500, Math.max(1, Math.floor(parsed.maxCount)));
        if (cap < count) {
          autoNote += ` — cappat till ${cap} (input-rutan)`;
          cappedByInput = true;
        }
        count = Math.min(count, cap);
      }
    }
    const args = [
      '--env-file=.env',
      '--import', 'file:///Users/claudgashi/EventPulse/node_modules/tsx/dist/loader.mjs',
      'BFL-generator/bin/bfl-zoom-orchestrate.ts',
      `--count=${count}`,
    ];
    if (parsed.categories && parsed.categories.length > 0) {
      args.push(`--categories=${parsed.categories.join(',')}`);
    }
    if (parsed.model) args.push(`--model=${parsed.model}`);
    if (parsed.variant === 'small') args.push('--variant=small');
    if (parsed.out) args.push(`--out=${parsed.out}`);
    if (parsed.resetState) args.push('--reset-state');

    const runId = newBflRunId();
    // Skicka runId till orchestrator FÖRE spawn (så batch + dashboard delar samma state-fil)
    args.push(`--run-id=${runId}`);

    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,  // överlever om dashboard startas om
    });
    child.unref();
    // Sätt in pending state
    if (!existsSync(ZOOM_RUNS_DIR)) mkdirSync(ZOOM_RUNS_DIR, { recursive: true });
    const pending: ZoomRunState = {
      runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      count,
      categories: parsed.categories ?? [],
      model: parsed.model ?? 'image-01',
      variant: parsed.variant ?? 'legacy',
      out: parsed.out ?? 'local_image_library_stamped',
      pid: child.pid ?? null,
      exitCode: null,
      log: [],
      imageCount: 0,
    };
    writeFileSync(join(ZOOM_RUNS_DIR, `zoom_${runId}.json.tmp`), JSON.stringify(pending, null, 2));
    renameSync(join(ZOOM_RUNS_DIR, `zoom_${runId}.json.tmp`), join(ZOOM_RUNS_DIR, `zoom_${runId}.json`));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      runId,
      pid: child.pid,
      count,
      autoNote: autoNote || undefined,
      cappedByInput: cappedByInput || undefined,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  }
  return true;
}

// GET /api/bfl/zoom-run/:id/status
const zoomStatusMatch = url.match(/^\/api\/bfl\/zoom-run\/([^/]+)\/status$/);
if (zoomStatusMatch && req.method === 'GET') {
  const state = readZoomRunState(zoomStatusMatch[1]);
  if (!state) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'run not found' }));
    return true;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify({ ok: true, result: state }));
  return true;
}

// GET /api/bfl/zoom-run/latest — returnera senaste körningens state
if (url === '/api/bfl/zoom-run/latest' && req.method === 'GET') {
  if (!existsSync(ZOOM_RUNS_DIR)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: null }));
    return true;
  }
  const files = readdirSync(ZOOM_RUNS_DIR)
    .filter((f) => f.startsWith('zoom_') && f.endsWith('.json'))
    .sort()
    .reverse();
  let latest: ZoomRunState | null = null;
  for (const f of files) {
    try {
      latest = JSON.parse(readFileSync(join(ZOOM_RUNS_DIR, f), 'utf8')) as ZoomRunState;
      break;
    } catch { /* skip */ }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, result: latest }));
  return true;
}

// ─── BFL model-compare endpoints (2026-10-18) ─────────────────────
  // PARALLELLA experiment-endpoints. Rör INTE /api/bfl/* ovan.
  // Genererar 3 bilder (3 default-kategorier) med EN modell per klick.
  // Output hamnar i en gemensam parent-mapp för modell-jämförelse.
  // Skriver INTE till image_library / Supabase / local_image_library.

  const COMPARE_MODELS = new Set(['bfl-flux-2-pro', 'minimax-image-01']);
  const COMPARE_DEFAULT_CATEGORIES = ['music', 'theatre-drama', 'community'];
  const COMPARE_RUNS_DIR = join(PROJECT_ROOT, 'tmp', 'bfl_runs');
  const COMPARE_OUT_BASE = join(PROJECT_ROOT, 'tmp');

  interface CompareRunState {
    runId: string;
    model: string;
    status: 'running' | 'success' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    outDir: string;
    pid: number | null;
    exitCode: number | null;
    log: string[];
    images: Array<{ category: string; file: string; ok: boolean }>;
  }

  function readCompareRunState(runId: string): CompareRunState | null {
    if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
    const p = join(COMPARE_RUNS_DIR, `compare_${runId}.json`);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  }

  function writeCompareRunState(state: CompareRunState): void {
    if (!existsSync(COMPARE_RUNS_DIR)) mkdirSync(COMPARE_RUNS_DIR, { recursive: true });
    const p = join(COMPARE_RUNS_DIR, `compare_${state.runId}.json`);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, p);
  }

  if (req.method === 'POST' && url === '/api/bfl/compare-test') {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const parsed = JSON.parse(body || '{}') as { model?: string; outDir?: string };
      if (!parsed.model || !COMPARE_MODELS.has(parsed.model)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `model måste vara en av ${Array.from(COMPARE_MODELS).join(', ')}` }));
        return true;
      }
      const runId = newBflRunId();
      // Använd utdelad outDir (så flera knappar kan peka på samma parent),
      // annars skapa en ny parent per körning.
      const outDir = parsed.outDir && typeof parsed.outDir === 'string' && parsed.outDir.startsWith(PROJECT_ROOT)
        ? parsed.outDir
        : join(COMPARE_OUT_BASE, `bfl_model_compare_${runId}`);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const state: CompareRunState = {
        runId,
        model: parsed.model,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        outDir,
        pid: null,
        exitCode: null,
        log: [],
        images: [],
      };
      writeCompareRunState(state);

      // Spawn tools/bfl-model-compare.mjs som subprocess.
      // --no-open: dashboarden öppnar mappen själv när status=success.
      const args = [
        '--env-file=.env',
        'tools/bfl-model-compare.mjs',
        `--model=${parsed.model}`,
        `--out-dir=${outDir}`,
        '--no-open',
      ];
      // Använd absolut path till node. När dashboard-servern kör under tsx
      // och spawnar 'node' får macOS-barnet en minimal env där 'node' inte
      // alltid är i PATH (vi såg "spawn ENOENT" utan detta).
      const nodeBin = process.execPath; // samma node-binär som dashboard själv körs på
      const child = spawn(nodeBin, args, {
        cwd: PROJECT_ROOT,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      state.pid = child.pid ?? null;
      writeCompareRunState(state);

      child.stdout?.on('data', (d: Buffer) => {
        const lines = d.toString('utf8').split('\n').filter(Boolean);
        state.log.push(...lines);
        if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
        writeCompareRunState(state);
      });
      child.stderr?.on('data', (d: Buffer) => {
        const lines = d.toString('utf8').split('\n').filter(Boolean);
        state.log.push(...lines.map((l) => `[stderr] ${l}`));
        if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
        writeCompareRunState(state);
      });

      child.on('close', (code) => {
        state.exitCode = code;
        state.finishedAt = new Date().toISOString();
        state.status = code === 0 ? 'success' : 'failed';
        writeCompareRunState(state);
      });
      child.on('error', (err) => {
        state.log.push(`spawn error: ${err.message}`);
        state.status = 'failed';
        state.finishedAt = new Date().toISOString();
        writeCompareRunState(state);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, runId, outDir, model: parsed.model, pid: state.pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // /api/bfl/compare-test/:id/status
  const compareStatusMatch = url.match(/^\/api\/bfl\/compare-test\/([^/]+)\/status$/);
  if (compareStatusMatch && req.method === 'GET') {
    const state = readCompareRunState(compareStatusMatch[1]);
    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'run not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ok: true, result: state }));
    return true;
  }

  // GET /api/bfl/compare-test/out-dir — returnerar senaste körningens outDir
  // (för att klienten ska kunna återöppna samma parent efter båda knapparna).
  if (url === '/api/bfl/compare-test/out-dir' && req.method === 'GET') {
    try {
      // Hitta senaste compare_*.json i runs-dir → använd dess outDir.
      if (!existsSync(COMPARE_RUNS_DIR)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, outDir: null }));
        return true;
      }
      const files = readdirSync(COMPARE_RUNS_DIR)
        .filter((f) => f.startsWith('compare_') && f.endsWith('.json'))
        .sort()
        .reverse();
      let latest: CompareRunState | null = null;
      for (const f of files) {
        try {
          latest = JSON.parse(readFileSync(join(COMPARE_RUNS_DIR, f), 'utf8')) as CompareRunState;
          break;
        } catch { /* skip */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, outDir: latest?.outDir ?? null }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

  // GET /api/bfl/compare-test/open?dir=... — kör `open <dir>` på macOS.
  // Säkerhets-validering: dir måste vara under PROJECT_ROOT/tmp/.
  if (url.startsWith('/api/bfl/compare-test/open') && req.method === 'GET') {
    try {
      const u = new URL(req.url, 'http://x');
      const dirRaw = u.searchParams.get('dir');
      if (!dirRaw) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing dir param' }));
        return true;
      }
      const resolved = resolve(dirRaw);
      const projectResolved = resolve(PROJECT_ROOT);
      if (!resolved.startsWith(projectResolved)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'dir utanför PROJECT_ROOT' }));
        return true;
      }
      if (!existsSync(resolved)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'dir finns inte' }));
        return true;
      }
      execFile('open', [resolved], { timeout: 3000 }, () => { /* swallow */ });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dir: resolved }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    }
    return true;
  }

// ─── Adaptive fill (2026-10-29) ─────────────────────────────────────────
// Knappen "MiniMax image-01" på dashboarden fyller ut biblioteket med N nya
// bilder via scripts/adaptive_image_gen.ts — samma logik som den
// bakgrundsgående körningen (kvotplan + M3-granskning + grind).
//
// Varje körning får en egen mapp under runtime/adaptive-image-gen/runs/<id>/
// med state.json, verify.ndjson, progress.json och run.log.

const ADAPTIVE_RUNS_DIR = join(PROJECT_ROOT, 'runtime', 'adaptive-image-gen', 'runs');
const ADAPTIVE_LOCK_FILE = join(PROJECT_ROOT, 'runtime', 'adaptive-image-gen', 'run.lock');

interface AdaptiveRunMeta {
  runId: string;
  pid: number | null;
  count: number;
  extra: number;
  concurrency: number;
  start: number;
  startedAt: string;
  runDir: string;
  logPath: string;
}

interface AdaptiveProgress {
  startedAt: string;
  updatedAt: string;
  round: number;
  size: number;
  target: number;
  remaining: number;
  generated: number;
  passed: number;
  failed: number;
  apiErrors: number;
  lastFile: string | null;
  lastCategory: string | null;
  lastVerdict: string | null;
  done: boolean;
}

/**
 * Hittar pågående adaptive_image_gen-processer.
 *
 * RpmGuard i generatorn räknar per PROCESS, och MiniMax image_generation
 * har 10 RPM tak. Två parallella körningar skulle tillsammans ge upp till
 * 18 anrop/min → 429. Därför vägrar vi starta en ny körning när en redan
 * pågår (även om den startats utanför dashboarden).
 */
function findAdaptiveRuns(): number[] {
  try {
    // `comm` = det körbara programmet (t.ex. "node"), `args` = hela
    // kommandoraden. VI MÅSTE matcha på comm — en ren substring-sökning på
    // args ger falska träffar: varje rad som *nämner* både "node" och
    // "adaptive_image_gen.ts" (t.ex. en bash-rad, en grep, en editor) sågs
    // tidigare som en pågående körning, och dashboarden vägrade starta.
    const out = execFileSync('ps', ['-ax', '-o', 'pid=,comm=,args='], {
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const pids: number[] = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      const [, pidStr, comm, args] = m;
      const exe = comm.split('/').pop() ?? '';
      if (exe !== 'node') continue; // endast riktiga node-processer
      if (!args.includes('adaptive_image_gen.ts')) continue;
      pids.push(Number(pidStr));
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * Körningar som startats via dashboarden (run.json med levande pid).
 *
 * Skiljer sig från findAdaptiveRuns(): denna fångar körningar vars argv
 * inte längre syns (t.ex. efter en omstart av dashboarden) och täcker
 * fönstret mellan två samtidiga POST-anrop — där hinner ingen process-scan
 * se den andra.
 */
function findLiveAdaptiveRuns(): Array<{ runId: string; pid: number }> {
  if (!existsSync(ADAPTIVE_RUNS_DIR)) return [];
  const out: Array<{ runId: string; pid: number }> = [];
  for (const dir of readdirSync(ADAPTIVE_RUNS_DIR)) {
    const p = join(ADAPTIVE_RUNS_DIR, dir, 'run.json');
    if (!existsSync(p)) continue;
    try {
      const meta = JSON.parse(readFileSync(p, 'utf8')) as { runId?: string; pid?: number };
      const pid = Number(meta?.pid ?? 0);
      if (!pid) continue;
      try {
        process.kill(pid, 0);
        out.push({ runId: String(meta?.runId ?? dir), pid });
      } catch {
        /* processen är död → ingen levande körning */
      }
    } catch { /* trasig run.json → hoppa över */ }
  }
  return out;
}

/** Låset som generatorn sätter — läses för att ge en tydligare feltext. */
function adaptiveLockOwner(): number | null {
  try {
    if (!existsSync(ADAPTIVE_LOCK_FILE)) return null;
    const info = JSON.parse(readFileSync(ADAPTIVE_LOCK_FILE, 'utf8')) as { pid?: number };
    const pid = Number(info?.pid ?? 0);
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function readAdaptiveRunMeta(runId: string): AdaptiveRunMeta | null {
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
  const p = join(ADAPTIVE_RUNS_DIR, runId, 'run.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as AdaptiveRunMeta;
  } catch {
    return null;
  }
}

function readAdaptiveProgress(runId: string): AdaptiveProgress | null {
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
  const p = join(ADAPTIVE_RUNS_DIR, runId, 'progress.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as AdaptiveProgress;
  } catch {
    return null;
  }
}

function pidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailFile(path: string, lines = 12): string[] {
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8').trimEnd();
    if (!raw) return [];
    return raw.split('\n').slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Klippar ett numeriskt värde till [min, max].
 *
 * Viktigt: `Math.floor(Number('abc'))` → NaN, och `Math.max(1, NaN)` → NaN.
 * Ett NaN värde nådde tidigare CLI:n som `--max-total=NaN`, där
 * `parseInt('NaN')` → NaN → generatorn slutar omedelbart. Oklippbara
 * värden (tom sträng, "abc") ska alltså FALLBACKA, inte passera igenom.
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** POST /api/bfl/adaptive-run — starta en adaptiv "fyll ut"-körning. */
if (req.method === 'POST' && url === '/api/bfl/adaptive-run') {
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    const parsed = JSON.parse(body || '{}') as {
      count?: number;
      extra?: number;
      concurrency?: number;
      start?: number;
    };

    const count = clampInt(parsed.count, 1, 800, 300);
    const extra = clampInt(parsed.extra ?? parsed.count, 0, 800, count);
    const concurrency = clampInt(parsed.concurrency, 1, 12, 8);
    const start = clampInt(parsed.start, 1, 64, 32);

    // 1) Ingen parallell körning (RPM-taket är per process).
    //    Tre oberoende kontroller:
    //    a) process-scan (fångar körningar startade utanför dashboarden)
    //    b) run.json med levande pid (fångar dashboardkörningar)
    //    c) låsfilen (fångar en körning som håller på att starta)
    //    (b) täcker också fönstret mellan två samtidiga POST-anrop, där
    //    process-scanen ännu inte ser den andra processen.
    const running = findAdaptiveRuns();
    if (running.length > 0) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          error: `en bildgenerering körs redan (pid ${running.join(', ')}) — MiniMax-taket är 10 bilder/min, så två körningar samtidigt skulle ge 429-fel`,
        }),
      );
      return true;
    }
    const live = findLiveAdaptiveRuns();
    if (live.length > 0) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          error: `en bildgenerering körs redan (pid ${live.map((r) => r.pid).join(', ')}) — MiniMax-taket är 10 bilder/min, så två körningar samtidigt skulle ge 429-fel`,
        }),
      );
      return true;
    }
    const lockOwner = adaptiveLockOwner();
    if (lockOwner) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          error: `låset är taget av pid ${lockOwner} — en körning pågår redan`,
        }),
      );
      return true;
    }

    // 2) Starta körningen i egen mapp med eget state.
    const runId = newBflRunId();
    const runDir = join(ADAPTIVE_RUNS_DIR, runId);
    mkdirSync(runDir, { recursive: true });
    const logPath = join(runDir, 'run.log');
    const fd = openSync(logPath, 'a');

    const args = [
      '--env-file=.env',
      '--import',
      'tsx',
      'scripts/adaptive_image_gen.ts',
      `--run-dir=${runDir}`,
      `--extra=${extra}`,
      `--max-total=${count}`,
      `--start=${start}`,
      '--max-rounds=60',
      `--concurrency=${concurrency}`,
      '--reset',
    ];

    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', fd, fd],
      detached: true, // överlever om dashboarden startas om
    });
    child.unref();
    closeSync(fd);

    const meta: AdaptiveRunMeta = {
      runId,
      pid: child.pid ?? null,
      count,
      extra,
      concurrency,
      start,
      startedAt: new Date().toISOString(),
      runDir,
      logPath,
    };
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(meta, null, 2));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, runId, pid: meta.pid, count, extra, concurrency, runDir }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  }
  return true;
}

// GET /api/bfl/adaptive-run/:id/status
const adaptiveStatusMatch = url.match(/^\/api\/bfl\/adaptive-run\/([^/]+)\/status$/);
if (adaptiveStatusMatch && req.method === 'GET') {
  const runId = adaptiveStatusMatch[1];
  const meta = readAdaptiveRunMeta(runId);
  if (!meta) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'run not found' }));
    return true;
  }
  const prog = readAdaptiveProgress(runId);
  const alive = pidAlive(meta.pid);
  const status = prog?.done ? 'success' : alive ? 'running' : 'failed';
  const generated = prog?.generated ?? 0;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(
    JSON.stringify({
      ok: true,
      result: {
        runId,
        status,
        pid: meta.pid,
        count: meta.count,
        extra: meta.extra,
        concurrency: meta.concurrency,
        generated,
        passed: prog?.passed ?? 0,
        failed: prog?.failed ?? 0,
        apiErrors: prog?.apiErrors ?? 0,
        round: prog?.round ?? 0,
        size: prog?.size ?? 0,
        target: prog?.target ?? 0,
        remaining: prog?.remaining ?? 0,
        percent: meta.count > 0 ? Math.min(100, Math.round((generated / meta.count) * 100)) : 0,
        startedAt: meta.startedAt,
        updatedAt: prog?.updatedAt ?? meta.startedAt,
        done: prog?.done ?? false,
        lastFile: prog?.lastFile ?? null,
        lastCategory: prog?.lastCategory ?? null,
        lastVerdict: prog?.lastVerdict ?? null,
        logTail: tailFile(meta.logPath),
      },
    }),
  );
  return true;
}

// GET /api/bfl/adaptive-run/latest — senaste körningens state.
if (url === '/api/bfl/adaptive-run/latest' && req.method === 'GET') {
  try {
    if (!existsSync(ADAPTIVE_RUNS_DIR)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, result: null }));
      return true;
    }
    const dirs = readdirSync(ADAPTIVE_RUNS_DIR)
      .filter((d) => existsSync(join(ADAPTIVE_RUNS_DIR, d, 'run.json')))
      .sort()
      .reverse();
    let latest: AdaptiveRunMeta | null = null;
    for (const d of dirs) {
      try {
        latest = JSON.parse(readFileSync(join(ADAPTIVE_RUNS_DIR, d, 'run.json'), 'utf8')) as AdaptiveRunMeta;
        break;
      } catch { /* skip */ }
    }
    if (!latest) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, result: null }));
      return true;
    }
    const prog = readAdaptiveProgress(latest.runId);
    const alive = pidAlive(latest.pid);
    const generated = prog?.generated ?? 0;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          runId: latest.runId,
          status: prog?.done ? 'success' : alive ? 'running' : 'failed',
          pid: latest.pid,
          count: latest.count,
          extra: latest.extra,
          concurrency: latest.concurrency,
          generated,
          passed: prog?.passed ?? 0,
          failed: prog?.failed ?? 0,
          apiErrors: prog?.apiErrors ?? 0,
          round: prog?.round ?? 0,
          size: prog?.size ?? 0,
          target: prog?.target ?? 0,
          remaining: prog?.remaining ?? 0,
          percent: latest.count > 0 ? Math.min(100, Math.round((generated / latest.count) * 100)) : 0,
          startedAt: latest.startedAt,
          updatedAt: prog?.updatedAt ?? latest.startedAt,
          done: prog?.done ?? false,
          lastFile: prog?.lastFile ?? null,
          lastCategory: prog?.lastCategory ?? null,
          lastVerdict: prog?.lastVerdict ?? null,
          logTail: tailFile(latest.logPath),
        },
      }),
    );
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  }
  return true;
}


  return false;
}

// ─── Review endpoints (adapters + discovery candidates) ────────────────────

interface AdapterReviewRow {
  sourceId: string;
  type: string;
  seedUrl: string;
  validationPassed: boolean;
  aiConfidence: number;
  generatedAt: string;
  validatedAt: string;
  validationNotes: string;
  path: string; // runtime-relative path for the "open file" hint
}

interface DiscoveryCandidateRow {
  sourceId: string;
  candidateUrl: string;
  score: number;
  productivity: number;
  stability: number;
  discoveredAt: string;
  reason: string;
  evidence: Record<string, unknown> | undefined;
}

function collectAdaptersForReview(root: string): { count: number; rows: AdapterReviewRow[] } {
  const adaptersDir = join(root, 'runtime/adapters');
  if (!existsSync(adaptersDir)) return { count: 0, rows: [] };
  const files = readdirSync(adaptersDir).filter((f) => f.endsWith('.json') && f !== '_manifest.jsonl');
  const rows: AdapterReviewRow[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(adaptersDir, f), 'utf-8')) as Record<string, unknown>;
      rows.push({
        sourceId: String(raw.sourceId ?? f.replace(/\.json$/, '')),
        type: String(raw.type ?? 'unknown'),
        seedUrl: String(raw.seedUrl ?? ''),
        validationPassed: raw.validationPassed === true,
        aiConfidence: Number(raw.aiConfidence ?? 0),
        generatedAt: String(raw.generatedAt ?? ''),
        validatedAt: String(raw.validatedAt ?? ''),
        validationNotes: String(raw.validationNotes ?? ''),
        path: `runtime/adapters/${f}`,
      });
    } catch {
      // skip malformed file
    }
  }
  // sort: failed validation first, then lowest confidence
  rows.sort((a, b) => {
    if (a.validationPassed !== b.validationPassed) return a.validationPassed ? 1 : -1;
    return a.aiConfidence - b.aiConfidence;
  });
  return { count: rows.length, rows };
}

function collectDiscoveryCandidates(root: string): { count: number; rows: DiscoveryCandidateRow[] } {
  const path = join(root, 'runtime/discovery-candidates.jsonl');
  if (!existsSync(path)) return { count: 0, rows: [] };
  const text = readFileSync(path, 'utf-8').trim();
  if (!text) return { count: 0, rows: [] };
  const rows: DiscoveryCandidateRow[] = text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        return {
          sourceId: String(o.sourceId ?? ''),
          candidateUrl: String(o.candidateUrl ?? ''),
          score: Number(o.score ?? 0),
          productivity: Number(o.productivity ?? 0),
          stability: Number(o.stability ?? 0),
          discoveredAt: String(o.discoveredAt ?? ''),
          reason: String(o.reason ?? ''),
          evidence: (o.evidence as Record<string, unknown> | undefined) ?? undefined,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is DiscoveryCandidateRow => r !== null);
  // sort: highest score first
  rows.sort((a, b) => b.score - a.score);
  return { count: rows.length, rows };
}

const server = createServer(async (req, res) => {
  if (serveStatic(req, res)) return;
  if (await serveJson(req, res)) return;
  res.writeHead(404);
  res.end('Not found');
});

// Auto-listen only when this file is executed directly (launchd plist,
// tools/dashboard_lifecycle.ts spawn, or manual `npx tsx`). Importing the
// module — as tests do — must never bind PORT: module-level listen caused
// EADDRINUSE unhandled errors in vitest whenever the real dashboard was
// already running (and booted a rogue second one when it wasn't).
const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`[supervisor-dashboard] listening on http://localhost:${PORT}`);
    console.log(`[supervisor-dashboard] project root: ${PROJECT_ROOT}`);
  });
}

export { server };
