#!/usr/bin/env node
/**
 * state-snap.ts — PreCompact hook — plan §12, §16
 *
 * Reads JSON on stdin: { session_id, cwd, hook_event_name, transcript_path? }
 * Writes .claude/eventpulse/state/agent-state.json with a compact continuity
 * summary. Never stores transcript content or raw tool outputs.
 * Always exits 0 (fail-open).
 */

import * as fs from "fs";
import * as path from "path";
import { findMissionBySession } from "./mission-resolver";

const STATE_DIR = path.join(process.cwd(), ".claude", "eventpulse", "state");
const STATE_PATH = path.join(STATE_DIR, "agent-state.json");

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function missionForSession(repoRoot: string, sessionId: string | null | undefined): { mission_id: string; file: string } | null {
  // Phase L-A: explicit session/mission binding.
  const ref = findMissionBySession(repoRoot, sessionId);
  if (!ref) return null;
  return { mission_id: ref.mission_id, file: ref.file };
}

function readRecentEvidence(repoRoot: string, limit = 20): any[] {
  const ledger = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  if (!fs.existsSync(ledger)) return [];
  return fs
    .readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

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
    process.stderr.write("[ep-state-snap] WARN: failed to parse stdin JSON; skipping.\n");
    process.exit(0);
  }

  const sessionId: string = payload.session_id || "unknown";
  const cwd: string = payload.cwd || process.cwd();

  const mission = missionForSession(cwd, sessionId);
  const recentEvidence = readRecentEvidence(cwd);

  const recentCommands = recentEvidence.slice(-5).map((e) => e.cmd).filter(Boolean);
  const recentAgents = Array.from(
    new Set(recentEvidence.slice(-5).map((e) => e.agent).filter(Boolean)),
  );

  const state = {
    schema_version: 1,
    session_id: sessionId,
    updated_at: new Date().toISOString(),
    reason: payload.reason || payload.hook_event_name || "PreCompact",
    active_missions: mission
      ? [{ mission_id: mission.mission_id, file: mission.file, status: "in_progress" }]
      : [],
    completed_tasks: recentEvidence
      .filter((e) => e.event === "TaskCompleted")
      .slice(-5)
      .map((e) => ({ ts: e.ts, agent: e.agent, cmd: e.cmd, exit_code: e.exit_code })),
    recent_commands: recentCommands,
    recent_agents: recentAgents,
    key_decisions: [],
    blockers: [],
    next_actions: [],
  };

  ensureDir(STATE_DIR);
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    process.stderr.write(
      `[ep-state-snap] wrote state to ${STATE_PATH} (mission=${state.active_missions[0]?.mission_id ?? "none"})\n`,
    );
  } catch (err) {
    process.stderr.write(`[ep-state-snap] ERROR (fail-open): ${(err as Error).message}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-state-snap] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
