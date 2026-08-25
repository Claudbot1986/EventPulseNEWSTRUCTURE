#!/usr/bin/env node
/**
 * evidence-recorder.ts — PostToolUse hook (Bash) — plan §12, §14
 *
 * Reads JSON on stdin: { tool_name, tool_input, tool_response, session_id, cwd, agent_name? }
 * Appends one NDJSON line to .claude/eventpulse/evidence/ledger.ndjson (gitignored).
 * Always exits 0 (fail-open). Redacts secrets before writing.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const EVIDENCE_DIR = path.join(process.cwd(), ".claude", "eventpulse", "evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, "ledger.ndjson");

const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(input: string): string {
  return input.replace(SECRET_RE, (_m, name: string) => `${name}=<REDACTED>`);
}

function workingTreeFingerprint(repoRoot: string): string {
  try {
    const out = execSync(
      "git ls-files | sort | xargs cat 2>/dev/null | shasum -a 256 | awk '{print $1}'",
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return `sha256:${out.trim().slice(0, 32)}`;
  } catch {
    return "sha256:unavailable";
  }
}

function activeMissionIdFromMirror(repoRoot: string): string | null {
  try {
    const missionsDir = path.join(repoRoot, ".claude", "eventpulse", "missions");
    const files = fs
      .readdirSync(missionsDir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => ({ f, m: fs.statSync(path.join(missionsDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length === 0) return null;
    return files[0].f.replace(/\.yaml$/, "");
  } catch {
    return null;
  }
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

async function main(): Promise<void> {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  if (!raw.trim()) {
    process.exit(0);
  }

  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("[ep-evidence-recorder] WARN: failed to parse stdin JSON; skipping.\n");
    process.exit(0);
  }

  const toolName: string = payload.tool_name || "";
  const toolInput = payload.tool_input || {};
  const toolResponse = payload.tool_response || {};
  const agentName: string | undefined = payload.agent_name || undefined;
  const cwd: string = payload.cwd || process.cwd();

  // Only record Bash for now (Edit/Write get logged via task-ledger in Phase 7).
  if (toolName !== "Bash") {
    process.exit(0);
  }

  const cmd: string = redactSecrets(String(toolInput.command || toolInput.cmd || ""));
  const exitCode: number =
    typeof toolResponse.exit_code === "number"
      ? toolResponse.exit_code
      : typeof toolResponse.exitCode === "number"
        ? toolResponse.exitCode
        : 0;

  ensureDir(EVIDENCE_DIR);

  const entry = {
    ts: new Date().toISOString(),
    mission_id: activeMissionIdFromMirror(cwd),
    agent: agentName ?? null,
    tool: "Bash",
    event: "PostToolUse",
    cmd: cmd.slice(0, 500),
    exit_code: exitCode,
    working_tree_fp: workingTreeFingerprint(cwd),
    duration_ms:
      typeof toolResponse.duration_ms === "number" ? toolResponse.duration_ms : null,
  };

  try {
    fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", { encoding: "utf8" });
  } catch (err) {
    process.stderr.write(`[ep-evidence-recorder] ERROR (fail-open): ${(err as Error).message}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-evidence-recorder] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
