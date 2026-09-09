#!/usr/bin/env node
/**
 * agent-trace.ts — SubagentStart hook — plan §12
 *
 * Reads JSON on stdin: { agent_name, agent_role?, parent_mission_id?, session_id, cwd, ... }
 * Appends one NDJSON entry to .claude/eventpulse/evidence/ledger.ndjson
 * with event=SubagentStart. Always exits 0 (fail-open).
 */

import * as fs from "fs";
import * as path from "path";

const EVIDENCE_DIR = path.join(process.cwd(), ".claude", "eventpulse", "evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, "ledger.ndjson");

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
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
    process.stderr.write("[ep-agent-trace] WARN: failed to parse stdin JSON; skipping.\n");
    process.exit(0);
  }

  const agentName: string = payload.agent_name || payload.agent || "unknown-agent";
  const agentRole: string = payload.agent_role || "unspecified";
  const parentMission: string | undefined = payload.parent_mission_id || undefined;

  ensureDir(EVIDENCE_DIR);

  const entry = {
    ts: new Date().toISOString(),
    mission_id: parentMission ?? null,
    agent: agentName,
    role: agentRole,
    tool: "SubagentStart",
    event: "SubagentStart",
    cmd: null,
    exit_code: null,
    working_tree_fp: null,
  };

  try {
    fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", { encoding: "utf8" });
    process.stderr.write(
      `[ep-agent-trace] recorded SubagentStart for ${agentName} (${agentRole})\n`,
    );
  } catch (err) {
    process.stderr.write(`[ep-agent-trace] ERROR (fail-open): ${(err as Error).message}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-agent-trace] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
