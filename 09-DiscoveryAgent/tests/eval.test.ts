/**
 * 09-DiscoveryAgent/tests/eval.test.ts — Tier-selection unit tests.
 *
 * Uses node:test (built-in, no extra deps). Run with:
 *   npx tsx --test 09-DiscoveryAgent/tests/eval.test.ts
 *
 * Coverage: pickHealTier logic across all routing-reason patterns + edge cases.
 * Does NOT cover appendRun (audit logs) — those are integration-level.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickHealTier, type SourceStatus } from '../eval.js';

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
  assert.equal(pickHealTier(s), 3);
});

test('pickHealTier → tier 3 when 5+ fails and lastSuccess=null', () => {
  const s = status({
    consecutiveFailures: 7,
    lastSuccess: null,
    lastRoutingReason: 'no-jsonld',
  });
  assert.equal(pickHealTier(s), 3);
});

test('pickHealTier → tier 2 for no-jsonld reason with 3 fails', () => {
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'T0096: jsonld stuck (3 attempts, 0 events)',
  });
  assert.equal(pickHealTier(s), 2);
});

test('pickHealTier → tier 1 for Fetch failed reason', () => {
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: null,
    lastRoutingReason: 'toolA(preA): Fetch failed: ENOTFOUND',
  });
  assert.equal(pickHealTier(s), 1);
});

test('pickHealTier → tier 1 for ECONNRESET', () => {
  const s = status({
    consecutiveFailures: 4,
    lastSuccess: null,
    lastRoutingReason: 'ECONNRESET from upstream',
  });
  assert.equal(pickHealTier(s), 1);
});

test('pickHealTier → tier 1 for network/SSL', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'SSL handshake failed',
  });
  assert.equal(pickHealTier(s), 1);
});

test('pickHealTier → tier 2 when reason contains "0 events"', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'runA-extract: 0 events',
  });
  assert.equal(pickHealTier(s), 2);
});

test('pickHealTier → null when no lastRoutingReason', () => {
  const s = status({
    consecutiveFailures: 4,
    lastSuccess: null,
    lastRoutingReason: undefined,
  });
  assert.equal(pickHealTier(s), null);
});

test('pickHealTier → tier 2 when recent success overrides retire', () => {
  const s = status({
    consecutiveFailures: 8,
    lastSuccess: new Date().toISOString(),
    lastRoutingReason: 'no-jsonld',
  });
  assert.equal(pickHealTier(s), 2);
});

test('pickHealTier → respects retireDays override', () => {
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const s = status({
    consecutiveFailures: 3,
    lastSuccess: oldDate,
    lastRoutingReason: 'no-jsonld',
  });
  // Default retireDays=30 → 100-day-old success is "old" but consecutiveFailures<5 → not retire
  assert.equal(pickHealTier(s), 2);
  // With retireDays=200 → 100 days is recent → not retired yet (still tier 2)
  assert.equal(pickHealTier(s, { retireDays: 200 }), 2);
  // With retireAfter=2 AND a really old success (500 days) → retire (tier 3)
  const veryOld = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString();
  const s2 = status({
    consecutiveFailures: 3,
    lastSuccess: veryOld,
    lastRoutingReason: 'no-jsonld',
  });
  assert.equal(pickHealTier(s2, { retireAfter: 2, retireDays: 200 }), 3);
});

test('pickHealTier → defaults to tier 2 for unrecognized reason', () => {
  const s = status({
    consecutiveFailures: 2,
    lastSuccess: null,
    lastRoutingReason: 'something completely new',
  });
  assert.equal(pickHealTier(s), 2);
});
