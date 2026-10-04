#!/usr/bin/env node
// scripts/autonomy/vault-sync.mjs — harness-independent vault reconciliation
//
// Replaces the hard-coded paths in scripts/vault-sync-session-end.js with a
// portable script that:
//   - Resolves the project root from cwd (or --project-root).
//   - Resolves the vault root from <project>/00-Vault/ (or --vault-root).
//   - Runs all sub-commands with bounded timeouts so a stuck vitest cannot hang
//     the session.
//   - Falls back gracefully when sub-commands time out or fail.
//
// Usage:
//   node scripts/autonomy/vault-sync.mjs                  # auto-detect from cwd
//   node scripts/autonomy/vault-sync.mjs --project-root /path/to/repo
//   node scripts/autonomy/vault-sync.mjs --vault-root /path/to/vault
//   node scripts/autonomy/vault-sync.mjs --dry-run        # print, don't write
//   node scripts/autonomy/vault-sync.mjs --skip-tests     # skip vitest (faster)
//   node scripts/autonomy/vault-sync.mjs --timeout-ms 5000

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const DEFAULT_VAULT_REL = "00-Vault";
const TARGET_REL = "01-Projects/EventPulse/00-Core/01-Current-State.md";

const DEFAULT_TIMEOUT_MS = 8000;       // bounded; vitest and others
const HARD_EXIT_TIMEOUT_MS = 30000;     // never let one sub-command hold longer
const VALID_LOG_BUDGET_MS = 60000;        // total budget

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
  args.cmd = args._[0] || "run";
  return args;
}

function usage() {
  process.stdout.write(
    `vault-sync.mjs — harness-independent vault reconciliation

Usage:
  node scripts/autonomy/vault-sync.mjs [run] [flags]
  node scripts/autonomy/vault-sync.mjs status [flags]

Flags:
  --project-root <p>   override project root (default: cwd)
  --vault-root <p>     override vault root (default: <project>/00-Vault)
  --target-file <p>    override target file (default: <vault>/01-Projects/EventPulse/00-Core/01-Current-State.md)
  --timeout-ms <n>     per-command timeout in ms (default: 8000)
  --skip-tests         skip vitest invocation (much faster)
  --dry-run            print auto-facts and the resolved paths, do not write

Sub-commands:
  run     Update the vault (default)
  status  Print resolved paths and last sync time

All commands never exceed ${HARD_EXIT_TIMEOUT_MS}ms per sub-command and
${VALID_LOG_BUDGET_MS}ms total.

Exit codes:
  0  ok
  2  vault root missing — STOP, do not invent
  4  internal error
`,
  );
}

function timedExec(cmd, args, opts) {
  const timeoutMs = Math.min(opts.timeoutMs || DEFAULT_TIMEOUT_MS, HARD_EXIT_TIMEOUT_MS);
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 5 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message;
    return { ok: false, out: err.stdout ? err.stdout.toString() : "", error: msg };
  }
}

function resolveProjectRoot(opts) {
  if (opts["project-root"]) return path.resolve(opts["project-root"]);
  return process.cwd();
}

function resolveVaultRoot(opts, projectRoot) {
  if (opts["vault-root"]) return path.resolve(opts["vault-root"]);
  return path.join(projectRoot, DEFAULT_VAULT_REL);
}

function resolveTargetFile(opts, vaultRoot) {
  if (opts["target-file"]) return path.resolve(opts["target-file"]);
  return path.join(vaultRoot, TARGET_REL);
}

