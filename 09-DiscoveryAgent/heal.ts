/**
 * 09-DiscoveryAgent/heal.ts — 3-tier heal pipeline for failing sources.
 *
 * Tier 1 (transport): Network/transport failure → render-gate via ScrapingBee.
 *   If rendered HTML contains JSON-LD events → mark recovered + lastPathUsed='render'.
 *
 * Tier 2 (no-jsonld): Source has no usable JSON-LD → run C0 candidate discovery
 *   → if winner found → run constrainedAgent pipeline → save adapter.
 *   Source gets pendingNextTool='D-renderGate' so next runA picks up the adapter.
 *
 * Tier 3 (retire): consecutiveFailures >= threshold AND no recent success →
 *   audit-only retire (append to retired.jsonl). Never deletes from sources/.
 *
 * Every tier logs to runs.jsonl via appendRun. updateSourceStatus is called
 * for tier 1/2 success paths only — tier 3 never mutates source state.
 *
 * No LLM decisions outside the existing constrainedAgent.runPipeline which is
 * already deployed and tested.
 */

import { load } from 'cheerio';

import {
  renderPage,
  type RenderResult,
} from '../02-Ingestion/D-renderGate/renderGate.js';
import {
  discoverEventCandidates,
} from '../02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.js';
import {
  runPipeline,
} from '../02-Ingestion/D-renderGate/constrainedAgent.js';
import {
  updateSourceStatus,
} from '../02-Ingestion/tools/sourceRegistry.js';

import {
  appendRun,
  appendRetired,
  pickHealTier,
  nowIso,
  type FailingSource,
} from './eval.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type HealStatus =
  | 'recovered'        // tier 1: render-gate produced events
  | 'adapter_saved'    // tier 2: D-AI adapter generated and validated
  | 'deferred'         // tier 2: no candidate winner — try again tomorrow
  | 'retired'          // tier 3: moved to retired.jsonl (audit-only)
  | 'error';           // any tier threw

export interface HealResult {
  sourceId: string;
  tier: 1 | 2 | 3;
  status: HealStatus;
  durationMs: number;
  before: {
    events: number;
    consecutiveFailures: number;
    lastRoutingReason: string;
  };
  after: {
    events: number;
    adapterPath?: string;
    candidatesFound?: number;
    winnerUrl?: string;
  };
  error?: string;
}

export interface HealOptions {
  /** Per-tier timeout in ms (default 60s). */
  timeoutMs?: number;
  /** Skip side-effects (no updateSourceStatus, no appendRun). For tests. */
  dryRun?: boolean;
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Heal one failing source. Picks tier from status.lastRoutingReason via
 * pickHealTier, dispatches to the right tier function, returns the result.
 * Always logs to runs.jsonl (unless dryRun).
 */
export async function healOne(
  failing: FailingSource,
  options: HealOptions = {},
): Promise<HealResult> {
  const { source, status } = failing;
  const tier = failing.suggestedTier ?? pickHealTier(status);
  const start = Date.now();
  const before = {
    events: status.lastEventsFound,
    consecutiveFailures: status.consecutiveFailures,
    lastRoutingReason: status.lastRoutingReason ?? '',
  };

  if (tier === null) {
    const result: HealResult = {
      sourceId: source.id,
      tier: 2,
      status: 'deferred',
      durationMs: Date.now() - start,
      before,
      after: { events: before.events },
      error: 'no lastRoutingReason — cannot pick tier',
    };
    if (!options.dryRun) {
      appendRun({
        ts: nowIso(),
        phase: 'heal',
        sourceId: source.id,
        durationMs: result.durationMs,
        before,
        after: result.after,
        error: result.error,
        dryRun: false,
      });
    }
    return result;
  }

  try {
    let result: HealResult;
    if (tier === 1) result = await healTier1Transport(source, status, before, start, options);
    else if (tier === 2) result = await healTier2NoJsonld(source, status, before, start, options);
    else result = await healTier3Retire(source, status, before, start, options);

    if (!options.dryRun) {
      appendRun({
        ts: nowIso(),
        phase: 'heal',
        sourceId: source.id,
        tier,
        durationMs: result.durationMs,
        before,
        after: result.after,
        error: result.error,
        dryRun: false,
      });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: HealResult = {
      sourceId: source.id,
      tier,
      status: 'error',
      durationMs: Date.now() - start,
      before,
      after: { events: before.events },
      error: message,
    };
    if (!options.dryRun) {
      appendRun({
        ts: nowIso(),
        phase: 'heal',
        sourceId: source.id,
        tier,
        durationMs: result.durationMs,
        before,
        after: result.after,
        error: message,
        dryRun: false,
      });
    }
    return result;
  }
}

// ─── Tier 1: transport ─────────────────────────────────────────────────────

async function healTier1Transport(
  source: { id: string; url: string },
  status: { consecutiveFailures: number; lastRoutingReason?: string },
  before: HealResult['before'],
  start: number,
  options: HealOptions,
): Promise<HealResult> {
  const timeout = options.timeoutMs ?? 60_000;
  const render = await renderPage(source.url, { timeout });
  if (!render.success || !render.html) {
    return {
      sourceId: source.id,
      tier: 1,
      status: 'deferred',
      durationMs: Date.now() - start,
      before,
      after: { events: before.events },
      error: `renderPage failed: ${render.error ?? 'unknown'}`,
    };
  }

  const eventsFound = countJsonLdEvents(render.html);
  if (eventsFound > 0 && !options.dryRun) {
    updateSourceStatus(source.id, {
      status: 'success',
      lastPathUsed: 'render',
      lastEventsFound: eventsFound,
      lastSuccess: nowIso(),
      consecutiveFailures: 0,
      lastRoutingReason: `discovery-agent tier1 render: ${eventsFound} events`,
      lastRoutingSource: 'triage',
    });
  }

  return {
    sourceId: source.id,
    tier: 1,
    status: eventsFound > 0 ? 'recovered' : 'deferred',
    durationMs: Date.now() - start,
    before,
    after: { events: eventsFound },
  };
}

/** Count <script type="application/ld+json"> with @type Event. */
function countJsonLdEvents(html: string): number {
  let count = 0;
  try {
    const $ = load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      const text = $(el).contents().text();
      try {
        const parsed = JSON.parse(text);
        count += collectEventNodes(parsed);
      } catch {
        // skip non-JSON blocks
      }
    });
  } catch {
    return 0;
  }
  return count;
}

function collectEventNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) {
    return node.reduce((acc, n) => acc + collectEventNodes(n), 0);
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isEvent =
    type === 'Event' ||
    (Array.isArray(type) && type.includes('Event'));
  let n = isEvent ? 1 : 0;
  if (Array.isArray(obj['@graph'])) {
    n += (obj['@graph'] as unknown[]).reduce(
      (acc, child) => acc + collectEventNodes(child),
      0,
    );
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      n += collectEventNodes(value);
    }
  }
  return n;
}

// ─── Tier 2: no-jsonld ─────────────────────────────────────────────────────

async function healTier2NoJsonld(
  source: { id: string; url: string },
  status: { consecutiveFailures: number; lastRoutingReason?: string },
  before: HealResult['before'],
  start: number,
  options: HealOptions,
): Promise<HealResult> {
  const timeout = options.timeoutMs ?? 60_000;

  const discovery = await Promise.race([
    discoverEventCandidates(source.url, undefined, source.id),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('discoverEventCandidates timeout')), timeout),
    ),
  ]).catch((err: unknown) => {
    throw new Error(`C0 discovery failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const winner = discovery.winner;
  if (!winner) {
    return {
      sourceId: source.id,
      tier: 2,
      status: 'deferred',
      durationMs: Date.now() - start,
      before,
      after: {
        events: before.events,
        candidatesFound: discovery.candidatesFound,
      },
      error: `no winner: ${discovery.winnerReason ?? 'unknown'}`,
    };
  }

  // Generate D-AI adapter from the winner URL.
  const pipelineResult = await runPipeline({
    sourceId: source.id,
    url: winner.url,
    maxTokens: 1500,
    rateLimitMs: 1500,
  }).catch((err: unknown) => {
    throw new Error(`runPipeline failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const adapterPath = `runtime/adapters/${source.id}.json`;
  const eventsFound = pipelineResult.eventsFound ?? 0;

  if (!options.dryRun && pipelineResult.validationPassed) {
    updateSourceStatus(source.id, {
      status: 'pending_api_adapter',
      pendingNextTool: 'D-renderGate',
      lastRoutingReason: `discovery-agent tier2: adapter saved (${eventsFound} events validated)`,
      lastRoutingSource: 'triage',
    });
  }

  return {
    sourceId: source.id,
    tier: 2,
    status: pipelineResult.validationPassed ? 'adapter_saved' : 'deferred',
    durationMs: Date.now() - start,
    before,
    after: {
      events: eventsFound,
      adapterPath: pipelineResult.validationPassed ? adapterPath : undefined,
      candidatesFound: discovery.candidatesFound,
      winnerUrl: winner.url,
    },
    error: pipelineResult.validationPassed
      ? undefined
      : `validation: ${pipelineResult.validationNotes ?? 'unknown'}`,
  };
}

// ─── Tier 3: retire (audit-only) ───────────────────────────────────────────

async function healTier3Retire(
  source: { id: string },
  status: { consecutiveFailures: number; lastSuccess: string | null; lastRoutingReason?: string },
  before: HealResult['before'],
  start: number,
  options: HealOptions,
): Promise<HealResult> {
  const reason = `consecutiveFailures=${status.consecutiveFailures},lastSuccess=${status.lastSuccess ?? 'null'}`;
  if (!options.dryRun) {
    appendRetired({
      ts: nowIso(),
      sourceId: source.id,
      reason,
      consecutiveFailures: status.consecutiveFailures,
      lastSuccess: status.lastSuccess,
      movedFrom: 'runtime/sources_status.jsonl',
    });
  }
  return {
    sourceId: source.id,
    tier: 3,
    status: 'retired',
    durationMs: Date.now() - start,
    before,
    after: { events: before.events },
  };
}

export type { RenderResult };
