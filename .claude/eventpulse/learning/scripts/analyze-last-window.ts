#!/usr/bin/env tsx
/**
 * analyze-last-window.ts — Review analyzer (Phase L-C)
 *
 * Per master-prompt §13: läser senaste N review-eligible episoder, beräknar
 * metrics med INSUFFICIENT DATA-markeringar, skriver REVIEW-YYYYMMDD-NNN.md.
 *
 * Användning:
 *   npx tsx analyze-last-window.ts [--window 20] [--output <path>]
 *
 * Output:
 *   learning/optimization-reviews/REVIEW-YYYY-MM-DD-NNN.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Episode } from "./episode-types";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const SCHEMA_VERSION = "ep-review-1.0";

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function episodesDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "episodes");
}

function reviewsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimization-reviews");
}

export interface WindowMetrics {
  total_episodes: number;
  review_eligible: number;
  terminal_state_distribution: Record<string, number>;
  task_success_rate: number | "INSUFFICIENT_DATA";
  first_attempt_pass_rate: number | "INSUFFICIENT_DATA";
  avg_learning_quality: number | "INSUFFICIENT_DATA";
  median_learning_quality: number | "INSUFFICIENT_DATA";
  top_failure_profiles: Array<{ profile: string; count: number }>;
  top_gates_failed: Array<{ gate: string; count: number }>;
  window_start: string | null;
  window_end: string | null;
}

export function computeMetrics(episodes: Episode[]): WindowMetrics {
  const reviewEligible = episodes.filter((e) => e.review_eligible);
  const total = episodes.length;

  const terminalDist: Record<string, number> = {};
  for (const e of episodes) {
    terminalDist[e.terminal_state] = (terminalDist[e.terminal_state] ?? 0) + 1;
  }

  const taskSuccessValues = reviewEligible
    .map((e) => e.outcome?.task_success)
    .filter((v): v is boolean => typeof v === "boolean");
  const firstAttemptValues = reviewEligible
    .map((e) => e.outcome?.first_attempt_passed)
    .filter((v): v is boolean => typeof v === "boolean");

  const taskSuccessRate =
    taskSuccessValues.length >= 5
      ? taskSuccessValues.filter(Boolean).length / taskSuccessValues.length
      : "INSUFFICIENT_DATA";
  const firstAttemptPassRate =
    firstAttemptValues.length >= 5
      ? firstAttemptValues.filter(Boolean).length / firstAttemptValues.length
      : "INSUFFICIENT_DATA";

  const qualityScores = reviewEligible
    .map((e) => e.learning_quality_score)
    .filter((v): v is number => typeof v === "number" && v > 0);

  const avgQuality =
    qualityScores.length >= 3
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : "INSUFFICIENT_DATA";
  const sorted = [...qualityScores].sort((a, b) => a - b);
  const medianQuality =
    sorted.length >= 3
      ? sorted[Math.floor(sorted.length / 2)]
      : "INSUFFICIENT_DATA";

  // top failure profiles
  const profileCount: Record<string, number> = {};
  for (const e of episodes) {
    const p = e.metadata?.verification_profile ?? "unknown";
    if (e.terminal_state === "failed" || e.terminal_state === "blocked") {
      profileCount[p] = (profileCount[p] ?? 0) + 1;
    }
  }
  const topFailureProfiles = Object.entries(profileCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([profile, count]) => ({ profile, count }));

  // top gates failed
  const gateCount: Record<string, number> = {};
  for (const e of episodes) {
    for (const g of e.outcome?.gates_failed ?? []) {
      gateCount[g] = (gateCount[g] ?? 0) + 1;
    }
  }
  const topGatesFailed = Object.entries(gateCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([gate, count]) => ({ gate, count }));

  // Window timing
  const dates = episodes
    .map((e) => e.created_at)
    .filter((d): d is string => typeof d === "string")
    .sort();
  const windowStart = dates[0] ?? null;
  const windowEnd = dates[dates.length - 1] ?? null;

  return {
    total_episodes: total,
    review_eligible: reviewEligible.length,
    terminal_state_distribution: terminalDist,
    task_success_rate: taskSuccessRate,
    first_attempt_pass_rate: firstAttemptPassRate,
    avg_learning_quality: avgQuality,
    median_learning_quality: medianQuality,
    top_failure_profiles: topFailureProfiles,
    top_gates_failed: topGatesFailed,
    window_start: windowStart,
    window_end: windowEnd,
  };
}

export function formatMetric(value: number | "INSUFFICIENT_DATA", precision = 3): string {
  if (value === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  return (value as number).toFixed(precision);
}

export function loadAllEpisodes(repoRoot: string): Episode[] {
  const dir = episodesDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: Episode[] = [];
  function walk(d: string): void {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".json")) {
        try {
          out.push(JSON.parse(fs.readFileSync(full, "utf8")));
        } catch {
          // skip
        }
      }
    }
  }
  walk(dir);
  // Sort by created_at
  out.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  return out;
}

export interface AnalyzeResult {
  review_id: string;
  review_path: string;
  metrics: WindowMetrics;
  review_window: Episode[];
}

export function nextReviewSeq(repoRoot: string, dateStr: string): number {
  const dir = reviewsDir(repoRoot);
  ensureDir(dir);
  const existing = fs.readdirSync(dir).filter((f) => f.startsWith(`REVIEW-${dateStr}`));
  return existing.length + 1;
}

export function analyzeWindow(repoRoot: string, windowSize: number): AnalyzeResult {
  const allEpisodes = loadAllEpisodes(repoRoot);
  const reviewEligible = allEpisodes.filter((e) => e.review_eligible);
  const window = reviewEligible.slice(-windowSize);
  const metrics = computeMetrics(window);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const seq = nextReviewSeq(repoRoot, dateStr);
  const reviewId = `REVIEW-${dateStr}-${String(seq).padStart(3, "0")}`;

  const lines: string[] = [];
  lines.push(`# Review ${reviewId}`);
  lines.push("");
  lines.push(`- schema_version: ${SCHEMA_VERSION}`);
  lines.push(`- generated_at: ${now.toISOString()}`);
  lines.push(`- window_size: ${window.length}`);
  lines.push(`- window_start: ${metrics.window_start}`);
  lines.push(`- window_end: ${metrics.window_end}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push(`- total_episodes_in_window: ${metrics.total_episodes}`);
  lines.push(`- review_eligible: ${metrics.review_eligible}`);
  lines.push(`- task_success_rate: ${formatMetric(metrics.task_success_rate)}`);
  lines.push(`- first_attempt_pass_rate: ${formatMetric(metrics.first_attempt_pass_rate)}`);
  lines.push(`- avg_learning_quality: ${formatMetric(metrics.avg_learning_quality)}`);
  lines.push(`- median_learning_quality: ${formatMetric(metrics.median_learning_quality)}`);
  lines.push("");
  lines.push("### Terminal state distribution");
  for (const [k, v] of Object.entries(metrics.terminal_state_distribution)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("### Top failure profiles");
  if (metrics.top_failure_profiles.length === 0) {
    lines.push("- (none in this window)");
  } else {
    for (const f of metrics.top_failure_profiles) {
      lines.push(`- ${f.profile}: ${f.count}`);
    }
  }
  lines.push("");
  lines.push("### Top gates failed");
  if (metrics.top_gates_failed.length === 0) {
    lines.push("- (none in this window)");
  } else {
    for (const g of metrics.top_gates_failed) {
      lines.push(`- ${g.gate}: ${g.count}`);
    }
  }
  lines.push("");
  lines.push("## Episodes in window");
  for (const e of window) {
    lines.push(`- ${e.episode_id} | mission=${e.mission_id} | state=${e.terminal_state} | quality=${e.learning_quality_score} | success=${e.outcome?.task_success ?? "?"}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- Per master-prompt §13: low-sample metrics are marked `INSUFFICIENT_DATA`.");
  lines.push("- Per K3 feedback: backfilled episodes are kept in cohort `historical_backfill` and may be excluded from this window.");

  const targetPath = path.join(reviewsDir(repoRoot), `${reviewId}.md`);
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, lines.join("\n") + "\n", "utf8");

  return { review_id: reviewId, review_path: targetPath, metrics, review_window: window };
}

function parseArgs(argv: string[]): { window: number; output: string | null } {
  let window = 20;
  let output: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--window") window = Number(argv[++i]) || 20;
    else if (argv[i] === "--output") output = argv[++i] ?? null;
  }
  return { window, output };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  const result = analyzeWindow(repoRoot, args.window);
  process.stderr.write(
    `[analyze-last-window] wrote ${result.review_id} path=${result.review_path} eligible=${result.metrics.review_eligible}\n`,
  );
  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(result.metrics, null, 2), "utf8");
  }
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
    process.stderr.write(`[analyze-last-window] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}