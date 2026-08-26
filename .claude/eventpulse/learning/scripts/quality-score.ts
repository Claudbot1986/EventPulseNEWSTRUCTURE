#!/usr/bin/env node
/**
 * quality-score.ts — Episode quality scoring (Phase L-D)
 *
 * Per master-prompt §10: telemetry completeness score (0..1) baserat på
 * vilka fält som kunde fyllas i. Viktar provenance > outcome > tokens/cost
 * > context.
 *
 * Public API:
 *   - computeQualityScore(episode): number  (0..1)
 *   - QUALITY_FIELD_WEIGHTS: ordnad viktning per fält (samma som finalize-episode)
 *   - isExcluded(score, threshold): markerar episoder under threshold som
 *     exkluderade från review-window.
 */

import type { Episode } from "./episode-types";

export const QUALITY_FIELD_WEIGHTS: Record<string, number> = {
  "metadata.working_tree_fp": 0.10,
  "metadata.verification_profile": 0.10,
  "outcome.task_success": 0.15,
  "outcome.first_attempt_passed": 0.10,
  "outcome.gates_passed": 0.10,
  "outcome.duration_ms": 0.05,
  "state_machine.implemented_at": 0.10,
  "state_machine.verified_at": 0.15,
  "state_machine.reconciled_at": 0.10,
  "evidence_refs": 0.05,
};

export function computeQualityScore(episode: Partial<Episode>): number {
  let total = 0;
  let available = 0;
  for (const [path, weight] of Object.entries(QUALITY_FIELD_WEIGHTS)) {
    total += weight;
    const value = path.split(".").reduce((acc: any, k) => acc?.[k], episode);
    if (
      value !== null &&
      value !== undefined &&
      !(Array.isArray(value) && value.length === 0) &&
      !(typeof value === "string" && value.length === 0)
    ) {
      available += weight;
    }
  }
  return total === 0 ? 0 : available / total;
}

export function isExcluded(score: number, threshold = 0.40): boolean {
  return score < threshold;
}
