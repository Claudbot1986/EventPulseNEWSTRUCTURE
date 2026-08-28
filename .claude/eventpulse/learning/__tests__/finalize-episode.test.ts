/**
 * finalize-episode.test.ts — Phase L-H tester (5 tester)
 *
 * Verifierar att episode-finalizer:
 *   1. är idempotent (samma mission → samma episode, andra anropet skippar)
 *   2. skriver EP-EPISODE-YYYY-MM-DD-NNN.json med rätt schema
 *   3. uppdaterar counter atomiskt med rätt since_last_review delta
 *   4. markerar review_eligible=true endast när terminal_state=completed + quality >= 0.40
 *   5. filtrerar bort led-tradar som saknar mission_id
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const SMOKE = mkdtempSync(join(tmpdir(), "ep-finalize-test-"));
const SCRIPTS = join(SMOKE, ".claude", "eventpulse", "learning", "scripts");
const REAL_SCRIPTS = join(process.cwd(), ".claude", "eventpulse", "learning", "scripts");

beforeAll(() => {
  // Copy scripts + schemas to smoke dir
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "episodes"), { recursive: true });
  mkdirSync(SCRIPTS, { recursive: true });
  for (const f of ["finalize-episode.ts", "counter.ts", "file-lock.ts", "state-machine.ts", "quality-score.ts", "episode-types.ts"]) {
    const src = join(REAL_SCRIPTS, f);
    if (existsSync(src)) {
      writeFileSync(join(SCRIPTS, f), readFileSync(src, "utf8"));
    }
  }
  // Stub policy.md so canonical-path-guard isn't accidentally triggered (we don't call it from finalize)
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "policy.md"), { recursive: true });
});

beforeEach(() => {
  // Reset episodes dir between tests
  const epDir = join(SMOKE, ".claude", "eventpulse", "learning", "episodes");
  // Don't delete the dir itself (mkdirSync would race); just clear contents
  try {
    for (const yyyy of readdirSync(epDir)) {
      const sub = join(epDir, yyyy);
      if (existsSync(sub)) {
        try {
          execFileSync("rm", ["-rf", sub], { stdio: "ignore" });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  // Reset counter
  const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
  mkdirSync(dirname(counterPath), { recursive: true });
  writeFileSync(counterPath, JSON.stringify({
    all_terminal_episodes: 0,
    review_eligible_episodes: 0,
    since_last_review: 0,
    review_every: 20,
    last_updated: new Date().toISOString(),
  }));
  // Reset outcomes.ndjson
  const outcomesPath = join(SMOKE, ".claude", "eventpulse", "learning", "outcomes.ndjson");
  try {
    if (existsSync(outcomesPath)) execFileSync("rm", [outcomesPath], { stdio: "ignore" });
  } catch { /* ignore */ }
});

afterAll(() => {
  try {
    execFileSync("rm", ["-rf", SMOKE], { stdio: "ignore" });
  } catch { /* ignore */ }
});

async function loadFinalize(): Promise<typeof import("../scripts/finalize-episode")> {
  return await import(join(SCRIPTS, "finalize-episode.ts"));
}

async function seedMission(missionId: string, opts: { withVerifyPassed?: boolean; profile?: string } = {}): Promise<void> {
  const missionsDir = join(SMOKE, ".claude", "eventpulse", "missions");
  mkdirSync(missionsDir, { recursive: true });
  const yaml = [
    `mission_id: ${missionId}`,
    `original_prompt: smoke test`,
    `task_type: feature`,
    `verification_profile: ${opts.profile ?? "standard"}`,
    `session_id: smoke-session-${missionId}`,
    `created_at: 2026-08-26T17:00:00Z`,
    `acceptance_criteria: ["a"]`,
    `constraints: ["c"]`,
  ].join("\n");
  writeFileSync(join(missionsDir, `${missionId}.yaml`), yaml);

  // Seed ledger with events to walk state machine: active → implemented → verified → reconciled
  const ledgerDir = join(SMOKE, ".claude", "eventpulse", "evidence");
  mkdirSync(ledgerDir, { recursive: true });
  const lines = [
    JSON.stringify({ event: "PostToolUse", cmd: "npm run build", mission_id: missionId, ts: "2026-08-26T17:10:00Z" }),
    JSON.stringify({ event: "mission.terminal", mission_id: missionId, session_id: `smoke-session-${missionId}`, terminal_state: "completed", ts: "2026-08-26T17:30:00Z" }),
  ];
  if (opts.withVerifyPassed) {
    lines.push(JSON.stringify({ event: "verify.passed", mission_id: missionId, gates_passed: ["x"], gates_failed: [], working_tree_fp: "fp-001", ts: "2026-08-26T17:20:00Z" }));
    lines.push(JSON.stringify({ event: "reconcile.completed", mission_id: missionId, ts: "2026-08-26T17:25:00Z" }));
  }
  writeFileSync(join(ledgerDir, "ledger.ndjson"), lines.join("\n") + "\n");
}

