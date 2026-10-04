#!/usr/bin/env node
// scripts/autonomy/workflow.mjs — workflow / task-size gates
//
// Drives the size-driven gates that state.mjs::mark --status DONE depends on.
// This is the single source of truth for which sections must be filled before
// a task of a given size can be marked DONE.
//
// Commands:
//   init            create new task state (delegates to state.mjs::init)
//   check-size      validate that the task satisfies its size-driven gates
//   start-improve   transition PHASE → IMPROVE and start iteration #1 (or #N)
//
// Size-driven gate matrix:
//   xs  : only NEXT ACTION non-empty
//   s   : xs + IMPROVE LOG ≥ 1 iteration
//   m   : s + RESEARCH CITATIONS filled + DECISIONS filled + RESEARCH FINDINGS→DECISIONS valid
//   l   : m + UI VISUAL VERIFICATION (3 dim, if UI task) + IMPROVE LOG re-prove-status
//   xl  : l + strictest: PHASE=IMPROVE before mark DONE

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const STATE_MJS = path.join(__dirname, "state.mjs");
const RESEARCH_MJS = path.join(__dirname, "research.mjs");

const TASK_SIZES = ["xs", "s", "m", "l", "xl"];

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
    `workflow.mjs — size-driven gates + IMPROVE-loop orchestration

Commands:
  init          Create new task state via state.mjs::init.
  check-size    Validate size-driven gates for the task. Exit 0 if OK, 2 if blocked.
  start-improve Transition the task to PHASE=IMPROVE and start iteration #N.
  add-improve-iteration  Update an iteration row with findings/fixes/re-prove-status.

Usage:
  node scripts/autonomy/workflow.mjs init \\
    --id <task-id> --goal "..." --task-size m [--criteria "AC1;AC2"]

  node scripts/autonomy/workflow.mjs check-size --id <task-id>

  node scripts/autonomy/workflow.mjs start-improve --id <task-id> [--iteration 1]

check-size validates, per task-size:

  xs : NEXT ACTION non-empty
  s  : xs + IMPROVE LOG has ≥1 iteration row
  m  : s + RESEARCH CITATIONS has content + DECISIONS has content
       + RESEARCH FINDINGS → DECISIONS: every row has DECISION + APPLIED IN
       + (UI tasks) UI VISUAL VERIFICATION mentions A/B/C
  l  : m + IMPROVE LOG latest iteration has re-prove-status set
       + AC EVIDENCE MAP has a row per AC in ACCEPTANCE CRITERIA
  xl : l + PHASE == IMPROVE (or DONE)

Exit codes:
  0  PASS
  2  blocked — see stderr
  3  file not found
  4  internal error
`,
  );
}

// --- State-file helpers -----------------------------------------------------

function statePath(taskId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(taskId)) {
    process.stderr.write(`[workflow] invalid task-id: ${taskId}\n`);
    process.exit(2);
  }
  return path.join(STATE_DIR, `${taskId}.md`);
}

function parseFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, body: m[2] };
}

function parseSections(body) {
  const out = {};
  let current = null;
  let buf = [];
  for (const line of body.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      if (current !== null) out[current] = buf.join("\n").replace(/^\n+|\n+$/g, "");
      current = h[1].trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) out[current] = buf.join("\n").replace(/^\n+|\n+$/g, "");
  return out;
}

function readState(taskId) {
  const fp = statePath(taskId);
  if (!fs.existsSync(fp)) {
    process.stderr.write(`[workflow] state file not found: ${fp}\n`);
    return null;
  }
  const raw = fs.readFileSync(fp, "utf8");
  const parsed = parseFrontmatter(raw);
  return { fp, fm: parsed.fm, sections: parseSections(parsed.body) };
}

function writeState(fp, fm, body) {
  const lines = ["---"];
  for (const k of Object.keys(fm)) lines.push(`${k}: ${fm[k]}`);
  lines.push("---", "");
  fs.writeFileSync(fp, lines.join("\n") + body + "\n", "utf8");
}

