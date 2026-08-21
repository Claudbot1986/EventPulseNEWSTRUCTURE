/**
 * storage.ts — JSONL persistence for analytics events.
 *
 * Phase 1: writes one JSON line per event to a JSONL file. Synchronous
 * append is intentional — analytics writes are infrequent, batched
 * client-side, and we want a hard durability guarantee. fs.appendFile
 * opens + writes + closes per call, which is fine at our throughput.
 *
 * Phase 2: Supabase will be inserted here as a primary store with
 * JSONL as the fallback. The interface is intentionally narrow so
 * the swap is local.
 */

import { appendFile, readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredEvent } from './analytics.js';

const RUNTIME_DIR = process.env.ANALYTICS_RUNTIME_DIR || './runtime';
const EVENTS_FILE = join(RUNTIME_DIR, 'events.jsonl');

let initialized = false;
function ensureDir() {
  if (initialized) return;
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }
  initialized = true;
}

/**
 * Persist a single event. Synchronous return after fs append — the
 * client is fire-and-forget.
 */
export async function persistEvent(ev: StoredEvent): Promise<void> {
  ensureDir();
  const line = JSON.stringify(ev) + '\n';
  await appendFile(EVENTS_FILE, line, 'utf8');
}

/**
 * Read all events (used by stats endpoints). Reads from the tail —
 * for the MVP this is fine; for Phase 2 we switch to SQL queries.
 *
 * @param limit  max events to return (default 1000)
 * @param since  optional ISO timestamp filter
 */
export async function readEvents(opts: { limit?: number; since?: string } = {}): Promise<StoredEvent[]> {
  ensureDir();
  if (!existsSync(EVENTS_FILE)) return [];
  const raw = await readFile(EVENTS_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events: StoredEvent[] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as StoredEvent;
      if (opts.since && ev.ts < opts.since) continue;
      events.push(ev);
    } catch {
      // Skip malformed line — log only. Don't crash the dashboard.
    }
  }
  if (opts.limit && events.length > opts.limit) {
    return events.slice(events.length - opts.limit);
  }
  return events;
}

/**
 * Delete all events for a given device_id_hash (GDPR right-to-delete).
 * Returns the number of events deleted.
 */
export async function deleteEventsForDevice(deviceIdHash: string): Promise<number> {
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
      if (ev.device_id_hash === deviceIdHash) {
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

/**
 * Purge events older than the retention window. Returns the count deleted.
 * Used by the daily cron / scripts/analytics-purge.ts.
 */
export async function purgeOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return deleteEventsWhere((ev) => ev.ts < cutoff);
}

async function deleteEventsWhere(pred: (ev: StoredEvent) => boolean): Promise<number> {
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
      // skip
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(EVENTS_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  return deleted;
}

/**
 * Storage stats — used by the dashboard header.
 */
export async function storageStats(): Promise<{ bytes: number; events: number }> {
  ensureDir();
  if (!existsSync(EVENTS_FILE)) return { bytes: 0, events: 0 };
  const s = await stat(EVENTS_FILE);
  const events = (await readFile(EVENTS_FILE, 'utf8'))
    .split('\n')
    .filter((l) => l.trim().length > 0).length;
  return { bytes: s.size, events };
}

export { EVENTS_FILE };
