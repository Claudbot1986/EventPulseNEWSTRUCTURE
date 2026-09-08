#!/usr/bin/env node
/**
 * verify-completion.ts — TaskCompleted hook — plan §12, §14
 *
 * Reads JSON on stdin: { tool_name, tool_input, session_id, cwd, agent_name? }
 * Verifies that the active mission's `required_gates` are backed by fresh evidence
 * ledger entries and a consistent working-tree fingerprint.
 *
 * Behavior:
 *   - Trivial profile → always allow (single-gate typecheck only).
 *   - Non-trivial: for each gate in required_gates[], find the most recent
 *     evidence-ledger entry whose cmd matches a known gate fingerprint and
 *     whose age ≤ gate.max_age_seconds. Reject (exit 2) if any gate missing
 *     or stale, or if the working-tree fingerprint changed since the last
 *     matching evidence entry.
 *   - Unknown gates (e.g. grounding_eval, no_fabricated_events) → warning +
 *     skip (do not hard-fail; manual review surface).
 *   - Always logs to stderr; writes decision JSON to stdout when blocking.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { recordOutcome } from "./learning/scripts/outcome-record";
import { findMissionBySession, parseMissionSessionId, type MissionRef } from "./mission-resolver";

// ---- Gate → cmd-substring fingerprints + max age (seconds) ----------------

interface GateSpec {
  cmdContains: string[];
  maxAgeSeconds: number;
}

const GATE_SPECS: Record<string, GateSpec> = {
  typecheck: { cmdContains: ["tsc --noEmit", "type-check", "typecheck"], maxAgeSeconds: 600 },
  adapter_test: { cmdContains: ["vitest run 02-Ingestion", "vitest run A-directAPI"], maxAgeSeconds: 3600 },
  fixture_replay: { cmdContains: ["Alltools-E2E/e2e.py", "e2e.py"], maxAgeSeconds: 3600 },
  dedup_smoke: { cmdContains: ["test_real_pipeline.py"], maxAgeSeconds: 3600 },
  dedup_test: { cmdContains: ["vitest run 04-Normalizer", "vitest run 07-Discovery"], maxAgeSeconds: 3600 },
  schema_diff: { cmdContains: ["schema_diff", "schema"], maxAgeSeconds: 3600 },
  venue_graph_dry_run: { cmdContains: ["venue-graph:dry-run"], maxAgeSeconds: 3600 },
  expo_typecheck: { cmdContains: ["06-UI && npx tsc", "06-UI && tsc"], maxAgeSeconds: 600 },
  expo_lint: { cmdContains: ["06-UI && npx eslint", "06-UI && eslint"], maxAgeSeconds: 600 },
  expo_smoke: { cmdContains: ["verify-providers"], maxAgeSeconds: 600 },
};

const AUTO_VERIFY_GATES = new Set(Object.keys(GATE_SPECS));

// ---- Helpers ---------------------------------------------------------------

function readMissionForSession(repoRoot: string, sessionId: string | null | undefined): MissionRef | null {
  // Phase L-A: explicit session/mission binding. Never fall back to "newest mtime".
  return findMissionBySession(repoRoot, sessionId);
}

function parseGatesField(text: string): string[] {
  const blockRe = /required_gates\s*:\s*\n((?:\s*-\s*[^\n]+\n?)+)/m;
  const m = blockRe.exec(text);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function parseProfileField(text: string): string | null {
  const re = /^\s*verification_profile\s*:\s*(.+?)\s*$/m;
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

function workingTreeFingerprint(repoRoot: string): string {
  try {
    const out = execSync(
      "git ls-files | sort | xargs cat 2>/dev/null | shasum -a 256 | awk '{print $1}'",
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return `sha256:${out.trim().slice(0, 32)}`;
  } catch {
    return "sha256:unavailable";
  }
}

function readEvidence(repoRoot: string): any[] {
  const ledger = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  if (!fs.existsSync(ledger)) return [];
  return fs
    .readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function evidenceMatchesGate(entry: any, gate: string, nowMs: number): boolean {
  const spec = GATE_SPECS[gate];
  if (!spec) return false;
  if (entry.exit_code !== 0) return false;
  const ageSec = (nowMs - new Date(entry.ts).getTime()) / 1000;
  if (ageSec > spec.maxAgeSeconds) return false;
  const cmd = String(entry.cmd || "");
  return spec.cmdContains.some((sub) => cmd.includes(sub));
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  if (!raw.trim()) process.exit(0);

  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("[ep-verify-completion] WARN: failed to parse stdin JSON; allowing.\n");
    process.exit(0);
  }

  const toolName: string = payload.tool_name || "";
  const sessionId: string | undefined = typeof payload.session_id === "string" ? payload.session_id : undefined;
  const cwd: string = payload.cwd || process.cwd();

  if (toolName !== "TaskCompleted") {
    process.exit(0);
  }

  const mission = readMissionForSession(cwd, sessionId);
  if (!mission) {
    process.stderr.write(
      `[ep-verify-completion] no mission bound to session_id=${sessionId ?? "unknown"}; allowing (explicit binding required).\n`,
    );
    process.exit(0);
  }

  const profile = parseProfileField(mission.text);
  const requiredGates = parseGatesField(mission.text);

  if (profile === "trivial" || requiredGates.length === 0) {
    process.stderr.write(`[ep-verify-completion] trivial profile or no gates; allowing.\n`);
    process.exit(0);
  }

  const nowMs = Date.now();
  const evidence = readEvidence(cwd);
  const currentFp = workingTreeFingerprint(cwd);

  const missing: string[] = [];
  const stale: string[] = [];
  const fpMismatch: string[] = [];
  const unknown: string[] = [];

  let latestMatchingFp: string | null = null;
  let latestMatchingTs: number = 0;

  for (const gate of requiredGates) {
    if (!AUTO_VERIFY_GATES.has(gate)) {
      unknown.push(gate);
      continue;
    }
    const matches = evidence.filter((e) => evidenceMatchesGate(e, gate, nowMs));
    if (matches.length === 0) {
      const anyAtAll = evidence.some((e) => {
        const spec = GATE_SPECS[gate];
        return spec && spec.cmdContains.some((sub) => String(e.cmd || "").includes(sub));
      });
      if (anyAtAll) stale.push(gate);
      else missing.push(gate);
      continue;
    }
    const latest = matches[matches.length - 1];
    const latestTs = new Date(latest.ts).getTime();
    if (latestTs > latestMatchingTs) {
      latestMatchingTs = latestTs;
      latestMatchingFp = latest.working_tree_fp;
    }
  }

  if (
    latestMatchingFp &&
    latestMatchingFp !== currentFp &&
    latestMatchingFp !== "sha256:unavailable"
  ) {
    fpMismatch.push(`current=${currentFp} lastEvidence=${latestMatchingFp}`);
  }

  const blocking = missing.length > 0 || stale.length > 0 || fpMismatch.length > 0;

  if (unknown.length > 0) {
    process.stderr.write(
      `[ep-verify-completion] WARN: unknown gates (manual review required): ${unknown.join(", ")}\n`,
    );
  }

  if (blocking) {
    const reasons: string[] = [];
    if (missing.length) reasons.push(`missing gates: ${missing.join(", ")}`);
    if (stale.length) reasons.push(`stale gates (evidence too old): ${stale.join(", ")}`);
    if (fpMismatch.length) reasons.push(`fingerprint mismatch: ${fpMismatch.join("; ")}`);

    const reasonText = `[ep-verify-completion] BLOCKED: ${reasons.join(" | ")}`;
    process.stderr.write(reasonText + "\n");
    const out = {
      hookSpecificOutput: {
        hookEventName: "TaskCompleted",
        permissionDecision: "deny",
        permissionDecisionReason: reasonText,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(2);
  }

  process.stderr.write(
    `[ep-verify-completion] PASS: mission=${mission.mission_id} gates=${requiredGates.join(",")}\n`,
  );
  // Phase L-A: persist outcome to evidence ledger (non-blocking, fail-open).
  const gatesFailed = [...missing, ...stale];
  const gatesPassed = requiredGates.filter(
    (g) => !missing.includes(g) && !stale.includes(g) && !unknown.includes(g),
  );
  const outcomeResult = recordOutcome(cwd, {
    missionId: mission.mission_id,
    verdict: "passed",
    verificationProfile: profile,
    gatesPassed,
    gatesFailed,
    gatesUnknown: unknown,
    workingTreeFp: currentFp,
  });
  if (!outcomeResult.ok) {
    process.stderr.write(
      `[ep-verify-completion] WARN: outcome-record failed: ${outcomeResult.error ?? "unknown"}\n`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-verify-completion] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
