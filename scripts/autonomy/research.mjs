#!/usr/bin/env node
// scripts/autonomy/research.mjs — research tracking + audit
//
// Logs research findings with the mandatory Finding → Source → Implication →
// Decision → Applied-In structure. The audit command refuses to pass if
// any finding lacks a Decision or Applied-In value.
//
// Storage: runtime/autonomy/research.log (NDJSON, one row per add / youtube).
//
// Usage:
//   research.mjs add   --task-id <id> --source <web|github|official-docs|youtube-learner|exa>
//                      --finding "..." --implication "..." --decision "..."
//                      --applied-in "..." [--url "https://..."]
//   research.mjs youtube --task-id <id> --url <url> --rationale "..."
//   research.mjs audit  --task-id <id>      # exit 0 if all findings have Decision + Applied-In
//   research.mjs list   --task-id <id>      # pretty-print findings
//   research.mjs --help

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOG_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const LOG_PATH = path.join(LOG_DIR, "research.log");

const SOURCES = new Set(["web", "github", "official-docs", "youtube-learner", "exa"]);
const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;
const PLACEHOLDER_VALUES = new Set([
  "(none yet)",
  "(to be defined)",
  "(none)",
  "(TBD)",
  "(see scripts/autonomy/research.mjs)",
  "(see workflow.mjs start-improve)",
  "—",
  "tbd",
  "todo",
  "",
  "-",
  "n/a",
]);

function redactSecrets(input) {
  return String(input).replace(SECRET_RE, (_m, name) => `${name}=<REDACTED>`);
}

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
    `research.mjs — research tracking + audit

Storage: runtime/autonomy/research.log (NDJSON)

Commands:
  add       Append a research finding with Finding/Implication/Decision/Applied-In.
  youtube   Append a Youtube-learner call (counted as a finding after analysis).
  audit     Validate that each finding has Decision + Applied-In (exit 0/2).
  list      Pretty-print findings for a task.

add flags:
  --task-id <id>      required
  --source <s>        required (web | github | official-docs | youtube-learner | exa)
  --finding <text>    required
  --implication <text> required
  --decision <text>   required (or "- none" + --applied-in "" to explicitly mark no decision)
  --applied-in <text> required (or "- none" if the research informed but did not change code)
  --url <url>         optional

youtube flags:
  --task-id <id>      required
  --url <url>         required
  --rationale <text>  required (which factors from §7.1 made you choose Youtube-Learner)

Exit codes:
  0  success / audit pass
  2  validation failure / audit blocked
  3  not found
`,
  );
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendLog(entry) {
  ensureDir(LOG_DIR);
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", { encoding: "utf8" });
}

function validateTaskId(taskId) {
  if (!taskId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(taskId)) {
    process.stderr.write(`[research] invalid --task-id: ${taskId}\n`);
    process.exit(2);
  }
}

function isMeaningful(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (PLACEHOLDER_VALUES.has(s.toLowerCase())) return false;
  return s.length > 0;
}

function cmdAdd(opts) {
  const taskId = opts["task-id"];
  const source = opts.source;
  validateTaskId(taskId);

  const required = {
    "--source": source,
    "--finding": opts.finding,
    "--implication": opts.implication,
    "--decision": opts.decision,
    "--applied-in": opts["applied-in"],
  };
  for (const [flag, val] of Object.entries(required)) {
    if (!isMeaningful(val)) {
      process.stderr.write(`[research] add requires ${flag}\n`);
      process.exit(2);
    }
  }
  if (!SOURCES.has(source)) {
    process.stderr.write(`[research] --source must be one of: ${[...SOURCES].join(", ")}\n`);
    process.exit(2);
  }

  const entry = {
    ts: nowIso(),
    kind: "finding",
    task_id: taskId,
    source,
    finding: redactSecrets(opts.finding).slice(0, 2000),
    implication: redactSecrets(opts.implication).slice(0, 2000),
    decision: redactSecrets(opts.decision).slice(0, 1000),
    applied_in: redactSecrets(opts["applied-in"]).slice(0, 500),
    url: opts.url ? redactSecrets(opts.url) : null,
  };
  appendLog(entry);
  process.stdout.write(`[research] appended finding for task=${taskId} (source=${source})\n`);
}

