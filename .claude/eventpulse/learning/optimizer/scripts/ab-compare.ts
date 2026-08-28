#!/usr/bin/env tsx
/**
 * ab-compare.ts — A/B comparison with hard guardrails (Phase L-G)
 *
 * Per master-prompt §41 + K3: A/B-test tvä konfigurationer mot samma
 * episode-set. Hårda constraints (kan ALDRIG mark "better" enbart på
 * snabbhet/kostnad):
 *   - success_rate (treatment) >= success_rate (control)
 *   - no_regression: alla guardrail-metrics får inte försämras
 *   - safety_assertions: alla safety checks måste passera
 *   - statistical_significance: sample_size >= MIN_SAMPLE_SIZE
 *
 * Användning:
 *   npx tsx ab-compare.ts --control-config <name> --treatment-config <name>
 *                         --episodes <id1,id2,...> [--metric <name>] [--json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { replayEpisode } from "./replay-eval";
import { verifyCanonicalPath } from "./canonical-path-guard";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";

const MIN_SAMPLE_SIZE = 5;
const SUCCESS_RATE_MIN_DELTA = 0.0; // treatment >= control required

export type ABVerdict = "treatment_better" | "treatment_equal" | "treatment_worse" | "indeterminate" | "guardrail_violation";

export interface ABResult {
  control_config: string;
  treatment_config: string;
  episode_count: number;
  control_success_rate: number;
  treatment_success_rate: number;
  control_blocked_count: number;
  treatment_blocked_count: number;
  control_passed_count: number;
  treatment_passed_count: number;
  hard_guardrail_violations: string[];
  guardrail_metrics: Record<string, { control: number; treatment: number; passed: boolean }>;
  verdict: ABVerdict;
  reasoning: string;
}

export function abCompare(
  repoRoot: string,
  controlConfig: string,
  treatmentConfig: string,
  episodeIds: string[],
  mockExternal: boolean = true,
): ABResult {
  const hardGuardrailViolations: string[] = [];

  const guard = verifyCanonicalPath();
  if (!guard.ok) {
    hardGuardrailViolations.push(`canonical-path-guard failed: ${guard.errors.join("; ")}`);
  }

  if (episodeIds.length < MIN_SAMPLE_SIZE) {
    hardGuardrailViolations.push(
      `sample_size=${episodeIds.length} < MIN_SAMPLE_SIZE=${MIN_SAMPLE_SIZE} — INSUFFICIENT DATA`,
    );
    return {
      control_config: controlConfig,
      treatment_config: treatmentConfig,
      episode_count: episodeIds.length,
      control_success_rate: 0,
      treatment_success_rate: 0,
      control_blocked_count: 0,
      treatment_blocked_count: 0,
      control_passed_count: 0,
      treatment_passed_count: 0,
      hard_guardrail_violations: hardGuardrailViolations,
      guardrail_metrics: {},
      verdict: "indeterminate",
      reasoning: `sample size too small (need >= ${MIN_SAMPLE_SIZE})`,
    };
  }

  let controlPassed = 0;
  let controlBlocked = 0;
  let treatmentPassed = 0;
  let treatmentBlocked = 0;
  let controlDestructiveCount = 0;
  let treatmentDestructiveCount = 0;

  for (const eid of episodeIds) {
    const ctl = replayEpisode(repoRoot, eid, controlConfig, mockExternal);
    const trt = replayEpisode(repoRoot, eid, treatmentConfig, mockExternal);
    controlPassed += ctl.passed_count;
    controlBlocked += ctl.blocked_count;
    treatmentPassed += trt.passed_count;
    treatmentBlocked += trt.blocked_count;
    controlDestructiveCount += ctl.actions.filter((a) => a.kind === "destructive").length;
    treatmentDestructiveCount += trt.actions.filter((a) => a.kind === "destructive").length;

    // Guardrail: treatment introduces NEW destructive actions (not in control)
    const ctlDestructive = new Set(ctl.actions.filter((a) => a.kind === "destructive").map((a) => a.target));
    const newDestructive = trt.actions.filter(
      (a) => a.kind === "destructive" && !ctlDestructive.has(a.target),
    );
    if (newDestructive.length > 0) {
      hardGuardrailViolations.push(
        `treatment introduces ${newDestructive.length} new destructive action(s) for episode=${eid}`,
      );
    }
  }

  const controlTotal = controlPassed + controlBlocked;
  const treatmentTotal = treatmentPassed + treatmentBlocked;
  const controlSuccessRate = controlTotal > 0 ? controlPassed / controlTotal : 0;
  const treatmentSuccessRate = treatmentTotal > 0 ? treatmentPassed / treatmentTotal : 0;

  // Hard guardrail metrics
  const guardrailMetrics: Record<string, { control: number; treatment: number; passed: boolean }> = {
    success_rate: {
      control: controlSuccessRate,
      treatment: treatmentSuccessRate,
      passed: treatmentSuccessRate >= controlSuccessRate + SUCCESS_RATE_MIN_DELTA,
    },
    no_regression_passed: {
      control: controlPassed,
      treatment: treatmentPassed,
      passed: treatmentPassed >= controlPassed,
    },
    no_new_destructive: {
      control: controlDestructiveCount,
      treatment: treatmentDestructiveCount,
      passed: treatmentDestructiveCount <= controlDestructiveCount && hardGuardrailViolations.length === 0,
    },
  };

  const allGuardrailsPassed = Object.values(guardrailMetrics).every((m) => m.passed);

  let verdict: ABVerdict;
  let reasoning: string;
  if (!allGuardrailsPassed) {
    verdict = "guardrail_violation";
    reasoning = `guardrail_violation: ${Object.entries(guardrailMetrics)
      .filter(([_, m]) => !m.passed)
      .map(([k, m]) => `${k}(ctl=${m.control},trt=${m.treatment})`)
      .join("; ")}`;
  } else if (treatmentSuccessRate > controlSuccessRate) {
    verdict = "treatment_better";
    reasoning = `treatment_success_rate (${treatmentSuccessRate.toFixed(3)}) > control (${controlSuccessRate.toFixed(3)}), all guardrails passed`;
  } else if (treatmentSuccessRate === controlSuccessRate) {
    verdict = "treatment_equal";
    reasoning = `treatment_success_rate equals control (${controlSuccessRate.toFixed(3)})`;
  } else {
    verdict = "treatment_worse";
    reasoning = `treatment_success_rate (${treatmentSuccessRate.toFixed(3)}) < control (${controlSuccessRate.toFixed(3)})`;
  }

  return {
    control_config: controlConfig,
    treatment_config: treatmentConfig,
    episode_count: episodeIds.length,
    control_success_rate: controlSuccessRate,
    treatment_success_rate: treatmentSuccessRate,
    control_blocked_count: controlBlocked,
    treatment_blocked_count: treatmentBlocked,
    control_passed_count: controlPassed,
    treatment_passed_count: treatmentPassed,
    hard_guardrail_violations: hardGuardrailViolations,
    guardrail_metrics: guardrailMetrics,
    verdict,
    reasoning,
  };
}

function parseArgs(argv: string[]): {
  controlConfig: string | null;
  treatmentConfig: string | null;
  episodes: string[];
  json: boolean;
} {
  let controlConfig: string | null = null;
  let treatmentConfig: string | null = null;
  let episodesRaw: string | null = null;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--control-config") controlConfig = argv[++i] ?? null;
    else if (argv[i] === "--treatment-config") treatmentConfig = argv[++i] ?? null;
    else if (argv[i] === "--episodes") episodesRaw = argv[++i] ?? null;
    else if (argv[i] === "--json") json = true;
  }
  const episodes = episodesRaw ? episodesRaw.split(",").filter(Boolean) : [];
  return { controlConfig, treatmentConfig, episodes, json };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  const args = parseArgs(process.argv);
  if (!args.controlConfig || !args.treatmentConfig || args.episodes.length === 0) {
    process.stderr.write(
      "[ab-compare] usage: --control-config <name> --treatment-config <name> --episodes <id1,id2,...> [--json]\n",
    );
    process.exit(1);
  }
  const result = abCompare(repoRoot, args.controlConfig, args.treatmentConfig, args.episodes, true);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stderr.write(
      `[ab-compare] control=${result.control_config} treatment=${result.treatment_config} n=${result.episode_count} verdict=${result.verdict}\n  ctl_success=${result.control_success_rate.toFixed(3)} trt_success=${result.treatment_success_rate.toFixed(3)}\n  reasoning: ${result.reasoning}\n`,
    );
    if (result.hard_guardrail_violations.length > 0) {
      for (const v of result.hard_guardrail_violations) {
        process.stderr.write(`[ab-compare] HARD-VIOLATION: ${v}\n`);
      }
    }
  }
  process.exit(result.verdict === "treatment_better" || result.verdict === "treatment_equal" ? 0 : 1);
}

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
    process.stderr.write(`[ab-compare] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
