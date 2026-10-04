#!/usr/bin/env node
// scripts/autonomy/evidence.mjs — harness-independent evidence ledger + gate checker
//
// Mirrors the verify-completion.ts logic without Claude Code hooks:
//   - Append redacted NDJSON entries for each meaningful bash command.
//   - Verify that the active mission's required_gates have fresh evidence
//     within max_age_seconds and that the working-tree fingerprint hasn't
//     drifted since the matching entry.
//
// Usage:
//   evidence.mjs append    --cmd "npm test" --exit 0 [--mission-id <id>]
//   evidence.mjs gate-check --state <path/to/state.md>
//   evidence.mjs query      --gate <name> [--since-seconds <n>]
//   evidence.mjs fp         (print current working-tree fingerprint)
//   evidence.mjs --help

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const LEDGER_PATH = path.join(EVIDENCE_DIR, "evidence.ndjson");

// Gate fingerprints mirror the Claude hook's GATE_SPECS. Keep in sync.
const GATE_SPECS = {
  typecheck: { cmdContains: ["tsc --noEmit", "type-check", "typecheck"], maxAgeSeconds: 600 },
  adapter_test: { cmdContains: ["vitest run 02-Ingestion", "vitest run A-directAPI"], maxAgeSeconds: 3600 },
  fixture_replay: { cmdContains: ["Alltools-E2E/e2e.py", "e2e.py"], maxAgeSeconds: 3600 },
  dedup_smoke: { cmdContains: ["test_real_pipeline.py"], maxAgeSeconds: 3600 },
  dedup_test: { cmdContains: ["vitest run 04-Normalizer", "vitest run 07-Discovery"], maxAgeSeconds: 3600 },
  schema_diff: { cmdContains: ["schema_diff", "schema"], maxAgeSeconds: 3600 },
  venue_graph_dry_run: { cmdContains: ["venue-graph:dry-run"], maxAgeSeconds: 3600 },
  expo_typecheck: { cmdContains: ["06-UI && npx tsc", "06-UI && tsc"], maxAgeSeconds: 600 },
  expo_lint: { cmdContains: ["06-UI && npx eslint", "06-UI && eslint"], maxAgeSeconds: 600 },
  expo_smoke: { cmdContains: ["verify-providers"], maxAgeSeconds: 600 },
  // New gates introduced by the 2026-10-02 workflow overhaul.
  ui_visual_review: {
    cmdContains: [
      "ui-review/run-iteration.mjs",
      "verify_stamp_rendered.py",
      "verify_utforska_star.py",
    ],
    maxAgeSeconds: 3600,
  },
  runtime_smoke: {
    cmdContains: [
      "curl http",
      "curl -X POST",
      "curl -s http",
      "/agent/health",
      "GET http",
      "npm run start:agent",
    ],
    maxAgeSeconds: 3600,
  },
  // The remaining gates are state-file-derived (not command-fingerprinted):
  //   research_citations_recorded, decisions_documented, improvement_pass_done,
  //   youtube_learner_used, ui_visual_review_dimensions, ac_evidence_map_complete,
  //   research_findings_decisions_valid, improve_loop_iterations.
  // workflow.mjs::check-size owns these; gate-check below returns WARN for them.
};

