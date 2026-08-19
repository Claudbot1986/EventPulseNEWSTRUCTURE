/**
 * db.ts — Supabase read-only helpers for the supervisor dashboard.
 *
 * Every function here is a one-shot query against the live database.
 * Errors-as-data: returns null/empty rather than throwing, so the
 * dashboard can render a muted "DB unreachable" state without crashing
 * the rest of the page.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
    return Object.entries(total)
      .map(([source, events]) => ({
        source,
        events,
        fresh7d: freshCnt[source] ?? 0,
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
