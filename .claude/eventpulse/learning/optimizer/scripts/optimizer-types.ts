#!/usr/bin/env node
/**
 * optimizer-types.ts — Delade typer för L-F (Phase L-F.1)
 */

export type OptimizerJobStatus =
  | "queued"
  | "running"
  | "interrupted"
  | "completed"
  | "failed"
  | "rejected_by_human"
  | "expired";

export type OptimizerRecoveryState =
  | "resume_safe"
  | "retry_safe"
  | "needs_cleanup"
  | "requires_human";

export interface OptimizerJob {
  job_id: string;
  review_id: string;
  opt_ids: string[];
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: OptimizerJobStatus;
  candidate_iterations: number;
  cost_usd: number | null;
  result_md: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  error: string | null;
  recovery: OptimizerRecoveryState | null;
}

export interface OptimizerState {
  schema_version: string;
  active_job_id: string | null;
  active_started_at: string | null;
  total_jobs_processed: number;
  total_jobs_succeeded: number;
  total_jobs_failed: number;
  total_cost_usd: number;
  last_heartbeat_at: string | null;
  state: "idle" | "busy" | "waiting_for_project_volume" | "paused";
  supervisor_pid: number | null;
  last_updated: string;
}

export interface OptimizerConfig {
  max_concurrent_jobs: number;
  max_candidate_iterations_per_job: number;
  max_wall_clock_seconds_per_job: number;
  max_cost_usd_per_job: number;
  keep_artifacts_on_completion: boolean;
  auto_promote_enabled: boolean;
  tmux_session_name: string;
  worktree_dir: string;
}
