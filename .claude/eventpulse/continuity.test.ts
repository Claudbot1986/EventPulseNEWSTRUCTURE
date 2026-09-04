/**
 * continuity.test.ts — regressionstest för kontinuitetshookarna.
 *
 * Scenarier:
 *   1. state-snap     PreCompact    → skriver state-JSON
 *   2. agent-trace    SubagentStart → lägger till rad i ledgern
 *   3. handoff-writer SubagentStop  → skriver handoff-markdown
 *
 * Hook-skripten löser sina skrivvägar från process.cwd()
 * (state-snap.ts:15, agent-trace.ts:13, handoff-writer.ts:14) och har egna
 * ensureDir — därför körs allt mot en temporär sandbox och levande
 * state/ledger/handoffs i repot berörs aldrig.
 *
 * T0094: den tidigare versionen var ett skript (top-level-kod + process.exit)
 * som pekade på en hårdkodad sökväg till en gammal projektkopia
 * (/Users/claudgashi/EventPulse-recovery/…) — spawnSync fick ENOENT och
 * filen kraschade okodat vid import under vitest.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ep-continuity-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  sandbox = "";
});

interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
}

function run(hook: string, payload: Record<string, unknown>): RunResult {
  const script = path.join(REPO, ".claude", "eventpulse", hook);
  const r = spawnSync(TSX, [script], {
    input: JSON.stringify({ cwd: sandbox, ...payload }),
    encoding: "utf8",
    cwd: sandbox,
  });
  return {
    exit: r.status ?? -1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function ledgerLines(): string[] {
  const p = path.join(sandbox, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
}

describe("continuity hooks", () => {
  it("state-snap skriver state-JSON vid PreCompact", () => {
    const r = run("state-snap.ts", {
      session_id: "smoke-test-006",
      hook_event_name: "PreCompact",
    });
    expect(r.exit).toBe(0);

    const statePath = path.join(sandbox, ".claude", "eventpulse", "state", "agent-state.json");
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.session_id).toBe("smoke-test-006");
    expect(state.schema_version).toBe(1);
    expect(state.reason).toBe("PreCompact");
    expect(Array.isArray(state.active_missions)).toBe(true);
  });

  it("agent-trace lägger till en SubagentStart-rad i ledgern", () => {
    const before = ledgerLines().length;
    const r = run("agent-trace.ts", {
      agent_name: "ep-ingestion-engineer",
      agent_role: "ingestion_engineer",
      parent_mission_id: "EP-2026-08-24-T3",
      session_id: "smoke-test-006",
    });
    expect(r.exit).toBe(0);

    const after = ledgerLines();
    expect(after.length).toBe(before + 1);
    const entry = JSON.parse(after[after.length - 1] || "{}");
    expect(entry.event).toBe("SubagentStart");
    expect(entry.agent).toBe("ep-ingestion-engineer");
    expect(entry.role).toBe("ingestion_engineer");
    expect(entry.mission_id).toBe("EP-2026-08-24-T3");
  });

  it("handoff-writer skriver handoff-markdown (≤60 rader, rätt sektioner)", () => {
    const missionId = "EP-2026-08-24-T3";
    const agent = "ep-event-graph-engineer";
    const r = run("handoff-writer.ts", {
      agent_name: agent,
      agent_role: "event_graph_engineer",
      mission_id: missionId,
      session_id: "smoke-test-006",
    });
    expect(r.exit).toBe(0);

    const handoffPath = path.join(
      sandbox,
      ".claude",
      "eventpulse",
      "handoffs",
      `${missionId}-${agent}.md`,
    );
    expect(fs.existsSync(handoffPath)).toBe(true);
    const text = fs.readFileSync(handoffPath, "utf8");
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
    expect(text.startsWith("# Handoff")).toBe(true);
    expect(text).toContain(missionId);
    expect(text).toContain(agent);
    expect(text).toContain("## What was done");
  });
});