const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(input) {
  return input.replace(SECRET_RE, (_m, name) => `${name}=<REDACTED>`);
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
    `evidence.mjs — runtime/autonomy/evidence.ndjson + gate-check

Commands:
  append      Append one redacted entry to the ledger.
  gate-check  Verify all gates in a state file have fresh evidence.
  query       List evidence matching a gate.
  fp          Print the current working-tree fingerprint.

Append flags:
  --cmd <command>          The command that was run (required, redacted before write)
  --exit <code>            Exit code (required)
  --mission-id <id>        Optional mission/task id
  --duration-ms <n>        Optional duration

gate-check flags:
  --state <path>           Path to a state.md file produced by state.mjs
                           (default: scans runtime/autonomy/*.md for first active)
  --evidence <path>        Override evidence ledger path

Exit codes:
  0  all gates pass / append succeeded / query returned rows
  2  one or more gates missing/stale/expired — see stderr
  3  state file not found
  4  internal error
`,
  );
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function workingTreeFingerprint() {
  try {
    const out = execSync(
      "git ls-files | sort | xargs cat 2>/dev/null | shasum -a 256 | awk '{print $1}'",
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return `sha256:${out.trim().slice(0, 32)}`;
  } catch {
    return "sha256:unavailable";
  }
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf8")
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

function cmdAppend(opts) {
  const cmd = opts.cmd;
  if (!cmd || cmd === true) {
    process.stderr.write("[evidence] append requires --cmd\n");
    process.exit(2);
  }
  const exitRaw = opts.exit;
  const exitCode = exitRaw === undefined || exitRaw === true ? 0 : Number(exitRaw);
  ensureDir(EVIDENCE_DIR);
  const entry = {
    ts: nowIso(),
    mission_id: opts["mission-id"] ? String(opts["mission-id"]) : null,
    tool: "Bash",
    event: "PostToolUse",
    cmd: redactSecrets(String(cmd)).slice(0, 500),
    exit_code: Number.isFinite(exitCode) ? exitCode : 0,
    working_tree_fp: workingTreeFingerprint(),
    duration_ms: opts["duration-ms"] ? Number(opts["duration-ms"]) : null,
  };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", { encoding: "utf8" });
  process.stdout.write(`[evidence] appended (fp=${entry.working_tree_fp})\n`);
}

function evidenceMatchesGate(entry, gate, nowMs) {
  const spec = GATE_SPECS[gate];
  if (!spec) return false;
  if (entry.exit_code !== 0) return false;
  const ageSec = (nowMs - new Date(entry.ts).getTime()) / 1000;
  if (ageSec > spec.maxAgeSeconds) return false;
  return spec.cmdContains.some((sub) => String(entry.cmd || "").includes(sub));
}

function nowIso() {
  return new Date().toISOString();
}

function readStateFile(stateArg) {
  const fp = stateArg
    ? path.resolve(stateArg)
    : firstActiveStateFile();
  if (!fp || !fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, "utf8");
  // Extract "ACCEPTANCE CRITERIA" body to find required gates (lines starting with -)
  const m = /## ACCEPTANCE CRITERIA\n([\s\S]*?)(?:\n## |\n*$)/.exec(raw);
  if (!m) return { fp, gates: [] };
  const lines = m[1].split("\n");
  const gates = [];
  for (const line of lines) {
    const t = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (!t) continue;
    const name = t[1].trim();
    if (Object.prototype.hasOwnProperty.call(GATE_SPECS, name)) {
      gates.push(name);
    }
  }
  return { fp, gates };
}

function firstActiveStateFile() {
  if (!fs.existsSync(EVIDENCE_DIR)) return null;
  const files = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const fp = path.join(EVIDENCE_DIR, f);
    const raw = fs.readFileSync(fp, "utf8");
    if (/status:\s*IN_PROGRESS/.test(raw)) return fp;
  }
  return files.length > 0 ? path.join(EVIDENCE_DIR, files[0]) : null;
}

function cmdGateCheck(opts) {
  const stateInfo = readStateFile(opts.state);
  if (!stateInfo) {
    process.stderr.write(`[evidence] state file not found: ${opts.state || "(auto)"}\n`);
    process.exit(3);
  }
  const { fp: stateFp, gates } = stateInfo;
  if (gates.length === 0) {
    process.stdout.write(`[evidence] no recognized gates in ${stateFp}; nothing to verify.\n`);
    process.exit(0);
  }
  const nowMs = Date.now();
  const evidence = readLedger();
  const currentFp = workingTreeFingerprint();
  const missing = [];
  const stale = [];
  const unknown = [];
  let latestMatchingFp = null;
  let latestMatchingTs = 0;

  for (const gate of gates) {
    const matches = evidence.filter((e) => evidenceMatchesGate(e, gate, nowMs));
    if (matches.length === 0) {
      const anyAtAll = evidence.some((e) => {
        const spec = GATE_SPECS[gate];
        return spec && spec.cmdContains.some((sub) => String(e.cmd || "").includes(sub));
      });
      if (anyAtAll) stale.push(gate);
      else missing.push(gate);
      continue;
    }
    const latest = matches[matches.length - 1];
    const latestTs = new Date(latest.ts).getTime();
    if (latestTs > latestMatchingTs) {
      latestMatchingTs = latestTs;
      latestMatchingFp = latest.working_tree_fp;
    }
  }

  let fpMismatch = false;
  if (
    latestMatchingFp &&
    latestMatchingFp !== currentFp &&
    latestMatchingFp !== "sha256:unavailable"
  ) {
    fpMismatch = true;
  }

  process.stdout.write(`state:   ${stateFp}\n`);
  process.stdout.write(`gates:   ${gates.join(", ")}\n`);
  process.stdout.write(`current_fp: ${currentFp}\n`);

  const blocking = missing.length > 0 || stale.length > 0 || fpMismatch;
  if (missing.length) process.stdout.write(`missing: ${missing.join(", ")}\n`);
  if (stale.length) process.stdout.write(`stale:   ${stale.join(", ")}\n`);
  if (fpMismatch) process.stdout.write(`fp_mismatch: yes (evidence fp=${latestMatchingFp})\n`);
  if (unknown.length) process.stdout.write(`unknown: ${unknown.join(", ")} (manual review)\n`);

  if (blocking) {
    process.exit(2);
  }
  process.stdout.write(`[evidence] PASS\n`);
}

function cmdQuery(opts) {
  const gate = opts.gate;
  if (!gate) {
    process.stderr.write("[evidence] query requires --gate\n");
    process.exit(2);
  }
  const since = Number(opts["since-seconds"] || 86400);
  const cutoff = Date.now() - since * 1000;
  const rows = readLedger().filter((e) => {
    const spec = GATE_SPECS[gate];
    if (!spec) return false;
    return spec.cmdContains.some((sub) => String(e.cmd || "").includes(sub));
  });
  const fresh = rows.filter((e) => new Date(e.ts).getTime() >= cutoff);
  process.stdout.write(`gate=${gate}  total=${rows.length}  fresh(<${since}s)=${fresh.length}\n`);
  for (const r of fresh.slice(-10)) {
    process.stdout.write(`  ${r.ts}  exit=${r.exit_code}  ${String(r.cmd).slice(0, 120)}\n`);
  }
  if (fresh.length === 0) process.exit(2);
}

function cmdFp() {
  process.stdout.write(workingTreeFingerprint() + "\n");
}

const args = parseArgs(process.argv);
if (args.cmd === "--help" || args.cmd === "-h" || args.cmd === undefined) {
  usage();
  process.exit(args.cmd === undefined ? 2 : 0);
}

switch (args.cmd) {
  case "append":
    cmdAppend(args.opts);
    break;
  case "gate-check":
    cmdGateCheck(args.opts);
    break;
  case "query":
    cmdQuery(args.opts);
    break;
  case "fp":
    cmdFp();
    break;
  default:
    process.stderr.write(`[evidence] unknown command: ${args.cmd}\n`);
    usage();
    process.exit(2);
}
