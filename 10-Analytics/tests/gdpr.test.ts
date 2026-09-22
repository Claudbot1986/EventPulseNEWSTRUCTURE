/**
 * gdpr.test.ts — GDPR helpers (validation + retention + cross-source
 * Fas B coverage: export/erase must see BOTH the Supabase primary store
 * and the JSONL fallback).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEvent } from '../analytics.js';
import { makeFakeSupabase } from './fakeSupabase.js';

const TMP = mkdtempSync(join(tmpdir(), 'ep-analytics-gdpr-'));
const JSONL_FILE = join(TMP, 'events.jsonl');
// Pin BEFORE the FIRST import of storage.js (its RUNTIME_DIR is load-time
// state). gdpr.js transitively imports storage.js, so gdpr.js must never
// be statically imported here — ESM hoisting would evaluate it with the
// env unpinned and pin the JSONL path to './runtime'. Hence the dynamic
// importGdpr() below.
process.env.ANALYTICS_RUNTIME_DIR = TMP;

const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);

function ev(partial: Partial<StoredEvent> = {}): StoredEvent {
  return {
    event_type: 'session_start',
    page: 'app',
    payload: {},
    device_id_hash: DEVICE_A,
    session_id: 's1',
    ts: '2026-09-22T10:00:00.000Z',
    received_at: '2026-09-22T10:00:00.000Z',
    ...partial,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importGdpr(client: ReturnType<typeof makeFakeSupabase> | null): Promise<any> {
  const storage = await import('../storage.js');
  storage._setSupabaseClientForTests(client);
  // gdpr.js binds to the SAME storage module instance at its own import.
  return await import('../gdpr.js');
}

// The pure-function describes need the module too — load it once (env
// already pinned above) and reuse the instance in every test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gdprMod: any;
beforeAll(async () => {
  gdprMod = await importGdpr(null);
});
const isValidDeviceHash = (s: unknown) => gdprMod.isValidDeviceHash(s);
const retentionDays = () => gdprMod.retentionDays();

beforeEach(() => {
  rmSync(JSONL_FILE, { force: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('isValidDeviceHash', () => {
  it('accepts 64 lowercase hex chars', () => {
    expect(isValidDeviceHash('a'.repeat(64))).toBe(true);
  });

  it('rejects short', () => {
    expect(isValidDeviceHash('abc')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidDeviceHash('A'.repeat(64))).toBe(false);
  });

  it('rejects non-hex chars', () => {
    expect(isValidDeviceHash('g'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidDeviceHash('')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidDeviceHash(123)).toBe(false);
    expect(isValidDeviceHash(null)).toBe(false);
    expect(isValidDeviceHash(undefined)).toBe(false);
    expect(isValidDeviceHash({})).toBe(false);
  });
});

describe('retentionDays', () => {
  it('returns 30 by default', () => {
    delete process.env.ANALYTICS_RETENTION_DAYS;
    expect(retentionDays()).toBe(30);
  });

  it('respects env override', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '7';
    expect(retentionDays()).toBe(7);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('caps at 365', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '999';
    expect(retentionDays()).toBe(365);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('falls back to 30 on invalid input', () => {
    process.env.ANALYTICS_RETENTION_DAYS = 'not-a-number';
    expect(retentionDays()).toBe(30);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('falls back to 30 when env is below 1', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '0';
    expect(retentionDays()).toBe(30);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });
});

describe('cross-source GDPR (Fas B: EN databas)', () => {
  it('exportForDevice returns the device rows from BOTH stores', async () => {
    writeFileSync(
      JSONL_FILE,
      JSON.stringify(ev({ device_id_hash: DEVICE_A, event_type: 'search_query' })) + '\n' +
        JSON.stringify(ev({ device_id_hash: DEVICE_B, event_type: 'session_start' })) + '\n',
      'utf8'
    );
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ device_id_hash: DEVICE_A, event_type: 'tile_tap' }), id: 1 },
      { ...ev({ device_id_hash: DEVICE_B, event_type: 'event_save' }), id: 2 }
    );
    const { exportForDevice } = await importGdpr(fake);
    const rows = (await exportForDevice(DEVICE_A)) as Array<{ event_type: string; device_id_hash: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.device_id_hash === DEVICE_A)).toBe(true);
    expect(rows.map((r) => r.event_type).sort()).toEqual(['search_query', 'tile_tap']);
  });

  it('eraseForDevice deletes the device from BOTH stores and returns the sum', async () => {
    writeFileSync(
      JSONL_FILE,
      JSON.stringify(ev({ device_id_hash: DEVICE_A, event_type: 'search_query' })) + '\n' +
        JSON.stringify(ev({ device_id_hash: DEVICE_B, event_type: 'session_start' })) + '\n',
      'utf8'
    );
    const fake = makeFakeSupabase();
    fake.__rows.push(
      { ...ev({ device_id_hash: DEVICE_A, event_type: 'tile_tap' }), id: 1 },
      { ...ev({ device_id_hash: DEVICE_A, event_type: 'event_save' }), id: 2 },
      { ...ev({ device_id_hash: DEVICE_B, event_type: 'event_save' }), id: 3 }
    );
    const { eraseForDevice } = await importGdpr(fake);
    const deleted = await eraseForDevice(DEVICE_A);
    expect(deleted).toBe(3); // 1 JSONL + 2 Supabase
    // Remaining rows in both stores are the other device's.
    const remainingJsonl = readFileSync(JSONL_FILE, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { device_id_hash: string });
    expect(remainingJsonl).toHaveLength(1);
    expect(remainingJsonl[0].device_id_hash).toBe(DEVICE_B);
    expect(fake.__rows).toHaveLength(1);
    expect(fake.__rows[0].device_id_hash).toBe(DEVICE_B);
  });

  it('erase surfaces a Supabase failure as an error — partial erase never looks successful', async () => {
    writeFileSync(JSONL_FILE, JSON.stringify(ev({ device_id_hash: DEVICE_A })) + '\n', 'utf8');
    const fake = makeFakeSupabase({ failDelete: true });
    fake.__rows.push({ ...ev({ device_id_hash: DEVICE_A }), id: 1 });
    const { eraseForDevice } = await importGdpr(fake);
    await expect(eraseForDevice(DEVICE_A)).rejects.toThrow(/Supabase/i);
  });

  it('unconfigured Supabase → JSONL-only erase still works (Phase 1 intact)', async () => {
    writeFileSync(JSONL_FILE, JSON.stringify(ev({ device_id_hash: DEVICE_A })) + '\n', 'utf8');
    const { eraseForDevice } = await importGdpr(null);
    const deleted = await eraseForDevice(DEVICE_A);
    expect(deleted).toBe(1);
    expect(existsSync(JSONL_FILE)).toBe(true); // empty file remains, zero rows
  });
});