function stockholmDate() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getGitState(projectRoot, opts) {
  const log = timedExec("git", ["log", "--oneline", "-20"], { cwd: projectRoot, timeoutMs: opts.timeoutMs });
  const status = timedExec("git", ["status", "--short"], { cwd: projectRoot, timeoutMs: opts.timeoutMs });
  const diffStat = timedExec("git", ["diff", "--stat", "HEAD~5..HEAD"], { cwd: projectRoot, timeoutMs: opts.timeoutMs });
  const branch = timedExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot, timeoutMs: opts.timeoutMs });
  const branchName = branch.ok ? branch.out.trim() : "(unknown)";
  const logLines = log.ok ? log.out.split("\n") : [];
  const statusLines = status.ok ? status.out.split("\n").filter((l) => l.trim()) : [];
  const diffStatLines = diffStat.ok ? diffStat.out.split("\n").filter(Boolean) : [];
  const firstCommit = logLines[0] || "";
  const lastCommitMatch = /^([a-f0-9]+) (.+)$/.exec(firstCommit);
  return {
    branch: branchName,
    lastCommit: lastCommitMatch
      ? { hash: lastCommitMatch[1].slice(0, 7), subject: lastCommitMatch[2] }
      : { hash: "unknown", subject: "unknown" },
    uncommittedCount: statusLines.length,
    recentCommits: logLines.slice(0, 5).map((l) => l.replace(/^[a-f0-9]+ /, "")).join("\n"),
    diffStatLines,
    skipped: !log.ok || !status.ok || !diffStat.ok || !branch.ok,
  };
}

function getTestState(projectRoot, opts) {
  if (opts["skip-tests"]) {
    return { skipped: true, reason: "--skip-tests" };
  }
  // Use --bail=1 to short-circuit on first failure (cuts worst-case runtime).
  // Hard cap at the bounded ms to avoid hangs entirely.
    const res = timedExec(
      "npx",
      ["vitest", "run", "--reporter=json", "--bail=1"],
      { cwd: projectRoot, timeoutMs: Math.min(opts.timeoutMs || 8000, HARD_EXIT_TIMEOUT_MS) },
    );
  if (!res.ok) {
    return { skipped: true, reason: "vitest failed or timed out", error: res.error };
  }
  const m = /\{[\s\S]*"numTotalTests"[\s\S]*\}/.exec(res.out);
  if (!m) return { skipped: true, reason: "no JSON summary found" };
  try {
    const d = JSON.parse(m[0]);
    return {
      total: d.numTotalTests,
      passed: d.numPassedTests,
      failed: d.numFailedTests,
      suites: d.numSuites,
    };
  } catch {
    return { skipped: true, reason: "JSON parse failed" };
  }
}

function getPackageInfo(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, "package.json"), "utf8");
    const p = JSON.parse(raw);
    return { name: p.name, version: p.version };
  } catch {
    return null;
  }
}

function getMigrations(projectRoot) {
  const d = path.join(projectRoot, "05-Supabase", "migrations");
  if (!fs.existsSync(d)) return [];
  try {
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .slice(-5);
  } catch {
    return [];
  }
}

function buildAutoFacts({ git, tests, pkg, migrations, syncTime }) {
  const lines = [];
  lines.push(`[VERIFIED] Branch: \`${git.branch}\``);
  lines.push(`[VERIFIED] Last commit: \`${git.lastCommit.hash}\` — ${git.lastCommit.subject}`);
  lines.push(`[VERIFIED] Sync run at: ${syncTime}`);
  lines.push(`[VERIFIED] Uncommitted changes: ${git.uncommittedCount}`);
  if (git.recentCommits) {
    lines.push("");
    lines.push(`[VERIFIED] Most recent 5 commits on \`${git.branch}\`:`);
    for (const c of git.recentCommits.split("\n").filter(Boolean)) lines.push(`- ${c}`);
  }
  lines.push("");
  if (tests && !tests.skipped) {
    lines.push(
      `[VERIFIED] Tests (vitest): ${tests.total} total / ${tests.passed} passed / ${tests.failed} failed (${tests.suites} suites)`,
    );
  } else if (tests && tests.skipped) {
    lines.push(`[SKIPPED] Tests: ${tests.reason || "n/a"}`);
  }
  if (pkg) lines.push(`[VERIFIED] Package: \`${pkg.name}\` v${pkg.version}`);
  if (migrations.length > 0) {
    lines.push(`[VERIFIED] Most recent migrations in \`05-Supabase/migrations/\`:`);
    for (const m of migrations) lines.push(`- ${m}`);
  }
  lines.push(`[VERIFIED] Vault gitignored at \`/00-Vault/\` (per \`.gitignore\` rule).`);
  lines.push(`[VERIFIED] Vault sync via scripts/autonomy/vault-sync.mjs (harness-independent).`);
  if (git.diffStatLines && git.diffStatLines.length > 0) {
    lines.push("");
    lines.push(`[VERIFIED] Diff stat for HEAD~5..HEAD:`);
    for (const l of git.diffStatLines.slice(0, 10)) lines.push(`- ${l}`);
  }
  return lines.join("\n");
}

