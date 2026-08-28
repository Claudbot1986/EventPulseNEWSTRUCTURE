#!/usr/bin/env tsx
/**
 * mission-terminal-emitter.ts — Phase L-A terminal-state emitter
 *
 * Reads JSON on stdin (hook payload from TaskCompleted, SubagentStop, or Stop).
 * Computes a structured `terminal_state` for the active mission and appends a
 * `mission.terminal` event to the evidence ledger.
 *
 * Goals (plan §4 + §L1):
 *   - Utöka evidence-recorder med ett explicit terminal-state event (utan att
 *     röra befintliga PostToolUse events).
 *   - Fail-open: inga stdin-payload → exit 0 utan effekt.
 *   - Idempotent: samma (mission_id, terminal_state, ts) skrivs inte två ggr.
 *   - additionalProperties: ledger.schema.json tillåter nya fält redan.
 *
 * Input (stdin):
 *   { tool_name: "TaskCompleted"|"SubagentStop"|"Stop",
 *     session_id?: string,
 *     cwd?: string,
 *     exit_code?: number,
 *     block_reason?: string,
 *     verified?: boolean }
 *
 * Exit codes:
 *   0 = event skrivits ELLER no-op
 *   1 = fatalt fel (sällsynt — fail-open i praktiken)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findMissionBySession } from "../mission-resolver";

const REPO_ROOT_DEFAULT = process.env.EP_REPO_ROOT ?? "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(input: string): string {
  return input.replace(SECRET_RE, (_m, name: string) => `${name}=<REDACTED>`);
}

function activeMissionId(repoRoot: string, sessionId: string | null | undefined): string | null {
  // Phase L-A: explicit session/mission binding (no newest-mtime fallback).
  const ref = findMissionBySession(repoRoot, sessionId);
  return ref?.mission_id ?? null;
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

type TerminalState = "completed" | "failed" | "blocked" | "aborted" | "skipped";

function classifyTerminalState(payload: {
  tool_name?: string;
  exit_code?: number;
  block_reason?: string;
  verified?: boolean;
}): TerminalState {
  const tool = String(payload.tool_name ?? "");
  const verified = payload.verified === true;
  const blockReason = typeof payload.block_reason === "string" ? payload.block_reason : "";
  const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : 0;

  if (tool === "TaskCompleted" && blockReason) return "blocked";
  if (tool === "TaskCompleted" && verified) return "completed";
  if (tool === "TaskCompleted") return "failed";
  if (tool === "SubagentStop") return exitCode === 0 ? "completed" : "failed";
  if (tool === "Stop") return "completed";
  return "skipped";
}

function dedupeKey(repoRoot: string, missionId: string, state: TerminalState, tsMinute: string): string {
  const markerDir = path.join(repoRoot, ".claude", "eventpulse", "evidence");
  ensureDir(markerDir);
  return path.join(markerDir, `.terminal-${missionId}-${state}-${tsMinute}.lock`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolveP) => {
    let buf = "";
    if (process.stdin.isTTY) {
      resolveP("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolveP(buf));
    process.stdin.on("error", () => resolveP(buf));
    setTimeout(() => resolveP(buf), 1000);
  });
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) {
    process.exit(0);
  }

  let payload: {
    tool_name?: string;
    session_id?: string;
    cwd?: string;
    exit_code?: number;
    block_reason?: string;
    verified?: boolean;
  } = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("[mission-terminal-emitter] WARN: failed to parse stdin; allowing.\n");
    process.exit(0);
    return;
  }

  const tool = String(payload.tool_name ?? "");
  if (
    tool !== "TaskCompleted" &&
    tool !== "SubagentStop" &&
    tool !== "Stop"
  ) {
    process.exit(0);
  }

  const repoRoot = payload.cwd ?? REPO_ROOT_DEFAULT;
  const sessionId: string | undefined = typeof payload.session_id === "string" ? payload.session_id : undefined;
  const missionId = activeMissionId(repoRoot, sessionId);
  if (!missionId) {
    process.stderr.write(
      `[mission-terminal-emitter] no mission bound to session_id=${sessionId ?? "unknown"}; allowing (explicit binding required).\n`,
    );
    process.exit(0);
  }

  const terminalState = classifyTerminalState(payload);
  const ts = new Date().toISOString();
  // Per-minute dedupe: samma mission + state inom samma minut = noop
  const tsMinute = ts.slice(0, 16); // YYYY-MM-DDTHH:MM
  const lockPath = dedupeKey(repoRoot, missionId, terminalState, tsMinute);
  if (fs.existsSync(lockPath)) {
    process.stderr.write(
      `[mission-terminal-emitter] dedupe: ${missionId}/${terminalState}/${tsMinute} already emitted.\n`,
    );
    process.exit(0);
  }

  const entry: Record<string, unknown> = {
    ts,
    event: "mission.terminal",
    mission_id: missionId,
    terminal_state: terminalState,
    tool_name: tool,
    session_id: sessionId ?? null,
    block_reason: redactSecrets(String(payload.block_reason ?? "")),
    verified: payload.verified === true,
    exit_code: typeof payload.exit_code === "number" ? payload.exit_code : null,
  };

  const ledgerPath = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  ensureDir(path.dirname(ledgerPath));
  try {
    fs.appendFileSync(ledgerPath, JSON.stringify(entry) + "\n", "utf8");
    fs.writeFileSync(lockPath, ts, "utf8");
    process.stderr.write(
      `[mission-terminal-emitter] emitted mission.terminal mission=${missionId} state=${terminalState}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[mission-terminal-emitter] ERROR (fail-open): ${(err as Error).message}\n`,
    );
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mission-terminal-emitter] ERROR (fail-open): ${msg}\n`);
  process.exit(0);
});