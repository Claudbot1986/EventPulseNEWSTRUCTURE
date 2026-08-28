/**
 * db.ts — Supabase read-only helpers for the supervisor dashboard.
 *
 * Every function here is a one-shot query against the live database.
 * Errors-as-data: returns null/empty rather than throwing, so the
 * dashboard can render a muted "DB unreachable" state without crashing
 * the rest of the page.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export interface Kpis {
  totalFutureEvents: number | null;
  eventsNext7d: number | null;
  totalEventRows: number | null;
  activeSources7d: number | null;
  lastToolASuccessIso: string | null;
}

export async function collectKpis(): Promise<Kpis> {
  const sb = db();
  if (!sb) return emptyKpis();
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  try {
    const [future, next7, total, active] = await Promise.all([
      sb.from('events_public').select('*', { count: 'exact', head: true }).gt('start_time', now.toISOString()),
      sb.from('events_public').select('*', { count: 'exact', head: true })
        .gt('start_time', now.toISOString()).lt('start_time', sevenDays),
      sb.from('events').select('*', { count: 'exact', head: true }),
      sb.from('events_public').select('source').gt('freshness_at', sevenDaysAgo).limit(5000),
    ]);
    const uniqueSources = new Set((active.data ?? []).map((r) => r.source).filter(Boolean));
    return {
      totalFutureEvents: future.count,
      eventsNext7d: next7.count,
      totalEventRows: total.count,
      activeSources7d: uniqueSources.size,
      lastToolASuccessIso: null, // filled by collect() from JSONL
    };
  } catch {
    return emptyKpis();
  }
}

function emptyKpis(): Kpis {
  return {
    totalFutureEvents: null,
    eventsNext7d: null,
    totalEventRows: null,
    activeSources7d: null,
    lastToolASuccessIso: null,
  };
}

export interface DbSourceRow {
  source: string;
  events: number;
  fresh7d: number;
  /**
   * True iff the source has a custom adapter under
   * `02-Ingestion/F-eventExtraction/adapters/${source}.ts` — i.e.
   * site-specific (hand-tuned) extraction. False means the source goes
   * through the generic C-layer / universal-extractor path.
   * Always false when the row leaves `collectDbSources()`; the dashboard
   * server overwrites it from a filesystem scan before returning to the
   * client.
   */
  hasAdapter: boolean;
}

