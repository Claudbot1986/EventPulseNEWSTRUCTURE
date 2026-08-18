/**
 * Tests for freshness_metrics.ts — compute freshness, field coverage,
 * and batch metrics against synthetic fixtures (no real project data).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import {
  computeFreshnessMedianHours,
  computeFieldCoverage,
  computeBatchMetrics,
  computeAll,
} from '../tools/freshness_metrics';

let tmpRoot: string;
const NOW = new Date('2026-08-19T12:00:00Z');

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'fresh-metrics-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function setMtimeHoursAgo(file: string, hours: number): void {
  const ms = NOW.getTime() - hours * 3_600_000;
  utimesSync(file, new Date(ms), new Date(ms));
}

describe('computeFreshnessMedianHours', () => {
  it('returns null when no event directory exists', () => {
    const out = computeFreshnessMedianHours(tmpRoot, { eventDir: 'missing-dir', now: NOW });
    expect(out).toBeNull();
  });

  it('returns null for an empty event directory', () => {
    mkdirSync(resolve(tmpRoot, 'empty'), { recursive: true });
    const out = computeFreshnessMedianHours(tmpRoot, { eventDir: 'empty', now: NOW });
    expect(out).toBeNull();
  });

  it('returns the median age of files in hours', () => {
    const dir = resolve(tmpRoot, 'events');
    mkdirSync(dir, { recursive: true });
    const f1 = join(dir, 'a.jsonl');
    const f2 = join(dir, 'b.jsonl');
    const f3 = join(dir, 'c.jsonl');
    writeFileSync(f1, '');
    writeFileSync(f2, '');
    writeFileSync(f3, '');
    setMtimeHoursAgo(f1, 10);
    setMtimeHoursAgo(f2, 30);
    setMtimeHoursAgo(f3, 50);

    const out = computeFreshnessMedianHours(tmpRoot, { eventDir: 'events', now: NOW });
    expect(out).toBeCloseTo(30, 1);
  });

  it('scans subdirectories of the event dir', () => {
    const sub = resolve(tmpRoot, 'events/sub');
    mkdirSync(sub, { recursive: true });
    const f = join(sub, 'x.jsonl');
    writeFileSync(f, '');
    setMtimeHoursAgo(f, 12);
    const out = computeFreshnessMedianHours(tmpRoot, { eventDir: 'events', now: NOW });
    expect(out).toBeCloseTo(12, 1);
  });
});

describe('computeFieldCoverage', () => {
  it('returns zeros when no event directory exists', () => {
    const out = computeFieldCoverage(tmpRoot, { eventDir: 'missing' });
    expect(out).toEqual({ date: 0, venue: 0, title: 0, description: 0 });
  });

  it('counts hasDate/hasVenue/etc booleans (jazz-i-lund schema)', () => {
    const dir = resolve(tmpRoot, 'events');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'src1.jsonl'),
      [
        JSON.stringify({ title: 'A', confidence: { hasDate: true, hasVenue: true, hasTitle: true, hasDescription: false } }),
        JSON.stringify({ title: 'B', confidence: { hasDate: false, hasVenue: true, hasTitle: true, hasDescription: true } }),
        JSON.stringify({ title: 'C', confidence: { hasDate: true, hasVenue: false, hasTitle: true, hasDescription: true } }),
      ].join('\n') + '\n'
    );
    const out = computeFieldCoverage(tmpRoot, { eventDir: 'events' });
    expect(out.date).toBeCloseTo(2 / 3, 2);
    expect(out.venue).toBeCloseTo(2 / 3, 2);
    expect(out.title).toBe(1);
    expect(out.description).toBeCloseTo(2 / 3, 2);
  });

  it('counts confidence.fields numeric schema (debaser style)', () => {
    const dir = resolve(tmpRoot, 'events');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'src2.jsonl'),
      [
        JSON.stringify({ confidence: { fields: { title: 1, date: 1, venue: 0, description: 1 } } }),
        JSON.stringify({ confidence: { fields: { title: 1, date: 0, venue: 1, description: 0 } } }),
      ].join('\n') + '\n'
    );
    const out = computeFieldCoverage(tmpRoot, { eventDir: 'events' });
    expect(out.date).toBe(0.5);
    expect(out.venue).toBe(0.5);
    expect(out.title).toBe(1);
    expect(out.description).toBe(0.5);
  });

  it('falls back to non-empty top-level field values', () => {
    const dir = resolve(tmpRoot, 'events');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'src3.jsonl'),
      [
        JSON.stringify({ title: 'A', date: '2026-01-01', venue: 'X' }),
        JSON.stringify({ title: 'B', date: 'unknown' }),
        JSON.stringify({ title: '' }),
      ].join('\n') + '\n'
    );
    const out = computeFieldCoverage(tmpRoot, { eventDir: 'events' });
    // No confidence on any → fallback to top-level.
    // title: 'A' + 'B' count, '' does not → 2/3
    // date: '2026-01-01' counts, 'unknown' rejected, missing → 1/3
    // venue: 'X' counts, missing × 2 → 1/3
    expect(out.title).toBeCloseTo(2 / 3, 2);
    expect(out.date).toBeCloseTo(1 / 3, 2);
    expect(out.venue).toBeCloseTo(1 / 3, 2);
    expect(out.description).toBe(0);
  });

  it('skips malformed JSONL lines without crashing', () => {
    const dir = resolve(tmpRoot, 'events');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'src4.jsonl'),
      [
        'not-json',
        JSON.stringify({ title: 'OK', confidence: { hasTitle: true } }),
      ].join('\n') + '\n'
    );
    const out = computeFieldCoverage(tmpRoot, { eventDir: 'events' });
    expect(out.title).toBe(1);
  });
});

describe('computeBatchMetrics', () => {
  it('returns zeros when no batch dir exists', () => {
    const out = computeBatchMetrics(tmpRoot, { batchDir: 'missing', recentBatches: 5 });
    expect(out).toEqual({ attempts: 0, success: 0, decoy: 0, transportOk: 0, dataOk: 0 });
  });

  it('counts attempts, success, decoy, transportOk, dataOk across last N', () => {
    const bd = resolve(tmpRoot, 'reports');
    mkdirSync(join(bd, 'batch-1'), { recursive: true });
    mkdirSync(join(bd, 'batch-2'), { recursive: true });
    writeFileSync(
      join(bd, 'batch-1/batch-traces.jsonl'),
      [
        JSON.stringify({ success: true, eventsFound: 5 }),
        JSON.stringify({ success: true, eventsFound: 0 }),
        JSON.stringify({ success: false, eventsFound: 0 }),
      ].join('\n') + '\n'
    );
    writeFileSync(
      join(bd, 'batch-2/batch-traces.jsonl'),
      [
        JSON.stringify({ success: true, eventsFound: 3 }),
        JSON.stringify({ success: false, eventsFound: 0 }),
      ].join('\n') + '\n'
    );
    const out = computeBatchMetrics(tmpRoot, { batchDir: 'reports', recentBatches: 5 });
    expect(out.attempts).toBe(5);
    expect(out.success).toBe(3);
    expect(out.decoy).toBe(1);
    expect(out.transportOk).toBe(3);
    expect(out.dataOk).toBe(2);
  });

  it('only includes the most recent N batch dirs', () => {
    const bd = resolve(tmpRoot, 'reports');
    for (let i = 1; i <= 7; i++) {
      mkdirSync(join(bd, `batch-${i}`), { recursive: true });
      writeFileSync(
        join(bd, `batch-${i}/batch-traces.jsonl`),
        JSON.stringify({ success: true, eventsFound: 1 }) + '\n'
      );
    }
    const out = computeBatchMetrics(tmpRoot, { batchDir: 'reports', recentBatches: 3 });
    expect(out.attempts).toBe(3);
  });

  it('uses natural sort so batch-201 > batch-99 (not lexicographic)', () => {
    const bd = resolve(tmpRoot, 'reports');
    for (const n of [90, 99, 197, 200, 201]) {
      mkdirSync(join(bd, `batch-${n}`), { recursive: true });
      writeFileSync(
        join(bd, `batch-${n}/batch-traces.jsonl`),
        JSON.stringify({ sourceId: `s${n}`, success: true, eventsFound: n % 3 }) + '\n'
      );
    }
    const out = computeBatchMetrics(tmpRoot, { batchDir: 'reports', recentBatches: 3 });
    // Should pick batch-201, batch-200, batch-197 — not batch-99
    expect(out.attempts).toBe(3);
  });
});

describe('computeAll', () => {
  it('returns all three metrics in one call', () => {
    const ev = resolve(tmpRoot, 'events');
    mkdirSync(ev, { recursive: true });
    writeFileSync(join(ev, 'x.jsonl'), JSON.stringify({ title: 'A', date: '2026-01-01' }) + '\n');
    setMtimeHoursAgo(join(ev, 'x.jsonl'), 5);

    const bd = resolve(tmpRoot, 'reports');
    mkdirSync(join(bd, 'batch-1'), { recursive: true });
    writeFileSync(join(bd, 'batch-1/batch-traces.jsonl'),
      JSON.stringify({ success: true, eventsFound: 1 }) + '\n');

    const out = computeAll(tmpRoot, { eventDir: 'events', batchDir: 'reports', now: NOW });
    expect(out.freshnessMedianHours).toBeCloseTo(5, 1);
    expect(out.fieldCoverage.title).toBe(1);
    expect(out.batchMetrics.attempts).toBe(1);
    expect(out.batchMetrics.dataOk).toBe(1);
  });
});