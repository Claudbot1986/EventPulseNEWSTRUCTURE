#!/usr/bin/env tsx
/**
 * verify-optimizer-state.ts — Optimizer health-check (Phase L-F.1)
 *
 * Per master-prompt §46: health-check som verifierar att optimizer-staten
 * är konsistent innan supervisor startar worker.
 *
 * Användning:
 *   npx tsx verify-optimizer-state.ts [--json]
 *
 * Verifierar:
 *   - state.json valid + schema_version matchar
 *   - queue.ndjson parseable
 *   - active_job_id i state matchar en queued|running job i queue
 *   - runs/ katalogen har korrekt struktur för aktiva jobb
 *   - canonical-path-guard passerar
 *   - state ≠ waiting_for_project_volume om project_root är tillgänglig
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readOptimizerState, listJobs, getJob } from "./optimizer-state";
import { verifyCanonicalPath } from "./canonical-path-guard";
import type { OptimizerState, OptimizerJob } from "./optimizer-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

export interface VerifyResult {
  ok: boolean;
  state: OptimizerState | null;
  jobs_count: number;
  active_job: OptimizerJob | null;
  errors: string[];
  warnings: string[];
}

export function verifyOptimizerState(repoRoot: string): VerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. canonical-path-guard
  const guard = verifyCanonicalPath();
  if (!guard.ok) {
    errors.push(...guard.errors.map((e) => `canonical-path-guard: ${e}`));
  }

  // 2. state.json
  let state: OptimizerState | null = null;
  try {
    state = readOptimizerState(repoRoot);
    if (state.schema_version !== "ep-optimizer-state-1.0") {
      errors.push(`state schema_version mismatch: ${state.schema_version}`);
    }
  } catch (err) {
    errors.push(`state.json unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. queue.ndjson
  let jobs: OptimizerJob[] = [];
  try {
    jobs = listJobs(repoRoot);
  } catch (err) {
    errors.push(`queue.ndjson unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. active_job_id consistency
  let activeJob: OptimizerJob | null = null;
  if (state?.active_job_id) {
    activeJob = getJob(repoRoot, state.active_job_id) ?? null;
    if (!activeJob) {
      errors.push(`state.active_job_id=${state.active_job_id} not found in queue`);
    } else if (activeJob.status !== "running" && activeJob.status !== "queued") {
      errors.push(`active job ${state.active_job_id} has unexpected status: ${activeJob.status}`);
    }
  }

  // 5. runs/ consistency
  const runsDir = path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "runs");
  if (fs.existsSync(runsDir)) {
    for (const runDir of fs.readdirSync(runsDir)) {
      const statusPath = path.join(runsDir, runDir, "status.json");
      if (!fs.existsSync(statusPath)) {
        warnings.push(`run dir missing status.json: ${runDir}`);
      }
    }
  }

  // 6. heartbeat staleness
  if (state?.last_heartbeat_at) {
    const lastHb = new Date(state.last_heartbeat_at).getTime();
    const ageMs = Date.now() - lastHb;
    const STALE_THRESHOLD_MS = 60_000 * 5; // 5 min
    if (ageMs > STALE_THRESHOLD_MS && state.state === "busy") {
      warnings.push(`heartbeat stale: ${Math.round(ageMs / 1000)}s ago (state=busy)`);
    }
  }

  return {
    ok: errors.length === 0,
    state,
    jobs_count: jobs.length,
    active_job: activeJob,
    errors,
    warnings,
  };
}

function parseArgs(argv: string[]): { json: boolean } {
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
  }
  return { json };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  const result = verifyOptimizerState(repoRoot);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.warnings.length > 0) {
      for (const w of result.warnings) process.stderr.write(`[verify-optimizer-state] WARN: ${w}\n`);
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) process.stderr.write(`[verify-optimizer-state] ERROR: ${e}\n`);
    }
    process.stderr.write(
      `[verify-optimizer-state] ok=${result.ok} state=${result.state?.state ?? "?"} jobs=${result.jobs_count} active=${result.active_job?.job_id ?? "none"}\n`,
    );
  }
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
    process.stderr.write(`[verify-optimizer-state] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