export async function collectDbSources(): Promise<DbSourceRow[]> {
  const sb = db();
  if (!sb) return [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  try {
    const [all, fresh] = await Promise.all([
      sb.from('events_public').select('source').gt('start_time', now.toISOString()).limit(8000),
      sb.from('events_public').select('source').gt('start_time', now.toISOString())
        .gt('freshness_at', sevenDaysAgo).limit(8000),
    ]);
    const total: Record<string, number> = {};
    (all.data ?? []).forEach((r) => {
      if (r.source) total[r.source] = (total[r.source] ?? 0) + 1;
    });
    const freshCnt: Record<string, number> = {};
    (fresh.data ?? []).forEach((r) => {
      if (r.source) freshCnt[r.source] = (freshCnt[r.source] ?? 0) + 1;
    });
    // hasAdapter is filled in by the dashboard server after this returns,
    // since the adapter directory is a filesystem concern, not a DB one.
    // Default false so the row shape stays consistent.
    return Object.entries(total)
      .map(([source, events]) => ({
        source,
        events,
        fresh7d: freshCnt[source] ?? 0,
        hasAdapter: false,
      }))
      .sort((a, b) => b.events - a.events);
  } catch {
    return [];
  }
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface TimeSeries {
  eventsIngested: TimeSeriesPoint[];
  activeSources: TimeSeriesPoint[];
  confidenceAvg: TimeSeriesPoint[];
}

/** Last N days, default 120. Sparse — `freshness_at` only spans recent days. */
export async function collectTimeSeries(days = 120): Promise<TimeSeries> {
  const empty: TimeSeries = { eventsIngested: [], activeSources: [], confidenceAvg: [] };
  const sb = db();
  if (!sb) return empty;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const { data, error } = await sb
      .from('events_public')
      .select('source, freshness_at, confidence_score')
      .gt('freshness_at', since)
      .limit(20000);
    if (error || !data) return empty;
    const eventsByDay: Record<string, number> = {};
    const sourcesByDay: Record<string, Set<string>> = {};
    const confByDay: Record<string, { sum: number; n: number }> = {};
    for (const r of data) {
      if (!r.freshness_at) continue;
      const d = r.freshness_at.slice(0, 10);
      eventsByDay[d] = (eventsByDay[d] ?? 0) + 1;
      if (r.source) {
        if (!sourcesByDay[d]) sourcesByDay[d] = new Set();
        sourcesByDay[d].add(r.source);
      }
      if (typeof r.confidence_score === 'number') {
        if (!confByDay[d]) confByDay[d] = { sum: 0, n: 0 };
        confByDay[d].sum += r.confidence_score;
        confByDay[d].n += 1;
      }
    }
    return {
      eventsIngested: toPoints(eventsByDay),
      activeSources: Object.keys(sourcesByDay)
        .sort()
        .map((d) => ({ date: d, value: sourcesByDay[d].size })),
      confidenceAvg: toPoints(
        Object.fromEntries(
          Object.entries(confByDay).map(([d, v]) => [d, v.n ? Math.round(v.sum / v.n) : 0])
        )
      ),
    };
  } catch {
    return empty;
  }
}

function toPoints(rec: Record<string, number>): TimeSeriesPoint[] {
  return Object.keys(rec).sort().map((d) => ({ date: d, value: rec[d] }));
}

// ── Task 3a: per-layer extraction overview ────────────────────────────────

export interface LayerExtractionOverview {
  A: { latestSuccessIso: string | null; totalSuccesses: number; totalAttempts: number };
  B: { queueDepth: number; latestIso: string | null };
  C: { batchesTotal: number; latestIso: string | null };
  D: { pendingCount: number; latestIso: string | null };
  F: {
    sources: number;
    eventsTotal: number;
    latestIso: string | null;
    perSourceLatest: Array<{ source: string; events: number; latestIso: string | null }>;
  };
  G: { available: boolean; latestIso: string | null };
  H: { backlogSize: number; latestIso: string | null };
  AI: { logFiles: number; latestIso: string | null };
  Push: { totalJobs: number; lastJobIso: string | null; last7d: number };
}

/**
 * Build a per-layer extraction overview — historical total + latest run.
 *
 * Most of the data is read from JSONL/log files in `runtime/` and
 * `02-Ingestion/`. Each `latestIso` is the mtime of the most recently
 * modified file or the timestamp of the most recent row, depending on
 * which is more meaningful for the layer. `eventsTotal` for layer F is
 * read by line-counting the JSONL files (no full parse) for speed — this
 * is consistent with the existing `layer-F-events` tile.
 *
 * Pass the project root (cwd of the supervisor). Errors-as-data: an
 * unreadable layer returns zeros/nulls, never throws.
 */
export function collectExtractionOverview(projectRoot: string): LayerExtractionOverview {
  const safeStat = (p: string): string | null => {
    try { return statSync(p).mtime.toISOString(); } catch { return null; }
  };

  // A: sources_status.jsonl — derive from rows already read by the server.
  // Caller passes the row count and latestSuccessIso through other paths;
  // here we only fill in the A summary from disk so this function is
  // self-contained.
  let aLatest: string | null = null;
  let aSuccesses = 0;
  let aAttempts = 0;
  const aPath = join(projectRoot, 'runtime/sources_status.jsonl');
  if (existsSync(aPath)) {
    try {
      const txt = readFileSync(aPath, 'utf-8');
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        aAttempts++;
        let row: { status?: string; lastSuccess?: string; lastRun?: string };
        try { row = JSON.parse(line); } catch { continue; }
        if (row.status === 'success' || row.status === 'ok') aSuccesses++;
        const ts = row.lastSuccess ?? row.lastRun;
        if (ts && (!aLatest || ts > aLatest)) aLatest = ts;
      }
    } catch { /* ignore */ }
  }

  // B: postB-queue.jsonl
  const bPath = join(projectRoot, 'runtime/postB-queue.jsonl');
  let bDepth = 0, bLatest: string | null = safeStat(bPath);
  if (existsSync(bPath)) {
    try {
      const txt = readFileSync(bPath, 'utf-8');
      bDepth = txt.trim() ? txt.trim().split('\n').length : 0;
    } catch { /* ignore */ }
  }

  // C: C-candidates-batches-meta.jsonl
  const cPath = join(projectRoot, '02-Ingestion/C-candidates-batches-meta.jsonl');
  let cTotal = 0;
  if (existsSync(cPath)) {
    try {
      const txt = readFileSync(cPath, 'utf-8');
      cTotal = txt.trim() ? txt.trim().split('\n').length : 0;
    } catch { /* ignore */ }
  }
  const cLatest = safeStat(cPath);

  // D: pending_render_queue.jsonl
  const dPath = join(projectRoot, 'runtime/pending_render_queue.jsonl');
  let dPending = 0;
  if (existsSync(dPath)) {
    try {
      const txt = readFileSync(dPath, 'utf-8');
      dPending = txt.trim() ? txt.trim().split('\n').length : 0;
    } catch { /* ignore */ }
  }
  const dLatest = safeStat(dPath);

  // F: 03-Queue/03-extractedevents/ — per-source line counts + mtimes.
  const fDir = join(projectRoot, '03-Queue/03-extractedevents');
  const perSource: Array<{ source: string; events: number; latestIso: string | null }> = [];
  let fEvents = 0, fLatest: string | null = null;
  if (existsSync(fDir)) {
    for (const f of readdirSync(fDir).filter((n) => n.endsWith('.jsonl'))) {
      const p = join(fDir, f);
      const source = f.replace(/\.jsonl$/, '');
      let count = 0, mtime: string | null = null;
      try {
        const txt = readFileSync(p, 'utf-8');
        count = txt.trim() ? txt.trim().split('\n').length : 0;
        mtime = statSync(p).mtime.toISOString();
      } catch { /* ignore */ }
      fEvents += count;
      if (mtime && (!fLatest || mtime > fLatest)) fLatest = mtime;
      perSource.push({ source, events: count, latestIso: mtime });
    }
    perSource.sort((a, b) => b.events - a.events);
  }

  // G: results.jsonl in 02-Ingestion/G-universalScout
  const gPath = join(projectRoot, '02-Ingestion/G-universalScout/results.jsonl');
  const gAvailable = existsSync(gPath);

  // H: H-queue dir listing
  const hDir = join(projectRoot, '02-Ingestion/H-manualReview/H-queue');
  let hCount = 0, hLatest: string | null = null;
  if (existsSync(hDir)) {
    try {
      const files = readdirSync(hDir);
      hCount = files.length;
      for (const f of files) {
        const t = safeStat(join(hDir, f));
        if (t && (!hLatest || t > hLatest)) hLatest = t;
      }
    } catch { /* ignore */ }
  }

  // AI: deeptrace-d-*.json logs
  const logsDir = join(projectRoot, 'runtime/logs');
  let aiFiles: string[] = [];
  if (existsSync(logsDir)) {
    aiFiles = readdirSync(logsDir).filter((f) => /^deeptrace-d-.*\.json$/.test(f));
  }
  const aiLatest = aiFiles.length > 0 ? safeStat(join(logsDir, aiFiles.sort()[aiFiles.length - 1])) : null;

  // Push: EVENTPULSE-APP-queue.jsonl
  const pushPath = join(projectRoot, 'runtime/EVENTPULSE-APP-queue.jsonl');
  let pushTotal = 0, pushLast7d = 0, pushLatest: string | null = null;
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  if (existsSync(pushPath)) {
    try {
      const txt = readFileSync(pushPath, 'utf-8');
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        pushTotal++;
        let row: { queuedAt?: string };
        try { row = JSON.parse(line); } catch { continue; }
        if (row.queuedAt) {
          if (!pushLatest || row.queuedAt > pushLatest) pushLatest = row.queuedAt;
          if (new Date(row.queuedAt).getTime() >= sevenDaysAgo) pushLast7d++;
        }
      }
    } catch { /* ignore */ }
  }

  return {
    A: { latestSuccessIso: aLatest, totalSuccesses: aSuccesses, totalAttempts: aAttempts },
    B: { queueDepth: bDepth, latestIso: bLatest },
    C: { batchesTotal: cTotal, latestIso: cLatest },
    D: { pendingCount: dPending, latestIso: dLatest },
    F: { sources: perSource.length, eventsTotal: fEvents, latestIso: fLatest, perSourceLatest: perSource },
    G: { available: gAvailable, latestIso: safeStat(gPath) },
    H: { backlogSize: hCount, latestIso: hLatest },
    AI: { logFiles: aiFiles.length, latestIso: aiLatest },
    Push: { totalJobs: pushTotal, lastJobIso: pushLatest, last7d: pushLast7d },
  };
}

