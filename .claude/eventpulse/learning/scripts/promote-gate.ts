#!/usr/bin/env tsx
/**
 * promote-gate.ts — Promotion gate utilities (Phase L-C + K3 §15)
 *
 * Per master-prompt §44 + K3: auto-promote är OMÖJLIGT. Optimeraren kan
 * ALDRIG sätta status `accepted` eller `implemented`. Endast explicit
 * human-action via detta CLI kan göra det.
 *
 * Användning:
 *   npx tsx promote-gate.ts --list
 *   npx tsx promote-gate.ts --opt-id OPT-2026-08-26-001 --action accept|reject|implement
 *
 * Skydd:
 *   - Forbidden topics blockerar ALL promote (även av human)
 *   - Audit log till evidence-ledger
 *   - Idempotent (skippa om status redan satt)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

const FORBIDDEN_TOPICS = [
  "north_star",
  "authority_hierarchy",
  "safety_policy",
  "completion_gate",
  "braid_enablement",
  "agent_permissions",
  "mission_compiler_policy",
  "routing_thresholds",
  "verification_requirements",
];

function proposalsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "proposals");
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function appendEvent(repoRoot: string, event: Record<string, unknown>): void {
  const ledgerPath = path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
  ensureDir(path.dirname(ledgerPath));
  fs.appendFileSync(ledgerPath, JSON.stringify({ ...event, ts: new Date().toISOString() }) + "\n", "utf8");
}

function isForbidden(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_TOPICS.some((topic) => lower.includes(topic.replace(/_/g, " ")));
}

function findProposal(repoRoot: string, optId: string): { path: string; content: string } | null {
  const dir = proposalsDir(repoRoot);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(optId) && f.endsWith(".md"));
  if (files.length === 0) return null;
  const full = path.join(dir, files[0]);
  return { path: full, content: fs.readFileSync(full, "utf8") };
}

function updateStatusFrontmatter(content: string, newStatus: string): string {
  // Update the `- status: <...>` line
  return content.replace(/^(- status:\s*)(proposed|auto_testable|human_review_pending|accepted|rejected|implemented)/m, `$1${newStatus}`);
}

export interface PromoteResult {
  ok: boolean;
  reason: string;
  blocked?: boolean;
  new_status?: string;
}

export function applyPromoteAction(
  repoRoot: string,
  optId: string,
  action: "accept" | "reject" | "implement" | "mark_auto_testable" | "mark_human_review_pending",
): PromoteResult {
  const proposal = findProposal(repoRoot, optId);
  if (!proposal) {
    return { ok: false, reason: `proposal not found: ${optId}` };
  }

  if (isForbidden(proposal.content)) {
    appendEvent(repoRoot, { event: "promote_blocked", opt_id: optId, action, reason: "forbidden_topic" });
    return { ok: false, reason: "forbidden topic detected", blocked: true };
  }

  const statusMap: Record<string, string> = {
    accept: "accepted",
    reject: "rejected",
    implement: "implemented",
    mark_auto_testable: "auto_testable",
    mark_human_review_pending: "human_review_pending",
  };
  const newStatus = statusMap[action];

  // Idempotens: skippa om status redan matchar
  if (proposal.content.includes(`- status: ${newStatus}`)) {
    return { ok: true, reason: "already in target status (idempotent)", new_status: newStatus };
  }

  const updated = updateStatusFrontmatter(proposal.content, newStatus);
  fs.writeFileSync(proposal.path, updated, "utf8");

  appendEvent(repoRoot, { event: "promote_action", opt_id: optId, action, new_status: newStatus });

  return { ok: true, reason: `status updated to ${newStatus}`, new_status: newStatus };
}

function parseArgs(argv: string[]): { optId: string | null; action: string | null; list: boolean } {
  let optId: string | null = null;
  let action: string | null = null;
  let list = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--opt-id") optId = argv[++i] ?? null;
    else if (argv[i] === "--action") action = argv[++i] ?? null;
    else if (argv[i] === "--list") list = true;
  }
  return { optId, action, list };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  if (args.list) {
    const dir = proposalsDir(repoRoot);
    if (!fs.existsSync(dir)) {
      console.log("(no proposals)");
      process.exit(0);
    }
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const content = fs.readFileSync(path.join(dir, f), "utf8");
      const status = content.match(/^- status:\s*(.+)$/m)?.[1]?.trim() ?? "?";
      const title = content.match(/^# (.+)$/m)?.[1]?.trim() ?? f;
      console.log(`${f} | status=${status} | ${title}`);
    }
    process.exit(0);
  }
  if (!args.optId || !args.action) {
    process.stderr.write("[promote-gate] usage: --opt-id <id> --action <accept|reject|implement|mark_auto_testable|mark_human_review_pending> | --list\n");
    process.exit(1);
  }
  const validActions = ["accept", "reject", "implement", "mark_auto_testable", "mark_human_review_pending"] as const;
  if (!validActions.includes(args.action as any)) {
    process.stderr.write(`[promote-gate] invalid action: ${args.action}\n`);
    process.exit(1);
  }
  const result = applyPromoteAction(repoRoot, args.optId, args.action as any);
  process.stderr.write(`[promote-gate] ok=${result.ok} reason=${result.reason} status=${result.new_status ?? "unchanged"}\n`);
  process.exit(result.ok ? 0 : 1);
}

// Only invoke main() when run directly (not when imported as a module).
import { fileURLToPath } from "node:url";
const isMain = (() => {
  try {
    if (typeof import.meta.url !== "string" || typeof process.argv[1] !== "string") return false;
    const scriptPath = fileURLToPath(import.meta.url);
    const argvPath = process.argv[1];
    const argvReal = fs.existsSync(argvPath) ? fs.realpathSync(argvPath) : argvPath;
    const scriptReal = fs.existsSync(scriptPath) ? fs.realpathSync(scriptPath) : scriptPath;
    return argvReal === scriptReal;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[promote-gate] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}