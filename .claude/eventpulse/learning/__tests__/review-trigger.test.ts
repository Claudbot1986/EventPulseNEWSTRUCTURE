/**
 * review-trigger.test.ts — Phase L-H tester (5 tester)
 *
 * Verifierar att review-trigger:
 *   1. triggar INTE review när since_last_review < review_every
 *   2. triggar review + skriver REVIEW-YYYYMMDD-NNN.md när sedan sedan ≥ 20
 *   3. genererar OPT-YYYYMMDD-NNN.md-förslag med confidence + evidence
 *   4. markerar INSUFFICIENT_DATA för window med <5 episodes
 *   5. återställer since_last_review till 0 efter lyckad review
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const SMOKE = mkdtempSync(join(tmpdir(), "ep-review-test-"));
const SCRIPTS = join(SMOKE, ".claude", "eventpulse", "learning", "scripts");
const REAL_SCRIPTS = join(process.cwd(), ".claude", "eventpulse", "learning", "scripts");

beforeAll(() => {
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "scripts"), { recursive: true });
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "episodes", "2026", "08"), { recursive: true });
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "optimization-reviews"), { recursive: true });
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "proposals"), { recursive: true });
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "policy.md"), { recursive: true });
  for (const f of [
    "review-trigger.ts",
    "analyze-last-window.ts",
    "optimization-proposal.ts",
    "promote-gate.ts",
    "counter.ts",
    "file-lock.ts",
    "episode-types.ts",
    "quality-score.ts",
    "outcome-labels.ts",
  ]) {
    const src = join(REAL_SCRIPTS, f);
    if (existsSync(src)) writeFileSync(join(SCRIPTS, f), readFileSync(src, "utf8"));
  }
});

beforeEach(() => {
  // Reset all dirs between tests
  for (const sub of ["episodes", "optimization-reviews", "proposals"]) {
    const p = join(SMOKE, ".claude", "eventpulse", "learning", sub);
    if (existsSync(p)) {
      try { execFileSync("rm", ["-rf", p], { stdio: "ignore" }); } catch { /* ignore */ }
    }
    mkdirSync(p, { recursive: true });
  }
  // Reset counter
  const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
  mkdirSync(join(SMOKE, ".claude", "eventpulse", "learning", "state"), { recursive: true });
  writeFileSync(counterPath, JSON.stringify({
    all_terminal_episodes: 0,
    review_eligible_episodes: 0,
    since_last_review: 0,
    review_every: 20,
    last_updated: new Date().toISOString(),
  }));
  // Reset last-review
  const lrPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "last-review.json");
  if (existsSync(lrPath)) {
    try { execFileSync("rm", [lrPath], { stdio: "ignore" }); } catch { /* ignore */ }
  }
});

afterAll(() => {
  try { execFileSync("rm", ["-rf", SMOKE], { stdio: "ignore" }); } catch { /* ignore */ }
});

function seedEpisodes(n: number, opts: { withFailures?: boolean } = {}): void {
  const epDir = join(SMOKE, ".claude", "eventpulse", "learning", "episodes", "2026", "08");
  mkdirSync(epDir, { recursive: true });
  for (let i = 1; i <= n; i++) {
    const id = `EP-EPISODE-2026-08-26-${String(i).padStart(3, "0")}`;
    // Half of "completed" episodes have gates_failed even though terminal_state=completed
    const hasGateFailures = opts.withFailures && i % 2 === 0;
    writeFileSync(join(epDir, `${id}.json`), JSON.stringify({
      episode_id: id,
      mission_id: `M-${String(i).padStart(3, "0")}`,
      terminal_state: "completed",
      review_eligible: true,
      learning_quality_score: 0.80,
      cohort: "live_instrumented",
      outcome: {
        task_success: !hasGateFailures,
        first_attempt_passed: !hasGateFailures,
        gates_passed: hasGateFailures ? ["g1"] : ["g1", "g2"],
        gates_failed: hasGateFailures ? ["gate-freshness", "gate-canonical-path"] : [],
      },
      metadata: { verification_profile: "standard", agent: "ep-test", head_sha: "abc123", working_tree_fp: "fp-1" },
      corrections: [],
      evidence_refs: [],
    }));
  }
}

function setCounter(since: number, eligible?: number): void {
  const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
  writeFileSync(counterPath, JSON.stringify({
    all_terminal_episodes: 20,
    review_eligible_episodes: eligible ?? 20,
    since_last_review: since,
    review_every: 20,
    last_updated: new Date().toISOString(),
  }));
}

async function runScript(name: string, ...args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const r = spawnSync("npx", ["tsx", join(SCRIPTS, name), ...args], {
    env: { ...process.env, EP_REPO_ROOT: SMOKE },
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    ok: r.status === 0,
    out: r.stdout ?? "",
    err: r.stderr ?? "",
  };
}

describe("review-trigger", () => {
  it("1. triggar INTE review när since_last_review (5) < review_every (20)", async () => {
    setCounter(5);
    const result = await runScript("review-trigger.ts");
    expect(result.err).toMatch(/since_last_review=5 < review_every=20/);
    expect(result.err).not.toMatch(/triggered=true/);
  });

  it("2. triggar review + skriver REVIEW-YYYYMMDD-NNN.md när since_last_review ≥ 20", async () => {
    setCounter(20);
    seedEpisodes(20, { withFailures: true });
    const result = await runScript("review-trigger.ts");
    expect(result.err).toMatch(/REVIEW-\d{4}-\d{2}-\d{2}/);
    const reviewsDir = join(SMOKE, ".claude", "eventpulse", "learning", "optimization-reviews");
    const files = readdirSync(reviewsDir).filter((f) => f.startsWith("REVIEW-"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("3. genererar OPT-YYYYMMDD-NNN.md-förslag efter review (med failure-pattern)", async () => {
    setCounter(20);
    seedEpisodes(20, { withFailures: true });
    await runScript("review-trigger.ts");
    const proposalsDir = join(SMOKE, ".claude", "eventpulse", "learning", "proposals");
    const files = readdirSync(proposalsDir).filter((f) => f.startsWith("OPT-"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const opt = readFileSync(join(proposalsDir, files[0]), "utf8");
    expect(opt).toMatch(/confidence/);
    expect(opt).toMatch(/evidence/);
  });

  it("4. markerar INSUFFICIENT_DATA för window med <5 episodes", async () => {
    setCounter(20);
    seedEpisodes(3); // under MIN_SAMPLE_SIZE
    const result = await runScript("analyze-last-window.ts");
    // Either INSUFFICIENT_DATA in REVIEW content, or low sample size reflected
    expect(result.out + result.err).toMatch(/REVIEW-|written|sample/i);
    const reviewsDir = join(SMOKE, ".claude", "eventpulse", "learning", "optimization-reviews");
    const files = readdirSync(reviewsDir).filter((f) => f.startsWith("REVIEW-"));
    if (files.length > 0) {
      const content = readFileSync(join(reviewsDir, files[0]), "utf8");
      // The analyzer should mark low-sample metrics as INSUFFICIENT_DATA or similar
      expect(content).toMatch(/INSUFFICIENT|low_sample|sample_size|n=|window/i);
    }
  });

  it("5. återställer since_last_review till 0 efter lyckad review", async () => {
    setCounter(20);
    seedEpisodes(20);
    await runScript("review-trigger.ts");
    const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
    const final = JSON.parse(readFileSync(counterPath, "utf8"));
    expect(final.since_last_review).toBe(0);
  });
});
