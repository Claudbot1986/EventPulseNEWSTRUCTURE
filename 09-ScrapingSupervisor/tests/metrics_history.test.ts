/**
 * Tests for metrics_history.ts — append/overwrite/trim/read behavior.
 *
 * Uses mkdtemp-isolated projectRoot so writes do not touch the real
 * runtime/ directory.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import {
  appendSnapshot,
  readHistory,
  trimHistory,
  snapshotForToday,
  type MetricsSnapshot,
} from '../tools/metrics_history';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'metrics-hist-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const sampleSnapshot = (date: string): MetricsSnapshot => ({
  date,
  sources: { total: 500, working: 0, dead: 480, untouched: 20 },
  batches: { attempts: 100, success: 5, decoy: 1, transportOk: 5, dataOk: 4 },
  freshnessMedianHours: 50,
  fieldCoverage: { date: 0.8, venue: 0.5, title: 0.95, description: 0.3 },
});

describe('appendSnapshot', () => {
  it('creates the file on first write', () => {
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-18'));
    const path = resolve(tmpRoot, 'runtime/scraping-supervisor/metrics-history.jsonl');
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf-8').trim();
    expect(JSON.parse(text).date).toBe('2026-08-18');
  });

  it('preserves history order by date ascending', () => {
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-18'));
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-17'));
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-19'));
    const hist = readHistory(tmpRoot);
    expect(hist.map((s) => s.date)).toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
  });

  it('overwrites an existing entry for the same date (idempotent)', () => {
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-18'));
    const updated = sampleSnapshot('2026-08-18');
    updated.freshnessMedianHours = 99;
    appendSnapshot(tmpRoot, updated);
    const hist = readHistory(tmpRoot);
    expect(hist).toHaveLength(1);
    expect(hist[0].freshnessMedianHours).toBe(99);
  });

  it('returns the snapshot that was written', () => {
    const input = sampleSnapshot('2026-08-18');
    const out = appendSnapshot(tmpRoot, input);
    expect(out).toEqual(input);
  });
});

describe('snapshotForToday', () => {
  it('uses today as the date by default', () => {
    const snap = snapshotForToday(tmpRoot, {
      sources: { total: 1, working: 0, dead: 1, untouched: 0 },
      batches: { attempts: 0, success: 0, decoy: 0, transportOk: 0, dataOk: 0 },
      freshnessMedianHours: null,
      fieldCoverage: { date: 0, venue: 0, title: 0, description: 0 },
    });
    expect(snap.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('readHistory', () => {
  it('returns empty array when file missing', () => {
    expect(readHistory(tmpRoot)).toEqual([]);
  });

  it('respects keepDays option', () => {
    for (let d = 1; d <= 10; d++) {
      appendSnapshot(tmpRoot, sampleSnapshot(`2026-08-${String(d).padStart(2, '0')}`));
    }
    const last5 = readHistory(tmpRoot, { keepDays: 5 });
    expect(last5).toHaveLength(5);
    expect(last5[0].date).toBe('2026-08-06');
    expect(last5[4].date).toBe('2026-08-10');
  });
});

describe('trimHistory', () => {
  it('returns 0 when under the keep threshold', () => {
    appendSnapshot(tmpRoot, sampleSnapshot('2026-08-18'));
    expect(trimHistory(tmpRoot, 30)).toBe(0);
  });

  it('trims to the last N and returns removed count', () => {
    for (let d = 1; d <= 10; d++) {
      appendSnapshot(tmpRoot, sampleSnapshot(`2026-08-${String(d).padStart(2, '0')}`));
    }
    expect(trimHistory(tmpRoot, 3)).toBe(7);
    const after = readHistory(tmpRoot);
    expect(after).toHaveLength(3);
    expect(after.map((s) => s.date)).toEqual(['2026-08-08', '2026-08-09', '2026-08-10']);
  });
});