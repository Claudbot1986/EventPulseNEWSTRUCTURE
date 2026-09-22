/**
 * storage.ts — analytics event persistence.
 *
 * Fas B: EN databas (user decision 2026-09-21). Supabase `analytics_events`
 * is the PRIMARY store; the JSONL file remains only as a fallback when
 * Supabase is unconfigured or the write fails. The interface is unchanged
 * — every caller still goes through the five functions below.
 *
 * THE INVARIANT that makes merging safe:
 *   an event lives in EXACTLY ONE store — Supabase when the insert
 *   succeeds, JSONL only when Supabase is unavailable. So reads merge
 *   both sources without dedup, GDPR erase deletes from BOTH, and stats
 *   sum both counts.
 *
 * GDPR nuance: erase throws if the Supabase delete fails — a partial
 * erase must never look successful. Retention purges are best-effort.
 *
 * JSONL details (Phase 1, unchanged): append-only file, one JSON line
 * per event, malformed lines are skipped on read and dropped on rewrite.
 */

import { appendFile, readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StoredEvent } from './analytics.js';

const RUNTIME_DIR = process.env.ANALYTICS_RUNTIME_DIR || './runtime';
const EVENTS_FILE = join(RUNTIME_DIR, 'events.jsonl');

// Same env-name convention as 09-ScrapingSupervisor/dashboard/db.ts.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let sbClient: SupabaseClient | null | undefined;

/** Lazy singleton. null = Supabase unconfigured (JSONL-only mode). */
function sb(): SupabaseClient | null {
  if (sbClient !== undefined) return sbClient;
  sbClient =
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_SERVICE_ROLE_KEY === 'string' &&
    SUPABASE_URL.length > 0 &&
    SUPABASE_SERVICE_ROLE_KEY.length > 0
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null;
  return sbClient;
}

/**
 * Test-only injection — replaces the lazy singleton (mirrors the
 * analyticsClient._reset / agentClient test-hook convention). Pass null
 * to simulate "Supabase unconfigured".
 */
export function _setSupabaseClientForTests(client: SupabaseClient | null): void {
  sbClient = client;
}

/** PostgREST hard cap per request — read pages walk past it. */
const SB_PAGE = 1000;

// ---------------------------------------------------------------------------
// JSONL layer (Phase 1 — unchanged behavior)
// ---------------------------------------------------------------------------

let initialized = false;
function ensureDir() {
  if (initialized) return;
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }
  initialized = true;
}

async function appendJsonl(ev: StoredEvent): Promise<void> {
  ensureDir();
  const line = JSON.stringify(ev) + '\n';
  await appendFile(EVENTS_FILE, line, 'utf8');
}

async function readJsonlEvents(since?: string): Promise<StoredEvent[]> {
  ensureDir();
  if (!existsSync(EVENTS_FILE)) return [];
  const raw = await readFile(EVENTS_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events: StoredEvent[] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as StoredEvent;
      if (since && ev.ts < since) continue;
      events.push(ev);
    } catch {
      // Skip malformed line — don't crash the dashboard.
    }
  }
  return events;
}

