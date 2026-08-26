#!/usr/bin/env tsx
/**
 * recover-optimizer.ts — State classifier (Phase L-F.1)
 *
 * Per master-prompt §48: classify state into
 *   - resume_safe      → safe to resume current iteration
 *   - retry_safe       → safe to restart from beginning
 *   - needs_cleanup    → partial artifacts must be removed first
 *   - requires_human   → halt and notify user
 *
 * Användning:
 *   npx tsx recover-optimizer.ts [--apply] [--json]
 *
 * Read-only by default; --apply performs the recommended action
 * (resume, retry, cleanup, or no-op for requires_human).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readOptimizerState, getJob, listJobs } from "./optimizer-state";
import { verifyCanonicalPath } from "./canonical-path-guard";
import type { OptimizerJob, OptimizerRecoveryState, OptimizerState } from "./optimizer-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

const STALE_HEARTBEAT_MS = 60_000 * 5; // 5 min
const ORPHAN_RUN_DIR_MS = 60_000 * 60; // 1h

export interface RecoveryDecision {
  state: OptimizerRecoveryState;
  reason: string;
  recommended_action: string;
  active_job_id: string | null;
}

function runsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "runs");
}

function runDirAgeMs(runDir: string): number {
  const stat = fs.statSync(runDir);
  return Date.now() - stat.mtime.getTime();
}

function hasIncompleteArtifacts(runDir: string): boolean {
  const statusPath = path.join(runDir, "status.json");
  if (!fs.existsSync(statusPath)) return true;
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8")) as { terminal?: boolean };
    return status.terminal !== true;
  } catch {
    return true;
  }
}

export function classifyRecovery(repoRoot: string): RecoveryDecision {
  // 1. canonical-path-guard first — never recover if pointing at wrong recovery-mapp
  const guard = verifyCanonicalPath();
  if (!guard.ok) {
    return {
      state: "requires_human",
      reason: `canonical-path-guard failed: ${guard.errors.join("; ")}`,
      recommended_action: "halt — runtime-config.json points at invalid project_root",
      active_job_id: null,
    };
  }

  // 2. Project volume availability
  if (!fs.existsSync(repoRoot)) {
    return {
      state: "requires_human",
      reason: `project_root missing: ${repoRoot}`,
      recommended_action: "halt — mount project volume before resuming",
      active_job_id: null,
    };
  }

  let state: OptimizerState;
  try {
    state = readOptimizerState(repoRoot);
  } catch (err) {
    return {
      state: "requires_human",
      reason: `state.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      recommended_action: "halt — state corruption, manual inspection required",
      active_job_id: null,
    };
  }

  // 3. Idle — nothing to recover
  if (!state.active_job_id) {
    return {
      state: "resume_safe",
      reason: "no active job — supervisor may pick up next queued job",
      recommended_action: "continue — dequeue next job if present",
      active_job_id: null,
    };
  }

  // 4. Active job in state but not in queue → dangling reference
  const activeJob: OptimizerJob | null = getJob(repoRoot, state.active_job_id);
  if (!activeJob) {
    return {
      state: "needs_cleanup",
      reason: `state.active_job_id=${state.active_job_id} not found in queue (dangling)`,
      recommended_action: "clear state.active_job_id and re-verify",
      active_job_id: state.active_job_id,
    };
  }

  // 5. Stale heartbeat — supervisor died
  if (state.last_heartbeat_at) {
    const lastHb = new Date(state.last_heartbeat_at).getTime();
    const ageMs = Date.now() - lastHb;
    if (ageMs > STALE_HEARTBEAT_MS) {
      // Check candidate_iterations — if 0, safe to retry; if > 0, needs cleanup
      if (activeJob.candidate_iterations === 0) {
        return {
          state: "retry_safe",
          reason: `heartbeat stale (${Math.round(ageMs / 1000)}s) but no candidate iterations performed`,
          recommended_action: "mark job retry_safe and re-dequeue",
          active_job_id: state.active_job_id,
        };
      }
      return {
        state: "needs_cleanup",
        reason: `heartbeat stale (${Math.round(ageMs / 1000)}s) with ${activeJob.candidate_iterations} candidate iterations — partial state`,
        recommended_action: "remove partial run artifacts before retry",
        active_job_id: state.active_job_id,
      };
    }
  }

  // 6. Check orphan run directory
  const jobRunDir = path.join(runsDir(repoRoot), state.active_job_id);
  if (fs.existsSync(jobRunDir)) {
    const ageMs = runDirAgeMs(jobRunDir);
    if (ageMs > ORPHAN_RUN_DIR_MS && hasIncompleteArtifacts(jobRunDir)) {
      return {
        state: "needs_cleanup",
        reason: `run dir ${state.active_job_id} age ${Math.round(ageMs / 1000)}s with incomplete artifacts`,
        recommended_action: "remove run dir, then mark job retry_safe",
        active_job_id: state.active_job_id,
      };
    }
  }

  // 7. Default — supervisor alive and active; resume is safe
  return {
    state: "resume_safe",
    reason: "active job with fresh heartbeat",
    recommended_action: "continue — supervisor is healthy",
    active_job_id: state.active_job_id,
  };
}

function applyRecovery(repoRoot: string, decision: RecoveryDecision): void {
  // requires_human → no-op, leave state for human inspection
  if (decision.state === "requires_human") {
    process.stderr.write(`[recover-optimizer] requires_human: ${decision.reason} — no auto-action\n`);
    return;
  }

  const state = readOptimizerState(repoRoot);

  if (decision.state === "needs_cleanup") {
    // Clear active_job_id; cleanup of run dir is supervisor's responsibility
    const next: OptimizerState = {
      ...state,
      active_job_id: null,
      active_started_at: null,
      state: "idle",
      last_heartbeat_at: null,
      last_updated: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "state.json"),
      JSON.stringify(next, null, 2),
      "utf8",
    );
    process.stderr.write(`[recover-optimizer] needs_cleanup applied: cleared active_job_id\n`);
    return;
  }

  if (decision.state === "retry_safe" && decision.active_job_id) {
    // Reset job to queued; state stays idle so supervisor can dequeue
    const jobs = listJobs(repoRoot);
    const target = jobs.find((j) => j.job_id === decision.active_job_id);
    if (target) {
      target.status = "queued";
      target.started_at = null;
      target.recovery = "retry_safe";
      // Persist by rewriting queue
      const queuePath = path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "queue.ndjson");
      const tmp = `${queuePath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n", "utf8");
      fs.renameSync(tmp, queuePath);
    }
    const next: OptimizerState = {
      ...state,
      active_job_id: null,
      active_started_at: null,
      state: "idle",
      last_heartbeat_at: null,
      last_updated: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "state.json"),
      JSON.stringify(next, null, 2),
      "utf8",
    );
    process.stderr.write(`[recover-optimizer] retry_safe applied: job ${decision.active_job_id} reset to queued\n`);
    return;
  }

  // resume_safe → leave alone, supervisor is healthy
  process.stderr.write(`[recover-optimizer] resume_safe: no action needed\n`);
}

function parseArgs(argv: string[]): { apply: boolean; json: boolean } {
  let apply = false;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--json") json = true;
  }
  return { apply, json };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  const decision = classifyRecovery(repoRoot);
  if (args.apply) applyRecovery(repoRoot, decision);
  if (args.json) {
    process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
  } else {
    process.stderr.write(
      `[recover-optimizer] state=${decision.state} reason="${decision.reason}" action="${decision.recommended_action}" active=${decision.active_job_id ?? "none"}\n`,
    );
  }
  // Exit 0 only for resume_safe/retry_safe/needs_cleanup; non-zero for requires_human
  process.exit(decision.state === "requires_human" ? 1 : 0);
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
    process.stderr.write(`[recover-optimizer] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
