#!/usr/bin/env node
/**
 * confirm-stop.ts — Stop hook — plan §12
 *
 * Reads JSON on stdin: { tool_name, session_id, cwd, hook_event_name, ... }
 * Soft "are we sure?" — only blocks when the latest mission's
 * `execution_mode ∈ {architectural_review, lead_plus_specialists}` and
 * `human_review_required: true`. Otherwise fail-open (exit 0).
 */

import * as fs from "fs";
import * as path from "path";
import { findMissionBySession } from "./mission-resolver";

const STRICT_MODES = new Set(["architectural_review", "lead_plus_specialists"]);

function missionForSession(repoRoot: string, sessionId: string | null | undefined): { id: string; text: string } | null {
  // Phase L-A: explicit session/mission binding.
  const ref = findMissionBySession(repoRoot, sessionId);
  if (!ref) return null;
  return { id: ref.mission_id, text: ref.text };
}

function grepField(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
  const m = re.exec(text);
  return m ? m[1].trim() : null;
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
    process.stderr.write("[ep-confirm-stop] WARN: failed to parse stdin JSON; allowing.\n");
    process.exit(0);
  }

  if (payload.hook_event_name !== "Stop" && payload.tool_name !== "Stop") {
    process.exit(0);
  }

  const cwd: string = payload.cwd || process.cwd();
  const sessionId: string | undefined = typeof payload.session_id === "string" ? payload.session_id : undefined;
  const mission = missionForSession(cwd, sessionId);
  if (!mission) {
    process.stderr.write(
      `[ep-confirm-stop] no mission bound to session_id=${sessionId ?? "unknown"}; allowing stop (explicit binding required).\n`,
    );
    process.exit(0);
  }

  const executionMode = grepField(mission.text, "execution_mode");
  const humanReview = grepField(mission.text, "human_review_required") === "true";

  if (executionMode && STRICT_MODES.has(executionMode) && humanReview) {
    const reason = `[ep-confirm-stop] BLOCKED stop: mission ${mission.id} is ${executionMode} with human_review_required=true. Confirm with user before stopping.`;
    process.stderr.write(reason + "\n");
    const out = {
      hookSpecificOutput: {
        hookEventName: "Stop",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(2);
  }

  process.stderr.write(
    `[ep-confirm-stop] allowing stop (mission=${mission.id}, mode=${executionMode ?? "?"})\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-confirm-stop] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