async function deleteJsonlWhere(pred: (ev: StoredEvent) => boolean): Promise<number> {
  ensureDir();
  if (!existsSync(EVENTS_FILE)) return 0;
  const raw = await readFile(EVENTS_FILE, 'utf8');
  const lines = raw.split('\n');
  let deleted = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const ev = JSON.parse(line) as StoredEvent;
      if (pred(ev)) {
        deleted++;
      } else {
        kept.push(line);
      }
    } catch {
      // Drop malformed lines on the way out.
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(EVENTS_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  return deleted;
}

async function jsonlStats(): Promise<{ bytes: number; events: number }> {
  ensureDir();
  if (!existsSync(EVENTS_FILE)) return { bytes: 0, events: 0 };
  const s = await stat(EVENTS_FILE);
  const events = (await readFile(EVENTS_FILE, 'utf8'))
    .split('\n')
    .filter((l) => l.trim().length > 0).length;
  return { bytes: s.size, events };
}

// ---------------------------------------------------------------------------
// Supabase layer (Fas B)
// ---------------------------------------------------------------------------

const SB_SELECT = 'event_type,page,payload,device_id_hash,session_id,ts,received_at';

/**
 * All Supabase rows, paginated past the PostgREST 1000-row cap. All-or-
 * nothing: any page failure returns [] so callers fall back to the
 * JSONL view instead of acting on a partial read.
 */
async function readSupabaseEvents(since?: string): Promise<StoredEvent[]> {
  const client = sb();
  if (!client) return [];
  const out: StoredEvent[] = [];
  try {
    for (let from = 0; ; from += SB_PAGE) {
      const base = client.from('analytics_events').select(SB_SELECT);
      const filtered = since ? base.gte('ts', since) : base;
      const { data, error } = await filtered
        .order('ts', { ascending: true })
        .range(from, from + SB_PAGE - 1);
      if (error || !Array.isArray(data)) return [];
      out.push(...(data as StoredEvent[]));
      if (data.length < SB_PAGE) return out;
    }
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public interface (unchanged signatures)
// ---------------------------------------------------------------------------

/**
 * Persist a single event. Supabase primary; JSONL only on failure or
 * when unconfigured — never both (see the invariant above).
 */
export async function persistEvent(ev: StoredEvent): Promise<void> {
  const client = sb();
  if (client) {
    try {
      const { error } = await client.from('analytics_events').insert({
        event_type: ev.event_type,
        page: ev.page,
        payload: ev.payload,
        device_id_hash: ev.device_id_hash,
        session_id: ev.session_id,
        ts: ev.ts,
        received_at: ev.received_at,
      });
      if (!error) return;
    } catch {
      // fall through to JSONL
    }
  }
  await appendJsonl(ev);
}

/**
 * Read events from BOTH stores, merged and sorted by ts. Because an
 * event never lives in both stores, no dedup is needed. `limit` takes
 * the merged tail; `since` filters both sources.
 */
export async function readEvents(opts: { limit?: number; since?: string } = {}): Promise<StoredEvent[]> {
  const jsonlRows = await readJsonlEvents(opts.since);
  const supabaseRows = await readSupabaseEvents(opts.since);
  const merged = [...jsonlRows, ...supabaseRows].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
  );
  if (opts.limit && merged.length > opts.limit) {
    return merged.slice(merged.length - opts.limit);
  }
  return merged;
}

/**
 * Delete all events for a given device_id_hash (GDPR right-to-erasure)
 * from BOTH stores. Returns the total deleted. THROWS if the Supabase
 * delete fails — a partial erase must never look successful; rerunning
 * is idempotent (the JSONL pass deletes 0 next time).
 */
export async function deleteEventsForDevice(deviceIdHash: string): Promise<number> {
  const jsonlDeleted = await deleteJsonlWhere((ev) => ev.device_id_hash === deviceIdHash);
  const client = sb();
  if (!client) return jsonlDeleted;
  let deleted = 0;
  try {
    const { data, error } = await client
      .from('analytics_events')
      .delete()
      .eq('device_id_hash', deviceIdHash)
      .select('id');
    if (error) throw new Error(error.message);
    deleted = Array.isArray(data) ? data.length : 0;
  } catch (err) {
    throw new Error(
      `erase incomplete — Supabase delete failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return jsonlDeleted + deleted;
}

/**
 * Purge events older than the retention window from BOTH stores.
 * Returns the count deleted. Supabase failures are best-effort (retention
 * is routine cleanup, not a user right — unlike erase above) — the JSONL
 * purge result still stands and the next run retries Supabase.
 * Used by the daily cron / scripts/analytics-purge.ts.
 */
export async function purgeOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const jsonlDeleted = await deleteJsonlWhere((ev) => ev.ts < cutoff);
  const client = sb();
  if (!client) return jsonlDeleted;
  try {
    const { data, error } = await client
      .from('analytics_events')
      .delete()
      .lt('ts', cutoff)
      .select('id');
    if (error || !Array.isArray(data)) return jsonlDeleted;
    return jsonlDeleted + data.length;
  } catch {
    return jsonlDeleted;
  }
}

/**
 * Storage stats — JSONL bytes plus the summed event count across both
 * stores (disjoint by construction, so the sum is exact).
 */
export async function storageStats(): Promise<{ bytes: number; events: number }> {
  const jsonl = await jsonlStats();
  const client = sb();
  if (!client) return jsonl;
  try {
    const { count, error } = await client
      .from('analytics_events')
      .select('id', { count: 'exact', head: true });
    if (error || typeof count !== 'number') return jsonl;
    return { bytes: jsonl.bytes, events: jsonl.events + count };
  } catch {
    return jsonl;
  }
}

export { EVENTS_FILE };