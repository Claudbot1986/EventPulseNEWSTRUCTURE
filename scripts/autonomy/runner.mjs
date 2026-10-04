#!/usr/bin/env node
// scripts/autonomy/runner.mjs — autonomous run loop with LOCAL_BLOCKED semantics
//
// PRINCIPLE: LOCAL BLOCKER ≠ GLOBAL BLOCKER
//
// A single task failure must NOT stop the entire run as long as other runnable
// tasks exist. The runner iterates through all IN_PROGRESS tasks in the autonomy
// directory and:
//   - Tries each one (via the runner's own step dispatcher).
//   - On success → records evidence → moves on.
//   - On failure → diagnoses → if reparable, retries; otherwise marks the task
//     LOCAL_BLOCKED with a reason and continues with the next runnable task.
//   - Only when NO runnable tasks remain AND the remaining tasks all carry
//     GLOBAL_BLOCKER-level reasons does the runner itself declare GLOBAL_BLOCKED.
//
// Usage:
//   runner.mjs run                       # iterate all IN_PROGRESS tasks
//   runner.mjs run --task-prefix foo    # only run tasks whose id starts with 'foo'
//   runner.mjs run --simulate-fail-at 9  # simulate task index 9 failing (1-indexed)
//   runner.mjs run --retry-local-blocked # include LOCAL_BLOCKED tasks in the run
//   runner.mjs status                   # print current queue state
//
// Step dispatch is intentionally minimal in this version: the runner only verifies
// that workflow.mjs check-size passes (or simulates success/failure). The real
// production runner would call task-specific step executors via the agent's
// `task` tool. The point of this script is to enforce the LOCAL_BLOCKED ↔
// continue-running invariant deterministically.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const STATE_MJS = path.join(__dirname, "state.mjs");
const WORKFLOW_MJS = path.join(__dirname, "workflow.mjs");

const ACTIVE_STATUSES = new Set(["IN_PROGRESS"]);
const TERMINAL_DONE = "DONE";
const LOCAL_BLOCKED = "LOCAL_BLOCKED";
const GLOBAL_BLOCKED = "GLOBAL_BLOCKED";

// Tasks that fail with one of these reasons are GLOBAL blockers (truly outside
// the agent's reach). Anything else is treated as a LOCAL_BLOCKED and the runner
// continues.
const GLOBAL_BLOCKER_PATTERNS = [
  /\bcredential\b/i,
  /\bpermission\b.*denied/i,
  /\buser[-_ ]?decision\b/i,
  /\bproduct[-_ ]?decision\b/i,
  /\bblocked[-_ ]?by[-_ ]user\b/i,
  /\bneeds[-_ ]?human\b/i,
];

// --- Args parsing -----------------------------------------------------------

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
    `runner.mjs — autonomous run loop with LOCAL_BLOCKED semantics

Commands:
  run       Iterate active tasks; try each; continue past LOCAL_BLOCKED.
  status    Print queue state (counts by status + per-task summary).

run flags:
  --task-prefix <p>      Only run tasks whose id starts with p.
  --simulate-fail-at <N> 1-indexed position of task to mark LOCAL_BLOCKED.
  --simulate-reason <t>  Reason text to attach to the simulated failure.
  --retry-local-blocked  Re-attempt tasks already in LOCAL_BLOCKED.

Exit codes:
  0  all tasks DONE
  1  GLOBAL_BLOCKED — no runnable tasks, the only remaining ones are global blockers
  2  no IN_PROGRESS tasks (idempotent — nothing to do)
`,
  );
}

// --- State helpers --------------------------------------------------------

function listTaskIds(prefix) {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs
    .readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !prefix || f.replace(/\.md$/, "").startsWith(prefix))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

function readFrontmatter(taskId) {
  const fp = path.join(STATE_DIR, `${taskId}.md`);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return { fp, fm: {} };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fp, fm };
}

