#!/usr/bin/env node
/**
 * episode-types.ts — Delade TypeScript-typer för L-B/L-C/L-D/L-E/L-F
 */

export type EpisodeTerminalState = "completed" | "failed" | "blocked" | "aborted" | "skipped";

export type EpisodeCohort = "live_instrumented" | "historical_backfill";

export interface EpisodeStateMap {
  active_at: string | null;
  implemented_at: string | null;
  verified_at: string | null;
  reconciled_at: string | null;
  finalized_at: string | null;
}

export interface EpisodeMetadata {
  agent: string | null;
  verification_profile: string | null;
  working_tree_fp: string | null;
  head_sha: string | null;
}

export interface EpisodeOutcome {
  task_success: boolean | null;
  first_attempt_passed: boolean | null;
  duration_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  gates_passed: string[];
  gates_failed: string[];
  gates_unknown: string[];
}

export interface EpisodeCorrection {
  correction_id: string;
  type: "edit" | "rollback" | "redo" | "human_override" | "agent_overrule";
  before_ref: string;
  after_ref: string;
  reason?: string;
  at: string;
}

export interface Episode {
  episode_id: string;
  schema_version: string;
  created_at: string;
  mission_id: string;
  session_id: string;
  terminal_state: EpisodeTerminalState;
  state_machine: EpisodeStateMap;
  cohort: EpisodeCohort;
  review_eligible: boolean;
  learning_quality_score: number;
  metadata: EpisodeMetadata;
  outcome: EpisodeOutcome;
  corrections: EpisodeCorrection[];
  evidence_refs: string[];
  redaction_policy: "applied" | "skipped" | "not_applicable";
  historical_backfill: boolean;
  optimizer_eligibility: "none" | "replay_only" | "ab_test_candidate" | "auto_promote_eligible";
}

export interface CounterState {
  all_terminal_episodes: number;
  review_eligible_episodes: number;
  since_last_review: number;
  review_every: number;
  last_updated: string;
}

export interface LastReviewState {
  reviewed_at: string | null;
  episodes_in_window: number;
  last_episode_id: string | null;
  proposal_ids: string[];
}