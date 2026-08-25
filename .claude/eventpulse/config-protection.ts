#!/usr/bin/env node
/**
 * config-protection.ts — ConfigChange hook — plan §12
 *
 * Reads JSON on stdin: { tool_name, tool_input?, session_id, cwd, hook_event_name, origin? }
 * Refuses runtime config changes (settings.json, agents/*.md, .claude/eventpulse/policy.md,
 * runtime hook scripts) from non-lead origins. Always exits 0 for benign config changes.
 */

import * as fs from "fs";

const PROTECTED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\/settings\.json$/, reason: "~/.claude/settings.json is the runtime config — only lead may modify." },
  { re: /\/agents\/.*\.md$/, reason: "Agent role files are runtime config — only lead may modify." },
  { re: /\/eventpulse\/policy\.md$/, reason: ".claude/eventpulse/policy.md is the Tier 0 invariant core." },
  {
    re: /\/eventpulse\/(safety-gate|router|verify-completion|evidence-recorder|state-snap|handoff-writer|agent-trace|confirm-stop|config-protection)\.ts$/,
    reason: "Runtime hook script — only lead may modify.",
  },
];

function isLeadOrigin(payload: any): boolean {
  const origin = String(
    payload.origin || payload.agent_name || payload.tool_input?.origin || "",
  );
  return origin === "ep-lead" || origin === "lead" || origin === "user";
}

function pathFromPayload(payload: any): string {
  return String(
    payload.tool_input?.file_path ||
      payload.tool_input?.path ||
      payload.new_path ||
      payload.path ||
      "",
  );
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
    process.stderr.write("[ep-config-protection] WARN: failed to parse stdin JSON; allowing.\n");
    process.exit(0);
  }

  const hookEvent = payload.hook_event_name || "";
  if (hookEvent !== "ConfigChange") {
    process.exit(0);
  }

  const p = pathFromPayload(payload);
  if (!p) {
    process.exit(0);
  }

  if (isLeadOrigin(payload)) {
    process.stderr.write(`[ep-config-protection] lead-origin change to ${p} — allowed.\n`);
    process.exit(0);
  }

  for (const rule of PROTECTED_PATTERNS) {
    if (rule.re.test(p)) {
      const reason = `[ep-config-protection] BLOCKED: ${rule.reason} path=${p}`;
      process.stderr.write(reason + "\n");
      const out = {
        hookSpecificOutput: {
          hookEventName: "ConfigChange",
          permissionDecision: "deny",
          permissionDecisionReason: rule.reason,
        },
      };
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(2);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[ep-config-protection] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
