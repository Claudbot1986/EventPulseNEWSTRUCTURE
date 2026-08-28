#!/usr/bin/env node
/**
 * outcome-labels.ts — Outcome label derivation (Phase L-B)
 *
 * Per master-prompt §13: episodes har labels med provenance:
 *   - observed: direkt från ledger/handoff
 *   - derived: beräknad från andra fält
 *   - human_labeled: manuellt satt via corrections
 *   - unknown: kan ej bestämmas
 *
 * Public API:
 *   - deriveOutcomeLabels(episode, ledgerEntries): OutcomeLabel
 */

import type { Episode } from "./episode-types";

export interface OutcomeLabel {
  task_success: { value: boolean | null; source: "observed" | "derived" | "human_labeled" | "unknown" };
  first_attempt_passed: { value: boolean | null; source: "observed" | "derived" | "human_labeled" | "unknown" };
  task_success_source_detail: string;
}

export function deriveOutcomeLabels(episode: Episode, ledgerEntries: any[]): OutcomeLabel {
  // task_success: derived from terminal_state (observed) + verify.passed (observed)
  const terminal = episode.terminal_state;
  const verifyPassed = ledgerEntries.some((e) => e.event === "verify.passed" && e.mission_id === episode.mission_id);
  const verifyFailed = ledgerEntries.some((e) => e.event === "verify.failed" && e.mission_id === episode.mission_id);

  let taskSuccessValue: boolean | null;
  let taskSuccessSource: OutcomeLabel["task_success"]["source"];
  let taskSuccessDetail: string;

  if (terminal === "completed" && verifyPassed) {
    taskSuccessValue = true;
    taskSuccessSource = "observed";
    taskSuccessDetail = `terminal=completed + verify.passed observed`;
  } else if (terminal === "failed" || terminal === "blocked" || verifyFailed) {
    taskSuccessValue = false;
    taskSuccessSource = "observed";
    taskSuccessDetail = `terminal=${terminal} (or verify.failed observed)`;
  } else if (terminal === "completed" && !verifyPassed) {
    taskSuccessValue = null;
    taskSuccessSource = "unknown";
    taskSuccessDetail = "terminal=completed but no verify.passed observed (likely trivial profile)";
  } else {
    taskSuccessValue = null;
    taskSuccessSource = "unknown";
    taskSuccessDetail = `terminal=${terminal} indeterminate`;
  }

  // first_attempt_passed: derived — true if no corrections recorded
  const corrections = episode.corrections ?? [];
  const firstAttemptValue = corrections.length === 0 ? true : corrections.length > 0 ? false : null;
  const firstAttemptSource: OutcomeLabel["first_attempt_passed"]["source"] =
    corrections.length === 0 ? "derived" : "observed";

  return {
    task_success: { value: taskSuccessValue, source: taskSuccessSource },
    first_attempt_passed: { value: firstAttemptValue, source: firstAttemptSource },
    task_success_source_detail: taskSuccessDetail,
  };
}