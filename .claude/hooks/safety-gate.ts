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

// Vault files that are machine-synced (vault-sync sub-agent protocol, CLAUDE.md).
// These MAY be edited by the main session without a role name: Claude Code's
// real PreToolUse payloads never carry agent_name (verified empirically
// 2026-09-04), so the vault rule's bypassRoles can never fire in production
// and would block legitimate machine-syncs. Allowlist is exhaustive — every
// other vault .md remains vault-sync-only.
const VAULT_MACHINE_SYNC_FILES: string[] = [
  "/01-Projects/EventPulse/00-Core/01-Current-State.md",
  "/01-Projects/EventPulse/00-Core/01-Current-State.proposed.md",
  "/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md",
];

function isVaultMachineSyncFile(p: string): boolean {
  return VAULT_MACHINE_SYNC_FILES.some((f) => p.endsWith(f));
}

const EDIT_RULES: EditRule[] = [
  // 2026-10-09: MASTERPLAN.md and BACKLOG.md rules REMOVED.
  // Rationale (Alt B, see policy.md §1 update): these are strategic docs that
  // the lead-session edits on user's direct request. Hook-based protection
  // cannot distinguish main-session-from-user (Claude Code issue #84926: no
  // agent_type in main-session payload) and the previous `bypassRoles` fix
  // only worked for subagents — main session stayed blocked. The new model:
  // - policy.md: still blocked (Tier 0, no bypassRoles).
  // - MASTERPLAN/BACKLOG: protected at a different layer (user-direction
  //   required; agent refuses autonomous edits via policy.md §1).
  // Hook is no longer the right enforcement point for Tier 1.
  {
    // Tier 0 invariant core: stays locked for every role, including lead.
    // isLead() early-exit below is restricted to Bash to prevent bypassing
    // this rule from a subagent with agent_type=ep-lead (verified 2026-10-09).
    match: (p) => p.endsWith(".claude/eventpulse/policy.md") || /\/eventpulse\/policy\.md$/.test(p),
    reason: ".claude/eventpulse/policy.md is the Tier 0 invariant core — runtime may not mutate.",
  },
  {
    match: (p) => /\/05-Supabase\/migrations\/.*_prod_/.test(p),
    reason: "prod migrations require explicit human approval — runtime blocks by default.",
  },
  {
    // Scoped to actual vault path; previous regex `/^\/Volumes\/.*\/.*\.md$/`
    // over-matched every project .md under /Volumes/. Machine-synced files
    // (VAULT_MACHINE_SYNC_FILES) are excepted — see comment above.
    //
    // Lead/ep-lead are kept in bypassRoles (2026-10-09): the main session has
    // no agent_type in PreToolUse payload (Claude Code issue #84926), so the
    // isLead() early-exit above never fires for it. The per-rule bypassRoles
    // path is the only way for the lead-session (when it spawns a subagent
    // with agent_type=ep-lead) to write vault notes (CLAUDE.md names
    // vault-sync as the role for *automated* sync, not for the lead's own
    // session notes).
    match: (p) => /\/00-Vault\//.test(p) && p.endsWith(".md") && !isVaultMachineSyncFile(p),
    reason: "Obsidian vault files belong to vault-sync role only (machine-synced files excepted).",
    bypassRoles: ["vault-sync", "ep-lead", "lead"] as string[],
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
  // 2026-10-09: read `agent_type` first (the field that actually exists in
  // Claude Code PreToolUse payloads for subagent calls, ≥2.1.69; verified
  // 2026-10-09 with v2.1.96) and fall back to `agent_name` for forward
  // compatibility.
  const agentName: string | undefined = payload.agent_type || payload.agent_name || undefined;
  const cwd: string = payload.cwd || process.cwd();

  // 2026-10-09: isLead early-exit restricted to Bash only. For Edit/Write/
  // MultiEdit, the per-rule bypassRoles path applies (currently the 00-Vault
  // rule for vault-sync/ep-lead/lead). Restricting isLead() to Bash prevents
  // the previous Tier 0 regression where a subagent with agent_type=ep-lead
  // could Edit policy.md (the only Tier 0 path that previously had no
  // bypassRoles) — verified 2026-10-09, was exiting 0 from this branch
  // before reaching the EDIT_RULES loop.
  if (isLead(agentName) && toolName === "Bash") {
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
