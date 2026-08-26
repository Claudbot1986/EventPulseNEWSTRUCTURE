#!/usr/bin/env tsx
/**
 * canonical-path-guard.ts — Verify project_root + repo identity (Phase L-F.1)
 *
 * Per master-prompt §42: optimizer får ALDRIG peka mot fel recovery-mapp.
 * canonical-path-guard verifierar att runtime-config.json pekar mot
 * rätt project_root och att repo-marker-filen finns.
 *
 * Användning:
 *   npx tsx canonical-path-guard.ts [--config <path>]
 *
 * Returnerar exit 0 om allt är OK, exit 1 om något är fel.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT_DEFAULT = "/Volumes/2TB filer/NEWSTRUCTURE-COPY";
const DEFAULT_CONFIG_PATH = "/Volumes/2TB filer/NEWSTRUCTURE-COPY/.claude/runtime-config.json";

interface RuntimeConfig {
  schema_version?: string;
  project_root?: string;
  repo_marker?: string;
  repo_identity_check?: {
    expected_path_suffix?: string;
    marker_file?: string;
  };
  optimizer?: Record<string, unknown>;
  launchd?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
}

export interface GuardResult {
  ok: boolean;
  config_path: string;
  project_root: string | null;
  marker_path: string | null;
  errors: string[];
  warnings: string[];
}

export function verifyCanonicalPath(
  configPath: string = DEFAULT_CONFIG_PATH,
  expectedProjectRoot?: string,
): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(configPath)) {
    return {
      ok: false,
      config_path: configPath,
      project_root: null,
      marker_path: null,
      errors: [`config not found: ${configPath}`],
      warnings,
    };
  }

  let cfg: RuntimeConfig;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      config_path: configPath,
      project_root: null,
      marker_path: null,
      errors: [`config not parseable: ${err instanceof Error ? err.message : String(err)}`],
      warnings,
    };
  }

  const projectRoot = cfg.project_root;
  const repoMarker = cfg.repo_marker ?? cfg.repo_identity_check?.marker_file ?? ".claude/eventpulse/policy.md";

  if (!projectRoot) {
    errors.push("project_root missing from runtime-config.json");
  } else {
    if (!fs.existsSync(projectRoot)) {
      errors.push(`project_root does not exist: ${projectRoot}`);
    }
    if (expectedProjectRoot && projectRoot !== expectedProjectRoot) {
      errors.push(`project_root mismatch: config=${projectRoot}, expected=${expectedProjectRoot}`);
    }
    const suffix = cfg.repo_identity_check?.expected_path_suffix;
    if (suffix && !projectRoot.endsWith(suffix)) {
      errors.push(`project_root does not end with '${suffix}': ${projectRoot}`);
    }
  }

  let markerPath: string | null = null;
  if (projectRoot && repoMarker) {
    markerPath = path.join(projectRoot, repoMarker);
    if (!fs.existsSync(markerPath)) {
      errors.push(`repo_marker not found: ${markerPath}`);
    }
  }

  // Soft warnings (non-blocking)
  if (!cfg.schema_version) {
    warnings.push("schema_version missing");
  }
  if (!cfg.optimizer) {
    warnings.push("optimizer config missing — defaults will be used");
  }

  return {
    ok: errors.length === 0,
    config_path: configPath,
    project_root: projectRoot ?? null,
    marker_path: markerPath,
    errors,
    warnings,
  };
}

function parseArgs(argv: string[]): { configPath: string; expected: string | null } {
  let configPath = DEFAULT_CONFIG_PATH;
  let expected: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i] ?? DEFAULT_CONFIG_PATH;
    else if (argv[i] === "--expected") expected = argv[++i] ?? null;
  }
  return { configPath, expected };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const result = verifyCanonicalPath(args.configPath, args.expected ?? undefined);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`[canonical-path-guard] WARN: ${w}\n`);
    }
  }
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      process.stderr.write(`[canonical-path-guard] ERROR: ${e}\n`);
    }
    process.exit(1);
  }
  process.stderr.write(`[canonical-path-guard] ok project_root=${result.project_root} marker=${result.marker_path}\n`);
  process.exit(0);
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
    process.stderr.write(`[canonical-path-guard] ERROR (fail-open): ${msg}\n`);
    process.exit(0);
  });
}
