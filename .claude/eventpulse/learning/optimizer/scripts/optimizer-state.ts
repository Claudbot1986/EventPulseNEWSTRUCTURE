#!/usr/bin/env node
/**
 * optimizer-state.ts — Optimizer state management (Phase L-F.1)
 *
 * Per master-prompt §42 + K3: durable state för autonomous optimizer
 * worker. Atomic read/write med POSIX-rename.
 *
 * Public API:
 *   - readOptimizerState(repoRoot): OptimizerState
 *   - writeOptimizerState(repoRoot, state): void
 *   - enqueueJob(repoRoot, job): void
 *   - dequeueJob(repoRoot): OptimizerJob | null
 *   - updateJob(repoRoot, jobId, mutator): OptimizerJob | null
 *   - listJobs(repoRoot): OptimizerJob[]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { OptimizerJob, OptimizerState } from "./optimizer-types";

const STATE_SCHEMA_VERSION = "ep-optimizer-state-1.0";

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function statePath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "state.json");
}

function queuePath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimizer", "queue.ndjson");
}

function initialState(): OptimizerState {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    active_job_id: null,
    active_started_at: null,
    total_jobs_processed: 0,
    total_jobs_succeeded: 0,
    total_jobs_failed: 0,
    total_cost_usd: 0,
    last_heartbeat_at: null,
    state: "idle",
    supervisor_pid: null,
    last_updated: new Date().toISOString(),
  };
}

export function readOptimizerState(repoRoot: string): OptimizerState {
  const p = statePath(repoRoot);
  if (!fs.existsSync(p)) {
    writeOptimizerState(repoRoot, initialState());
    return initialState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as OptimizerState;
    return parsed;
  } catch {
    const init = initialState();
    writeOptimizerState(repoRoot, init);
    return init;
  }
}

export function writeOptimizerState(repoRoot: string, state: OptimizerState): void {
  const p = statePath(repoRoot);
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function enqueueJob(repoRoot: string, job: OptimizerJob): void {
  const p = queuePath(repoRoot);
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, JSON.stringify(job) + "\n", "utf8");
}

export function readQueue(repoRoot: string): OptimizerJob[] {
  const p = queuePath(repoRoot);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line) as OptimizerJob;
    } catch {
      return null;
    }
  }).filter((j): j is OptimizerJob => j !== null);
}

export function rewriteQueue(repoRoot: string, jobs: OptimizerJob[]): void {
  const p = queuePath(repoRoot);
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, jobs.map((j) => JSON.stringify(j)).join("\n") + (jobs.length > 0 ? "\n" : ""), "utf8");
  fs.renameSync(tmp, p);
}

export function dequeueJob(repoRoot: string): OptimizerJob | null {
  const jobs = readQueue(repoRoot);
  if (jobs.length === 0) return null;
  const [first, ...rest] = jobs;
  rewriteQueue(repoRoot, rest);
  return first;
}

export function updateJob(repoRoot: string, jobId: string, mutator: (job: OptimizerJob) => OptimizerJob): OptimizerJob | null {
  const jobs = readQueue(repoRoot);
  let updated: OptimizerJob | null = null;
  const newJobs = jobs.map((j) => {
    if (j.job_id === jobId) {
      const next = mutator(j);
      updated = next;
      return next;
    }
    return j;
  });
  rewriteQueue(repoRoot, newJobs);
  return updated;
}

export function listJobs(repoRoot: string): OptimizerJob[] {
  return readQueue(repoRoot);
}

export function getJob(repoRoot: string, jobId: string): OptimizerJob | null {
  const jobs = readQueue(repoRoot);
  return jobs.find((j) => j.job_id === jobId) ?? null;
}
