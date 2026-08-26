#!/usr/bin/env tsx
/**
 * enqueue-review.ts — Convert REVIEW → OPT-RUN job (Phase L-F.1)
 *
 * Per master-prompt §14: läser REVIEW + OPT-förslag, skapar OPT-RUN-jobb
 * i queue.ndjson. Hårt tak: max_concurrent_jobs (default 1).
 *
 * Användning:
 *   npx tsx enqueue-review.ts --review-id REVIEW-...
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readOptimizerState, enqueueJob, listJobs } from "./optimizer-state";
import { verifyCanonicalPath } from "./canonical-path-guard";
import type { OptimizerJob } from "./optimizer-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

function reviewsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimization-reviews");
}

function proposalsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "proposals");
}

interface ReviewMeta {
  review_id: string;
  generated_at: string;
  window_size: number;
  opt_ids: string[];
}

function parseReview(reviewPath: string): ReviewMeta | null {
  if (!fs.existsSync(reviewPath)) return null;
  const content = fs.readFileSync(reviewPath, "utf8");
  const reviewId = path.basename(reviewPath, ".md");
  const generatedAt = content.match(/^- generated_at:\s*(.+)$/m)?.[1]?.trim() ?? new Date().toISOString();
  const windowSizeMatch = content.match(/^- window_size:\s*(\d+)$/m);
  const windowSize = windowSizeMatch ? Number(windowSizeMatch[1]) : 0;
  // OPT-IDs är inte explicit listade i REVIEW-filen; hämta via mönster i proposals-dir
  return { review_id: reviewId, generated_at: generatedAt, window_size: windowSize, opt_ids: [] };
}

function findOptIdsForReview(repoRoot: string, reviewId: string): string[] {
  const dir = proposalsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f))
    .filter((p) => {
      try {
        const content = fs.readFileSync(p, "utf8");
        return content.includes(`review_id: ${reviewId}`);
      } catch {
        return false;
      }
    })
    .map((p) => path.basename(p, ".md"));
}

function nextJobSeq(repoRoot: string, dateStr: string): number {
  const jobs = listJobs(repoRoot);
  return jobs.filter((j) => j.job_id.startsWith(`OPT-RUN-${dateStr}`)).length + 1;
}

function parseArgs(argv: string[]): { reviewId: string | null } {
  let reviewId: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--review-id") reviewId = argv[++i] ?? null;
  }
  return { reviewId };
}

export function enqueueReview(repoRoot: string, reviewId: string): {
  ok: boolean;
  job: OptimizerJob | null;
  reason: string;
} {
  // Verify canonical path before enqueueing (defense)
  const guard = verifyCanonicalPath();
  if (!guard.ok) {
    return { ok: false, job: null, reason: `canonical-path-guard failed: ${guard.errors.join("; ")}` };
  }

  // Don't enqueue if already busy
  const state = readOptimizerState(repoRoot);
  if (state.active_job_id) {
    return { ok: false, job: null, reason: `optimizer busy with active_job_id=${state.active_job_id}` };
  }

  const reviewPath = path.join(reviewsDir(repoRoot), `${reviewId}.md`);
  const meta = parseReview(reviewPath);
  if (!meta) {
    return { ok: false, job: null, reason: `review not found: ${reviewId}` };
  }

  const optIds = findOptIdsForReview(repoRoot, reviewId);
  if (optIds.length === 0) {
    return { ok: false, job: null, reason: `no OPT proposals found for review ${reviewId}` };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const seq = nextJobSeq(repoRoot, dateStr);
  const jobId = `OPT-RUN-${dateStr}-${String(seq).padStart(3, "0")}`;

  const job: OptimizerJob = {
    job_id: jobId,
    review_id: reviewId,
    opt_ids: optIds,
    enqueued_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    status: "queued",
    candidate_iterations: 0,
    cost_usd: null,
    result_md: null,
    worktree_path: null,
    branch_name: null,
    error: null,
    recovery: null,
  };

  enqueueJob(repoRoot, job);
  process.stderr.write(`[enqueue-review] queued job_id=${jobId} review=${reviewId} opts=${optIds.length}\n`);
  return { ok: true, job, reason: "queued" };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  if (!args.reviewId) {
    process.stderr.write("[enqueue-review] usage: --review-id REVIEW-...\n");
    process.exit(1);
  }
  const result = enqueueReview(repoRoot, args.reviewId);
  process.exit(result.ok ? 0 : 1);
}

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
    process.stderr.write(`[enqueue-review] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
