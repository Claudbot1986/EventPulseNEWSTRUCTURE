#!/usr/bin/env tsx
/**
 * outcome-record.ts — Phase L-A persistens-modul
 *
 * Exporterar `recordOutcome()` som lägger till ett strukturerat
 * verify.passed|verify.failed event i evidence-ledgern.
 *
 * Används av verify-completion.ts pass-path (fas L-A) samt av fas L-B
 * finalizer för att märka review-eligibilitet.
 *
 * Schema (additionalProperties: true):
 *   {
 *     ts: ISO8601,
 *     event: "verify.passed" | "verify.failed",
 *     mission_id: string,
 *     verification_profile: string | null,
 *     gates_passed: string[],
 *     gates_failed: string[],
 *     gates_unknown: string[],
 *     working_tree_fp: string,
 *     at: ISO8601,
 *     reason?: string,            // endast vid verify.failed
 *     reviewer?: "verify-completion-hook" | "manual" | string,
 *   }
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(input: string): string {
  return input.replace(SECRET_RE, (_m, name: string) => `${name}=<REDACTED>`);
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

export interface OutcomeArgs {
  missionId: string;
  verdict: "passed" | "failed";
  verificationProfile?: string | null;
  gatesPassed?: string[];
  gatesFailed?: string[];
  gatesUnknown?: string[];
  workingTreeFp?: string | null;
  reason?: string | null;
  reviewer?: string;
}

export interface OutcomeResult {
  ok: boolean;
  ledgerPath: string;
  error?: string;
}

/**
 * Append one structured outcome event to the evidence ledger.
 * Fail-open: returns `{ ok: false, error }` on I/O failure but never throws.
 */
export function recordOutcome(
  repoRoot: string,
  args: OutcomeArgs,
): OutcomeResult {
  const ledgerPath = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  ensureDir(path.dirname(ledgerPath));
  const ts = new Date().toISOString();

  const entry: Record<string, unknown> = {
    ts,
    event: args.verdict === "passed" ? "verify.passed" : "verify.failed",
    mission_id: args.missionId,
    verification_profile: args.verificationProfile ?? null,
    gates_passed: Array.isArray(args.gatesPassed) ? args.gatesPassed : [],
    gates_failed: Array.isArray(args.gatesFailed) ? args.gatesFailed : [],
    gates_unknown: Array.isArray(args.gatesUnknown) ? args.gatesUnknown : [],
    working_tree_fp: args.workingTreeFp ?? null,
    reviewer: args.reviewer ?? "verify-completion-hook",
    at: ts,
  };
  if (args.reason) {
    entry.reason = redactSecrets(String(args.reason));
  }

  try {
    fs.appendFileSync(ledgerPath, JSON.stringify(entry) + "\n", "utf8");
    return { ok: true, ledgerPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, ledgerPath, error: msg };
  }
}

export const SECRET_REGEX = SECRET_RE;