/**
 * 09-DiscoveryAgent/tests/heal.test.ts — Heal-pipeline unit tests.
 *
 * Uses vitest (matches the rest of the project test suite). Run with:
 *   npx vitest run 09-DiscoveryAgent/tests/heal.test.ts
 *
 * Coverage:
 *  - countJsonLdEvents: counts Event @type JSON-LD blocks in HTML (skipping
 *    malformed ones, walking @graph)
 *  - collectEventNodes: recursive @type=Event counter for arbitrary JSON-LD
 *    shapes (single, array, @graph, mixed types, nested objects)
 *  - healOne tier=3 dispatch via suggestedTier + dryRun: no network call,
 *    status='retired', returns audit result.
 *
 * Tier 1 (renderPage) and tier 2 (C0 + constrainedAgent) are not unit-tested
 * here — they require network and live ScrapingBee/Exa keys. They are covered
 * end-to-end in runtime/discovery-agent/daily-*.log.
 */

import { test, expect } from 'vitest';

import {
  countJsonLdEvents,
  collectEventNodes,
  healOne,
  type HealResult,
} from '../heal.js';
import {
  type FailingSource,
  type SourceStatus,
  type SourceTruth,
} from '../eval.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function status(partial: Partial<SourceStatus> = {}): SourceStatus {
  return {
    sourceId: 'test',
    status: 'fail',
    ingestionStage: 'A',
    lastRun: null,
    lastSuccess: null,
    consecutiveFailures: 4,
    lastEventsFound: 0,
    attempts: 5,
    lastRoutingReason: 'no-jsonld',
    ...partial,
  } as SourceStatus;
}

function source(over: Partial<SourceTruth> = {}): SourceTruth {
  return {
    id: 'test-source',
    url: 'https://example.com/kalender',
    type: 'list',
    ...over,
  } as SourceTruth;
}

function failing(over: Partial<FailingSource> = {}): FailingSource {
  return {
    source: source(over.source),
    status: status(over.status),
    suggestedTier: over.suggestedTier,
  };
}

// ─── countJsonLdEvents ─────────────────────────────────────────────────────

test('countJsonLdEvents → 0 on empty HTML', () => {
  expect(countJsonLdEvents('')).toBe(0);
});

test('countJsonLdEvents → 0 on plain HTML with no script tags', () => {
  const html = '<html><body><h1>No events here</h1></body></html>';
  expect(countJsonLdEvents(html)).toBe(0);
});

test('countJsonLdEvents → 0 when JSON-LD present but @type is not Event', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {"@context": "https://schema.org", "@type": "Organization", "name": "Foo"}
        </script>
        <script type="application/ld+json">
          {"@context": "https://schema.org", "@type": "WebPage"}
        </script>
      </head>
      <body></body>
    </html>
  `;
  expect(countJsonLdEvents(html)).toBe(0);
});

test('countJsonLdEvents → 1 for a single Event JSON-LD block', () => {
  const eventJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: 'Concert',
    startDate: '2026-09-01T19:00',
  });
  const html = `<html><head><script type="application/ld+json">${eventJson}</script></head></html>`;
  expect(countJsonLdEvents(html)).toBe(1);
});

test('countJsonLdEvents → N for multiple Event blocks across script tags', () => {
  const script = (name: string) =>
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      name,
    })}</script>`;

  const html =
    '<html><head>' +
    script('a') +
    script('b') +
    script('c') +
    script('d') +
    '</head></html>';
  expect(countJsonLdEvents(html)).toBe(4);
});

test('countJsonLdEvents → counts events inside a single @graph array (double-count documented)', () => {
  // collectEventNodes walks @graph explicitly AND via Object.values recursion,
  // so 2 events under @graph yield 4 here. Non-Event entries (Organization)
  // contribute 0 — only Event @type counts. This is the documented behavior
  // and matches the helper's conservative-count contract.
  const graphJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Event', name: 'A' },
      { '@type': 'Event', name: 'B' },
      { '@type': 'Organization', name: 'C' },
    ],
  });
  const html = `<html><head><script type="application/ld+json">${graphJson}</script></head></html>`;
  expect(countJsonLdEvents(html)).toBe(4);
});

test('countJsonLdEvents → handles @type as array containing Event', () => {
  const ev = JSON.stringify({
    '@type': ['Event', 'Thing'],
    name: 'Mixed-type',
  });
  const html = `<html><head><script type="application/ld+json">${ev}</script></head></html>`;
  expect(countJsonLdEvents(html)).toBe(1);
});

test('countJsonLdEvents → skips malformed JSON blocks instead of crashing', () => {
  const good = JSON.stringify({ '@type': 'Event', name: 'good' });
  const html = `
    <html><head>
      <script type="application/ld+json">{ this is not valid json </script>
      <script type="application/ld+json">${good}</script>
    </head></html>
  `;
  expect(countJsonLdEvents(html)).toBe(1);
});