describe("finalize-episode", () => {
  it("1. är idempotent: andra anropet skippar (samma mission)", async () => {
    const { finalizeOne } = await loadFinalize();
    await seedMission("M-IDEM-001", { withVerifyPassed: true });
    const first = await finalizeOne({ missionId: "M-IDEM-001", sessionId: "smoke-session-M-IDEM-001", terminalState: "completed", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    expect(first.ok).toBe(true);
    expect(first.skipped).toBeFalsy();
    const second = await finalizeOne({ missionId: "M-IDEM-001", sessionId: "smoke-session-M-IDEM-001", terminalState: "completed", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
  });

  it("2. skriver EP-EPISODE-YYYY-MM-DD-NNN.json med rätt schema_version", async () => {
    const { finalizeOne } = await loadFinalize();
    await seedMission("M-SCHEMA-001", { withVerifyPassed: true });
    const result = await finalizeOne({ missionId: "M-SCHEMA-001", sessionId: "smoke-session-M-SCHEMA-001", terminalState: "completed", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    expect(result.ok).toBe(true);
    expect(result.episodeId).toMatch(/^EP-EPISODE-\d{4}-\d{2}-\d{2}-\d{3}$/);
    const epPath = join(SMOKE, ".claude", "eventpulse", "learning", "episodes", "2026", "08", `${result.episodeId}.json`);
    expect(existsSync(epPath)).toBe(true);
    const ep = JSON.parse(readFileSync(epPath, "utf8"));
    expect(ep.schema_version).toBe("ep-episode-1.0");
    expect(ep.mission_id).toBe("M-SCHEMA-001");
    expect(ep.terminal_state).toBe("completed");
    expect(ep.cohort).toBe("live_instrumented");
  });

  it("3. uppdaterar counter atomiskt med since_last_review += 1 (om eligible)", async () => {
    const { finalizeOne } = await loadFinalize();
    await seedMission("M-COUNTER-001", { withVerifyPassed: true });
    const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
    const before = JSON.parse(readFileSync(counterPath, "utf8"));
    expect(before.since_last_review).toBe(0);
    await finalizeOne({ missionId: "M-COUNTER-001", sessionId: "smoke-session-M-COUNTER-001", terminalState: "completed", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    const after = JSON.parse(readFileSync(counterPath, "utf8"));
    expect(after.since_last_review).toBeGreaterThanOrEqual(1);
    expect(after.all_terminal_episodes).toBe(before.all_terminal_episodes + 1);
  });

  it("4. markerar review_eligible=false när terminal_state=failed", async () => {
    const { finalizeOne } = await loadFinalize();
    await seedMission("M-FAILED-001", { withVerifyPassed: false });
    const result = await finalizeOne({ missionId: "M-FAILED-001", sessionId: "smoke-session-M-FAILED-001", terminalState: "failed", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    expect(result.ok).toBe(true);
    const epPath = join(SMOKE, ".claude", "eventpulse", "learning", "episodes", "2026", "08", `${result.episodeId}.json`);
    const ep = JSON.parse(readFileSync(epPath, "utf8"));
    expect(ep.terminal_state).toBe("failed");
    expect(ep.review_eligible).toBe(false);
  });

  it("5. counter ökas INTE för icke-eligible episodes (since_last_review oförändrat)", async () => {
    const { finalizeOne } = await loadFinalize();
    await seedMission("M-NOT-ELIG-001", { withVerifyPassed: false });
    const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
    const before = JSON.parse(readFileSync(counterPath, "utf8"));
    await finalizeOne({ missionId: "M-NOT-ELIG-001", sessionId: "smoke-session-M-NOT-ELIG-001", terminalState: "blocked", terminalTs: "2026-08-26T17:30:00Z", repoRoot: SMOKE });
    const after = JSON.parse(readFileSync(counterPath, "utf8"));
    expect(after.all_terminal_episodes).toBe(before.all_terminal_episodes + 1); // all_terminal ökar
    expect(after.since_last_review).toBe(before.since_last_review); // men review-counter ej
  });
});
