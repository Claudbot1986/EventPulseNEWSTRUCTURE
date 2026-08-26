#!/usr/bin/env node
/**
 * safety-gate.ts — PreToolUse hook (Bash, Edit, Write) — plan §12, §17
 *
 * Behavior:
 *   - For non-lead agents: hardcoded blocklist enforced, fail-closed (exit 2).
 *   - For lead agent: logged but allowed.
 *   - Reads JSON on stdin: { tool_name, tool_input, session_id, cwd, agent_name? }
 *   - Writes JSON on stdout when blocking:
 *       { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                              permissionDecision: "deny",
 *                              permissionDecisionReason: "..." } }
 *
 * Blocklist is intentionally minimal and obvious; native `permissions.deny` covers
 * the rest. This hook is defense-in-depth for the case where a non-lead agent
 * somehow bypasses the `permissions` config (e.g. through tool misuse).
 */

import * as fs from 'fs';

// ---- Blocklist patterns ----------------------------------------------------

interface BashRule {
  re: RegExp;
  reason: string;
}

const BASH_RULES: BashRule[] = [
  { re: /\brm\s+-rf\s+(\/|\~|\.\s*$|node_modules\s*$)/, reason: "recursive delete of root, home, cwd, or node_modules" },
  { re: /\bgit\s+push\s+--force\b/, reason: "force-push to remote" },
  { re: /\bgit\s+push\s+-f\b/, reason: "force-push to remote" },
  { re: /\bgit\s+push\s+--no-verify\b/, reason: "push bypassing pre-push hooks" },
  { re: /\bgit\s+filter-branch\b/, reason: "rewrite published history" },
  { re: /:\{[^}]*:\|:&[^}]*\};:/, reason: "fork-bomb pattern" },
  { re: /\bcurl\s+[^|]*\|\s*(sudo\s+)?sh\b/, reason: "pipe-curl-to-shell" },
  { re: /\bcurl\s+[^|]*\|\s*(sudo\s+)?bash\b/, reason: "pipe-curl-to-bash" },
  { re: /\bDROP\s+TABLE\s+(?!IF\s+EXISTS)/i, reason: "DROP TABLE without IF EXISTS" },
  { re: /\bpsql\s+[^&]*production\b/, reason: "psql targeting production database" },
  { re: />\s*~?\/?\.zshrc\b/, reason: "overwrite shell rc file" },
];

interface EditRule {
  match: (path: string) => boolean;
  reason: string;
  bypassRoles?: string[]; // roles allowed to bypass this specific rule (logged only)
}

const EDIT_RULES: EditRule[] = [
  {
    match: (p) => /\/docs\/MASTERPLAN\.md$/.test(p),
    reason: "docs/MASTERPLAN.md is Tier 1 — runtime may not mutate (see plan §17).",
  },
  {
    match: (p) => /\/docs\/BACKLOG\.md$/.test(p),
    reason: "docs/BACKLOG.md is Tier 1 — runtime may not mutate (see plan §17).",
  },
  {
    match: (p) => p.endsWith(".claude/eventpulse/policy.md") || /\/eventpulse\/policy\.md$/.test(p),
    reason: ".claude/eventpulse/policy.md is the Tier 0 invariant core — runtime may not mutate.",
  },
  {
    match: (p) => /\/05-Supabase\/migrations\/.*_prod_/.test(p),
    reason: "prod migrations require explicit human approval — runtime blocks by default.",
  },
  {
    // Scoped to actual vault path; previous regex `/^\/Volumes\/.*\/.*\.md$/`
    // over-matched every project .md under /Volumes/.
    match: (p) => /\/00-Vault\//.test(p) && p.endsWith(".md"),
    reason: "Obsidian vault files belong to vault-sync role only.",
    bypassRoles: ["vault-sync"] as string[],
  },
];

// ---- Helpers ---------------------------------------------------------------

function isLead(agentName?: string): boolean {
  if (!agentName) return false;
  return agentName === "ep-lead" || agentName === "lead";
}

function isBypassedByRule(rule: EditRule, agentName?: string): boolean {
  if (!rule.bypassRoles || !agentName) return false;
  return rule.bypassRoles.includes(agentName);
}

function projectRootFromCwd(cwd: string): string {
  // The runtime is project-scoped. Cwd should already be inside the project.
  return cwd || process.cwd();
}

function normalizeEditPath(raw: string, cwd: string): string {
  if (!raw) return raw;
  if (raw.startsWith("/")) return raw;
  return `${cwd.replace(/\/$/, "")}/${raw}`;
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    // No stdin — nothing to gate.
    process.exit(0);
  }
  if (!raw.trim()) {
    process.exit(0);
  }

  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write(`[ep-safety-gate] WARN: failed to parse stdin JSON; allowing.\n`);
    process.exit(0);
  }

  const toolName: string = payload.tool_name || "";
  const toolInput = payload.tool_input || {};
  const agentName: string | undefined = payload.agent_name || undefined;
  const cwd: string = payload.cwd || process.cwd();

  if (isLead(agentName)) {
    // Lead logs but allows.
    process.stderr.write(
      `[ep-safety-gate] lead agent '${agentName}' tool=${toolName} — bypass active, logged only.\n`,
    );
    process.exit(0);
  }

  // Bash blocklist.
  if (toolName === "Bash") {
    const cmd: string = toolInput.command || toolInput.cmd || "";
    for (const rule of BASH_RULES) {
      if (rule.re.test(cmd)) {
        const reason = `[ep-safety-gate] BLOCKED bash for non-lead agent: ${rule.reason}. cmd=${cmd.slice(0, 200)}`;
        process.stderr.write(reason + "\n");
        const out = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
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

  // Edit|Write|MultiEdit blocklist.
  if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
    const path: string = normalizeEditPath(
      toolInput.file_path || toolInput.path || "",
      projectRootFromCwd(cwd),
    );
    for (const rule of EDIT_RULES) {
      // Narrow, role-scoped bypass: only the role explicitly named in the rule
      // can write these paths. Bypass is logged (not silent) and applies ONLY
      // to this specific rule — other rules still block.
      if (rule.match(path) && isBypassedByRule(rule, agentName)) {
        process.stderr.write(
          `[ep-safety-gate] role '${agentName}' tool=${toolName} — rule bypass (role-scoped) for: ${rule.reason}. path=${path}\n`,
        );
        continue;
      }
      if (rule.match(path)) {
        process.stderr.write(
          `[ep-safety-gate] BLOCKED ${toolName} for non-lead agent: ${rule.reason}. path=${path}\n`,
        );
        const out = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
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

  // Other tools — pass through.
  process.exit(0);
}

main().catch((err) => {
  // Fail-open: enrichment hooks must not block the session.
  process.stderr.write(`[ep-safety-gate] ERROR (fail-open): ${(err as Error).message}\n`);
  process.exit(0);
});