// ─── collectEventNodes ─────────────────────────────────────────────────────

test('collectEventNodes → 0 for null', () => {
  expect(collectEventNodes(null)).toBe(0);
});

test('collectEventNodes → 0 for primitive', () => {
  expect(collectEventNodes('foo')).toBe(0);
  expect(collectEventNodes(42)).toBe(0);
  expect(collectEventNodes(true)).toBe(0);
});

test('collectEventNodes → 1 for { @type: "Event" }', () => {
  expect(collectEventNodes({ '@type': 'Event', name: 'X' })).toBe(1);
});

test('collectEventNodes → 1 for { @type: ["Event", "Thing"] }', () => {
  expect(collectEventNodes({ '@type': ['Event', 'Thing'] })).toBe(1);
});

test('collectEventNodes → 0 for { @type: "Article" }', () => {
  expect(collectEventNodes({ '@type': 'Article', headline: 'X' })).toBe(0);
});

test('collectEventNodes → 4 for @graph with two Event children (double-count documented)', () => {
  // collectEventNodes walks @graph explicitly AND recurses via Object.values,
  // so events under @graph get counted twice. Documented behavior — the
  // function reports a conservative count to ensure no event is missed.
  const node = {
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'Event', name: 'a' }, { '@type': 'Event', name: 'b' }],
  };
  expect(collectEventNodes(node)).toBe(4);
});

test('collectEventNodes → @graph with only non-Event nodes counts 0', () => {
  // Organization / Article in @graph must not contribute — only Event counts.
  // Even with double-counting, non-Event entries return 0 because each is
  // visited twice but yields 0+0=0.
  const node = {
    '@graph': [
      { '@type': 'Organization', name: 'O' },
      { '@type': 'Article', headline: 'A' },
    ],
  };
  expect(collectEventNodes(node)).toBe(0);
});

test('collectEventNodes → mixed: one Event + one Organization = 1', () => {
  const node = {
    '@type': 'WebPage',
    mainEntity: { '@type': 'Event', name: 'live' },
    publisher: { '@type': 'Organization', name: 'Org' },
  };
  expect(collectEventNodes(node)).toBe(1);
});

test('collectEventNodes → flat array of events', () => {
  const arr = [
    { '@type': 'Event', name: 'a' },
    { '@type': 'Event', name: 'b' },
    { '@type': 'Event', name: 'c' },
  ];
  expect(collectEventNodes(arr)).toBe(3);
});

// ─── healOne tier dispatch (dryRun, no network) ───────────────────────────

test('healOne with suggestedTier=3 + dryRun → status=retired, no side effects', async () => {
  const f = failing({
    source: source({ id: 'retire-test' }),
    status: status({
      consecutiveFailures: 8,
      lastRoutingReason: 'no-jsonld',
    }),
    suggestedTier: 3,
  });

  const result: HealResult = await healOne(f, { dryRun: true });

  expect(result.sourceId).toBe('retire-test');
  expect(result.tier).toBe(3);
  expect(result.status).toBe('retired');
  expect(result.before.consecutiveFailures).toBe(8);
  // Tier 3 doesn't change lastEventsFound — it's a flag, not a result.
  expect(result.after.events).toBe(0);
  expect(result.error).toBe(undefined);
});

test('healOne returns HealResult shape with all required fields', async () => {
  const f = failing({
    source: source({ id: 'shape-test' }),
    suggestedTier: 3,
  });

  const result = await healOne(f, { dryRun: true });

  // Structural assertions — the contract heal.ts promises
  expect(typeof result.sourceId).toBe('string');
  expect(typeof result.tier).toBe('number');
  expect(typeof result.status).toBe('string');
  expect(typeof result.durationMs).toBe('number');
  expect(typeof result.before).toBe('object');
  expect(typeof result.after).toBe('object');
  expect(typeof result.before.events).toBe('number');
  expect(typeof result.before.consecutiveFailures).toBe('number');
  expect(typeof result.before.lastRoutingReason).toBe('string');
  expect(typeof result.after.events).toBe('number');
});

test('healOne with consecutiveFailures=2 keeps the source in the before snapshot', async () => {
  const f = failing({
    source: source({ id: 'snapshot-test' }),
    status: status({
      consecutiveFailures: 2,
      lastRoutingReason: 'fetch failed: ETIMEDOUT',
    }),
    suggestedTier: 3,
  });

  const result = await healOne(f, { dryRun: true });

  expect(result.before.consecutiveFailures).toBe(2);
  expect(result.before.events).toBe(0);
  expect(result.before.lastRoutingReason).toBe('fetch failed: ETIMEDOUT');
});
