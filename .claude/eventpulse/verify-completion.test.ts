/**
 * verify-completion.test.ts — regressionstest för TaskCompleted-gaten.
 *
 * Kör HELT mot en temporär sandbox: gaten läser repoRoot från
 * payload.cwd (verify-completion.ts:136), så sandboxen kräver ingen
 * kodändring i hooken.
 *
 * VIKTIGT (T0094): den tidigare versionen av denna fil var ett skript
 * (top-level-kod + process.exit) som vid varje full vitest-körning raderade
 * LEVANDE missions/*.yaml + evidence-ledgern (clearMissions/clearEvidence
 * mot riktiga sökvägar) och dödade sedan vitest-workern. Det var en direkt
 * blockerare för verify-completion-gaten — en full testkörning strök
 * sessionens evidens innan TaskCompleted hann läsa den.
 *
 * Scenarier (manipulerar sandbox-missions + sandbox-ledger):
 *   1. trivial profile              → ALLOW (exit 0)
 *   2. ingestion, no evidence       → BLOCK (missing gates)
 *   3. ingestion, fresh evidence    → PASS
 *   4. ingestion, stale evidence     → BLOCK (stale)
 *   5. ingestion, fp-mismatch        → BLOCK (fingerprint)
 *   6. agent_ranking unknown gates  → PASS w/ warning (manual review surface)
 *   7. annat verktyg än TaskCompleted → ALLOW (exit 0)
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const HOOK = path.join(REPO, ".claude", "eventpulse", "verify-completion.ts");
const SESSION = "smoke-test-session-001";

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ep-verify-completion-"));
  // Gaten hashar `git ls-files`-innehåll — sandboxen måste vara ett git-repo.
  spawnSync("git", ["init"], { cwd: sandbox, encoding: "utf8" });
  fs.writeFileSync(path.join(sandbox, "fixture.txt"), "fixture\n", "utf8");
  spawnSync("git", ["add", "fixture.txt"], { cwd: sandbox, encoding: "utf8" });
  fs.mkdirSync(path.join(sandbox, ".claude", "eventpulse", "missions"), { recursive: true });
  fs.mkdirSync(path.join(sandbox, ".claude", "eventpulse", "evidence"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  sandbox = "";
});

function writeMission(id: string, profile: string, gates: string[]): void {
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
session_id: ${SESSION}
`;
  fs.writeFileSync(path.join(sandbox, ".claude", "eventpulse", "missions", `${id}.yaml`), yaml, "utf8");
}

function writeEvidence(entries: Record<string, unknown>[]): void {
  fs.writeFileSync(
    path.join(sandbox, ".claude", "eventpulse", "evidence", "ledger.ndjson"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
}

interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
}

function run(payload: Record<string, unknown> = {}): RunResult {
  const enriched = { session_id: SESSION, cwd: sandbox, ...payload };
  const r = spawnSync(TSX, [HOOK], {
    input: JSON.stringify(enriched),
    encoding: "utf8",
    cwd: sandbox,
  });
  return {
    exit: r.status ?? -1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function currentFingerprint(): string {
  const r = spawnSync(
    "bash",
    ["-c", "git ls-files | sort | xargs cat 2>/dev/null | shasum -a 256 | awk '{print $1}'"],
    { encoding: "utf8", cwd: sandbox },
  );
  return `sha256:${(r.stdout || "").trim().slice(0, 32)}`;
}

describe("verify-completion gate", () => {
  it("T1: trivial profil → ALLOW (exit 0)", () => {
    writeMission("EP-2026-08-24-T1", "trivial", ["typecheck"]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(0);
  });

  it("T2: ingestion utan evidens → BLOCK (missing gates)", () => {
    writeMission("EP-2026-08-24-T2", "ingestion", [
      "typecheck",
      "adapter_test",
      "fixture_replay",
      "dedup_smoke",
    ]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(2);
  });

  it("T3: ingestion med färsk evidens + fp-match → PASS", () => {
    writeMission("EP-2026-08-24-T3", "ingestion", [
      "typecheck",
      "adapter_test",
      "fixture_replay",
      "dedup_smoke",
    ]);
    const now = Date.now();
    const fp = currentFingerprint();
    writeEvidence([
      { ts: new Date(now - 30_000).toISOString(), cmd: "npm run type-check", exit_code: 0, working_tree_fp: fp },
      { ts: new Date(now - 60_000).toISOString(), cmd: "npx vitest run 02-Ingestion/A-directAPI", exit_code: 0, working_tree_fp: fp },
      { ts: new Date(now - 90_000).toISOString(), cmd: "python3 Alltools-E2E/e2e.py --source kulturhuset --limit 1", exit_code: 0, working_tree_fp: fp },
      { ts: new Date(now - 120_000).toISOString(), cmd: "python3 tests/test_real_pipeline.py --source kulturhuset", exit_code: 0, working_tree_fp: fp },
    ]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(0);
  });

  it("T4: ingestion med gammal evidens (>600s för typecheck) → BLOCK (stale)", () => {
    writeMission("EP-2026-08-24-T4", "ingestion", ["typecheck"]);
    writeEvidence([
      { ts: new Date(Date.now() - 700_000).toISOString(), cmd: "npm run type-check", exit_code: 0, working_tree_fp: "sha256:x" },
    ]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(2);
  });

  it("T5: ingestion med fp-mismatch → BLOCK", () => {
    writeMission("EP-2026-08-24-T5", "ingestion", ["typecheck"]);
    writeEvidence([
      {
        ts: new Date(Date.now() - 30_000).toISOString(),
        cmd: "npm run type-check",
        exit_code: 0,
        working_tree_fp: "sha256:0000000000000000000000000000dead",
      },
    ]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(2);
  });

  it("T6: okända gates → PASS med varning (manuell granskningsyta)", () => {
    writeMission("EP-2026-08-24-T6", "agent_ranking", ["grounding_eval", "no_fabricated_events"]);
    const r = run({ tool_name: "TaskCompleted" });
    expect(r.exit).toBe(0);
    expect(r.stderr).toContain("unknown gates");
  });

  it("T7: annat verktyg än TaskCompleted → ALLOW (exit 0)", () => {
    writeMission("EP-2026-08-24-T7", "ingestion", ["typecheck"]);
    const r = run({ tool_name: "Stop" });
    expect(r.exit).toBe(0);
  });
});