// ── Task 3b: missing-in-Supabase detector ──────────────────────────────────

export interface UnsyncedRow {
  source: string;
  url: string;
  title: string;
  date: string;
  /** When matched cross-source (local source=X, DB source=Y), the DB source. */
  dbSource?: string;
}

export interface PerSourceEntry {
  source: string;
  local: number;
  /** Locally present but not in DB at all. */
  missing: number;
  /** Matched in DB but under a different source (aggregator re-imports). */
  crossSourceMatched: number;
  /**
   * Matched in DB but the DB row has `source = null` (legacy imports from
   * dropped sources). These are NOT truly missing — they exist — but the
   * dashboard surfaces the count because it indicates data-hygiene drift
   * (URLs that lost their source attribution) worth investigating.
   */
  nullSourceMatched: number;
}

export interface UnsyncedReport {
  ok: boolean;
  error?: string;
  totalLocal: number;
  totalInSupabaseRows: number;
  /** Distinct ticket_urls in DB used for the cross-source match. */
  totalInSupabaseDistinctUrls: number;
  matched: number;
  missing: number;
  /** Subset of `matched` where local source differs from DB source. */
  crossSourceMatched: number;
  /**
   * Subset of `matched` where DB row has `source = null` (legacy imports
   * from dropped sources). Surfaces as a separate counter so operators can
   * spot data-hygiene drift (URLs that lost source attribution).
   */
  nullSourceMatched: number;
  missingRows: UnsyncedRow[]; // capped to first 100
  perSource: PerSourceEntry[];
  fetchedAt: string;
}

