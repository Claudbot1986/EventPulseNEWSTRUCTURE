#!/usr/bin/env tsx
/**
 * optimization-proposal.ts — Optimization proposal generator (Phase L-C)
 *
 * Per master-prompt §13 + §15: från REVIEW-resultat generera 1+ OPT-förslag.
 * Varje OPT rankas efter confidence (impact × sample-size).
 *
 * §15 — OPT får ALDRIG vara:
 *   - North Star, authority, safety, completion-gate, Braid-enablement
 *
 * Användning:
 *   npx tsx optimization-proposal.ts --review-id REVIEW-2026-08-26-001
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WindowMetrics } from "./analyze-last-window";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const SCHEMA_VERSION = "ep-opt-1.0";

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function proposalsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "proposals");
}

function reviewsDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "optimization-reviews");
}

// §15 Tier-0-protected topics — OPT får aldrig röra dessa
const FORBIDDEN_TOPICS = [
  "north_star",
  "authority_hierarchy",
  "safety_policy",
  "completion_gate",
  "braid_enablement",
  "agent_permissions",
  "mission_compiler_policy",
  "routing_thresholds",
  "verification_requirements",
];

export interface OptimizationProposal {
  opt_id: string;
  title: string;
  rationale: string;
  evidence: string[];
  expected_impact: "low" | "medium" | "high";
  confidence: number; // 0..1
  scope: string[];
  status: "proposed" | "auto_testable" | "human_review_pending" | "accepted" | "rejected" | "implemented";
  forbidden_check: "passed";
  review_id: string;
  generated_at: string;
  recommendations: string[];
}

function parseReview(reviewPath: string): WindowMetrics | null {
  if (!fs.existsSync(reviewPath)) return null;
  const content = fs.readFileSync(reviewPath, "utf8");
  // crude parse: extract metrics block
  const metricsBlock = content.match(/## Metrics\n([\s\S]+?)\n## /);
  if (!metricsBlock) return null;
  const block = metricsBlock[1];
  function pick(re: RegExp): string | null {
    const m = block.match(re);
    return m ? m[1].trim() : null;
  }
  const total = Number(pick(/- total_episodes_in_window:\s*(\d+)/) ?? "0");
  const eligible = Number(pick(/- review_eligible:\s*(\d+)/) ?? "0");
  const taskSuccess = pick(/- task_success_rate:\s*(.+)/);
  const topFailureProfiles: Array<{ profile: string; count: number }> = [];
  const failureBlock = content.match(/### Top failure profiles\n([\s\S]+?)\n### /);
  if (failureBlock) {
    for (const line of failureBlock[1].split("\n")) {
      const m = line.match(/^-\s+(\S+):\s+(\d+)/);
      if (m) topFailureProfiles.push({ profile: m[1], count: Number(m[2]) });
    }
  }
  const topGatesFailed: Array<{ gate: string; count: number }> = [];
  const gatesBlock = content.match(/### Top gates failed\n([\s\S]+?)\n## /);
  if (gatesBlock) {
    for (const line of gatesBlock[1].split("\n")) {
      const m = line.match(/^-\s+(\S+):\s+(\d+)/);
      if (m) topGatesFailed.push({ gate: m[1], count: Number(m[2]) });
    }
  }
  return {
    total_episodes: total,
    review_eligible: eligible,
    terminal_state_distribution: {},
    task_success_rate: taskSuccess === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : Number(taskSuccess),
    first_attempt_pass_rate: "INSUFFICIENT_DATA",
    avg_learning_quality: "INSUFFICIENT_DATA",
    median_learning_quality: "INSUFFICIENT_DATA",
    top_failure_profiles: topFailureProfiles,
    top_gates_failed: topGatesFailed,
    window_start: pick(/- window_start:\s*(.+)/),
    window_end: pick(/- window_end:\s*(.+)/),
  };
}

function isForbidden(title: string, scope: string[]): boolean {
  const lower = `${title} ${scope.join(" ")}`.toLowerCase();
  return FORBIDDEN_TOPICS.some((topic) => lower.includes(topic.replace(/_/g, " ")));
}

function makeProposal(opts: {
  title: string;
  rationale: string;
  evidence: string[];
  expected_impact: "low" | "medium" | "high";
  confidence: number;
  scope: string[];
  recommendations: string[];
  review_id: string;
  review_metrics: WindowMetrics;
}): OptimizationProposal | null {
  if (isForbidden(opts.title, opts.scope)) {
    process.stderr.write(
      `[optimization-proposal] BLOCKED: forbidden topic detected in proposal "${opts.title}"\n`,
    );
    return null;
  }
  // Sample-size guard: confidence cap baserat på review_eligible
  const sample = opts.review_metrics.review_eligible;
  let confidence = opts.confidence;
  if (sample < 5) confidence = Math.min(confidence, 0.30);
  else if (sample < 10) confidence = Math.min(confidence, 0.50);
  else if (sample < 20) confidence = Math.min(confidence, 0.70);

  const dateStr = new Date().toISOString().slice(0, 10);
  const dir = proposalsDir(process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT);
  ensureDir(dir);
  const seq = fs.readdirSync(dir).filter((f) => f.startsWith(`OPT-${dateStr}`)).length + 1;
  const optId = `OPT-${dateStr}-${String(seq).padStart(3, "0")}`;
  return {
    opt_id: optId,
    title: opts.title,
    rationale: opts.rationale,
    evidence: opts.evidence,
    expected_impact: opts.expected_impact,
    confidence: Math.round(confidence * 1000) / 1000,
    scope: opts.scope,
    status: "proposed",
    forbidden_check: "passed",
    review_id: opts.review_id,
    generated_at: new Date().toISOString(),
    recommendations: opts.recommendations,
  };
}

function renderMarkdown(p: OptimizationProposal): string {
  const lines: string[] = [];
  lines.push(`# ${p.opt_id} — ${p.title}`);
  lines.push("");
  lines.push(`- schema_version: ${SCHEMA_VERSION}`);
  lines.push(`- status: ${p.status}`);
  lines.push(`- confidence: ${p.confidence}`);
  lines.push(`- expected_impact: ${p.expected_impact}`);
  lines.push(`- forbidden_check: ${p.forbidden_check}`);
  lines.push(`- review_id: ${p.review_id}`);
  lines.push(`- generated_at: ${p.generated_at}`);
  lines.push("");
  lines.push("## Rationale");
  lines.push(p.rationale);
  lines.push("");
  lines.push("## Evidence");
  for (const e of p.evidence) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## Scope");
  for (const s of p.scope) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Recommendations");
  for (const r of p.recommendations) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Promote Gate");
  lines.push("- Status: `proposed`");
  lines.push("- Per §44: optimizer NEVER sets `accepted` or `implemented`.");
  lines.push("- Required human action: review evidence → set status to `accepted` or `rejected`.");
  lines.push("");
  return lines.join("\n");
}

export function generateProposalsForReview(repoRoot: string, reviewId: string): OptimizationProposal[] {
  const reviewPath = path.join(reviewsDir(repoRoot), `${reviewId}.md`);
  const metrics = parseReview(reviewPath);
  if (!metrics) {
    process.stderr.write(`[optimization-proposal] could not parse ${reviewPath}\n`);
    return [];
  }

  const proposals: OptimizationProposal[] = [];

  // Rule 1: top failure profile → targeted retry-budget proposal
  if (metrics.top_failure_profiles.length > 0) {
    const top = metrics.top_failure_profiles[0];
    const p = makeProposal({
      title: `Reduce ${top.profile} failure rate`,
      rationale: `Profile "${top.profile}" had ${top.count} failures in the last window of ${metrics.review_eligible} review-eligible episodes.`,
      evidence: [`review_id=${reviewId}`, `top_failure_profile: ${top.profile}: ${top.count}`],
      expected_impact: "medium",
      confidence: 0.55,
      scope: [".claude/eventpulse/profiles/" + top.profile + ".yaml"],
      recommendations: [
        "Investigate root cause via handoff artifacts",
        "Consider adding a more targeted retry or stricter evidence freshness",
        "Run replay-eval on the candidate fix",
      ],
      review_id: reviewId,
      review_metrics: metrics,
    });
    if (p) proposals.push(p);
  }

  // Rule 2: top failed gate → freshness-window proposal
  if (metrics.top_gates_failed.length > 0) {
    const top = metrics.top_gates_failed[0];
    const p = makeProposal({
      title: `Tighten evidence freshness for gate "${top.gate}"`,
      rationale: `Gate "${top.gate}" failed ${top.count} times in the window. May indicate stale evidence is being accepted.`,
      evidence: [`review_id=${reviewId}`, `top_failed_gate: ${top.gate}: ${top.count}`],
      expected_impact: "low",
      confidence: 0.40,
      scope: [".claude/eventpulse/verify-completion.ts (max_age_seconds tuning)"],
      recommendations: [
        "Inspect failed episodes' working_tree_fp timestamps",
        "If consistently close to max_age_seconds, reduce by 25%",
        "Verify with replay-eval on 5+ historical episodes",
      ],
      review_id: reviewId,
      review_metrics: metrics,
    });
    if (p) proposals.push(p);
  }

  // Write proposal files
  const dir = proposalsDir(repoRoot);
  ensureDir(dir);
  for (const p of proposals) {
    const target = path.join(dir, `${p.opt_id}.md`);
    fs.writeFileSync(target, renderMarkdown(p), "utf8");
    process.stderr.write(`[optimization-proposal] wrote ${p.opt_id} status=${p.status} confidence=${p.confidence}\n`);
  }
  return proposals;
}

function parseArgs(argv: string[]): { reviewId: string | null } {
  let reviewId: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--review-id") reviewId = argv[++i] ?? null;
  }
  return { reviewId };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  if (!args.reviewId) {
    process.stderr.write("[optimization-proposal] usage: --review-id REVIEW-...\n");
    process.exit(1);
  }
  const proposals = generateProposalsForReview(repoRoot, args.reviewId);
  process.exit(0);
}

// Only invoke main() when run directly (not when imported as a module).
// Without this guard, importing this file from another script would
// trigger process.exit() during the other script's execution.
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
    process.stderr.write(`[optimization-proposal] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}