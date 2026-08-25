/**
 * router.ts — UserPromptSubmit hook entry point (mission §6, plan §6).
 *
 * stdin  : JSON { prompt, session_id, cwd, ... }
 * stdout : JSON hookSpecificOutput.additionalContext (rendered mission markdown with delimiters)
 * stderr : log lines (always visible)
 * exit   : always 0 (fail-open per mission §44)
 *
 * Pipeline (mission §3/§18):
 *   loadConfig() → classify() → selectContext() → compileMission() →
 *   validateMission() → renderMissionMarkdown() → writeRuntimeArtifacts() →
 *   writeMissionMirror() → inject additionalContext
 *
 * Failures (mission §44):
 *   - compiler crash → stderr warn, exit 0, no enrichment (Claude still gets original prompt)
 *   - timeout       → stderr warn, exit 0, mission not emitted
 *   - bypass mode   → exit 0, no enrichment
 *   - recursion     → exit 0, no enrichment (mission §46)
 */

import { loadConfig, isEffectivelyEnabled } from './config';
import { classify, type Classification } from './classifier';
import { selectContext, type SelectionResult } from './context-selector';
import {
  compileMission,
  writeMissionMirror,
  renderMissionMarkdown,
  type Mission,
} from './mission-compiler';
import { validateMission, type ValidationResult } from './mission-validator';
import { writeRuntimeArtifacts } from './runtime-writer';

interface UserPromptSubmitInput {
  prompt: string;
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

function tryParseJson(s: string): UserPromptSubmitInput | null {
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj.prompt === 'string') return obj as UserPromptSubmitInput;
    return null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();

  if (config.active) {
    process.stderr.write('[ep-router] recursive invocation detected (EVENTPULSE_PROMPT_ACTIVE=1); bypassing.\n');
    process.exit(0);
  }

  if (!isEffectivelyEnabled()) {
    process.exit(0);
  }

  let raw = '';
  try {
    raw = await readStdin();
  } catch (err) {
    process.stderr.write(`[ep-router] failed to read stdin: ${String(err)}\n`);
    process.exit(0);
  }

  const input = tryParseJson(raw);
  if (!input) {
    process.stderr.write('[ep-router] stdin was not valid JSON; skipping enrichment.\n');
    process.exit(0);
  }

  const prompt = (input.prompt ?? '').trim();
  if (!prompt) {
    process.exit(0);
  }

  const repoRoot = process.env.EP_REPO_ROOT ?? input.cwd ?? process.cwd();

  let classification: Classification | null = null;
  let selection: SelectionResult | null = null;
  let mission: Mission | null = null;
  let missionMd = '';
  let result: 'success' | 'fail' | 'bypass' | 'timeout' = 'success';

  try {
    const work = (async () => {
      const c = classify(prompt);
      const s = selectContext(c);
      const compiled = compileMission({
        prompt,
        classification: c,
        selection: s,
        repoRoot,
        sessionId: input.session_id,
      });
      const v: ValidationResult = validateMission(compiled.mission, { strict: false });
      if (!v.ok) {
        process.stderr.write(`[ep-router] mission validation failed (continuing): ${v.errors.join('; ')}\n`);
      }
      if (v.warnings.length) {
        process.stderr.write(`[ep-router] mission warnings: ${v.warnings.join('; ')}\n`);
      }
      const md = renderMissionMarkdown(compiled.mission, { maxTokens: config.maxTokens });
      return { c, s, mission: compiled.mission, md, mirrorYaml: compiled.yaml };
    })();

    const result1 = await withTimeout(work, config.timeoutMs, 'prompt-compiler-pipeline');
    classification = result1.c;
    selection = result1.s;
    mission = result1.mission;
    missionMd = result1.md;

    try {
      const mirrorPath = writeMissionMirror(repoRoot, mission, result1.mirrorYaml);
      process.stderr.write(`[ep-router] mission mirror written: ${mirrorPath}\n`);
    } catch (err) {
      process.stderr.write(`[ep-router] mirror write failed (non-fatal): ${String(err)}\n`);
    }

    writeRuntimeArtifacts({
      config,
      sessionId: input.session_id,
      classification,
      selection,
      mission,
      missionMd,
      durationMs: Date.now() - t0,
      result,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('exceeded')) {
      result = 'timeout';
      process.stderr.write(`[ep-router] pipeline timeout (continuing without enrichment): ${msg}\n`);
    } else {
      result = 'fail';
      process.stderr.write(`[ep-router] pipeline error (continuing without enrichment): ${msg}\n`);
    }
    process.exit(0);
    return;
  }

  const additionalContext = missionMd;
  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(out));

  const dur = Date.now() - t0;
  process.stderr.write(
    `[ep-router] mission=${mission.mission_id} task=${classification.task_type} complexity=${classification.complexity} risk=${classification.risk} mode=${mission.execution_mode} profile=${mission.verification_profile} ctx=t0:${selection.tier0.length},t1:${selection.tier1.length},t2:${selection.tier2.length},t3:${selection.tier3.length} planning_only=${mission.planning_only} confidence=${classification.classification_confidence} duration_ms=${dur}\n`,
  );
  if (config.debug) {
    process.stderr.write(`[ep-router] DEBUG classification=${JSON.stringify(classification)}\n`);
    process.stderr.write(`[ep-router] DEBUG mission_summary=${missionIdSummary(mission)}\n`);
  }
}

function missionIdSummary(m: Mission): string {
  return JSON.stringify({
    mission_id: m.mission_id,
    task_type: m.task_type,
    complexity: m.complexity,
    risk: m.risk,
    execution_mode: m.execution_mode,
    verification_profile: m.verification_profile,
    planning_only: m.planning_only,
    user_overrides: m.user_overrides,
    working_tree_fp: m.working_tree_fp,
    repo_state_branch: m.repo_state.branch,
    repo_state_dirty: m.repo_state.dirty,
    requires_user_approval: m.requires_user_approval,
  });
}

main().catch((err) => {
  process.stderr.write(`[ep-router] top-level error (continuing without enrichment): ${String(err)}\n`);
  process.exit(0);
});