#!/usr/bin/env node
/**
 * state-machine.ts — Episode state machine (Phase L-B, K3 user feedback)
 *
 * Per master-prompt §K3 (user review 2026-08-26): tydlig state machine för
 * att undvika att finalizer loggar fel slutstatus.
 *
 * States: active → implemented → verified → reconciled → finalized
 *
 * - active: mission skapad (Mission YAML finns)
 * - implemented: kod skrivits / ändringar gjorts (Bash-evidence med implementerande cmd)
 * - verified: verify.passed event finns i ledger
 * - reconciled: brain reconcile har körts (event: reconcile.queued|completed i ledger)
 * - finalized: episode skriven till learning/episodes/
 *
 * Counter räknas ENDAST vid finalized → review_eligible transitions.
 *
 * Public API:
 *   - inferStates(ledgerEntries): EpisodeStateMap
 *   - isReviewEligible(stateMap): boolean
 *   - STATE_TRANSITIONS: ordnad lista av giltiga transitions
 */

import type { EpisodeStateMap } from "./episode-types";

const STATES = ["active", "implemented", "verified", "reconciled", "finalized"] as const;

export const STATE_TRANSITIONS: Array<{ from: string; to: string; matcher: (e: any) => boolean }> = [
  { from: "none", to: "active", matcher: () => true }, // mission created
  {
    from: "active",
    to: "implemented",
    matcher: (e) =>
      e.event === "PostToolUse" &&
      (typeof e.cmd === "string") &&
      /^(npm run (build|test)|git commit|npx vitest|cargo build)/.test(e.cmd),
  },
  {
    from: "implemented",
    to: "verified",
    matcher: (e) => e.event === "verify.passed",
  },
  {
    from: "verified",
    to: "reconciled",
    matcher: (e) => e.event === "reconcile.completed",
  },
  // finalized sätts av finalize-episode.ts EFTER att episoden är skriven
];

export function inferStates(ledgerEntries: any[]): EpisodeStateMap {
  const sorted = [...ledgerEntries].sort((a, b) => {
    const ta = new Date(a.ts ?? 0).getTime();
    const tb = new Date(b.ts ?? 0).getTime();
    return ta - tb;
  });

  let current = "active";
  const result: EpisodeStateMap = {
    active_at: null,
    implemented_at: null,
    verified_at: null,
    reconciled_at: null,
    finalized_at: null,
  };

  for (const entry of sorted) {
    const ts = entry.ts ?? new Date().toISOString();
    // Initial active_at from earliest event
    if (!result.active_at) result.active_at = ts;

    for (const transition of STATE_TRANSITIONS) {
      if (transition.from === current && transition.matcher(entry)) {
        current = transition.to;
        if (current === "implemented") result.implemented_at = ts;
        else if (current === "verified") result.verified_at = ts;
        else if (current === "reconciled") result.reconciled_at = ts;
        break;
      }
    }
  }

  return result;
}

export function isReviewEligible(stateMap: EpisodeStateMap): boolean {
  // Per §K3: finalized krävs. Implementerat är inte nog.
  // För backfill-läge kan vi relaxera till verified.
  return stateMap.verified_at !== null;
}

export function nextState(current: string): string | null {
  const idx = STATES.indexOf(current as any);
  if (idx === -1 || idx === STATES.length - 1) return null;
  return STATES[idx + 1];
}