function cmdYoutube(opts) {
  const taskId = opts["task-id"];
  const url = opts.url;
  const rationale = opts.rationale;
  validateTaskId(taskId);
  if (!url || !rationale) {
    process.stderr.write(`[research] youtube requires --url and --rationale\n`);
    process.exit(2);
  }
  const entry = {
    ts: nowIso(),
    kind: "youtube-call",
    task_id: taskId,
    source: "youtube-learner",
    url: redactSecrets(url),
    rationale: redactSecrets(rationale).slice(0, 500),
    // youtube-call alone is NOT evidence for the research gate —
    // it becomes a finding only after the slutsats is reviewed and
    // --applied-in is filled by a subsequent add command.
    finding: null,
    implication: null,
    decision: null,
    applied_in: null,
  };
  appendLog(entry);
  process.stdout.write(`[research] appended youtube-call for task=${taskId}\n`);
}

function cmdAudit(opts) {
  const taskId = opts["task-id"];
  validateTaskId(taskId);
  const all = readLog().filter((e) => e.task_id === taskId);
  const findings = all.filter((e) => e.kind === "finding");
  const youtubeCalls = all.filter((e) => e.kind === "youtube-call");

  const blockers = [];
  if (findings.length === 0) {
    blockers.push("no findings recorded");
  }
  findings.forEach((f, idx) => {
    if (!isMeaningful(f.decision)) blockers.push(`finding #${idx + 1}: decision empty`);
    if (!isMeaningful(f.applied_in)) blockers.push(`finding #${idx + 1}: applied_in empty`);
  });

  // Youtube calls must have at least one related finding with applied_in.
  if (youtubeCalls.length > 0) {
    const followUps = findings.filter((f) => f.source === "youtube-learner");
    if (followUps.length === 0) {
      blockers.push(`${youtubeCalls.length} youtube-call(s) without follow-up finding (run research.mjs add)`);
    } else {
      const withoutApplied = followUps.filter((f) => !isMeaningful(f.applied_in));
      if (withoutApplied.length > 0) {
        blockers.push(`${withoutApplied.length} youtube-learner finding(s) lack applied_in`);
      }
    }
  }

  process.stdout.write(`task:       ${taskId}\n`);
  process.stdout.write(`findings:   ${findings.length}\n`);
  process.stdout.write(`yt-calls:   ${youtubeCalls.length}\n`);

  if (blockers.length === 0) {
    process.stdout.write(`[research] audit PASS\n`);
    process.exit(0);
  } else {
    process.stdout.write(`[research] audit BLOCKED (${blockers.length})\n`);
    for (const b of blockers) process.stderr.write(`  - ${b}\n`);
    process.exit(2);
  }
}

function cmdList(opts) {
  const taskId = opts["task-id"];
  validateTaskId(taskId);
  const all = readLog().filter((e) => e.task_id === taskId);
  if (all.length === 0) {
    process.stdout.write(`(no research for task=${taskId})\n`);
    return;
  }
  for (const e of all) {
    if (e.kind === "youtube-call") {
      process.stdout.write(`[${e.ts}] YOUTUBE-CALL url=${e.url}\n`);
      process.stdout.write(`    rationale: ${e.rationale}\n`);
    } else {
      process.stdout.write(`[${e.ts}] FINDING source=${e.source}\n`);
      process.stdout.write(`    finding:     ${e.finding}\n`);
      process.stdout.write(`    implication: ${e.implication}\n`);
      process.stdout.write(`    decision:    ${e.decision}\n`);
      process.stdout.write(`    applied_in:  ${e.applied_in}\n`);
      if (e.url) process.stdout.write(`    url:         ${e.url}\n`);
    }
    process.stdout.write("");
  }
}

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

switch (args.cmd) {
  case "add":
    cmdAdd(args.opts);
    break;
  case "youtube":
    cmdYoutube(args.opts);
    break;
  case "audit":
    cmdAudit(args.opts);
    break;
  case "list":
    cmdList(args.opts);
    break;
  default:
    process.stderr.write(`[research] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}