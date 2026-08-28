#!/usr/bin/env node
/**
 * handoff-writer.ts — SubagentStop hook — plan §12, §16
 *
 * Reads JSON on stdin: { agent_name, agent_role?, mission_id?, session_id, cwd, ... }
 * Writes a concise handoff file at .claude/eventpulse/handoffs/<mission_id>-<agent>.md
 * (max ~60 lines). Always exits 0 (fail-open).
 */

import * as fs from "fs";
import * as path from "path";
import { findMissionBySession } from "./mission-resolver";

const HANDOFFS_DIR = path.join(process.cwd(), ".claude", "eventpulse", "handoffs");

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function missionForSession(repoRoot: string, sessionId: string | null | undefined): string | null {
  // Phase L-A: explicit session/mission binding.
  const ref = findMissionBySession(repoRoot, sessionId);
  return ref?.mission_id ?? null;
}

function readState(repoRoot: string): any | null {
  const p = path.join(repoRoot, ".claude", "eventpulse", "state", "agent-state.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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
    process.stderr.write("[ep-handoff-writer] WARN: failed to parse stdin JSON; skipping.\n");
    process.exit(0);
  }

  const agentName: string = payload.agent_name || payload.agent || "unknown-agent";
  const agentRole: string = payload.agent_role || "unspecified";
  const sessionId: string = payload.session_id || "unknown";
  const cwd: string = payload.cwd || process.cwd();

  // Phase L-A: explicit session binding. If payload.mission_id is provided
  // and matches a known mission, allow; otherwise resolve by session.
  const fromPayload = typeof payload.mission_id === "string" ? payload.mission_id : null;
  const fromSession = missionForSession(cwd, sessionId);
  const missionId = fromPayload ?? fromSession ?? "no-mission";
  const state = readState(cwd);

  const ts = new Date().toISOString();
  const lines: string[] = [
    `# Handoff — ${missionId} (${agentName})`,
    "",
    `- **Time:** ${ts}`,
    `- **Session:** ${sessionId}`,
    `- **Role:** ${agentRole}`,
    `- **Mission:** ${missionId}`,
    "",
    "## What was done",
    "(filled by agent at stop time)",
    "",
    "## What is still open",
    "(filled by agent at stop time)",
    "",
    "## Suggested next action for next agent",
    "(filled by agent at stop time)",
    "",
  ];

  if (state) {
    lines.push(
      "## Recent context (from state-snap)",
      `- Active mission: ${state.active_missions?.[0]?.mission_id ?? "(none)"}`,
      `- Recent commands: ${(state.recent_commands ?? []).slice(0, 3).join(" | ") || "(none)"}`,
      `- Recent agents: ${(state.recent_agents ?? []).join(", ") || "(none)"}`,
      "",
    );
  }

  const out = lines.slice(0, 60).join("\n") + "\n";

  ensureDir(HANDOFFS_DIR);
  const fileName = `${missionId}-${agentName.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
  const filePath = path.join(HANDOFFS_DIR, fileName);
  try {
    fs.writeFileSync(filePath, out, "utf8");
    process.stderr.write(`[ep-handoff-writer] wrote handoff to ${filePath}\n`);
  } catch (err) {
    process.stderr.write(`[ep-handoff-writer] ERROR (fail-open): ${(err as Error).message}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-handoff-writer] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
