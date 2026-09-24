/**
 * 09-DiscoveryAgent/tests/eval.test.ts — Tier-selection unit tests.
 *
 * Uses vitest (matches the rest of the project test suite). Run with:
 *   npx vitest run 09-DiscoveryAgent/tests/eval.test.ts
 *
 * Coverage: pickHealTier logic across all routing-reason patterns + edge cases.
 * Does NOT cover appendRun (audit logs) — those are integration-level.
 */

import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { hasRepeatableError, pickHealTier, type SourceStatus } from '../eval.js';

function status(partial: Partial<SourceStatus>): SourceStatus {
  return {
    sourceId: 'test',
    status: 'fail',
    ingestionStage: 'A',
    lastRun: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    lastEventsFound: 0,
    attempts: 0,
    ...partial,
  } as SourceStatus;
}

test('pickHealTier → tier 3 when 5+ fails and old lastSuccess', () => {
  const s = status({
    consecutiveFailures: 5,
    lastSuccess: '2024-01-01T00:00:00.000Z',
    lastRoutingReason: 'no-jsonld',
  });
  expect(pickHealTier(s)).toBe(3);
});

test('pickHealTier → tier 3 when 5+ fails and lastSuccess=null', () => {
  const s = status({
    consecutiveFailures: 7,
    lastSuccess: null,
    lastRoutingReason: 'no-jsonld',
  });
  expect(pickHealTier(s)).toBe(3);
});

test('pickHealTier → tier 2 for no-jsonld reason with 3 fails', () => {
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'T0096: jsonld stuck (3 attempts, 0 events)',
  });
  expect(pickHealTier(s)).toBe(2);
});

test('pickHealTier → tier 1 for Fetch failed reason', () => {
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'toolA(preA): Fetch failed: ENOTFOUND',
  });
  expect(pickHealTier(s)).toBe(1);
});

test('pickHealTier → tier 1 for ECONNRESET', () => {
  const s = status({
    consecutiveFailures: 4,
    lastSuccess: null,
    lastRoutingReason: 'ECONNRESET from upstream',
  });
  expect(pickHealTier(s)).toBe(1);
});

test('pickHealTier → tier 1 for network/SSL', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'SSL handshake failed',
  });
  expect(pickHealTier(s)).toBe(1);
});

test('pickHealTier → tier 2 when reason contains "0 events"', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'runA-extract: 0 events',
  });
  expect(pickHealTier(s)).toBe(2);
});

test('pickHealTier → null when no lastRoutingReason', () => {
  const s = status({
    consecutiveFailures: 4,
    lastSuccess: null,
    lastRoutingReason: undefined,
  });
  expect(pickHealTier(s)).toBe(null);
});

test('pickHealTier → tier 2 when recent success overrides retire', () => {
  const s = status({
    consecutiveFailures: 8,
    lastSuccess: new Date().toISOString(),
    lastRoutingReason: 'no-jsonld',
  });
  expect(pickHealTier(s)).toBe(2);
});

test('pickHealTier → respects retireDays override', () => {
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: oldDate,
    lastRoutingReason: 'no-jsonld',
  });
  // Default retireDays=30 → 100-day-old success is "old" but consecutiveFailures<5 → not retire
  expect(pickHealTier(s)).toBe(2);
  // With retireDays=200 → 100 days is recent → not retired yet (still tier 2)
  expect(pickHealTier(s, { retireDays: 200 })).toBe(2);
  // With retireAfter=2 AND a really old success (500 days) → retire (tier 3)
  const veryOld = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString();
  const s2 = status({
    consecutiveFailures: 3,
    lastSuccess: veryOld,
    lastRoutingReason: 'no-jsonld',
  });
  expect(pickHealTier(s2, { retireAfter: 2, retireDays: 200 })).toBe(3);
});

test('pickHealTier → defaults to tier 2 for unrecognized reason', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'something completely new',
  });
  expect(pickHealTier(s)).toBe(2);
});

// ─── Tier 0 (Fas 2.1): pre-routing errors are not healable ────────────────

test('pickHealTier → null for postB-preC: reason (pre-routing, not healable)', () => {
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'postB-preC: toolB(preB): [breadth] unclear/low_value',
  });
  expect(pickHealTier(s)).toBe(null);
});

test('pickHealTier → null for toolB(preB) reason (sub-retire-threshold failure count)', () => {
  // 3 consecutiveFailures is below the retire threshold (5) so the tier 0
  // filter is what determines the outcome.
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'toolB(preB): discovery returned no candidates',
  });
  expect(pickHealTier(s)).toBe(null);
});

