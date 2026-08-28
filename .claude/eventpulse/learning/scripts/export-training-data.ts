#!/usr/bin/env tsx
/**
 * export-training-data.ts — Training data exporter (Phase L-E)
 *
 * Per master-prompt §20: exporterar episode-data till 4 format. Vi tränar
 * INGET — bara exporterar.
 *
 * Format:
 *   - router:    routing-decisions features (mission_id → subsystem, gates)
 *   - classifier: classification labels (verification_profile, terminal_state)
 *   - preference: prefer-references (corrections, before/after)
 *   - sft:       SFT-candidate format (input/output par för supervised fine-tuning)
 *   - eval:      eval-fixtures (held-out episodes för replay-eval)
 *
 * Filter: learning_quality_score >= threshold (default 0.70).
 * Pipeline: cohort = live_instrumented (vi exporterar EJ backfilled).
 *
 * Layer 1: EXPORT_FIELD_ALLOWLIST (vitlista)
 * Layer 2: regex-redaction (SECRET_PATTERNS)
 *
 * Användning:
 *   npx tsx export-training-data.ts --format router --quality-min 0.70 --output <path>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { filterByAllowlist, redactSecrets, FORMAT_ALLOWLISTS } from "./redact-secrets";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const SCHEMA_VERSION = "ep-export-1.0";

export type ExportFormat = "router" | "classifier" | "preference" | "sft" | "eval";

function episodesDir(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "episodes");
}

function loadEpisodes(repoRoot: string): any[] {
  const dir = episodesDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: any[] = [];
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
  return out;
}

interface ExportOptions {
  format: ExportFormat;
  qualityMin: number;
  output: string | null;
  cohort: "live_instrumented" | "all";
}

function parseArgs(argv: string[]): ExportOptions {
  let format: ExportFormat = "router";
  let qualityMin = 0.70;
  let output: string | null = null;
  let cohort: "live_instrumented" | "all" = "live_instrumented";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--format") {
      const v = argv[++i] ?? "router";
      if (!["router", "classifier", "preference", "sft", "eval"].includes(v)) {
        throw new Error(`invalid format: ${v}`);
      }
      format = v as ExportFormat;
    } else if (argv[i] === "--quality-min") {
      qualityMin = Number(argv[++i]) || 0.70;
    } else if (argv[i] === "--output") {
      output = argv[++i] ?? null;
    } else if (argv[i] === "--cohort") {
      const v = argv[++i] ?? "live_instrumented";
      if (!["live_instrumented", "all"].includes(v)) {
        throw new Error(`invalid cohort: ${v}`);
      }
      cohort = v as "live_instrumented" | "all";
    }
  }
  return { format, qualityMin, output, cohort };
}

function passesFilter(ep: any, opts: ExportOptions): boolean {
  const score = Number(ep.learning_quality_score ?? 0);
  if (score < opts.qualityMin) return false;
  if (opts.cohort === "live_instrumented" && ep.cohort !== "live_instrumented") return false;
  return true;
}

function toRouter(ep: any): any {
  return {
    episode_id: ep.episode_id,
    mission_id: ep.mission_id,
    session_id: ep.session_id,
    terminal_state: ep.terminal_state,
    task_success: ep.outcome?.task_success ?? null,
    verification_profile: ep.metadata?.verification_profile ?? null,
    gates_passed: ep.outcome?.gates_passed ?? [],
    gates_failed: ep.outcome?.gates_failed ?? [],
    quality_tier: tier(Number(ep.learning_quality_score ?? 0)),
  };
}

function toClassifier(ep: any): any {
  return {
    episode_id: ep.episode_id,
    mission_id: ep.mission_id,
    terminal_state: ep.terminal_state,
    task_success: ep.outcome?.task_success ?? null,
    first_attempt_passed: ep.outcome?.first_attempt_passed ?? null,
    verification_profile: ep.metadata?.verification_profile ?? null,
    gates_passed: ep.outcome?.gates_passed ?? [],
    gates_failed: ep.outcome?.gates_failed ?? [],
    quality_tier: tier(Number(ep.learning_quality_score ?? 0)),
  };
}

function toPreference(ep: any): any {
  const corrections = ep.corrections ?? [];
  if (corrections.length === 0) return null;
  return {
    episode_id: ep.episode_id,
    mission_id: ep.missionId ?? ep.mission_id,
    corrections: corrections.map((c: any) => ({
      correction_id: c.correction_id,
      type: c.type,
      reason: c.reason ?? null,
    })),
    quality_tier: tier(Number(ep.learning_quality_score ?? 0)),
  };
}

function toSft(ep: any): any {
  return {
    episode_id: ep.episode_id,
    mission_id: ep.mission_id,
    input: {
      mission_id: ep.mission_id,
      verification_profile: ep.metadata?.verification_profile ?? null,
      required_gates: ep.outcome?.gates_passed?.concat(ep.outcome?.gates_failed ?? []) ?? [],
    },
    output: {
      terminal_state: ep.terminal_state,
      task_success: ep.outcome?.task_success ?? null,
      first_attempt_passed: ep.outcome?.first_attempt_passed ?? null,
    },
    quality_tier: tier(Number(ep.learning_quality_score ?? 0)),
  };
}

function toEval(ep: any): any {
  return {
    episode_id: ep.episode_id,
    mission_id: ep.mission_id,
    held_out: true,
    fixture: {
      terminal_state: ep.terminal_state,
      task_success: ep.outcome?.task_success ?? null,
      gates_passed: ep.outcome?.gates_passed ?? [],
      gates_failed: ep.outcome?.gates_failed ?? [],
      verification_profile: ep.metadata?.verification_profile ?? null,
    },
    quality_tier: tier(Number(ep.learning_quality_score ?? 0)),
  };
}

function tier(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.70) return "medium";
  return "low";
}

const transformers: Record<ExportFormat, (ep: any) => any> = {
  router: toRouter,
  classifier: toClassifier,
  preference: toPreference,
  sft: toSft,
  eval: toEval,
};

export interface ExportResult {
  ok: boolean;
  format: ExportFormat;
  quality_min: number;
  cohort_filter: string;
  total_episodes: number;
  matching_episodes: number;
  records_written: number;
  dropped_paths: string[];
  output_path: string | null;
}

export function runExport(repoRoot: string, opts: ExportOptions): ExportResult {
  const all = loadEpisodes(repoRoot);
  const matching = all.filter((ep) => passesFilter(ep, opts));
  const transform = transformers[opts.format];

  const records: any[] = [];
  const allDropped: string[] = [];
  // Temporarily swap allowlist to format-specific
  const formatAllowlist = FORMAT_ALLOWLISTS[opts.format];
  for (const ep of matching) {
    const raw = transform(ep);
    if (raw === null) continue;
    // Filter to format-specific top-level fields
    const filtered: any = {};
    for (const [k, v] of Object.entries(raw)) {
      if (formatAllowlist.has(k)) {
        filtered[k] = v;
      } else {
        allDropped.push(k);
      }
    }
    // Apply regex redaction on string fields
    const redacted = redactSecrets(filtered);
    records.push(redacted);
  }

  // Dedupe dropped_paths
  const droppedPaths = Array.from(new Set(allDropped));

  let outputPath: string | null = null;
  if (opts.output) {
    const header = {
      schema_version: SCHEMA_VERSION,
      format: opts.format,
      quality_min: opts.qualityMin,
      cohort_filter: opts.cohort,
      total_episodes: all.length,
      matching_episodes: matching.length,
      records_written: records.length,
      dropped_paths: droppedPaths,
      generated_at: new Date().toISOString(),
    };
    const lines: string[] = [];
    lines.push(JSON.stringify(header));
    for (const r of records) lines.push(JSON.stringify(r));
    fs.writeFileSync(opts.output, lines.join("\n") + "\n", "utf8");
    outputPath = opts.output;
  } else {
    // stdout
    const header = {
      schema_version: SCHEMA_VERSION,
      format: opts.format,
      quality_min: opts.qualityMin,
      cohort_filter: opts.cohort,
      total_episodes: all.length,
      matching_episodes: matching.length,
      records_written: records.length,
      dropped_paths: droppedPaths,
      generated_at: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(header) + "\n");
    for (const r of records) process.stdout.write(JSON.stringify(r) + "\n");
  }

  return {
    ok: true,
    format: opts.format,
    quality_min: opts.qualityMin,
    cohort_filter: opts.cohort,
    total_episodes: all.length,
    matching_episodes: matching.length,
    records_written: records.length,
    dropped_paths: droppedPaths,
    output_path: outputPath,
  };
}

async function main(): Promise<void> {
  const repoRoot = process.env.EP_REPO_ROOT ?? REPO_ROOT_DEFAULT;
  let args: ExportOptions;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[export-training-data] ERROR: ${msg}\n`);
    process.exit(1);
  }
  const result = runExport(repoRoot, args);
  process.stderr.write(
    `[export-training-data] format=${result.format} quality_min=${result.quality_min} matching=${result.matching_episodes}/${result.total_episodes} written=${result.records_written} output=${result.output_path ?? "stdout"}\n`,
  );
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
    process.stderr.write(`[export-training-data] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