function serializeSectionsPreserve(stateObj, overrideSections) {
  // Reconstruct body keeping the canonical section order with overrides applied.
  const order = [
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
  const out = [];
  for (const name of order) {
    out.push(`## ${name}`);
    out.push("");
    out.push(overrideSections[name] ?? stateObj[name] ?? "(none)");
    out.push("");
  }
  return out.join("\n");
}

// --- check-size core --------------------------------------------------------

const PLACEHOLDER_VALUES = new Set([
  "(none yet)",
  "(to be defined)",
  "(to be filled as ACs are verified)",
  "(only required for UI tasks; leave '(none yet)' otherwise)",
  "(none yet — see scripts/autonomy/research.mjs)",
  "(none yet — see workflow.mjs start-improve)",
  "(TBD)",
  "(none)",
  "(see scripts/autonomy/research.mjs)",
  "-",
  "—",
  "tbd",
  "todo",
  "",
]);

function isFilled(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (PLACEHOLDER_VALUES.has(trimmed)) return false;
  // Section with a meaningful bullet
  return trimmed.length > 0;
}

function extractBullets(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l.length > 0 && !PLACEHOLDER_VALUES.has(l) && !l.startsWith("|") && !/^##/.test(l));
}

function extractTableRows(text) {
  // Rows like "| col1 | col2 | col3 |" — exclude header separator (---)
  return String(text || "")
    .split("\n")
    .filter((l) => /^\s*\|/.test(l))
    .filter((l) => !/^\s*\|[\s-:|]+\|\s*$/.test(l));
}

function findACList(state) {
  const ac = state.sections["ACCEPTANCE CRITERIA"] || "";
  const bullets = extractBullets(ac);
  if (bullets.length === 0) return [];
  return bullets.map((b) => {
    // AC1: text → return AC1 (or the full token at the start)
    const m = /^(AC\d+|[A-Za-z][\w-]*)\b/.exec(b);
    return m ? m[1] : b.slice(0, 20);
  });
}

function checkSize(taskId) {
  const state = readState(taskId);
  if (!state) process.exit(3);
  const size = (state.fm.task_size || "xs").toLowerCase();
  if (!TASK_SIZES.includes(size)) {
    process.stderr.write(`[workflow] invalid task_size '${size}' in frontmatter\n`);
    process.exit(2);
  }

  const blockers = [];
  const warnings = [];
  const acList = findACList(state);

  // Universal: NEXT ACTION must be non-empty
  const nextAction = String(state.sections["NEXT ACTION"] || "").trim();
  if (!nextAction || PLACEHOLDER_VALUES.has(nextAction)) {
    blockers.push("NEXT ACTION is empty or placeholder");
  }

  // xs: nothing more required
  // s: IMPROVE LOG ≥ 1 iteration
  if (size !== "xs") {
    const improveLog = state.sections["IMPROVE LOG"] || "";
    const rows = extractTableRows(improveLog).filter((r) => !/^\s*\|\s*#\s*\|/.test(r));
    // Header row counts as a row; require ≥ 2 rows = header + ≥1 iteration
    const allRows = improveLog.split("\n").filter((l) => /^\s*\|/.test(l));
    if (allRows.length < 2) {
      blockers.push(`IMPROVE LOG must have ≥1 iteration row for size=${size} (header only)`);
    }
  }

  // m+: research/decisions
  if (size === "m" || size === "l" || size === "xl") {
    const rc = state.sections["RESEARCH CITATIONS"] || "";
    if (!isFilled(rc)) blockers.push("RESEARCH CITATIONS must be filled for size=m|l|xl");

    const dec_ = state.sections["DECISIONS"] || "";
    if (!isFilled(dec_)) blockers.push("DECISIONS must be filled for size=m|l|xl");

    // RESEARCH FINDINGS → DECISIONS: every table row must have DECISION + APPLIED IN
    const rfd = state.sections["RESEARCH FINDINGS → DECISIONS"] || "";
    const rfdRows = extractTableRows(rfd).filter((r) => !/^\s*\|\s*#\s*\|/.test(r));
    if (rfdRows.length === 0) {
      blockers.push("RESEARCH FINDINGS → DECISIONS must have ≥1 row for size=m|l|xl");
    } else {
      rfdRows.forEach((row, idx) => {
        const cols = row.split("|").map((c) => c.trim());
        // Expect at least 6 columns: # | Finding | Source | Implication | Decision | Applied In
        if (cols.length < 6) {
          blockers.push(`RESEARCH FINDINGS row ${idx + 1}: need 6 columns (got ${cols.length})`);
          return;
        }
        const decision = cols[4] || "";
        const applied = cols[5] || "";
        if (!decision || PLACEHOLDER_VALUES.has(decision) || decision === "-") {
          blockers.push(`RESEARCH FINDINGS row ${idx + 1}: DECISION is empty`);
        }
        if (!applied || PLACEHOLDER_VALUES.has(applied) || applied === "-") {
          blockers.push(`RESEARCH FINDINGS row ${idx + 1}: APPLIED IN is empty (research without impact)`);
        }
      });
    }
  }

  // m+: IMPROVE LOG latest row must have re-prove-status (not a placeholder)
  if (size === "m" || size === "l" || size === "xl") {
    const improveLog = state.sections["IMPROVE LOG"] || "";
    const allRows = improveLog.split("\n").filter((l) => /^\s*\|/.test(l));
    if (allRows.length >= 2) {
      const lastRow = allRows[allRows.length - 1];
      const cols = lastRow.split("|").map((c) => c.trim());
      // cols[0] and cols[last] are empty strings around the table syntax.
      // Expected non-empty columns (after trim): # | date | review-source | findings | fixes | re-prove
      if (cols.length < 8) {
        blockers.push(`IMPROVE LOG latest row: need ≥6 data columns + 2 sentinels = 8 cols (got ${cols.length})`);
      } else {
        // re-prove-status is the last non-empty data column
        const reProve = cols[cols.length - 2] || "";
        if (!reProve || PLACEHOLDER_VALUES.has(reProve) || reProve === "-") {
          blockers.push("IMPROVE LOG latest iteration has no re-prove-status");
        }
        // findings is index 4 (after # | date | review-source)
        const findings = cols[4] || "";
        // fixes is index 5
        const fixes = cols[5] || "";
        const isNoFindings = /^(no\s+(relevant\s+)?findings|inga\s+(relevanta\s+)?findings|\(none\))$/i.test(findings);
        if (!isNoFindings && (!fixes || PLACEHOLDER_VALUES.has(fixes) || fixes === "-")) {
          blockers.push("IMPROVE LOG: findings present but fixes column is empty");
        }
      }
    }
  }

  // l+: AC EVIDENCE MAP must cover every AC
  if (size === "l" || size === "xl") {
    const acMap = state.sections["AC EVIDENCE MAP"] || "";
    const acMapRows = extractTableRows(acMap).filter((r) => !/^\s*\|\s*AC\s*\|/.test(r));
    const acMapTokens = new Set();
    for (const row of acMapRows) {
      const cols = row.split("|").map((c) => c.trim());
      if (cols.length >= 2 && cols[1] && !PLACEHOLDER_VALUES.has(cols[1]) && cols[1] !== "-") {
        acMapTokens.add(cols[1]);
      }
    }
    if (acList.length > 0) {
      const missing = acList.filter((ac) => !acMapTokens.has(ac));
      if (missing.length > 0) {
        blockers.push(`AC EVIDENCE MAP missing rows for: ${missing.join(", ")}`);
      }
    } else {
      warnings.push("ACCEPTANCE CRITERIA is empty — nothing to verify in AC EVIDENCE MAP");
    }
  }

  // UI: UI VISUAL VERIFICATION must mention all three dimensions A/B/C
  // Heuristic: section mentions "A" + "FUNCTIONAL" + "B" + "VISUAL" + "C" + "UX" or
  //             the section is left as the explicit placeholder.
  // We always require the section to be filled for ANY size if it has been
  // touched (heuristic — UI flag is not stored in frontmatter yet, but the
  // agent is expected to fill it for UI tasks).
  const uiSection = state.sections["UI VISUAL VERIFICATION"] || "";
  const uiFilled = isFilled(uiSection) && !/leave '\(none yet\)' otherwise/.test(uiSection);
  if (uiFilled) {
    const hasA = /A\.?\s*FUNCTIONAL|FUNCTIONAL.*PROOF/i.test(uiSection);
    const hasB = /B\.?\s*VISUAL|VISUAL.*PROOF/i.test(uiSection);
    const hasC = /C\.?\s*UX|UX.*DESIGN|DESIGN.*QUALITY/i.test(uiSection);
    if (!hasA || !hasB || !hasC) {
      blockers.push("UI VISUAL VERIFICATION must mention all three dimensions A/B/C");
    }
  }

  // xl: PHASE must be IMPROVE
  if (size === "xl") {
    const phase = String(state.fm.phase || "").toUpperCase();
    if (phase !== "IMPROVE" && phase !== "DONE") {
      blockers.push(`PHASE must be IMPROVE for size=xl (current=${phase || "(unset)"})`);
    }
  }

  // Output
  process.stdout.write(`task:    ${taskId}\n`);
  process.stdout.write(`size:    ${size}\n`);
  process.stdout.write(`phase:   ${state.fm.phase || "UNDERSTAND"}\n`);
  process.stdout.write(`acs:     ${acList.length}\n`);

  if (warnings.length) {
    process.stdout.write(`warnings: ${warnings.join("; ")}\n`);
  }

  if (blockers.length === 0) {
    process.stdout.write(`[workflow] check-size PASS\n`);
    process.exit(0);
  } else {
    process.stdout.write(`[workflow] check-size BLOCKED (${blockers.length})\n`);
    for (const b of blockers) {
      process.stderr.write(`  - ${b}\n`);
    }
    process.exit(2);
  }
}

// --- start-improve ----------------------------------------------------------

function startImprove(taskId, iterArg) {
  const state = readState(taskId);
  if (!state) process.exit(3);
  const iteration = Number(iterArg || 1);
  if (!Number.isFinite(iteration) || iteration < 1) {
    process.stderr.write(`[workflow] --iteration must be a positive integer\n`);
    process.exit(2);
  }

  const size = (state.fm.task_size || "xs").toLowerCase();
  if (size === "xs") {
    process.stderr.write(`[workflow] IMPROVE loop is not required for size=xs (allowed but not enforced)\n`);
  }

  const currentPhase = String(state.fm.phase || "UNDERSTAND").toUpperCase();
  if (currentPhase === "DONE") {
    process.stderr.write(`[workflow] task is already DONE; cannot start IMPROVE.\n`);
    process.exit(2);
  }

  // Initialize or extend the IMPROVE LOG table.
  const existingLog = state.sections["IMPROVE LOG"] || "(none yet — see workflow.mjs start-improve)";
  const today = new Date().toISOString().slice(0, 10);
  let newLog;
  if (!existingLog.includes("| # |")) {
    newLog = [
      "| # | date | review-source | findings | fixes | re-prove-status |",
      "|---|------|---------------|----------|-------|-----------------|",
      `| ${iteration} | ${today} | self-review | (TBD) | (TBD) | (TBD) |`,
    ].join("\n");
  } else {
    // Append a new row to the existing log table.
    newLog = [existingLog, `| ${iteration} | ${today} | self-review | (TBD) | (TBD) | (TBD) |`].join("\n");
  }

  const newSections = {
    ...state.sections,
    "PHASE": "IMPROVE",
    "IMPROVE LOG": newLog,
    "IMPROVE FINDINGS": state.sections["IMPROVE FINDINGS"] || "(none yet)",
    "NEXT ACTION": "Run review, document findings, apply fixes, re-prove.",
  };
  const body = serializeSectionsPreserve(state.sections, newSections);
  const newFm = { ...state.fm, phase: "IMPROVE", updated: new Date().toISOString() };
  writeState(state.fp, newFm, body);
  process.stdout.write(`[workflow] task ${taskId} → PHASE=IMPROVE, iteration #${iteration}\n`);
}

// --- add-improve-iteration --------------------------------------------------
// Updates an iteration row in IMPROVE LOG with findings/fixes/re-prove-status.

function addImproveIteration(taskId, opts) {
  const state = readState(taskId);
  if (!state) process.exit(3);
  const iteration = Number(opts.iteration || 0);
  if (!Number.isFinite(iteration) || iteration < 1) {
    process.stderr.write(`[workflow] --iteration must be a positive integer\n`);
    process.exit(2);
  }
  const findings = opts.findings || "(TBD)";
  const fixes = opts.fixes || "(TBD)";
  const reProve = opts["re-prove-status"] || "(none yet)";
  const reviewSource = opts["review-source"] || "self-review";

  const existingLog = state.sections["IMPROVE LOG"] || "(none yet — see workflow.mjs start-improve)";
  if (!existingLog.includes("| # |")) {
    process.stderr.write(`[workflow] IMPROVE LOG not initialized — run workflow.mjs start-improve first\n`);
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  const newRow = `| ${iteration} | ${today} | ${reviewSource} | ${findings} | ${fixes} | ${reProve} |`;

  // If a row with this iteration number exists, replace it; else append.
  const lines = existingLog.split("\n");
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\|\s*(\d+)\s*\|/.exec(lines[i]);
    if (m && Number(m[1]) === iteration) {
      lines[i] = newRow;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.push(newRow);

  const newLog = lines.join("\n");
  const newSections = { ...state.sections, "IMPROVE LOG": newLog };
  const body = serializeSectionsPreserve(state.sections, newSections);
  const newFm = { ...state.fm, updated: new Date().toISOString() };
  writeState(state.fp, newFm, body);
  process.stdout.write(`[workflow] updated iteration #${iteration} for task=${taskId}\n`);
}

// --- init (delegates) -------------------------------------------------------

function cmdInit(opts) {
  const args = ["init"];
  for (const k of Object.keys(opts)) {
    const v = opts[k];
    if (v === true) continue;
    args.push(`--${k}`, String(v));
  }
  try {
    execFileSync("node", [STATE_MJS, ...args], { cwd: REPO_ROOT, stdio: "inherit" });
  } catch (err) {
    process.exit(err.status || 2);
  }
}

// --- Main -------------------------------------------------------------------

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

switch (args.cmd) {
  case "init":
    cmdInit(args.opts);
    break;
  case "check-size":
    checkSize(args.opts.id);
    break;
  case "start-improve":
    startImprove(args.opts.id, args.opts.iteration);
    break;
  case "add-improve-iteration":
    addImproveIteration(args.opts.id, args.opts);
    break;
  default:
    process.stderr.write(`[workflow] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}