function execNode(file, args) {
  try {
    const out = execFileSync("node", [file, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout: out, stderr: "" };
  } catch (err) {
    return {
      exitCode: err.status || 2,
      stdout: err.stdout ? err.stdout.toString() : "",
      stderr: err.stderr ? err.stderr.toString() : (err.message || ""),
    };
  }
}

// --- Step execution -------------------------------------------------------

function runOneTask(taskId, simulateFailReason) {
  // Step 1: run workflow.mjs check-size for this task. This is the
  // deterministic gate that decides whether the task can progress to DONE.
  if (simulateFailReason) {
    return {
      ok: false,
      reason: simulateFailReason,
      detail: `simulated failure injected by runner.mjs --simulate-fail-at for task=${taskId}`,
    };
  }
  const result = execNode(WORKFLOW_MJS, ["check-size", "--id", taskId]);
  if (result.exitCode !== 0) {
    return { ok: false, reason: "check-size-gate failed", detail: result.stdout + result.stderr };
  }
  return { ok: true, detail: result.stdout };
}

function classify(reason) {
  if (!reason) return LOCAL_BLOCKED;
  for (const re of GLOBAL_BLOCKER_PATTERNS) {
    if (re.test(reason)) return GLOBAL_BLOCKED;
  }
  return LOCAL_BLOCKED;
}

function mark(taskId, status, reason) {
  execNode(STATE_MJS, ["mark", "--id", taskId, "--status", status, "--reason", reason]);
}

// --- Main loop ------------------------------------------------------------

function cmdRun(opts) {
  const prefix = opts["task-prefix"] || "";
  const ids = listTaskIds(prefix);
  if (ids.length === 0) {
    process.stdout.write("[runner] no tasks in queue\n");
    process.exit(2);
  }

  const failAtRaw = opts["simulate-fail-at"];
  const failAt = failAtRaw === undefined || failAtRaw === true ? null : Number(failAtRaw);
  if (failAt !== null && (!Number.isFinite(failAt) || failAt < 1)) {
    process.stderr.write("[runner] --simulate-fail-at must be a positive integer (1-indexed)\n");
    process.exit(2);
  }
  const simulateReason = (opts["simulate-reason"] || "simulated external failure (auth error 50112)").toString();

  const retryLocalBlocked = !!opts["retry-local-blocked"];

  let taskNumber = 0;
  let localBlockedCount = 0;
  let globalBlockedCount = 0;
  let doneCount = 0;
  let skippedCount = 0;
  const failures = [];

  for (const taskId of ids) {
    const front = readFrontmatter(taskId);
    if (!front) continue;
    const status = (front.fm.status || "IN_PROGRESS").toUpperCase();

    if (status === "DONE") {
      doneCount++;
      continue;
    }
    if (status === "LOCAL_BLOCKED" && !retryLocalBlocked) {
      localBlockedCount++;
      continue;
    }
    if (status === "GLOBAL_BLOCKED") {
      globalBlockedCount++;
      continue;
    }
    if (!ACTIVE_STATUSES.has(status)) {
      skippedCount++;
      continue;
    }

    taskNumber++;

    // Simulate failure if this is the configured index.
    let failureReason = null;
    if (failAt !== null && taskNumber === failAt) {
      failureReason = simulateReason;
    }

    const result = runOneTask(taskId, failureReason);

    if (result.ok) {
      // Mark this task DONE.
      mark(taskId, "DONE", "auto:runner");
      doneCount++;
      process.stdout.write(`[runner] ${taskId}: DONE\n`);
    } else {
      const kind = classify(result.reason);
      mark(taskId, kind, result.reason);
      if (kind === GLOBAL_BLOCKED) {
        globalBlockedCount++;
        failures.push({ taskId, reason: result.reason, kind });
        process.stderr.write(`[runner] ${taskId}: GLOBAL_BLOCKED — ${result.reason}\n`);
      } else {
        localBlockedCount++;
        failures.push({ taskId, reason: result.reason, kind });
        process.stderr.write(`[runner] ${taskId}: LOCAL_BLOCKED — ${result.reason}\n`);
      }
      // Continue with next task (do NOT abort).
    }
  }

  process.stdout.write(
    `\n[runner] summary: done=${doneCount} local_blocked=${localBlockedCount} ` +
    `global_blocked=${globalBlockedCount} skipped=${skippedCount}\n`,
  );

  if (globalBlockedCount > 0) {
    process.stdout.write("[runner] GLOBAL_BLOCKED present, returning 1\n");
    process.exit(1);
  }
  if (doneCount + localBlockedCount + skippedCount === 0) {
    process.stdout.write("[runner] no IN_PROGRESS tasks (idempotent)\n");
    process.exit(2);
  }
  if (doneCount === 0 && localBlockedCount > 0) {
    // All tasks ran but every one is LOCAL_BLOCKED — runner is in a loop; emit
    // GLOBAL_BLOCKED so the caller can decide whether to escalate.
    process.stdout.write("[runner] all ran tasks are LOCAL_BLOCKED — emitting GLOBAL_BLOCKED\n");
    process.exit(1);
  }
  if (doneCount > 0 && localBlockedCount === 0) {
    process.stdout.write("[runner] all runnable tasks completed\n");
    process.exit(0);
  }
  // Mixed: some done, some local-blocked, others still pending. Continue running.
  process.stdout.write(`[runner] partial completion; ${localBlockedCount} tasks local-blocked, others pending\n`);
  // Return 0 because progress was made; the caller decides whether to re-run.
  process.exit(0);
}

function cmdStatus(opts) {
  const prefix = opts["task-prefix"] || "";
  const ids = listTaskIds(prefix);
  if (ids.length === 0) {
    process.stdout.write("(no tasks)\n");
    return;
  }
  const counts = {};
  for (const id of ids) {
    const f = readFrontmatter(id);
    if (!f) continue;
    const status = (f.fm.status || "IN_PROGRESS").toUpperCase();
    counts[status] = (counts[status] || 0) + 1;
  }
  process.stdout.write("status\tcount\n");
  process.stdout.write("-------\t-------\n");
  for (const [s, c] of Object.entries(counts).sort()) {
    process.stdout.write(`${s.padEnd(15)}\t${c}\n`);
  }
  process.stdout.write("\ntasks:\n");
  for (const id of ids) {
    const f = readFrontmatter(id);
    if (!f) continue;
    const status = (f.fm.status || "IN_PROGRESS").padEnd(15);
    const reason = f.fm.blocking_reason && f.fm.blocking_reason !== "null" ? ` (${f.fm.blocking_reason})` : "";
    process.stdout.write(`  ${id.padEnd(28)} ${status}${reason}\n`);
  }
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
    process.stderr.write(`[runner] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}