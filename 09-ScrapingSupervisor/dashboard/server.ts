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
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
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
  type Kpis,
  type DbSourceRow,
  type TimeSeries,
  type LayerExtractionOverview,
  type UnsyncedReport,
} from './db';

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
  // Live state (Phase 5): BullMQ + 08-Agent
  bullmq: BullmqSummary;
  agent: AgentMetrics;
  // BFL credit balance (header box — left of analytics)
  bflCredits: BflCredits;
  // 10-Analytics server status (header box — right of analytics)
  analyticsServer: AnalyticsServerStatus;
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
  const [kpis, dbSources, timeSeries] = await Promise.all([
    collectKpis(),
    collectDbSources(),
    collectTimeSeries(120),
  ]);

  // Annotate DB-fed sources with site-specific flag from the adapter dir.
  const adapterSet = buildAdapterSet(PROJECT_ROOT);
  for (const row of dbSources) row.hasAdapter = adapterSet.has(row.source);

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
    bullmq: await collectBullmq(),
    agent: await collectAgent(),
    bflCredits: await collectBflCredits(),
    analyticsServer: await collectAnalyticsServer(),
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

async function collectBullmq(): Promise<BullmqSummary> {
  // Dynamic import via file URL — keeps BullMQ out of cold-start path if Redis is down.
  // Use absolute path to dodge tsx relative-path quirks with hyphen/space in cwd.
  try {
    const queueUrl = pathToFileURL(join(PROJECT_ROOT, '03-Queue/queue.ts')).href;
    const mod: any = await import(queueUrl);
    const { rawEventsQueue, smokeTestQueue, searchSyncQueue } = mod;
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    const [raw, smoke, search] = await Promise.all([
      withTimeout(rawEventsQueue.getJobCounts()),
      withTimeout(smokeTestQueue.getJobCounts()),
      withTimeout(searchSyncQueue.getJobCounts()),
    ]);
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

// BFL credits — proxied from autoGenServer (port 7790). 60s in-process cache
// så 15-min meta-refresh inte hamrar BFL API:t. autoGenServer cachar i sin tur
// ingenting; anropet dit har 4s server-side timeout.
let _bflCreditsCache: { data: BflCredits; ts: number } | null = null;
async function collectBflCredits(): Promise<BflCredits> {
  const now = Date.now();
  if (_bflCreditsCache && now - _bflCreditsCache.ts < 60_000) return _bflCreditsCache.data;
  const url = process.env.AUTOGEN_URL ?? 'http://localhost:7790/bfl-credits';
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
      const data: BflCredits = { ok: false, error: `autoGenServer ${res.status}`, fetchedAt: new Date().toISOString() };
      _bflCreditsCache = { data, ts: now };
      return data;
    }
    const j = (await res.json()) as Partial<BflCredits>;
    const data: BflCredits = {
      ok: Boolean(j.ok),
      credits: j.credits ?? null,
      error: j.error,
      fetchedAt: new Date().toISOString(),
    };
    _bflCreditsCache = { data, ts: now };
    return data;
  } catch (err) {
    const data: BflCredits = { ok: false, error: String((err as Error)?.message ?? err), fetchedAt: new Date().toISOString() };
    _bflCreditsCache = { data, ts: now };
    return data;
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

  // 1. Är servern redan uppe?
  let existingPid: number | null = null;
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -1`, {
      encoding: 'utf8',
      timeout: 1500,
    }).trim();
    existingPid = out ? Number(out) : null;
  } catch { /* ignore */ }

  if (existingPid) {
    // Stoppa: SIGTERM, sedan SIGKILL efter 2s om den lever.
    try {
      process.kill(existingPid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 1500));
      try {
        process.kill(existingPid, 0);
        process.kill(existingPid, 'SIGKILL');
      } catch { /* redan död */ }
      _analyticsServerCache = null;
      return { ok: true, action: 'stopped', pid: existingPid };
    } catch (err) {
      return { ok: false, action: 'noop', error: String((err as Error)?.message ?? err) };
    }
  }

  // 2. Starta: spawn detached child som överlever dashboardens egna livscykel.
  try {
    mkdirSync(join(PROJECT_ROOT, 'runtime'), { recursive: true });
    const { openSync } = await import('fs');
    const logFd = openSync(logFile, 'a');
    const child = spawn(
      'npx',
      ['tsx', '10-Analytics/server.ts'],
      {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      },
    );
    child.unref();
    _analyticsServerCache = null;
    return { ok: true, action: 'started', pid: child.pid ?? null };
  } catch (err) {
    return { ok: false, action: 'noop', error: String((err as Error)?.message ?? err) };
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

server.listen(PORT, () => {
  console.log(`[supervisor-dashboard] listening on http://localhost:${PORT}`);
  console.log(`[supervisor-dashboard] project root: ${PROJECT_ROOT}`);
});

export { server };
