/**
 * activity.ts — append-only structured activity stream.
 *
 * Writes one JSON object per line to runtime/activity.jsonl. The lead agent
 * or wrapper script emits events via this module so the mobile dashboard has
 * a real, durable history of meaningful activity (not a log replay).
 *
 * Why append-only: the stream must survive wrapper restarts, context loss,
 * and process kills. Each line is independently parseable. We never rewrite
 * or delete lines.
 *
 * Event types (matches the spec):
 *   autonomous_run_started | autonomous_run_paused | autonomous_run_resumed
 *   task_selected | task_delegated | task_completed | task_blocked | task_added
 *   agent_started | agent_completed
 *   test_started | test_passed | test_failed
 *   commit_created
 *   vault_reconciled | decision_recorded
 *   recovery_occurred | next_task_selected
 *   user_instruction_received | instruction_queued
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { activityStreamPath } from './state.ts';

export type EventType =
  | 'autonomous_run_started'
  | 'autonomous_run_paused'
  | 'autonomous_run_resumed'
  | 'autonomous_run_stopped'
  // wrapper lifecycle (emitted by scripts/autonomous-loop.sh)
  | 'iteration_started'
  | 'claude_spawned'
  | 'claude_completed'
  | 'iteration_timeout'
  | 'iteration_failed'
  | 'loop_terminated'
  // task lifecycle
  | 'task_selected'
  | 'task_delegated'
  | 'task_completed'
  | 'task_blocked'
  | 'task_added'
  // sub-agent lifecycle (emitted by Claude Code hooks when EP_AUTONOMOUS=1)
  | 'agent_started'
  | 'agent_completed'
  // lead tool activity (aggregated — never per Bash token)
  | 'lead_action'
  // tests + commits + reconciliation
  | 'test_started'
  | 'test_passed'
  | 'test_failed'
  | 'commit_created'
  | 'vault_reconciled'
  // meta
  | 'decision_recorded'
  | 'recovery_occurred'
  | 'next_task_selected'
  | 'user_instruction_received'
  | 'instruction_queued'
  | 'instruction_consumed';

export interface ActivityPayload {
  type: EventType;
  detail: string;
  meta?: Record<string, unknown>;
}

/**
 * Append a single event. Atomic per line (single write call). Best-effort:
 * if the write fails, we log to stderr but don't throw — caller code must
 * never be blocked by activity logging.
 */
export function recordEvent(payload: ActivityPayload): void {
  const path = activityStreamPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // best-effort
    }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    type: payload.type,
    detail: payload.detail,
    meta: payload.meta ?? {},
  });
  try {
    appendFileSync(path, line + '\n');
  } catch (err) {
    process.stderr.write(`[activity] failed to write: ${(err as Error).message}\n`);
  }
}