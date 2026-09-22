/**
 * storage.test.ts — Fas B: EN databas (Supabase primary, JSONL fallback).
 *
 * The invariant that makes the whole design safe:
 *   every event lives in EXACTLY ONE store — Supabase when the insert
 *   succeeds, JSONL only when Supabase is unconfigured or fails.
 * Therefore reads merge both sources WITHOUT dedup, GDPR erase deletes
 * from BOTH, and stats sum both counts.
 *
 * ANALYTICS_RUNTIME_DIR must be set before storage.js is imported (the
 * module resolves the JSONL dir at load time), so every import goes
 * through importStorage() after the env is pinned.
 *
 * AAA pattern. Run: npx vitest run 10-Analytics/tests/storage.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEvent } from '../analytics.js';
import { makeFakeSupabase, type FakeSupabase } from './fakeSupabase.js';

const TMP = mkdtempSync(join(tmpdir(), 'ep-analytics-storage-'));
const JSONL_FILE = join(TMP, 'events.jsonl');
// Pin BEFORE importing storage.js — its RUNTIME_DIR is load-time state.
process.env.ANALYTICS_RUNTIME_DIR = TMP;

function ev(partial: Partial<StoredEvent> = {}): StoredEvent {
  return {
    event_type: 'session_start',
    page: 'app',
    payload: {},
    device_id_hash: 'a'.repeat(64),
    session_id: 's1',
    ts: '2026-09-22T10:00:00.000Z',
    received_at: '2026-09-22T10:00:00.000Z',
    ...partial,
  };
}

/**
 * Fresh storage module per call (module-level client singleton) with the
 * given client injected — null simulates "Supabase unconfigured".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importStorage(client: FakeSupabase | null): Promise<any> {
  const mod = await import('../storage.js');
  mod._setSupabaseClientForTests(client);
  return mod;
}

function seedJsonl(rows: StoredEvent[]): void {
  writeFileSync(JSONL_FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function readJsonlRows(): StoredEvent[] {
  if (!existsSync(JSONL_FILE)) return [];
  return readFileSync(JSONL_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredEvent);
}

beforeEach(() => {
  // Start EVERY test from an empty JSONL so counts never leak between
  // tests (the fake's in-memory rows are per-test, the file is not).
  rmSync(JSONL_FILE, { force: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('persistEvent — Supabase primary', () => {
  it('inserts into analytics_events and never touches JSONL', async () => {
    const fake = makeFakeSupabase();
    const { persistEvent } = await importStorage(fake);
    await persistEvent(ev({ event_type: 'search_query', payload: { query_len: 5 } }));
    expect(fake.__rows).toHaveLength(1);
    expect(fake.__rows[0]).toMatchObject({
      event_type: 'search_query',
      page: 'app',
      device_id_hash: 'a'.repeat(64),
      ts: '2026-09-22T10:00:00.000Z',
    });
    expect(fake.__rows[0].payload).toEqual({ query_len: 5 });
    expect(existsSync(JSONL_FILE)).toBe(false);
  });

  it('falls back to JSONL when the Supabase insert fails', async () => {
    const fake = makeFakeSupabase({ failInsert: true });
    const { persistEvent } = await importStorage(fake);
    await persistEvent(ev({ event_type: 'event_save', ts: '2026-09-22T10:00:01.000Z' }));
    expect(fake.__rows).toHaveLength(0);
    expect(readJsonlRows()).toHaveLength(1);
    expect(readJsonlRows()[0].event_type).toBe('event_save');
  });

  it('no Supabase configured → JSONL only (Phase 1 behavior intact)', async () => {
    const { persistEvent } = await importStorage(null);
    await persistEvent(ev({ event_type: 'tile_tap', payload: { word: 'helg' } }));
    const rows = readJsonlRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('tile_tap');
  });
});

describe('readEvents — merged view (JSONL history + Supabase primary)', () => {
  it('merges both sources sorted by ts — no event in both stores by construction', async () => {
    seedJsonl([
      ev({ event_type: 'session_start', ts: '2026-09-20T08:00:00.000Z', received_at: '2026-09-20T08:00:00.000Z' }),
      ev({ event_type: 'search_query', ts: '2026-09-21T08:00:00.000Z', received_at: '2026-09-21T08:00:00.000Z' }),
    ]);
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ event_type: 'tile_tap', ts: '2026-09-22T09:00:00.000Z', received_at: '2026-09-22T09:00:00.000Z' }), id: 1 },
      { ...ev({ event_type: 'event_save', ts: '2026-09-19T07:00:00.000Z', received_at: '2026-09-19T07:00:00.000Z' }), id: 2 },
    );
    const { readEvents } = await importStorage(fake);
    const rows = await readEvents();
    expect(rows.map((r: StoredEvent) => r.event_type)).toEqual([
      'event_save', // 09-19 (Supabase)
      'session_start', // 09-20 (JSONL)
      'search_query', // 09-21 (JSONL)
      'tile_tap', // 09-22 (Supabase)
    ]);
  });

  it('limit takes the merged tail across both sources', async () => {
    seedJsonl([
      ev({ event_type: 'session_start', ts: '2026-09-20T08:00:00.000Z' }),
    ]);
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ event_type: 'tile_tap', ts: '2026-09-22T09:00:00.000Z' }), id: 1 },
      { ...ev({ event_type: 'event_save', ts: '2026-09-21T09:00:00.000Z' }), id: 2 },
    );
    const { readEvents } = await importStorage(fake);
    const rows = await readEvents({ limit: 2 });
    expect(rows.map((r: StoredEvent) => r.event_type)).toEqual(['event_save', 'tile_tap']);
  });

  it('since filters both sources', async () => {
    seedJsonl([
      ev({ event_type: 'session_start', ts: '2026-09-20T08:00:00.000Z' }),
      ev({ event_type: 'search_query', ts: '2026-09-22T08:00:00.000Z' }),
    ]);
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ event_type: 'tile_tap', ts: '2026-09-21T09:00:00.000Z' }), id: 1 },
      { ...ev({ event_type: 'event_save', ts: '2026-09-19T07:00:00.000Z' }), id: 2 },
    );
    const { readEvents } = await importStorage(fake);
    const rows = await readEvents({ since: '2026-09-21T00:00:00.000Z' });
    expect(rows.map((r: StoredEvent) => r.event_type).sort()).toEqual(['search_query', 'tile_tap']);
  });

  it('Supabase select failure → JSONL rows still readable (fallback)', async () => {
    seedJsonl([ev({ event_type: 'session_start' })]);
    const fake = makeFakeSupabase({ failSelect: true });
    fake.__rows.push({ ...ev({ event_type: 'tile_tap' }), id: 1 });
    const { readEvents } = await importStorage(fake);
    const rows = await readEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('session_start');
  });
});

describe('deleteEventsForDevice — GDPR erase across both sources', () => {
  it('deletes from BOTH sources and returns the sum', async () => {
    const deviceB = 'b'.repeat(64);
    seedJsonl([
      ev({ device_id_hash: 'a'.repeat(64), event_type: 'session_start' }),
      ev({ device_id_hash: deviceB, event_type: 'session_start' }),
    ]);
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ device_id_hash: 'a'.repeat(64), event_type: 'tile_tap' }), id: 1 },
      { ...ev({ device_id_hash: 'a'.repeat(64), event_type: 'event_save' }), id: 2 },
      { ...ev({ device_id_hash: deviceB, event_type: 'event_save' }), id: 3 },
    );
    const { deleteEventsForDevice } = await importStorage(fake);
    const deleted = await deleteEventsForDevice('a'.repeat(64));
    expect(deleted).toBe(3); // 1 JSONL + 2 Supabase
    expect(readJsonlRows()).toHaveLength(1);
    expect(readJsonlRows()[0].device_id_hash).toBe(deviceB);
    expect(fake.__rows).toHaveLength(1);
    expect(fake.__rows[0].device_id_hash).toBe(deviceB);
  });

  it('throws when the Supabase delete fails — a partial erase must not look successful', async () => {
    seedJsonl([ev({ device_id_hash: 'a'.repeat(64) })]);
    const fake = makeFakeSupabase({ failDelete: true });
    fake.__rows.push({ ...ev({ device_id_hash: 'a'.repeat(64) }), id: 1 });
    const { deleteEventsForDevice } = await importStorage(fake);
    await expect(deleteEventsForDevice('a'.repeat(64))).rejects.toThrow(/Supabase/i);
  });
});

describe('purgeOlderThan — retention across both sources', () => {
  it('purges old rows from both, keeps recent', async () => {
    const oldTs = '2026-08-01T08:00:00.000Z';
    const newTs = '2026-09-22T08:00:00.000Z';
    seedJsonl([
      ev({ ts: oldTs, received_at: oldTs, event_type: 'session_start' }),
      ev({ ts: newTs, received_at: newTs, event_type: 'search_query' }),
    ]);
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ ts: oldTs, received_at: oldTs }), id: 1 },
      { ...ev({ ts: newTs, received_at: newTs }), id: 2 },
    );
    const { purgeOlderThan } = await importStorage(fake);
    const purged = await purgeOlderThan(30);
    expect(purged).toBe(2); // one per store
    expect(readJsonlRows()).toHaveLength(1);
    expect(fake.__rows).toHaveLength(1);
  });

  it('Supabase purge failure is best-effort — JSONL purge still counts', async () => {
    const oldTs = '2026-08-01T08:00:00.000Z';
    seedJsonl([ev({ ts: oldTs, received_at: oldTs })]);
    const fake = makeFakeSupabase({ failDelete: true });
    fake.__rows.push({ ...ev({ ts: oldTs, received_at: oldTs }), id: 1 });
    const { purgeOlderThan } = await importStorage(fake);
    const purged = await purgeOlderThan(30);
    expect(purged).toBe(1);
    expect(readJsonlRows()).toHaveLength(0);
    expect(fake.__rows).toHaveLength(1); // Supabase kept its old row this run
  });
});

describe('storageStats — summed across both stores', () => {
  it('events = JSONL lines + Supabase count (disjoint by construction)', async () => {
    seedJsonl([ev({ event_type: 'session_start' }), ev({ event_type: 'search_query' })]);
    const fake = makeFakeSupabase();
    fake.__rows.push({ ...ev({ event_type: 'tile_tap' }), id: 1 });
    const { storageStats } = await importStorage(fake);
    const stats = await storageStats();
    expect(stats.events).toBe(3);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('unconfigured → JSONL stats only', async () => {
    seedJsonl([ev({ event_type: 'session_start' })]);
    const { storageStats } = await importStorage(null);
    const stats = await storageStats();
    expect(stats.events).toBe(1);
  });
});