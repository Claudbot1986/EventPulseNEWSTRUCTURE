/**
 * continuity.test.ts — Phase 6 verification.
 *
 * Scenarios:
 *   1. state-snap    PreCompact      → writes state JSON
 *   2. agent-trace   SubagentStart   → appends to ledger
 *   3. handoff-writer SubagentStop   → writes handoff markdown
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO = "/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/NEWSTRUCTURE";
const STATE_PATH = path.join(REPO, ".claude/eventpulse/state/agent-state.json");
const EVIDENCE = path.join(REPO, ".claude/eventpulse/evidence/ledger.ndjson");
const HANDOFF = (missionId: string, agent: string) =>
  path.join(REPO, `.claude/eventpulse/handoffs/${missionId}-${agent}.md`);

function run(hook: string, payload: any): { exit: number; stdout: string; stderr: string } {
  const r = spawnSync("npx", ["tsx", path.join(REPO, hook)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO,
  });
  return { exit: r.status ?? -1, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

let pass = 0;
let fail = 0;
function check(name: string, actual: any, expected: any, hint: string) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} (${hint})`);
  ok ? pass++ : fail++;
}

// --- Test 1: state-snap ---
if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
{
  const r = run(".claude/eventpulse/state-snap.ts", {
    session_id: "smoke-test-006",
    cwd: REPO,
    hook_event_name: "PreCompact",
  });
  check("state-snap exit", r.exit, 0, r.stderr.slice(-100));
  const exists = fs.existsSync(STATE_PATH);
  check("state file written", exists, true, STATE_PATH);
  if (exists) {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    check("state.session_id", state.session_id, "smoke-test-006", "roundtrip");
    check("state.schema_version", state.schema_version, 1, "version constant");
    check("state.reason", state.reason, "PreCompact", "reason passthrough");
    check("state.active_missions is array", Array.isArray(state.active_missions), true, "type");
  }
}

// --- Test 2: agent-trace ---
const beforeLines = fs.existsSync(EVIDENCE)
  ? fs.readFileSync(EVIDENCE, "utf8").split("\n").filter(Boolean).length
  : 0;
{
  const r = run(".claude/eventpulse/agent-trace.ts", {
    agent_name: "ep-ingestion-engineer",
    agent_role: "ingestion_engineer",
    parent_mission_id: "EP-2026-08-24-T3",
    session_id: "smoke-test-006",
    cwd: REPO,
  });
  check("agent-trace exit", r.exit, 0, r.stderr.slice(-100));
  const afterLines = fs.readFileSync(EVIDENCE, "utf8").split("\n").filter(Boolean).length;
  check("ledger line appended", afterLines, beforeLines + 1, `${beforeLines} → ${afterLines}`);
  const last = fs.readFileSync(EVIDENCE, "utf8").split("\n").filter(Boolean).pop();
  const entry = JSON.parse(last || "{}");
  check("entry.event", entry.event, "SubagentStart", "schema");
  check("entry.agent", entry.agent, "ep-ingestion-engineer", "schema");
  check("entry.role", entry.role, "ingestion_engineer", "schema");
  check("entry.mission_id", entry.mission_id, "EP-2026-08-24-T3", "schema");
}

// --- Test 3: handoff-writer ---
const missionId = "EP-2026-08-24-T3";
const agent = "ep-event-graph-engineer";
const handoffPath = HANDOFF(missionId, agent);
if (fs.existsSync(handoffPath)) fs.unlinkSync(handoffPath);
{
  const r = run(".claude/eventpulse/handoff-writer.ts", {
    agent_name: agent,
    agent_role: "event_graph_engineer",
    mission_id: missionId,
    session_id: "smoke-test-006",
    cwd: REPO,
  });
  check("handoff-writer exit", r.exit, 0, r.stderr.slice(-100));
  const exists = fs.existsSync(handoffPath);
  check("handoff file written", exists, true, handoffPath);
  if (exists) {
    const text = fs.readFileSync(handoffPath, "utf8");
    const lineCount = text.split("\n").length;
    check("handoff ≤ 60 lines", lineCount <= 60, true, `lineCount=${lineCount}`);
    check("handoff H1 heading", text.startsWith(`# Handoff`), true, "starts with # Handoff");
    check("handoff mentions mission", text.includes(missionId), true, "missionId in text");
    check("handoff mentions agent", text.includes(agent), true, "agent in text");
    check("handoff has 'What was done' section", text.includes("## What was done"), true, "section template");
  }
}

console.log(`\nresult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
