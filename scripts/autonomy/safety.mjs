#!/usr/bin/env node
// scripts/autonomy/safety.mjs — harness-independent safety blocklist
//
// Mirrors .claude/hooks/safety-gate.ts so the same protective rules apply
// even when Claude Code hooks are not in effect (e.g. MiniMax Code TUI).
//
// Usage:
//   safety.mjs check-bash <command>     # exit 0 if allowed, exit 2 if blocked
//   safety.mjs check-edit <path>        # exit 0 if allowed, exit 2 if blocked
//   safety.mjs list                      # print all rules with reasons
//   safety.mjs --help

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BASH_RULES = [
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
  { re: /\bnpx\s+expo\s+publish\b/, reason: "expo publish overrides release pipeline" },
  // npm install outside an explicit manifest change: agent should never add deps
  // without human approval. Bare 'npm install' / 'npx install' is allowed (resolves
  // lockfile); installing new packages is the manifest-level concern handled by
  // package.json edits and human approval flow.
];

const VAULT_MACHINE_SYNC_FILES = [
  "/01-Projects/EventPulse/00-Core/01-Current-State.md",
  "/01-Projects/EventPulse/00-Core/01-Current-State.proposed.md",
  "/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md",
];

function isVaultMachineSyncFile(p) {
  return VAULT_MACHINE_SYNC_FILES.some((f) => p.endsWith(f));
}

const EDIT_RULES = [
  { match: (p) => /\/docs\/MASTERPLAN\.md$/.test(p), reason: "docs/MASTERPLAN.md is Tier 1 — runtime may not mutate." },
  { match: (p) => /\/docs\/BACKLOG\.md$/.test(p), reason: "docs/BACKLOG.md is Tier 1 — runtime may not mutate." },
  { match: (p) => /\/eventpulse\/policy\.md$/.test(p), reason: ".claude/eventpulse/policy.md is the Tier 0 invariant core — runtime may not mutate." },
  { match: (p) => /\/05-Supabase\/migrations\/.*_prod_/.test(p), reason: "prod migrations require explicit human approval — runtime blocks by default." },
  { match: (p) => /\/00-Vault\//.test(p) && p.endsWith(".md") && !isVaultMachineSyncFile(p), reason: "Obsidian vault files belong to vault-sync role only (machine-synced files excepted)." },
];

function parseArgs(argv) {
  const args = { _: [], opts: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args.opts[key] = true;
      } else {
        args.opts[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  args.cmd = args._[0];
  return args;
}

function usage() {
  process.stdout.write(
    `safety.mjs — blocklist for dangerous bash + edit patterns

Commands:
  check-bash <cmd>    Validate a shell command. Exit 0 if safe, exit 2 if blocked.
  check-edit <path>   Validate a file write path. Exit 0 if safe, exit 2 if blocked.
  list                Print all rules with reasons.

This script mirrors .claude/hooks/safety-gate.ts so the same protections apply
when Claude Code hooks are not in effect (e.g. MiniMax Code TUI / headless).

Exit codes:
  0  allowed
  2  blocked — see stderr for the matched rule
  3  internal error
`,
  );
}

function normalizeEditPath(raw) {
  if (!raw) return raw;
  if (raw.startsWith("/")) return raw;
  return `${REPO_ROOT.replace(/\/$/, "")}/${raw}`;
}

function cmdCheckBash(parts) {
  // parts is everything after "check-bash" on the argv
  const cmd = parts.join(" ").trim();
  if (!cmd) {
    process.stderr.write("[safety] check-bash requires a command\n");
    process.exit(3);
  }
  for (const rule of BASH_RULES) {
    if (rule.re.test(cmd)) {
      process.stderr.write(`[safety] BLOCKED: ${rule.reason}\n  cmd: ${cmd.slice(0, 200)}\n`);
      process.exit(2);
    }
  }
  process.stdout.write(`[safety] allowed: ${cmd.slice(0, 120)}\n`);
}

function cmdCheckEdit(parts) {
  const p = normalizeEditPath(parts.join(" ").trim());
  if (!p) {
    process.stderr.write("[safety] check-edit requires a path\n");
    process.exit(3);
  }
  for (const rule of EDIT_RULES) {
    if (rule.match(p)) {
      process.stderr.write(`[safety] BLOCKED: ${rule.reason}\n  path: ${p}\n`);
      process.exit(2);
    }
  }
  process.stdout.write(`[safety] allowed: ${p}\n`);
}

function cmdList() {
  process.stdout.write("=== Bash rules ===\n");
  for (const r of BASH_RULES) {
    process.stdout.write(`  ${r.re.toString()}  →  ${r.reason}\n`);
  }
  process.stdout.write("\n=== Edit rules ===\n");
  for (const r of EDIT_RULES) {
    process.stdout.write(`  ${r.reason}\n`);
  }
  process.stdout.write("\nVault machine-sync excepted files:\n");
  for (const f of VAULT_MACHINE_SYNC_FILES) {
    process.stdout.write(`  ${f}\n`);
  }
}

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

// For check-bash and check-edit, the rest of argv is the value to check.
const rest = process.argv.slice(3);

switch (args.cmd) {
  case "check-bash":
    cmdCheckBash(rest);
    break;
  case "check-edit":
    cmdCheckEdit(rest);
    break;
  case "list":
    cmdList();
    break;
  default:
    process.stderr.write(`[safety] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}
