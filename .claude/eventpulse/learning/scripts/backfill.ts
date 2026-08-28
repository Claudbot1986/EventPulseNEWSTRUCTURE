#!/usr/bin/env tsx
/**
 * backfill.ts — Historical baseline generator (Phase L-D)
 *
 * Per master-prompt §17 + K3: bygg baseline från existerande missions/
 * + ledger-events. Tillskriv `cohort: "historical_backfill"`,
 * `historical_backfill: true`, telemetry completeness score.
 *
 * Användning:
 *   npx tsx backfill.ts [--dry-run] [--output <path>]
 *
 * Output:
 *   - episodes/YYYY/MM/EP-EPISODE-BACKFILL-...json (skippas vid --dry-run)
 *   - baselines/BASELINE-YYYY-MM-DD.md (rapport)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { computeQualityScore, isExcluded } from "./quality-score";
import { readCounter, updateCounter } from "./counter";
import type { Episode, EpisodeStateMap, EpisodeTerminalState } from "./episode-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const SCHEMA_VERSION = "ep-episode-1.0";
const COHORT: "historical_backfill" = "historical_backfill";
const QUALITY_THRESHOLD = 0.40;

const SECRET_RE = /(api[_-]?key|secret|password|access[_-]?token|supabase_service_role)\s*[:=]\s*[^\s,;]+/gi;
function redactSecrets(input: string): string {
  return input.replace(SECRET_RE, (_m, name: string) => `${name}=<REDACTED>`);
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function ledgerPath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "evidence", "ledger.ndjson");
}

function missionsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "missions");
}

function episodesDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "episodes");
}

function baselinesDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "baselines");
}

function readLedger(repoRoot: string): any[] {
  const p = ledgerPath(repoRoot);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function gitSafe(repoRoot: string, args: string[]): string {
  try {
    const out = execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch {
    return "";
  }
}

function parseField(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
  const m = re.exec(text);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function inferStateMapFromLedger(entries: any[]): EpisodeStateMap {
  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.ts ?? 0).getTime();
    const tb = new Date(b.ts ?? 0).getTime();
    return ta - tb;
  });
  const result: EpisodeStateMap = {
    active_at: null,
    implemented_at: null,
    verified_at: null,
    reconciled_at: null,
    finalized_at: null,
  };
  for (const e of sorted) {
    const ts = e.ts ?? new Date().toISOString();
    if (!result.active_at) result.active_at = ts;
    if (e.event === "verify.passed" && !result.verified_at) result.verified_at = ts;
    if (e.event === "reconcile.completed" && !result.reconciled_at) result.reconciled_at = ts;
    if (e.event === "PostToolUse" && typeof e.cmd === "string" && /^(npm run (build|test)|git commit|npx vitest|cargo build)/.test(e.cmd) && !result.implemented_at) {
      result.implemented_at = ts;
    }
  }
  return result;
}

function deriveTerminalState(entries: any[]): EpisodeTerminalState {
  const terminal = [...entries].reverse().find((e) => e.event === "mission.terminal");
  if (terminal?.terminal_state) return terminal.terminal_state;
  const verify = entries.find((e) => e.event === "verify.passed");
  if (verify) return "completed";
  return "unknown";
}

export interface BackfillResult {
  ok: boolean;
  missions_seen: number;
  episodes_written: number;
  episodes_skipped_existing: number;
  episodes_excluded_low_quality: number;
  baseline_path: string | null;
}

export interface BackfillOptions {
  dryRun: boolean;
  output: string | null;
}

function listMissionFiles(repoRoot: string): Array<{ missionId: string; yaml: string; createdAt: string }> {
  const dir = missionsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ missionId: string; yaml: string; createdAt: string }> = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".yaml")) continue;
    const full = path.join(dir, f);
    try {
      const content = fs.readFileSync(full, "utf8");
      const missionId = parseField(content, "mission_id") ?? f.replace(/\.yaml$/, "");
      const createdAt = parseField(content, "created_at") ?? new Date().toISOString();
      out.push({ missionId, yaml: content, createdAt });
    } catch {
      // skip
    }
  }
  return out;
}

function episodePathFor(repoRoot: string, missionId: string, createdAt: string): { path: string; id: string } {
  const dateStr = createdAt.slice(0, 10);
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(5, 7);
  const dir = path.join(episodesDir(repoRoot), year, month);
  // Use BACKFILL suffix to avoid collision with live episodes
  const id = `EP-EPISODE-BACKFILL-${dateStr}-${missionId}`;
  return { path: path.join(dir, `${id}.json`), id };
}

function episodeExists(repoRoot: string, missionId: string): boolean {
  const dir = episodesDir(repoRoot);
  if (!fs.existsSync(dir)) return false;
  function walk(d: string): boolean {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (walk(full)) return true;
      } else if (e.name.endsWith(".json")) {
        try {
          const ep = JSON.parse(fs.readFileSync(full, "utf8"));
          if (ep.mission_id === missionId) return true;
        } catch {
          // skip
        }
      }
    }
    return false;
  }
  return walk(dir);
}

export async function runBackfill(repoRoot: string, opts: BackfillOptions): Promise<BackfillResult> {
  const missions = listMissionFiles(repoRoot);
  const ledger = readLedger(repoRoot);
  const headSha = gitSafe(repoRoot, ["rev-parse", "--short", "HEAD"]) || null;

  let written = 0;
  let skippedExisting = 0;
  let excludedLowQuality = 0;
  const writtenFiles: string[] = [];
  const excludedFiles: string[] = [];
  const fieldCompleteness: Record<string, number> = {};
  const profiles: Record<string, number> = {};

  for (const m of missions) {
    if (episodeExists(repoRoot, m.missionId)) {
      skippedExisting++;
      continue;
    }
    const missionEntries = ledger.filter((e: any) => e.mission_id === m.missionId);
    const stateMap = inferStateMapFromLedger(missionEntries);
    const terminalState = deriveTerminalState(missionEntries);
    const sessionId = parseField(m.yaml, "session_id") ?? "unknown-backfill";
    const verificationProfile = parseField(m.yaml, "verification_profile");
    profiles[verificationProfile ?? "unknown"] = (profiles[verificationProfile ?? "unknown"] ?? 0) + 1;

    const verifyPassed = missionEntries.find((e: any) => e.event === "verify.passed");
    const verifyFailed = missionEntries.find((e: any) => e.event === "verify.failed");
    const gatesPassed: string[] = verifyPassed?.gates_passed ?? [];
    const gatesFailed: string[] = verifyPassed?.gates_failed ?? verifyFailed?.gates_failed ?? [];
    const gatesUnknown: string[] = verifyPassed?.gates_unknown ?? [];
    const workingTreeFp = verifyPassed?.working_tree_fp ?? missionEntries.find((e: any) => e.working_tree_fp)?.working_tree_fp ?? null;

    const episodeDraft: Partial<Episode> = {
      schema_version: SCHEMA_VERSION,
      created_at: m.createdAt,
      mission_id: m.missionId,
      session_id: sessionId,
      terminal_state: terminalState,
      state_machine: stateMap,
      cohort: COHORT,
      review_eligible: false,
      learning_quality_score: 0,
      metadata: {
        agent: missionEntries.find((e: any) => e.agent)?.agent ?? null,
        verification_profile: verificationProfile,
        working_tree_fp: workingTreeFp,
        head_sha: headSha,
      },
      outcome: {
        task_success: terminalState === "completed" ? true : terminalState === "failed" || terminalState === "blocked" ? false : null,
        first_attempt_passed: stateMap.verified_at && !verifyFailed ? true : false,
        duration_ms: null,
        tokens_input: null,
        tokens_output: null,
        cost_usd: null,
        gates_passed: gatesPassed,
        gates_failed: gatesFailed,
        gates_unknown: gatesUnknown,
      },
      corrections: [],
      evidence_refs: [],
      redaction_policy: "applied",
      historical_backfill: true,
      optimizer_eligibility: "none", // backfilled episodes are NEVER optimizer-eligible
    };

    const quality = computeQualityScore(episodeDraft);
    const episode: Episode = {
      ...(episodeDraft as Episode),
      learning_quality_score: Math.round(quality * 1000) / 1000,
    };

    // Track per-field completeness
    for (const fieldPath of Object.keys({
      "metadata.working_tree_fp": 1,
      "metadata.verification_profile": 1,
      "outcome.task_success": 1,
      "outcome.first_attempt_passed": 1,
      "outcome.gates_passed": 1,
      "outcome.duration_ms": 1,
      "state_machine.implemented_at": 1,
      "state_machine.verified_at": 1,
      "state_machine.reconciled_at": 1,
      "evidence_refs": 1,
    })) {
      const value = fieldPath.split(".").reduce((acc: any, k) => acc?.[k], episode);
      const filled = value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);
      if (filled) fieldCompleteness[fieldPath] = (fieldCompleteness[fieldPath] ?? 0) + 1;
    }

    if (isExcluded(quality, QUALITY_THRESHOLD)) {
      excludedLowQuality++;
      excludedFiles.push(m.missionId);
      continue;
    }

    const { path: targetPath, id } = episodePathFor(repoRoot, m.missionId, m.createdAt);
    if (!opts.dryRun) {
      ensureDir(path.dirname(targetPath));
      const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, redactSecrets(JSON.stringify(episode, null, 2)), "utf8");
      fs.renameSync(tmp, targetPath);
      writtenFiles.push(targetPath);
    }
    written++;
  }

  // Don't touch counter for backfilled episodes (per K3: live vs backfill cohort)
  // But we record what we did in outcomes.ndjson
  if (!opts.dryRun && written > 0) {
    const outcomesPath = path.join(repoRoot, ".claude", "eventpulse", "learning", "outcomes.ndjson");
    ensureDir(path.dirname(outcomesPath));
    const at = new Date().toISOString();
    for (const targetPath of writtenFiles) {
      try {
        const ep = JSON.parse(fs.readFileSync(targetPath, "utf8"));
        fs.appendFileSync(outcomesPath, JSON.stringify({
          episode_id: ep.episode_id,
          mission_id: ep.mission_id,
          terminal_state: ep.terminal_state,
          review_eligible: false, // backfilled NEVER review-eligible
          learning_quality_score: ep.learning_quality_score,
          cohort: COHORT,
          historical_backfill: true,
          at,
        }) + "\n", "utf8");
      } catch {
        // skip
      }
    }
  }

  // Generate baseline report
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  let baselinePath: string | null = null;
  if (!opts.dryRun) {
    const baselineFile = `BASELINE-${dateStr}.md`;
    const baselineFull = path.join(baselinesDir(repoRoot), baselineFile);
    ensureDir(path.dirname(baselineFull));
    const lines: string[] = [];
    lines.push(`# Baseline ${dateStr}`);
    lines.push("");
    lines.push(`- schema_version: ep-baseline-1.0`);
    lines.push(`- generated_at: ${now.toISOString()}`);
    lines.push(`- cohort: ${COHORT}`);
    lines.push(`- missions_seen: ${missions.length}`);
    lines.push(`- episodes_written: ${written}`);
    lines.push(`- episodes_skipped_existing: ${skippedExisting}`);
    lines.push(`- episodes_excluded_low_quality: ${excludedLowQuality}`);
    lines.push(`- quality_threshold: ${QUALITY_THRESHOLD}`);
    lines.push("");
    lines.push("## Field Completeness (among written episodes)");
    for (const [field, count] of Object.entries(fieldCompleteness).sort((a, b) => b[1] - a[1])) {
      const pct = written > 0 ? Math.round((count / written) * 100) : 0;
      lines.push(`- ${field}: ${count}/${written} (${pct}%)`);
    }
    lines.push("");
    lines.push("## Verification Profile Distribution");
    for (const [profile, count] of Object.entries(profiles).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${profile}: ${count}`);
    }
    lines.push("");
    lines.push("## Confidence");
    lines.push(`- Per §17: backfilled episodes are kept in cohort 'historical_backfill' and excluded from review-window.`);
    lines.push(`- Live (instrumented) episodes are kept in cohort 'live_instrumented'.`);
    lines.push(`- Per K3: counter does NOT include backfilled episodes (since_last_review unaffected).`);
    lines.push("");
    lines.push("## Limitations");
    lines.push("- tokens_input/output/cost are null for all historical episodes (we did not measure pre-L-A).");
    lines.push("- duration_ms is null for all historical episodes.");
    lines.push("- state_machine transitions are inferred from ledger event order, not from explicit state events.");
    lines.push("- corrections/references are empty (we did not capture these pre-L-B).");
    lines.push("- Episodes with quality < 0.40 are excluded and not written.");
    lines.push("");
    lines.push("## Notes");
    lines.push("- Run again with `--dry-run` to preview without writing.");
    lines.push("- Re-runs are idempotent — existing episodes are skipped.");
    lines.push("");
    fs.writeFileSync(baselineFull, lines.join("\n") + "\n", "utf8");
    baselinePath = baselineFull;
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, JSON.stringify({
      missions_seen: missions.length,
      episodes_written: written,
      episodes_skipped_existing: skippedExisting,
      episodes_excluded_low_quality: excludedLowQuality,
      excluded_mission_ids: excludedFiles,
      field_completeness: fieldCompleteness,
      profiles,
      cohort: COHORT,
    }, null, 2), "utf8");
  }

  process.stderr.write(
    `[backfill] missions=${missions.length} written=${written} skipped=${skippedExisting} excluded=${excludedLowQuality} baseline=${baselinePath ?? "dry-run"}\n`,
  );

  return {
    ok: true,
    missions_seen: missions.length,
    episodes_written: written,
    episodes_skipped_existing: skippedExisting,
    episodes_excluded_low_quality: excludedLowQuality,
    baseline_path: baselinePath,
  };
}

function parseArgs(argv: string[]): BackfillOptions {
  let dryRun = false;
  let output: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--output") output = argv[++i] ?? null;
  }
  return { dryRun, output };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  await runBackfill(repoRoot, args);
  process.exit(0);
}

// Only invoke main() when run directly (not when imported as a module).
import { fileURLToPath } from "node:url";
const isMain = (() => {
  try {
    if (typeof import.meta.url !== "string" || typeof process.argv[1] !== "string") return false;
    const scriptPath = fileURLToPath(import.meta.url);
    const argvPath = process.argv[1];
    const argvReal = fs.existsSync(argvPath) ? fs.realpathSync(argvPath) : argvPath;
    const scriptReal = fs.existsSync(scriptPath) ? fs.realpathSync(scriptPath) : scriptPath;
    return argvReal === scriptReal;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[backfill] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
