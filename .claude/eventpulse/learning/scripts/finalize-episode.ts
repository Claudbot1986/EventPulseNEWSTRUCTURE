#!/usr/bin/env tsx
/**
 * finalize-episode.ts — Episode finalizer (Phase L-B)
 *
 * Per master-prompt §4 + §K3 user feedback: episodes triggas från
 * `mission.terminal`-events (inte PostToolUse Bash), kör en tydlig
 * state-machine (active → implemented → verified → reconciled → finalized),
 * och atomiskt räknar upp counter med exklusiv lock.
 *
 * Trigger:
 *   1. Hook-mode: `npx tsx finalize-episode.ts --via-terminal-emitter`
 *      Tar JSON-payload på stdin (samma format som mission-terminal-emitter).
 *   2. CLI-mode:  `npx tsx finalize-episode.ts --mission-id <id>`
 *      Finalize:a specifik mission.
 *   3. Scan-mode: `npx tsx finalize-episode.ts`
 *      Itererar alla `mission.terminal`-events och finalize:ar de som inte
 *      har en episode ännu.
 *
 * Idempotens: om EP-EPISODE-*.json redan finns för mission_id → skip.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { inferStates, isReviewEligible } from "./state-machine";
import { readCounter, updateCounter } from "./counter";
import type { Episode, EpisodeStateMap, EpisodeTerminalState, CounterState } from "./episode-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const SCHEMA_VERSION = "ep-episode-1.0";
const COHORT: "live_instrumented" = "live_instrumented";

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

function episodesDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "episodes");
}

function episodePath(repoRoot: string, episodeId: string): string {
  // episodes/YYYY/MM/EP-EPISODE-YYYY-MM-DD-NNN.json
  const m = episodeId.match(/EP-EPISODE-(\d{4})-(\d{2})-(\d{2})-(\d+)/);
  if (!m) throw new Error(`invalid episode_id format: ${episodeId}`);
  const dir = path.join(episodesDir(repoRoot), m[1], m[2]);
  return path.join(dir, `${episodeId}.json`);
}

function missionYamlPath(repoRoot: string, missionId: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "missions", `${missionId}.yaml`);
}

function readMissionYaml(repoRoot: string, missionId: string): string | null {
  const p = missionYamlPath(repoRoot, missionId);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function episodeExists(repoRoot: string, missionId: string): boolean {
  const dir = episodesDir(repoRoot);
  if (!fs.existsSync(dir)) return false;
  // Search recursively for any episode file referencing this mission_id
  function walk(d: string): boolean {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
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

function findEpisodeForMission(repoRoot: string, missionId: string): string | null {
  const dir = episodesDir(repoRoot);
  if (!fs.existsSync(dir)) return null;
  function walk(d: string): string | null {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (e.name.endsWith(".json")) {
        try {
          const ep = JSON.parse(fs.readFileSync(full, "utf8"));
          if (ep.mission_id === missionId) return full;
        } catch {
          // skip
        }
      }
    }
    return null;
  }
  return walk(dir);
}

function computeQualityScore(episode: Partial<Episode>): number {
  let total = 0;
  let available = 0;
  const fieldWeights: Record<string, number> = {
    "metadata.working_tree_fp": 0.10,
    "metadata.verification_profile": 0.10,
    "outcome.task_success": 0.15,
    "outcome.first_attempt_passed": 0.10,
    "outcome.gates_passed": 0.10,
    "outcome.duration_ms": 0.05,
    "state_machine.implemented_at": 0.10,
    "state_machine.verified_at": 0.15,
    "state_machine.reconciled_at": 0.10,
    "evidence_refs": 0.05,
  };
  for (const [path, weight] of Object.entries(fieldWeights)) {
    total += weight;
    const value = path.split(".").reduce((acc: any, k) => acc?.[k], episode);
    if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      available += weight;
    }
  }
  return total === 0 ? 0 : available / total;
}

function nextEpisodeSeq(repoRoot: string, dateStr: string): number {
  // Räkna antal episoder för dagens datum
  const dir = path.join(episodesDir(repoRoot), dateStr.slice(0, 4), dateStr.slice(5, 7));
  if (!fs.existsSync(dir)) return 1;
  const existing = fs.readdirSync(dir).filter((f) => f.startsWith(`EP-EPISODE-${dateStr}`));
  return existing.length + 1;
}

function parseField(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
  const m = re.exec(text);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function gitSafe(repoRoot: string, args: string[]): string {
  try {
    const out = execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch {
    return "";
  }
}

export interface FinalizeArgs {
  missionId: string;
  sessionId: string | null;
  terminalState: EpisodeTerminalState;
  terminalTs: string;
  repoRoot: string;
}

export async function finalizeOne(args: FinalizeArgs): Promise<{
  ok: boolean;
  skipped?: boolean;
  episodeId?: string;
  error?: string;
}> {
  const { missionId, sessionId, terminalState, terminalTs, repoRoot } = args;

  // Idempotens: skippa om episode redan finns
  if (episodeExists(repoRoot, missionId)) {
    return { ok: true, skipped: true };
  }

  const ledger = readLedger(repoRoot);
  const missionEntries = ledger.filter((e: any) => e.mission_id === missionId);
  const stateMap: EpisodeStateMap = inferStates(missionEntries);
  // Sätt finalized_at som vi själva gör nu
  const finalizeTs = new Date().toISOString();
  stateMap.finalized_at = finalizeTs;

  const missionYaml = readMissionYaml(repoRoot, missionId) ?? "";
  const verificationProfile = parseField(missionYaml, "verification_profile");
  const sessionIdFromYaml = parseField(missionYaml, "session_id");
  const createdAt = parseField(missionYaml, "created_at");

  // Pull outcome from verify.passed/failed
  const verifyPassed = missionEntries.find((e: any) => e.event === "verify.passed");
  const verifyFailed = missionEntries.find((e: any) => e.event === "verify.failed");

  const gatesPassed: string[] = verifyPassed?.gates_passed ?? [];
  const gatesFailed: string[] = verifyPassed?.gates_failed ?? verifyFailed?.gates_failed ?? [];
  const gatesUnknown: string[] = verifyPassed?.gates_unknown ?? [];

  const workingTreeFp = verifyPassed?.working_tree_fp ?? missionEntries.find((e: any) => e.working_tree_fp)?.working_tree_fp ?? null;
  const headSha = gitSafe(repoRoot, ["rev-parse", "--short", "HEAD"]) || null;

  const dateStr = finalizeTs.slice(0, 10);
  const seq = nextEpisodeSeq(repoRoot, dateStr);
  const episodeId = `EP-EPISODE-${dateStr}-${String(seq).padStart(3, "0")}`;

  // Compute quality score BEFORE filling corrections/evidence_refs
  const episodeDraft: Partial<Episode> = {
    episode_id: episodeId,
    schema_version: SCHEMA_VERSION,
    created_at: finalizeTs,
    mission_id: missionId,
    session_id: sessionId ?? sessionIdFromYaml ?? "unknown",
    terminal_state: terminalState,
    state_machine: stateMap,
    cohort: COHORT,
    review_eligible: false, // sätts nedan
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
    evidence_refs: missionEntries.slice(-5).map((_: any, i: number) => `ledger.ndjson:L${missionEntries.length - 5 + i}`),
    redaction_policy: "applied",
    historical_backfill: false,
    optimizer_eligibility: terminalState === "completed" ? "replay_only" : "none",
  };

  const qualityScore = computeQualityScore(episodeDraft);
  const reviewEligible = isReviewEligible(stateMap) && qualityScore >= 0.40 && terminalState === "completed";

  const episode: Episode = {
    ...(episodeDraft as Episode),
    review_eligible: reviewEligible,
    learning_quality_score: Math.round(qualityScore * 1000) / 1000,
  };

  // Write atomically
  const targetPath = episodePath(repoRoot, episodeId);
  ensureDir(path.dirname(targetPath));
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  const json = JSON.stringify(episode, null, 2);
  fs.writeFileSync(tmpPath, redactSecrets(json), "utf8");
  fs.renameSync(tmpPath, targetPath);

  // Update counter atomically
  const updated = await updateCounter(repoRoot, (current: CounterState): CounterState => {
    const next: CounterState = {
      ...current,
      all_terminal_episodes: current.all_terminal_episodes + 1,
      review_eligible_episodes: current.review_eligible_episodes + (reviewEligible ? 1 : 0),
      since_last_review: reviewEligible ? current.since_last_review + 1 : current.since_last_review,
      review_every: current.review_every,
      last_updated: new Date().toISOString(),
    };
    return next;
  });

  // Write to outcomes.ndjson (append-only)
  const outcomesPath = path.join(repoRoot, ".claude", "eventpulse", "learning", "outcomes.ndjson");
  ensureDir(path.dirname(outcomesPath));
  const outcomeRecord = {
    episode_id: episodeId,
    mission_id: missionId,
    terminal_state: terminalState,
    review_eligible: reviewEligible,
    learning_quality_score: episode.learning_quality_score,
    at: finalizeTs,
  };
  fs.appendFileSync(outcomesPath, JSON.stringify(outcomeRecord) + "\n", "utf8");

  process.stderr.write(
    `[finalize-episode] wrote ${episodeId} mission=${missionId} state=${terminalState} eligible=${reviewEligible} score=${episode.learning_quality_score} counter=${updated.since_last_review}/${updated.review_every}\n`,
  );
  return { ok: true, episodeId };
}

// --- CLI / Hook entry ---------------------------------------------------

async function readStdin(): Promise<string> {
  return new Promise((resolveP) => {
    let buf = "";
    if (process.stdin.isTTY) {
      resolveP("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => { buf += chunk; });
    process.stdin.on("end", () => resolveP(buf));
    process.stdin.on("error", () => resolveP(buf));
    setTimeout(() => resolveP(buf), 1000);
  });
}

function parseArgs(argv: string[]): { viaTerminalEmitter: boolean; missionId: string | null } {
  let viaTerminalEmitter = false;
  let missionId: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--via-terminal-emitter") viaTerminalEmitter = true;
    else if (argv[i] === "--mission-id") missionId = argv[++i] ?? null;
  }
  return { viaTerminalEmitter, missionId };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);

  if (args.viaTerminalEmitter) {
    const raw = (await readStdin()).trim();
    if (!raw) {
      process.exit(0);
    }
    let payload: any = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stderr.write("[finalize-episode] WARN: failed to parse stdin; allowing.\n");
      process.exit(0);
    }
    if (!payload.mission_id) {
      process.exit(0);
    }
    const result = await finalizeOne({
      missionId: payload.mission_id,
      sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
      terminalState: payload.terminal_state ?? "completed",
      terminalTs: typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
      repoRoot,
    });
    process.exit(result.ok ? 0 : 1);
  }

  if (args.missionId) {
    const result = await finalizeOne({
      missionId: args.missionId,
      sessionId: null,
      terminalState: "completed",
      terminalTs: new Date().toISOString(),
      repoRoot,
    });
    process.exit(result.ok ? 0 : 1);
  }

  // Scan-mode: iterera alla mission.terminal-events och finalize:a de som saknar episode
  const ledger = readLedger(repoRoot);
  const terminals = ledger.filter((e: any) => e.event === "mission.terminal");
  let finalized = 0;
  let skipped = 0;
  for (const t of terminals) {
    const missionId = t.mission_id;
    if (!missionId) continue;
    const result = await finalizeOne({
      missionId,
      sessionId: typeof t.session_id === "string" ? t.session_id : null,
      terminalState: t.terminal_state ?? "completed",
      terminalTs: typeof t.ts === "string" ? t.ts : new Date().toISOString(),
      repoRoot,
    });
    if (result.skipped) skipped++;
    if (result.ok && !result.skipped) finalized++;
  }
  process.stderr.write(`[finalize-episode] scan complete: finalized=${finalized} skipped=${skipped}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[finalize-episode] ERROR (fail-open): ${msg}\n`);
  process.exit(0);
});