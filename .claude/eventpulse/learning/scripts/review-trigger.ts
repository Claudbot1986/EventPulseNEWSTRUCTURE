#!/usr/bin/env tsx
/**
 * review-trigger.ts — 20-episode review trigger (Phase L-C)
 *
 * Per master-prompt §7: när since_last_review >= 20, kör analyze → REVIEW → OPT.
 *
 * Användning:
 *   npx tsx review-trigger.ts [--dry-run]
 *
 * Beteende:
 *   - Läser counter.json (låst read-only)
 *   - Om since_last_review >= review_every → kör analyze → OPT → nollställ räknare
 *   - Vid fel: counter kvar på samma värde (ingen reset)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readCounter, updateCounter } from "./counter";
import { analyzeWindow } from "./analyze-last-window";
import { generateProposalsForReview } from "./optimization-proposal";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

function reviewsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimization-reviews");
}

function proposalsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "proposals");
}

function appendReviewEvent(repoRoot: string, event: Record<string, unknown>): void {
  const ledgerPath = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify({ ...event, ts: new Date().toISOString() }) + "\n", "utf8");
}

export interface TriggerResult {
  triggered: boolean;
  reason: string;
  review_id: string | null;
  opt_ids: string[];
  review_path: string | null;
}

export async function maybeTriggerReview(repoRoot: string, dryRun = false): Promise<TriggerResult> {
  const counter = readCounter(repoRoot);
  if (counter.since_last_review < counter.review_every) {
    return {
      triggered: false,
      reason: `since_last_review=${counter.since_last_review} < review_every=${counter.review_every}`,
      review_id: null,
      opt_ids: [],
      review_path: null,
    };
  }
  if (counter.review_eligible_episodes === 0) {
    return {
      triggered: false,
      reason: "no review-eligible episodes in counter",
      review_id: null,
      opt_ids: [],
      review_path: null,
    };
  }
  // Run analyze
  let reviewId: string;
  let reviewPath: string;
  try {
    const result = analyzeWindow(repoRoot, counter.review_every);
    reviewId = result.review_id;
    reviewPath = result.review_path;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendReviewEvent(repoRoot, { event: "optimization_review_failed", error: msg });
    return {
      triggered: false,
      reason: `analyze-window failed: ${msg}`,
      review_id: null,
      opt_ids: [],
      review_path: null,
    };
  }

  // Generate proposals
  let proposals: Array<{ opt_id: string }>;
  try {
    proposals = generateProposalsForReview(repoRoot, reviewId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendReviewEvent(repoRoot, { event: "optimization_proposal_failed", review_id: reviewId, error: msg });
    // Don't reset counter — per §K3: failed review leaves counter at 20 for retry
    return {
      triggered: false,
      reason: `optimization-proposal failed: ${msg}`,
      review_id: reviewId,
      opt_ids: [],
      review_path: reviewPath,
    };
  }

  if (dryRun) {
    return {
      triggered: true,
      reason: "dry-run — counter not reset",
      review_id: reviewId,
      opt_ids: proposals.map((p) => p.opt_id),
      review_path: reviewPath,
    };
  }

  // Update last-review state + reset counter
  const lastReviewPath = path.join(repoRoot, ".claude", "eventpulse", "learning", "state", "last-review.json");
  fs.mkdirSync(path.dirname(lastReviewPath), { recursive: true });
  const lastReview = {
    reviewed_at: new Date().toISOString(),
    episodes_in_window: counter.since_last_review,
    last_episode_id: null,
    proposal_ids: proposals.map((p) => p.opt_id),
  };
  fs.writeFileSync(lastReviewPath, JSON.stringify(lastReview, null, 2), "utf8");

  await updateCounter(repoRoot, (current) => ({
    ...current,
    since_last_review: 0,
  }));

  appendReviewEvent(repoRoot, {
    event: "review.triggered",
    window_size: counter.since_last_review,
    review_id: reviewId,
    opt_ids: proposals.map((p) => p.opt_id),
  });

  return {
    triggered: true,
    reason: "triggered — review+OPT written, counter reset",
    review_id: reviewId,
    opt_ids: proposals.map((p) => p.opt_id),
    review_path: reviewPath,
  };
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  const result = await maybeTriggerReview(repoRoot, args.dryRun);
  process.stderr.write(
    `[review-trigger] triggered=${result.triggered} reason=${result.reason} review=${result.review_id ?? "none"} opts=${result.opt_ids.length}\n`,
  );
  process.exit(0);
}

// Only invoke main() when run directly (not when imported as a module).
import { fileURLToPath } from "node:url";
const isMain = (() => {
  try {
    if (typeof import.meta.url !== "string" || typeof process.argv[1] !== "string") return false;
    const scriptPath = fileURLToPath(import.meta.url);
    const argvPath = process.argv[1];
    const argvReal = fs.existsSync(argvPath) ? fs.realpathSync(argvPath) : argvPath;
    const scriptReal = fs.existsSync(scriptPath) ? fs.realpathSync(scriptPath) : scriptPath;
    return argvReal === scriptReal;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[review-trigger] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}