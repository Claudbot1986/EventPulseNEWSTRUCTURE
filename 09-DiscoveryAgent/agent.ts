#!/usr/bin/env node
/**
 * 09-DiscoveryAgent/agent.ts — Autonomous discovery agent orchestrator.
 *
 * Daily cron entrypoint. Three phases:
 *   A. HEAL  — heal failing sources via 3-tier pipeline (transport / no-jsonld / retire)
 *   B. PROMOTE — test unexplored discovery-candidates, promote ≥10-event sources
 *   C. EXPAND — weekly (Mondays) seed expansion via Exa search
 *
 * Caps (enforced):
 *   - Max 5 sources touched per phase, per day (configurable via MAX env or --cap)
 *   - 60s timeout per source
 *   - No LLM decisions outside constrainedAgent.runPipeline (already deployed)
 *   - All writes audited in runtime/discovery-agent/{runs,promoted,retired}.jsonl
 *
 * CLI:
 *   --dry                Dry-run: no side-effects, no logs written
 *   --cap=N              Override default cap (default 5, env MAX also honored)
 *   --force-expand       Skip Monday gate for seed expansion
 *
 * Exit code: always 0. Errors are logged to runs.jsonl but never propagate —
 * cron jobs must not flap.
 */

import {
  readFailingSources,
  readUnexploredCandidates,
  nowIso,
} from './eval.js';
import { healOne, type HealResult } from './heal.js';
import { promoteOne, type PromoteResult } from './promote.js';
import { expandSeeds, type ExpandResult } from './expand.js';

// ─── CLI parsing ───────────────────────────────────────────────────────────

interface ParsedArgs {
  dryRun: boolean;
  cap: number;
  forceExpand: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  let cap = Number.parseInt(process.env.MAX ?? '5', 10);
  let forceExpand = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--dry') {
      dryRun = true;
    } else if (arg.startsWith('--cap=')) {
      cap = Number.parseInt(arg.slice('--cap='.length), 10);
    } else if (arg === '--force-expand') {
      forceExpand = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`[discovery-agent] unknown arg: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (Number.isNaN(cap) || cap < 1) cap = 5;
  return { dryRun, cap, forceExpand };
}

function printUsage(): void {
  console.log(`Usage: tsx 09-DiscoveryAgent/agent.ts [--dry] [--cap=N] [--force-expand]

Env:
  MAX=N       Max sources touched per phase (default 5)
  DRY_RUN=1   Same as --dry
`);
}

// ─── Orchestration ─────────────────────────────────────────────────────────

export interface AgentSummary {
  healed: HealResult[];
  promoted: PromoteResult[];
  expanded: ExpandResult | null;
  durationMs: number;
  cap: number;
  dryRun: boolean;
  startedAt: string;
}

/**
 * Run all three phases. Returns a structured summary; safe to call from tests
 * (passing dryRun=true leaves no FS side-effects).
 */
export async function runAgent(options: { cap?: number; dryRun?: boolean; forceExpand?: boolean } = {}): Promise<AgentSummary> {
  const cap = options.cap ?? 5;
  const dryRun = options.dryRun ?? false;
  const forceExpand = options.forceExpand ?? false;
  const start = Date.now();
  const startedAt = nowIso();

  const healed: HealResult[] = [];
  const promoted: PromoteResult[] = [];
  let expanded: ExpandResult | null = null;

  // ── Phase A: HEAL ────────────────────────────────────────────────────
  const failing = readFailingSources({ minConsecutiveFailures: 2 });
  for (const src of failing.slice(0, cap)) {
    try {
      const result = await healOne(src, { dryRun, timeoutMs: 60_000 });
      healed.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      healed.push({
        sourceId: src.source.id,
        tier: 3,
        status: 'error',
        durationMs: 0,
        before: {
          events: src.status.lastEventsFound,
          consecutiveFailures: src.status.consecutiveFailures,
          lastRoutingReason: src.status.lastRoutingReason ?? '',
        },
        after: { events: src.status.lastEventsFound },
        error: message,
      });
    }
  }

  // ── Phase B: PROMOTE ─────────────────────────────────────────────────
  const remaining = Math.max(0, cap - healed.length);
  const candidates = readUnexploredCandidates();
  for (const cand of candidates.slice(0, remaining)) {
    try {
      const result = await promoteOne(cand, { dryRun });
      promoted.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      promoted.push({
        candidateUrl: cand.candidateUrl,
        status: 'error',
        eventsFound: 0,
        durationMs: 0,
        error: message,
      });
    }
  }

  // ── Phase C: EXPAND (weekly) ─────────────────────────────────────────
  if (forceExpand || isMonday(new Date())) {
    try {
      expanded = await expandSeeds({ force: forceExpand, dryRun });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expanded = {
        seedsFound: 0,
        newCandidates: [],
        alreadyKnown: 0,
        durationMs: 0,
        exaAvailable: false,
        error: message,
      };
    }
  }

  const summary: AgentSummary = {
    healed,
    promoted,
    expanded,
    durationMs: Date.now() - start,
    cap,
    dryRun,
    startedAt,
  };
  printSummary(summary);
  return summary;
}

function printSummary(s: AgentSummary): void {
  const counts = {
    recovered: s.healed.filter((h) => h.status === 'recovered').length,
    adapter_saved: s.healed.filter((h) => h.status === 'adapter_saved').length,
    retired: s.healed.filter((h) => h.status === 'retired').length,
    promoted: s.promoted.filter((p) => p.status === 'promoted').length,
    below_threshold: s.promoted.filter((p) => p.status === 'below_threshold').length,
    new_seeds: s.expanded?.newCandidates.length ?? 0,
  };
  const tag = s.dryRun ? '[discovery-agent:dry]' : '[discovery-agent]';
  console.log(
    `${tag} started=${s.startedAt} cap=${s.cap} ` +
    `recovered=${counts.recovered} adapter_saved=${counts.adapter_saved} ` +
    `retired=${counts.retired} promoted=${counts.promoted} ` +
    `below_threshold=${counts.below_threshold} new_seeds=${counts.new_seeds} ` +
    `durationMs=${s.durationMs}`,
  );
  for (const h of s.healed) {
    console.log(`  heal ${h.sourceId} tier=${h.tier} status=${h.status}${h.error ? ' error=' + h.error : ''}`);
  }
  for (const p of s.promoted) {
    console.log(`  promote ${p.candidateUrl} status=${p.status} events=${p.eventsFound}${p.sourceId ? ' sourceId=' + p.sourceId : ''}${p.error ? ' error=' + p.error : ''}`);
  }
  if (s.expanded) {
    console.log(`  expand seeds=${s.expanded.seedsFound} new=${s.expanded.newCandidates.length} known=${s.expanded.alreadyKnown} exa=${s.expanded.exaAvailable}${s.expanded.error ? ' error=' + s.expanded.error : ''}`);
  }
}

function isMonday(d: Date): boolean {
  return d.getUTCDay() === 1;
}

// ─── CLI entry ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  try {
    await runAgent({
      cap: args.cap,
      dryRun: args.dryRun,
      forceExpand: args.forceExpand,
    });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[discovery-agent] fatal: ${message}`);
    process.exit(0); // never flap cron
  }
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main();
}