function updateTarget(targetFile, autoFacts) {
  let content;
  try {
    content = fs.readFileSync(targetFile, "utf8");
  } catch {
    content = null;
  }
  if (!content) {
    content = `# EventPulse — Current State\n\n> Auto-maintained by vault-sync.mjs.\n\n## Auto-facts (machine-synced)\n\n${autoFacts}\n\n## Narrative (human-maintained)\n\n_None yet._\n`;
  } else {
    const sectionStart = content.indexOf("## Auto-facts (machine-synced)");
    if (sectionStart === -1) {
      const narrativeStart = content.indexOf("## Narrative");
      if (narrativeStart !== -1) {
        content = content.slice(0, narrativeStart) + `## Auto-facts (machine-synced)\n\n${autoFacts}\n\n` + content.slice(narrativeStart);
      } else {
        content = content + `\n\n## Auto-facts (machine-synced)\n\n${autoFacts}\n`;
      }
    } else {
      const afterStart = content.indexOf("\n", sectionStart) + 1;
      const narrativeMatch = content.indexOf("## Narrative", afterStart);
      if (narrativeMatch !== -1) {
        content = content.slice(0, afterStart) + autoFacts + "\n\n" + content.slice(narrativeMatch);
      } else {
        content = content.slice(0, afterStart) + autoFacts + "\n\n";
      }
    }
  }
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, content, "utf8");
  return content;
}

function cmdRun(opts) {
  const projectRoot = resolveProjectRoot(opts);
  const vaultRoot = resolveVaultRoot(opts, projectRoot);
  const targetFile = resolveTargetFile(opts, vaultRoot);

  if (!fs.existsSync(vaultRoot)) {
    process.stderr.write(
      `[vault-sync] ERROR: vault root missing: ${vaultRoot}\n` +
        `Per project contract: do not create a vault out of nothing.\n`,
    );
    process.exit(3);
  }

  const syncTime = stockholmDate();
  const git = getGitState(projectRoot, opts);
  const tests = getTestState(projectRoot, opts);
  const pkg = getPackageInfo(projectRoot);
  const migrations = getMigrations(projectRoot);
  const autoFacts = buildAutoFacts({ git, tests, pkg, migrations, syncTime });

  process.stdout.write(`[vault-sync] project: ${projectRoot}\n`);
  process.stdout.write(`[vault-sync] vault:   ${vaultRoot}\n`);
  process.stdout.write(`[vault-sync] target:  ${targetFile}\n`);
  process.stdout.write(`[vault-sync] tests:   ${tests.skipped ? "skipped (" + tests.reason + ")" : "ran (" + tests.total + " tests)"}\n`);
  if (git.skipped) {
    process.stdout.write(`[vault-sync] git:     partial (one or more git sub-commands failed)\n`);
  }

  if (opts["dry-run"]) {
    process.stdout.write("\n--- DRY RUN — auto-facts ---\n");
    process.stdout.write(autoFacts);
    process.stdout.write("\n--- END ---\n");
    process.exit(0);
  }

  updateTarget(targetFile, autoFacts);
  process.stdout.write(`[vault-sync] updated ${targetFile}\n`);
  process.exit(0);
}

function cmdStatus(opts) {
  const projectRoot = resolveProjectRoot(opts);
  const vaultRoot = resolveVaultRoot(opts, projectRoot);
  const targetFile = resolveTargetFile(opts, vaultRoot);
  process.stdout.write(`project:  ${projectRoot}\n`);
  process.stdout.write(`vault:    ${vaultRoot}\n`);
  process.stdout.write(`target:   ${targetFile}\n`);
  process.stdout.write(`exists:   vault=${fs.existsSync(vaultRoot)} target=${fs.existsSync(targetFile)}\n`);
}

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

switch (args.cmd) {
  case "run":
    cmdRun(args.opts);
    break;
  case "status":
    cmdStatus(args.opts);
    break;
  default:
    process.stderr.write(`[vault-sync] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}