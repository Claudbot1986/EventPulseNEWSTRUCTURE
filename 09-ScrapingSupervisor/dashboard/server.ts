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
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  computeFreshnessMedianHours,
  computeFieldCoverage,
  computeBatchMetrics,
} from '../tools/freshness_metrics';
import { readHistory, type MetricsSnapshot } from '../tools/metrics_history';

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

export function collect(): DashboardData {
  const statusRows = readJsonl<SourceRow>(join(PROJECT_ROOT, 'runtime/sources_status.jsonl'));
  const sources = {
    total: statusRows.length,
    working: statusRows.filter((r) => r.status === 'ok').length,
    dead: statusRows.filter((r) => r.status === 'fail').length,
    untouched: statusRows.filter((r) => r.status !== 'ok' && r.status !== 'fail').length,
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
    .filter((r) => r.status !== 'ok' && r.status !== 'fail' && r.consecutiveFailures >= 10)
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

function serveJson(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  if (url === '/api/status') {
    try {
      const data = collect();
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
  return false;
}

const server = createServer((req, res) => {
  if (serveStatic(req, res)) return;
  if (serveJson(req, res)) return;
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[supervisor-dashboard] listening on http://localhost:${PORT}`);
  console.log(`[supervisor-dashboard] project root: ${PROJECT_ROOT}`);
});

export { server };