test('pickHealTier → null for postB-preC: even when otherwise no-jsonld would trigger tier 2', () => {
  // The 0-events substring matches tier 2 — but the postB-preC: prefix should
  // win because pre-routing failures cannot be healed by C0/render-gate.
  const s = status({
    consecutiveFailures: 4,
    lastSuccess: null,
    lastRoutingReason: 'postB-preC: toolB(preB): 0 events from upstream',
  });
  expect(pickHealTier(s)).toBe(null);
});

test('pickHealTier → tier 3 retire still beats tier 0 (5+ fails + old success)', () => {
  const s = status({
    consecutiveFailures: 7,
    lastSuccess: '2024-01-01T00:00:00.000Z',
    lastRoutingReason: 'postB-preC: toolB(preB): [breadth] unclear',
  });
  // Retire check runs first in pickHealTier; tier 0 must NOT override retire.
  expect(pickHealTier(s)).toBe(3);
});

// ─── hasRepeatableError (Fas 1.2) ──────────────────────────────────────────

function tempLogPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'jev-rep-')), 'runs.jsonl');
}

function seedLog(filePath: string, lines: object[]): void {
  writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
}

test('hasRepeatableError → false when log file is missing', () => {
  expect(hasRepeatableError('any-source', { logPath: '/nonexistent/path/runs.jsonl' })).toBe(false);
});

test('hasRepeatableError → true when last 3 heal entries for sourceId share an error signature', () => {
  const log = tempLogPath();
  const sig = 'C0 candidate discovery failed: No candidate pages matched (network or scoring)';
  seedLog(log, [
    { ts: '2026-09-23T01:00:00Z', phase: 'heal', sourceId: 's1', error: 'unrelated earlier' },
    { ts: '2026-09-23T01:05:00Z', phase: 'heal', sourceId: 'hopeless', error: sig },
    { ts: '2026-09-23T01:10:00Z', phase: 'heal', sourceId: 'hopeless', error: sig },
    { ts: '2026-09-23T01:15:00Z', phase: 'heal', sourceId: 'hopeless', error: sig },
  ]);
  expect(hasRepeatableError('hopeless', { logPath: log })).toBe(true);
  // Other sources in same log are NOT matched
  expect(hasRepeatableError('s1', { logPath: log })).toBe(false);
});

test('hasRepeatableError → false when error signatures differ across recent attempts', () => {
  const log = tempLogPath();
  seedLog(log, [
    { ts: '2026-09-23T01:00:00Z', phase: 'heal', sourceId: 'flaky', error: 'Fetch failed: ECONNRESET' },
    { ts: '2026-09-23T01:05:00Z', phase: 'heal', sourceId: 'flaky', error: 'Fetch failed: ETIMEDOUT' },
    { ts: '2026-09-23T01:10:00Z', phase: 'heal', sourceId: 'flaky', error: 'no-jsonld: 0 events' },
  ]);
  expect(hasRepeatableError('flaky', { logPath: log })).toBe(false);
});

test('hasRepeatableError → false when fewer than threshold entries exist for sourceId', () => {
  const log = tempLogPath();
  const sig = 'C0 candidate discovery failed: No candidate pages matched';
  seedLog(log, [
    { ts: '2026-09-23T01:00:00Z', phase: 'heal', sourceId: 'newcomer', error: sig },
    { ts: '2026-09-23T01:05:00Z', phase: 'heal', sourceId: 'newcomer', error: sig },
    // only 2 entries — below threshold of 3
  ]);
  expect(hasRepeatableError('newcomer', { logPath: log })).toBe(false);
});

test('hasRepeatableError → ignores non-heal phases and entries without errors', () => {
  const log = tempLogPath();
  seedLog(log, [
    { ts: '2026-09-23T01:00:00Z', phase: 'promote', sourceId: 'mixed', error: 'noise' },
    { ts: '2026-09-23T01:05:00Z', phase: 'heal', sourceId: 'mixed' }, // no error → transient recovery resets
    { ts: '2026-09-23T01:10:00Z', phase: 'heal', sourceId: 'mixed', error: 'sig-A' },
    { ts: '2026-09-23T01:15:00Z', phase: 'heal', sourceId: 'mixed', error: 'sig-A' },
  ]);
  // Only 2 entries with errors (last 2 heal-with-error entries) — under threshold
  expect(hasRepeatableError('mixed', { logPath: log })).toBe(false);
});
