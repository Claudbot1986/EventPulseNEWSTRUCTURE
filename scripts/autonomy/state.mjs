#!/usr/bin/env node
// scripts/autonomy/state.mjs — harness-independent task state manager
//
// Manages runtime/autonomy/<task-id>.md files for long-running tasks.
// Zero external dependencies — Node 18+ built-ins only.
//
// Sections (all required by template; some auto-populated):
//   PHASE                  UNDERSTAND / RESEARCH / DECIDE / BUILD / PROVE / IMPROVE / DONE
//   GOAL                   one-sentence task goal
//   ACCEPTANCE CRITERIA    bullet list of gates
//   AC EVIDENCE MAP        AC → gate-spec / verifieringskommando / resultat
//   RESEARCH CITATIONS     bullet list of research sources consulted
//   DECISIONS              bullet list of motivated decisions
//   RESEARCH FINDINGS → DECISIONS  finding → source → implication → decision → applied-in
//   UI VISUAL VERIFICATION three dimensions A/B/C for UI tasks
//   CURRENT PHASE          short status line
//   COMPLETED              log of finished steps
//   VERIFIED               log of steps confirmed by real code-path verification
//   FAILED / PROBLEMS      log of failed attempts and blockers
//   IMPORTANT DECISIONS    log of non-obvious decisions worth keeping
//   IMPROVE LOG            table of improve iterations
//   IMPROVE FINDINGS       bullet list of concrete findings
//   FILES CHANGED          files touched
//   REMAINING              what is still left
//   NEXT ACTION            exactly one concrete next step
//
// Usage:
//   state.mjs init   --id <task-id> --goal "..." --task-size xs|s|m|l|xl [--criteria "c1;c2"]
//   state.mjs update --id <task-id> [--phase "..."] [--next "..."] [--append-completed "..."]
//                              [--append-research-citation "..."] [--append-decision "..."]
//                              [--append-improve-finding "..."] [--append-improve-iteration "..."]
//                              [--set-ac-evidence-map "..."] [--set-ui-visual-verification "..."]
//                              [--set-research-findings-decisions "..."] [--append-verified "..."]
//                              [--append-problem "..."] [--append-decision-log "..."]
//                              [--append-file <path>] [--set-remaining <text>]
//   state.mjs mark   --id <task-id> --status DONE | BLOCKED [--reason "..."]
//   state.mjs status --id <task-id>
//   state.mjs list
//   state.mjs --help

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const WORKFLOW_MJS = path.join(__dirname, "workflow.mjs");

// Sections in canonical order. PHASE first so it appears at the top of the file.
const SECTIONS = [
  "PHASE",
  "GOAL",
  "TASK SIZE",
  "ACCEPTANCE CRITERIA",
  "AC EVIDENCE MAP",
  "RESEARCH CITATIONS",
  "DECISIONS",
  "RESEARCH FINDINGS → DECISIONS",
  "UI VISUAL VERIFICATION",
  "CURRENT PHASE",
  "COMPLETED",
  "VERIFIED",
  "FAILED / PROBLEMS",
  "IMPORTANT DECISIONS",
  "IMPROVE LOG",
  "IMPROVE FINDINGS",
  "FILES CHANGED",
  "REMAINING",
  "NEXT ACTION",
];

const TASK_SIZES = ["xs", "s", "m", "l", "xl"];
const PHASES = ["UNDERSTAND", "RESEARCH", "DECIDE", "BUILD", "PROVE", "IMPROVE", "DONE"];

// ---- Helpers ---------------------------------------------------------------

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
    `state.mjs — runtime/autonomy/<task-id>.md manager

Commands:
  init    Create new state file. Requires --id, --goal, --task-size.
  update  Update sections. Optional flags per field.
  mark    Mark status as DONE or BLOCKED. DONE invokes workflow.mjs check-size.
  status  Print compact summary.
  list    List all known task states.

Update flags (combine freely):
  --phase <text>                            Replace PHASE content
  --next <text>                             Replace NEXT ACTION content
  --set-remaining <text>                    Replace REMAINING content
  --set-ac-evidence-map <text>              Replace AC EVIDENCE MAP content
  --set-ui-visual-verification <text>       Replace UI VISUAL VERIFICATION content
  --set-research-findings-decisions <text>  Replace RESEARCH FINDINGS → DECISIONS
  --set-task-size <text>                    Replace TASK SIZE content (xs|s|m|l|xl)
  --append-completed <text>                 Append bullet to COMPLETED
  --append-verified <text>                  Append bullet to VERIFIED
  --append-problem <text>                   Append bullet to FAILED / PROBLEMS
  --append-decision <text>                  Append bullet to DECISIONS
  --append-research-citation <text>         Append bullet to RESEARCH CITATIONS
  --append-improve-finding <text>           Append bullet to IMPROVE FINDINGS
  --append-improve-iteration <text>         Append row to IMPROVE LOG
  --append-file <path>                      Append bullet to FILES CHANGED

NEXT ACTION must be non-empty unless the task is DONE or BLOCKED.
mark --status DONE invokes workflow.mjs check-size and rejects if it exits non-zero.

Exit codes:
  0  success
  2  validation failure
  3  file not found
  4  internal error
`,
  );
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function statePath(taskId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(taskId)) {
    process.stderr.write(`[state] invalid task-id: ${taskId}\n`);
    process.exit(2);
  }
  return path.join(STATE_DIR, `${taskId}.md`);
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`[state] not found: ${filePath}\n`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return parseFrontmatter(raw);
}

function parseFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    fm[k] = v;
  }
  return { fm, body: m[2] };
}

function serializeFrontmatter(fm) {
  const lines = ["---"];
  for (const k of Object.keys(fm)) {
    lines.push(`${k}: ${fm[k]}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function parseSections(body) {
  const out = {};
  let current = null;
  let buf = [];
  for (const line of body.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      if (current !== null) {
        out[current] = buf.join("\n").replace(/^\n+|\n+$/g, "");
      }
      current = h[1].trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) {
    out[current] = buf.join("\n").replace(/^\n+|\n+$/g, "");
  }
  return out;
}

function serializeSections(sections) {
  const out = [];
  for (const name of SECTIONS) {
    out.push(`## ${name}`);
    out.push("");
    out.push(sections[name] || "(none)");
    out.push("");
  }
  return out.join("\n");
}

function buildTemplate(goal, criteria, taskSize) {
  const criteriaLines = criteria
    ? criteria
        .split(/\n|;/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => `- ${c}`)
        .join("\n")
    : "(to be defined)";
  return {
    "PHASE": "UNDERSTAND",
    "GOAL": goal,
    "TASK SIZE": taskSize,
    "ACCEPTANCE CRITERIA": criteriaLines,
    "AC EVIDENCE MAP": "(to be filled as ACs are verified)",
    "RESEARCH CITATIONS": "(none yet)",
    "DECISIONS": "(none yet)",
    "RESEARCH FINDINGS → DECISIONS": "(none yet — see scripts/autonomy/research.mjs)",
    "UI VISUAL VERIFICATION": "(only required for UI tasks; leave '(none yet)' otherwise)",
    "CURRENT PHASE": "init",
    "COMPLETED": "(none yet)",
    "VERIFIED": "(none yet)",
    "FAILED / PROBLEMS": "(none yet)",
    "IMPORTANT DECISIONS": "(none yet)",
    "IMPROVE LOG": "(none yet — see workflow.mjs start-improve)",
    "IMPROVE FINDINGS": "(none yet)",
    "FILES CHANGED": "(none yet)",
    "REMAINING": "(see ACCEPTANCE CRITERIA)",
    "NEXT ACTION": "Define the next concrete action.",
  };
}

// ---- checkSize delegation -------------------------------------------------
//
// mark --status DONE invokes workflow.mjs check-size and refuses to mark DONE
// if it exits non-zero. The check-size script is the single source of truth
// for size-driven gates (research, decisions, UI, IMPROVE loop, etc.).

function runCheckSize(taskId) {
  if (!fs.existsSync(WORKFLOW_MJS)) {
    process.stderr.write(`[state] FATAL: workflow.mjs missing at ${WORKFLOW_MJS}\n`);
    process.exit(4);
  }
  let stdoutBuf = "";
  let stderrBuf = "";
  let exitCode = 0;
  try {
    stdoutBuf = execFileSync("node", [WORKFLOW_MJS, "check-size", "--id", taskId], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    exitCode = err.status || 2;
    stdoutBuf = err.stdout ? err.stdout.toString() : "";
    stderrBuf = err.stderr ? err.stderr.toString() : "";
  }
  return { exitCode, stdout: stdoutBuf, stderr: stderrBuf };
}

// ---- Commands --------------------------------------------------------------

function cmdInit(opts) {
  const id = opts.id;
  const goal = opts.goal;
  const taskSize = (opts["task-size"] || "xs").toLowerCase();
  if (!id || !goal) {
    process.stderr.write("[state] init requires --id and --goal\n");
    process.exit(2);
  }
  if (!TASK_SIZES.includes(taskSize)) {
    process.stderr.write(`[state] init --task-size must be one of: ${TASK_SIZES.join(", ")}\n`);
    process.exit(2);
  }
  const fp = statePath(id);
  if (fs.existsSync(fp)) {
    process.stderr.write(`[state] already exists: ${fp}\n`);
    process.exit(2);
  }
  const tpl = buildTemplate(goal, opts.criteria, taskSize);
  const body = serializeSections(tpl);
  const fm = {
    task_id: id,
    status: "IN_PROGRESS",
    phase: "UNDERSTAND",
    task_size: taskSize,
    created: nowIso(),
    updated: nowIso(),
    blocking_reason: "null",
  };
  ensureDir(STATE_DIR);
  fs.writeFileSync(fp, serializeFrontmatter(fm) + body + "\n", "utf8");
  process.stdout.write(`[state] created ${fp} (task-size=${taskSize})\n`);
}

function cmdUpdate(opts) {
  const id = opts.id;
  if (!id) {
    process.stderr.write("[state] update requires --id\n");
    process.exit(2);
  }
  const fp = statePath(id);
  const parsed = readState(fp);
  if (!parsed) process.exit(3);

  const sections = parseSections(parsed.body);
  let touched = 0;

  const setIf = (key, optName) => {
    if (opts[optName] !== undefined && opts[optName] !== true) {
      sections[key] = opts[optName];
      touched++;
    }
  };

  const appendIf = (key, optName, bulletPrefix = "- ") => {
    const v = opts[optName];
    if (v !== undefined && v !== true) {
      const cur = sections[key] || "";
      const next = cur && cur !== "(none yet)" && cur !== "(to be defined)"
        ? `${cur}\n${bulletPrefix}${v}`
        : `${bulletPrefix}${v}`;
      sections[key] = next;
      touched++;
    }
  };

  setIf("PHASE", "phase");
  setIf("NEXT ACTION", "next");
  setIf("REMAINING", "set-remaining");
  setIf("AC EVIDENCE MAP", "set-ac-evidence-map");
  setIf("UI VISUAL VERIFICATION", "set-ui-visual-verification");
  setIf("RESEARCH FINDINGS → DECISIONS", "set-research-findings-decisions");
  setIf("TASK SIZE", "set-task-size");
  appendIf("COMPLETED", "append-completed");
  appendIf("VERIFIED", "append-verified");
  appendIf("FAILED / PROBLEMS", "append-problem");
  appendIf("DECISIONS", "append-decision");
  appendIf("RESEARCH CITATIONS", "append-research-citation");
  appendIf("IMPROVE FINDINGS", "append-improve-finding");
  // IMPROVE LOG rows are markdown table rows — no bullet prefix.
  appendIf("IMPROVE LOG", "append-improve-iteration", "");
  appendIf("FILES CHANGED", "append-file");

  // TASK SIZE validation
  if (opts["set-task-size"] !== undefined) {
    const ts = String(opts["set-task-size"]).toLowerCase();
    if (!TASK_SIZES.includes(ts)) {
      process.stderr.write(`[state] set-task-size must be one of: ${TASK_SIZES.join(", ")}\n`);
      process.exit(2);
    }
    sections["TASK SIZE"] = ts;
  }

  // PHASE validation
  if (opts.phase !== undefined) {
    const ph = String(opts.phase).toUpperCase();
    if (!PHASES.includes(ph)) {
      process.stderr.write(`[state] phase must be one of: ${PHASES.join(", ")}\n`);
      process.exit(2);
    }
    sections["PHASE"] = ph;
  }

  if (touched === 0) {
    process.stderr.write("[state] update called with no field flags; nothing changed\n");
    process.exit(2);
  }

  // Enforce: NEXT ACTION must be non-empty unless DONE/BLOCKED.
  const status = parsed.fm.status || "IN_PROGRESS";
  const nextAction = (sections["NEXT ACTION"] || "").trim();
  if (status !== "DONE" && status !== "BLOCKED" && nextAction === "") {
    process.stderr.write(
      "[state] refused: NEXT ACTION is empty but status is " + status + ". Use --next to set one, or `mark --status DONE|BLOCKED` to terminate.\n",
    );
    process.exit(2);
  }

  const newFm = { ...parsed.fm, updated: nowIso() };
  if (opts.phase !== undefined) newFm.phase = String(opts.phase).toUpperCase();
  if (opts["set-task-size"] !== undefined) newFm.task_size = String(opts["set-task-size"]).toLowerCase();
  const newBody = serializeSections(sections);
  fs.writeFileSync(fp, serializeFrontmatter(newFm) + newBody + "\n", "utf8");
  process.stdout.write(`[state] updated ${fp} (${touched} field(s))\n`);
}

function cmdMark(opts) {
  const id = opts.id;
  if (!id) {
    process.stderr.write("[state] mark requires --id\n");
    process.exit(2);
  }
  const status = String(opts.status || "").toUpperCase();
  if (!["DONE", "BLOCKED", "LOCAL_BLOCKED", "GLOBAL_BLOCKED"].includes(status)) {
    process.stderr.write("[state] mark --status must be DONE | BLOCKED | LOCAL_BLOCKED | GLOBAL_BLOCKED\n");
    process.exit(2);
  }
  const fp = statePath(id);
  const parsed = readState(fp);
  if (!parsed) process.exit(3);

  // Terminal-status guards.
  const currentStatus = parsed.fm.status || "IN_PROGRESS";
  if (currentStatus === "DONE") {
    if (status !== "DONE") {
      process.stderr.write(`[state] refused: task is already DONE; cannot re-mark as ${status}.\n`);
      process.exit(2);
    }
    if (status === "DONE") {
      // Re-marking DONE is allowed (idempotent) but logs it.
      process.stderr.write(`[state] task already DONE; re-marking is idempotent.\n`);
    }
  }

  // Phase must have progressed past BUILD before DONE is allowed.
  // (Phase gates: UNDERSTAND→RESEARCH→DECIDE→BUILD→PROVE→IMPROVE→DONE.)
  if (status === "DONE") {
    const currentPhase = (parsed.fm.phase || "UNDERSTAND").toUpperCase();
    const allowed = ["IMPROVE", "DONE"];
    if (!allowed.includes(currentPhase)) {
      process.stderr.write(
        `[state] refused: mark --status DONE requires phase=IMPROVE (current=${currentPhase}). Run workflow.mjs start-improve first.\n`,
      );
      process.exit(2);
    }

    // Run workflow.mjs check-size to validate size-driven gates.
    const result = runCheckSize(id);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.exitCode !== 0) {
      process.stderr.write(
        `[state] refused: mark --status DONE blocked by workflow.mjs check-size (exit ${result.exitCode}).\n`,
      );
      process.exit(2);
    }
  }

  const blockingReason = (status === "BLOCKED" || status === "LOCAL_BLOCKED" || status === "GLOBAL_BLOCKED")
    ? (opts.reason || "unspecified")
    : "null";

  const fm = {
    ...parsed.fm,
    status,
    updated: nowIso(),
    blocking_reason: blockingReason,
  };
  if (status === "DONE") {
    fm.phase = "DONE";
  }
  fs.writeFileSync(fp, serializeFrontmatter(fm) + parsed.body + "\n", "utf8");
  process.stdout.write(`[state] marked ${fp} as ${status}\n`);
}

function cmdStatus(opts) {
  const id = opts.id;
  if (!id) {
    process.stderr.write("[state] status requires --id\n");
    process.exit(2);
  }
  const fp = statePath(id);
  const parsed = readState(fp);
  if (!parsed) process.exit(3);
  const sections = parseSections(parsed.body);
  const fm = parsed.fm;
  process.stdout.write(`task_id:    ${fm.task_id || id}\n`);
  process.stdout.write(`status:     ${fm.status || "IN_PROGRESS"}\n`);
  process.stdout.write(`phase:      ${fm.phase || "UNDERSTAND"}\n`);
  process.stdout.write(`task_size:  ${fm.task_size || "xs"}\n`);
  process.stdout.write(`created:    ${fm.created || "?"}\n`);
  process.stdout.write(`updated:    ${fm.updated || "?"}\n`);
  if (fm.blocking_reason && fm.blocking_reason !== "null") {
    process.stdout.write(`blocker:    ${fm.blocking_reason}\n`);
  }
  process.stdout.write(`\nPHASE:\n  ${sections["PHASE"] || "(unset)"}\n`);
  process.stdout.write(`\nNEXT ACTION:\n  ${sections["NEXT ACTION"] || "(unset)"}\n`);
  process.stdout.write(`\nREMAINING:\n${(sections["REMAINING"] || "").split("\n").map((l) => "  " + l).join("\n")}\n`);
}

function cmdList() {
  ensureDir(STATE_DIR);
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    process.stdout.write("(no task states in runtime/autonomy/)\n");
    return;
  }
  process.stdout.write("task_id                     phase       size  status        updated\n");
  process.stdout.write("--------------------------- ----------- ----- ------------- ------------------------\n");
  for (const f of files.sort()) {
    const fp = path.join(STATE_DIR, f);
    const parsed = readState(fp);
    if (!parsed) continue;
    const id = parsed.fm.task_id || f.replace(/\.md$/, "");
    const phase = (parsed.fm.phase || "UNDERSTAND").padEnd(11);
    const size = (parsed.fm.task_size || "xs").padEnd(5);
    const status = (parsed.fm.status || "IN_PROGRESS").padEnd(13);
    const updated = parsed.fm.updated || "?";
    process.stdout.write(`${id.padEnd(27)} ${phase} ${size} ${status} ${updated}\n`);
  }
}

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

switch (args.cmd) {
  case "init":
    cmdInit(args.opts);
    break;
  case "update":
    cmdUpdate(args.opts);
    break;
  case "mark":
    cmdMark(args.opts);
    break;
  case "status":
    cmdStatus(args.opts);
    break;
  case "list":
    cmdList();
    break;
  default:
    process.stderr.write(`[state] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}