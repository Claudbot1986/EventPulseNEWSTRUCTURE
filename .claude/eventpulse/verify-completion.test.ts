/**
 * verify-completion.test.ts — Phase 5 verification.
 *
 * Scenarios (manipulating evidence ledger + mission mirror):
 *   1. trivial profile              → ALLOW (exit 0)
 *   2. ingestion, no evidence       → BLOCK (missing gates)
 *   3. ingestion, fresh evidence    → PASS
 *   4. ingestion, stale evidence    → BLOCK (stale)
 *   5. ingestion, fp-mismatch       → BLOCK (fingerprint)
 *   6. agent_ranking unknown gates  → PASS w/ warning (manual review surface)
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const MISSIONS = path.join(REPO, ".claude/eventpulse/missions");
const EVIDENCE = path.join(REPO, ".claude/eventpulse/evidence/ledger.ndjson");
const HOOK = path.join(REPO, ".claude/eventpulse/verify-completion.ts");

function writeMission(id: string, profile: string, gates: string[], sessionId: string): void {
  const yaml = `mission_id: ${id}
original_prompt: smoke test
task_type: feature
subsystems: []
complexity: small
risk: low
execution_mode: single_agent
roles: []
verification_profile: ${profile}
context:
  tier0: [.claude/eventpulse/policy.md]
  tier1: []
  tier2: []
  tier3: []
acceptance_criteria: ["a"]
constraints: ["c"]
unknown_assumptions: ["u"]
escalation_conditions: ["e"]
required_gates:
${gates.map((g) => `  - ${g}`).join("\n")}
classification_confidence: 0.5
human_review_required: false
created_at: 2026-08-24T20:00:00Z
session_id: ${sessionId}
`;
  fs.writeFileSync(path.join(MISSIONS, `${id}.yaml`), yaml, "utf8");
}

function clearMissions(): void {
  if (fs.existsSync(MISSIONS)) {
    for (const f of fs.readdirSync(MISSIONS)) {
      if (f.endsWith(".yaml")) fs.unlinkSync(path.join(MISSIONS, f));
    }
  }
}

function clearEvidence(): void {
  if (fs.existsSync(EVIDENCE)) fs.unlinkSync(EVIDENCE);
}

function writeEvidence(entries: any[]): void {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(
    EVIDENCE,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
}

function run(payload: any): { exit: number; stdout: string; stderr: string } {
  const enriched = { session_id: "smoke-test-session-001", ...payload };
  const r = spawnSync("npx", ["tsx", HOOK], {
    input: JSON.stringify(enriched),
    encoding: "utf8",
    cwd: REPO,
  });
  return {
    exit: r.status ?? -1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

let pass = 0;
let fail = 0;

function check(name: string, actual: any, expected: any, reason: string) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: actual=${actual} expected=${expected} (${reason})`);
  ok ? pass++ : fail++;
}

// --- Test 1: trivial profile → ALLOW ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T1", "trivial", ["typecheck"], "smoke-test-session-001");
{
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T1 trivial allow", r.exit, 0, r.stderr.slice(-120));
}

// --- Test 2: ingestion, no evidence → BLOCK ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T2", "ingestion", ["typecheck", "adapter_test", "fixture_replay", "dedup_smoke"], "smoke-test-session-001");
{
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T2 missing-gates block", r.exit, 2, r.stderr.slice(-200));
}

// --- Test 3: ingestion, fresh evidence → PASS ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T3", "ingestion", ["typecheck", "adapter_test", "fixture_replay", "dedup_smoke"], "smoke-test-session-001");
const now = Date.now();
writeEvidence([
  { ts: new Date(now - 30_000).toISOString(), cmd: "npm run type-check", exit_code: 0, working_tree_fp: "sha256:placeholder" },
  { ts: new Date(now - 60_000).toISOString(), cmd: "npx vitest run 02-Ingestion/A-directAPI", exit_code: 0, working_tree_fp: "sha256:placeholder" },
  { ts: new Date(now - 90_000).toISOString(), cmd: "python3 Alltools-E2E/e2e.py --source kulturhuset --limit 1", exit_code: 0, working_tree_fp: "sha256:placeholder" },
  { ts: new Date(now - 120_000).toISOString(), cmd: "python3 tests/test_real_pipeline.py --source kulturhuset", exit_code: 0, working_tree_fp: "sha256:placeholder" },
]);
{
  const fpR = spawnSync("bash", ["-c", "git ls-files | sort | xargs cat 2>/dev/null | shasum -a 256 | awk '{print $1}'"], { encoding: "utf8", cwd: REPO });
  const realFp = `sha256:${fpR.stdout.trim().slice(0, 32)}`;
  const ledger = fs.readFileSync(EVIDENCE, "utf8").split("\n").filter(Boolean).map((l) => {
    const e = JSON.parse(l);
    e.working_tree_fp = realFp;
    return JSON.stringify(e);
  }).join("\n") + "\n";
  fs.writeFileSync(EVIDENCE, ledger, "utf8");
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T3 fresh-evidence pass", r.exit, 0, r.stderr.slice(-120));
}

// --- Test 4: ingestion, stale evidence (>10 min for typecheck) → BLOCK ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T4", "ingestion", ["typecheck"], "smoke-test-session-001");
writeEvidence([
  { ts: new Date(now - 700_000).toISOString(), cmd: "npm run type-check", exit_code: 0, working_tree_fp: "sha256:x" },
]);
{
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T4 stale-evidence block", r.exit, 2, r.stderr.slice(-200));
}

// --- Test 5: ingestion, fp mismatch → BLOCK ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T5", "ingestion", ["typecheck"], "smoke-test-session-001");
writeEvidence([
  { ts: new Date(now - 30_000).toISOString(), cmd: "npm run type-check", exit_code: 0, working_tree_fp: "sha256:0000000000000000000000000000dead" },
]);
{
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T5 fp-mismatch block", r.exit, 2, r.stderr.slice(-200));
}

// --- Test 6: agent_ranking unknown gates → PASS w/ warning ---
clearMissions();
clearEvidence();
writeMission("EP-2026-08-24-T6", "agent_ranking", ["grounding_eval", "no_fabricated_events"], "smoke-test-session-001");
{
  const r = run({ tool_name: "TaskCompleted", cwd: REPO });
  check("T6 unknown-gates pass", r.exit, 0, r.stderr.slice(-200));
  if (!r.stderr.includes("unknown gates")) {
    console.log("FAIL T6 expected 'unknown gates' warning");
    fail++;
  } else {
    console.log("PASS T6 unknown-gates warning emitted");
    pass++;
  }
}

console.log(`\nresult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