/**
 * Compare locally-extracted events in `03-Queue/03-extractedevents/`
 * against `events_public` rows in Supabase and report which local events
 * are missing from the database.
 *
 * Identity match: ticket_url alone (cross-source).
 * Why: aggregators like `sthlmlist` re-import events whose canonical URL
 * already exists in DB under the host source (e.g. `kulturhuset`). A
 * strict (source, ticket_url) match wrongly classifies those re-imports
 * as "missing" — inflating the missing count by ~450 for sthlmlist alone.
 *
 * Two-pass:
 *   1. Walk local files once, collecting per-source counts and a
 *      `(url → localSource)` map for matching.
 *   2. Query Supabase for ALL ticket_urls (`events_public.ticket_url`,
 *      non-null). Build a `url → dbSource` map. This is the cost of doing
 *      things correctly: ~6k rows today, fine at 50k+ as well.
 *
 * `missingRows` is capped at 100 entries (most recent by file mtime).
 * `perSource` shows local / cross-source-matched / actually-missing per
 * local source so the operator can spot concentrated gaps.
 *
 * Errors-as-data: if Supabase is unreachable, `ok` is false and the
 * `error` field carries the message.
 */
export async function collectUnsynced(projectRoot: string): Promise<UnsyncedReport> {
  const empty: UnsyncedReport = {
    ok: false, error: 'uninitialized',
    totalLocal: 0, totalInSupabaseRows: 0, totalInSupabaseDistinctUrls: 0,
    matched: 0, missing: 0, crossSourceMatched: 0, nullSourceMatched: 0,
    missingRows: [], perSource: [], fetchedAt: new Date().toISOString(),
  };
  const sb = db();
  if (!sb) return { ...empty, error: 'Supabase not configured' };
  const fDir = join(projectRoot, '03-Queue/03-extractedevents');
  if (!existsSync(fDir)) return { ...empty, error: '03-Queue/03-extractedevents missing' };

  // Pass 1: read all local files. Build:
  //   - perSourceLocal: counts per local source
  //   - urlToLocal: ticket_url → local source (first writer wins)
  //   - localRows: list of {source,url,title,date,mtime} sorted desc by mtime
  const perSourceLocal: Record<string, number> = {};
  const urlToLocal = new Map<string, string>();
  const localRows: Array<UnsyncedRow & { mtime: number }> = [];
  let totalLocal = 0;
  const fileEntries = readdirSync(fDir)
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => {
      const p = join(fDir, n);
      let mtime = 0;
      try { mtime = statSync(p).mtimeMs; } catch { /* ignore */ }
      return { path: p, source: n.replace(/\.jsonl$/, ''), mtime };
    });
  for (const fe of fileEntries) {
    let count = 0;
    try {
      const txt = readFileSync(fe.path, 'utf-8');
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        count++;
        totalLocal++;
        let row: { source?: string; url?: string; ticketUrl?: string; title?: string; date?: string };
        try { row = JSON.parse(line); } catch { continue; }
        const src = row.source ?? fe.source;
        const url = (row.url ?? row.ticketUrl ?? '').trim();
        if (!src || !url) continue;
        perSourceLocal[src] = (perSourceLocal[src] ?? 0) + 1;
        if (!urlToLocal.has(url)) urlToLocal.set(url, src);
        localRows.push({
          source: src, url, title: (row.title ?? '').slice(0, 80), date: row.date ?? '',
          mtime: fe.mtime,
        });
      }
    } catch { /* skip unreadable file */ }
  }

  // Pass 2: query Supabase for ALL (ticket_url, source) pairs.
  // Cross-source match requires scanning the whole table — there's no
  // shortcut because we don't know in advance which DB source holds the
  // canonical row. Supabase defaults a SELECT to 1000 rows, so we
  // paginate via `.range()` up to a hard ceiling (50k today).
  const DB_PAGE_SIZE = 1_000;
  const DB_MAX_ROWS = 50_000;
  let supRows: Array<{ source: string; ticket_url: string }> = [];
  try {
    for (let offset = 0; offset < DB_MAX_ROWS; offset += DB_PAGE_SIZE) {
      const { data, error } = await sb
        .from('events_public')
        .select('source, ticket_url')
        .not('ticket_url', 'is', null)
        .range(offset, offset + DB_PAGE_SIZE - 1);
      if (error) return { ...empty, error: error.message };
      const rows = (data ?? []).filter((r) => r.ticket_url);
      supRows.push(...rows);
      if (rows.length < DB_PAGE_SIZE) break; // last page
      if (offset + DB_PAGE_SIZE >= DB_MAX_ROWS) {
        // Capped — flag as data-quality note via totalInSupabaseRows=cap
        break;
      }
    }
  } catch (err) {
    return { ...empty, error: String((err as Error)?.message ?? err) };
  }

  // Build the cross-source membership map: url → DB source (first writer).
  // Value is `string | null` because legacy imports may have source=null
  // (dropped-source rows from old aggregator runs). Membership check is
  // `has(url)` — null is a valid matched value, not "missing".
  const urlToDbSource = new Map<string, string | null>();
  for (const r of supRows) {
    if (!urlToDbSource.has(r.ticket_url)) urlToDbSource.set(r.ticket_url, r.source);
  }
  const totalInSupabaseDistinctUrls = urlToDbSource.size;

  // Pass 3: walk localRows, classify. Sort desc by mtime so the most
  // recent missing events surface first in the capped missingRows list.
  localRows.sort((a, b) => b.mtime - a.mtime);
  const missingRows: UnsyncedRow[] = [];
  let matched = 0;
  let missing = 0;
  let crossSourceMatched = 0;
  let nullSourceMatched = 0;
  const perSourceMissing: Record<string, number> = {};
  const perSourceCrossMatched: Record<string, number> = {};
  const perSourceNullMatched: Record<string, number> = {};
  for (const r of localRows) {
    // Membership check: `has()` returns true iff the URL is in DB at all.
    // `get()` returns `string | null | undefined`; null is a valid match
    // (legacy import), undefined means truly missing.
    if (!urlToDbSource.has(r.url)) {
      missing++;
      perSourceMissing[r.source] = (perSourceMissing[r.source] ?? 0) + 1;
      if (missingRows.length < 100) {
        missingRows.push({ source: r.source, url: r.url, title: r.title, date: r.date });
      }
      continue;
    }
    const dbSource = urlToDbSource.get(r.url);
    matched++;
    if (dbSource == null) {
      // URL exists in DB but source was dropped (legacy import). Not
      // missing — surface as a separate category for data-hygiene review.
      nullSourceMatched++;
      perSourceNullMatched[r.source] = (perSourceNullMatched[r.source] ?? 0) + 1;
    } else if (dbSource !== r.source) {
      crossSourceMatched++;
      perSourceCrossMatched[r.source] = (perSourceCrossMatched[r.source] ?? 0) + 1;
    }
  }

  const perSource: PerSourceEntry[] = Object.keys(perSourceLocal)
    .map((source) => ({
      source,
      local: perSourceLocal[source],
      missing: perSourceMissing[source] ?? 0,
      crossSourceMatched: perSourceCrossMatched[source] ?? 0,
      nullSourceMatched: perSourceNullMatched[source] ?? 0,
    }))
    .sort((a, b) => b.missing - a.missing || b.local - a.local);

  return {
    ok: true,
    totalLocal,
    totalInSupabaseRows: supRows.length,
    totalInSupabaseDistinctUrls,
    matched,
    missing,
    crossSourceMatched,
    nullSourceMatched,
    missingRows,
    perSource,
    fetchedAt: new Date().toISOString(),
  };
}
