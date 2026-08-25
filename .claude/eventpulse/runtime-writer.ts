/**
 * runtime-writer.ts — write per-prompt-compilation runtime artifacts (mission §33/§62).
 *
 * Layout (per mission §62):
 *   <runtimeDir>/<session-id>/<mission-id>/
 *     classification.json
 *     context.json
 *     mission.json
 *     mission.md
 *     compiler.log
 *
 * Debug mode (§34) additionally writes/refreshes:
 *   <runtimeDir>/last-classification.json
 *   <runtimeDir>/last-context.json
 *   <runtimeDir>/last-mission.md
 *
 * Atomicity: each artifact is written via writeFileSync (small payloads, append-only session).
 * Concurrency: session-id + mission-id isolate concurrent Claude sessions (§47).
 * Failure policy: write failures are logged to stderr but never throw (mission §44 fail-open).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config';
import type { Classification } from './classifier';
import type { SelectionResult } from './context-selector';
import type { Mission } from './mission-compiler';

export interface RuntimeArtifactPaths {
  baseDir: string;
  classificationPath: string;
  contextPath: string;
  missionJsonPath: string;
  missionMdPath: string;
  logPath: string;
  debugClassificationPath?: string;
  debugContextPath?: string;
  debugMissionPath?: string;
}

function safeSessionId(raw: string | undefined): string {
  if (!raw) return 'anon';
  const trimmed = raw.trim();
  if (!trimmed) return 'anon';
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return safe || 'anon';
}

function safeMissionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function ensureRuntimePaths(opts: {
  config: Config;
  sessionId: string | undefined;
  missionId: string;
}): RuntimeArtifactPaths {
  const baseDir = path.join(opts.config.runtimeDir, safeSessionId(opts.sessionId), safeMissionId(opts.missionId));
  const paths: RuntimeArtifactPaths = {
    baseDir,
    classificationPath: path.join(baseDir, 'classification.json'),
    contextPath: path.join(baseDir, 'context.json'),
    missionJsonPath: path.join(baseDir, 'mission.json'),
    missionMdPath: path.join(baseDir, 'mission.md'),
    logPath: path.join(baseDir, 'compiler.log'),
  };
  if (opts.config.debug) {
    paths.debugClassificationPath = path.join(opts.config.runtimeDir, 'last-classification.json');
    paths.debugContextPath = path.join(opts.config.runtimeDir, 'last-context.json');
    paths.debugMissionPath = path.join(opts.config.runtimeDir, 'last-mission.md');
  }
  return paths;
}

function safeJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

function appendLog(logPath: string, lines: string[]): void {
  const stamp = new Date().toISOString();
  const body = lines.map((l) => `[${stamp}] ${l}`).join('\n') + '\n';
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, body, 'utf8');
  } catch {
    /* fail-open */
  }
}

export interface WriteRuntimeArtifactsInput {
  config: Config;
  sessionId: string | undefined;
  classification: Classification;
  selection: SelectionResult;
  mission: Mission;
  missionMd: string;
  durationMs: number;
  result: 'success' | 'fail' | 'bypass' | 'timeout';
}

export function writeRuntimeArtifacts(input: WriteRuntimeArtifactsInput): RuntimeArtifactPaths | null {
  const paths = ensureRuntimePaths({
    config: input.config,
    sessionId: input.sessionId,
    missionId: input.mission.mission_id,
  });
  try {
    fs.mkdirSync(paths.baseDir, { recursive: true });
    fs.writeFileSync(paths.classificationPath, safeJson(input.classification), 'utf8');
    fs.writeFileSync(paths.contextPath, safeJson(input.selection), 'utf8');
    fs.writeFileSync(paths.missionJsonPath, safeJson(input.mission), 'utf8');
    fs.writeFileSync(paths.missionMdPath, input.missionMd, 'utf8');
    appendLog(paths.logPath, [
      `result=${input.result}`,
      `duration_ms=${input.durationMs}`,
      `task_type=${input.classification.task_type}`,
      `complexity=${input.classification.complexity}`,
      `risk=${input.classification.risk}`,
      `execution_mode=${input.classification.execution_mode}`,
      `verification_profile=${input.classification.verification_profile}`,
      `subsystems=[${input.classification.subsystems.join(', ')}]`,
      `roles=[${input.classification.roles.join(', ')}]`,
      `selected_context=t0:${input.selection.tier0.length},t1:${input.selection.tier1.length},t2:${input.selection.tier2.length},t3:${input.selection.tier3.length}`,
      `prompt_size=${input.mission.original_prompt.length}`,
      `classification_confidence=${input.classification.classification_confidence}`,
    ]);
    if (input.config.debug) {
      try {
        if (paths.debugClassificationPath) fs.writeFileSync(paths.debugClassificationPath, safeJson(input.classification), 'utf8');
        if (paths.debugContextPath) fs.writeFileSync(paths.debugContextPath, safeJson(input.selection), 'utf8');
        if (paths.debugMissionPath) fs.writeFileSync(paths.debugMissionPath, input.missionMd, 'utf8');
      } catch {
        /* debug artifacts are best-effort */
      }
    }
    return paths;
  } catch (err) {
    process.stderr.write(`[ep-runtime-writer] failed to write artifacts: ${String(err)}\n`);
    return null;
  }
}