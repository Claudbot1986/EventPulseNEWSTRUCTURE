#!/usr/bin/env -S npx tsx
/**
 * scripts/bfl_orchestrate.ts — orchestrator för hela BFL-bildgenererings-pipelinen.
 *
 * Kedja (idempotent — varje steg skippar om worket redan är gjort):
 *   1. cluster   — bfl-cluster-real.ts (om tmp/cluster_<cat>.json saknas)
 *   2. batch     — bfl-batch.ts --apply (genererar bilder)
 *   3. upload    — _upload_bfl_to_library.ts --apply (laddar upp + registrerar)
 *   4. backfill  — _backfill_event_images.ts --apply (tilldelar bilder till events)
 *
 * Progress:
 *   - Skriver atomiskt till tmp/bfl_runs/${runId}.json efter varje steg
 *   - Parsar `[N/total]`-mönster från bfl-batch-stdout för live-progress
 *   - Live-streamas till stdout om --cli
 *
 * Säkerhet:
 *   - Hard credit-cap: --max-credits (annars: 4 * count)
 *   - Vid förbrukad kvot: hård fail innan BFL-anrop
 *   - ALLA nycklar läses via --env-file=.env vid spawn
 *
 * Användning:
 *   tsx scripts/bfl_orchestrate.ts --category=community --count=380 --cli
 *   tsx scripts/bfl_orchestrate.ts --category=music --count=20
 *   tsx scripts/bfl_orchestrate.ts --category=community --count=380 --dry-run
 *
 * Designprinciper (2026-10-12):
 *   - EN sanningskälla för status: tmp/bfl_runs/${runId}.json
 *   - Både CLI och supervisor-dashboard läser samma fil
 *   - --mock-prompts som explicit val (default = riktig M3 om nyckel finns)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// ── Public types ───────────────────────────────────────────────────────────

export interface OrchestrateInput {
  category: string;
  count: number;
  dryRun?: boolean;
  mockPrompts?: boolean;
  maxCredits?: number;
  runId?: string;
  cli?: boolean;
}

export interface ProgressCluster {
  done: boolean;
  tagCount: number;
}

export interface ProgressBatch {
  done: boolean;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentItem?: number;
}

export interface ProgressUpload {
  done: boolean;
  uploaded: number;
  skipped: number;
}

export interface ProgressBackfill {
  done: boolean;
  matched: number;
  unmatched: number;
  errors: number;
}

export type RunStatus = 'success' | 'partial' | 'failed' | 'dry-run';

export interface OrchestrateResult {
  runId: string;
  category: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  costBflCredits: number;
  maxCredits: number;
  log: string[];
  progress: {
    cluster: ProgressCluster;
    batch: ProgressBatch;
    upload: ProgressUpload;
    backfill: ProgressBackfill;
  };
  runJsonPath: string;
  pid: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/Users/claudgashi/EventPulse';
const RUNS_DIR = join(PROJECT_ROOT, 'tmp', 'bfl_runs');
const TMP_DIR = join(PROJECT_ROOT, 'tmp');
const BFL_CREDIT_PER_IMAGE = 4;
const MAX_LOG_LINES = 200;

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): OrchestrateInput {
  const out: OrchestrateInput = { category: '', count: 0, cli: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--category=')) out.category = a.slice('--category='.length);
    else if (a.startsWith('--count=')) out.count = parseInt(a.slice('--count='.length), 10);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--mock-prompts') out.mockPrompts = true;
    else if (a === '--cli') out.cli = true;
    else if (a.startsWith('--max-credits=')) out.maxCredits = parseInt(a.slice('--max-credits='.length), 10);
    else if (a.startsWith('--run-id=')) out.runId = a.slice('--run-id='.length);
  }
  if (!out.category || out.count <= 0) {
    console.error('Användning: --category=<slug> --count=<N> [--dry-run] [--mock-prompts] [--max-credits=N] [--cli]');
    process.exit(2);
  }
  return out;
}

// ── Run-state helpers ──────────────────────────────────────────────────────

function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function atomicWriteJson(path: string, obj: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}

function initResult(input: OrchestrateInput, runId: string): OrchestrateResult {
  const maxCredits = input.maxCredits ?? BFL_CREDIT_PER_IMAGE * input.count;
  return {
    runId,
    category: input.category,
    status: 'success',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    costBflCredits: 0,
    maxCredits,
    log: [],
    progress: {
      cluster: { done: false, tagCount: 0 },
      batch: { done: false, requested: input.count, succeeded: 0, failed: 0, skipped: 0 },
      upload: { done: false, uploaded: 0, skipped: 0 },
      backfill: { done: false, matched: 0, unmatched: 0, errors: 0 },
    },
    runJsonPath: join(RUNS_DIR, `${runId}.json`),
    pid: process.pid,
  };
}

function appendLog(result: OrchestrateResult, line: string): void {
  result.log.push(line);
  if (result.log.length > MAX_LOG_LINES) {
    result.log.splice(0, result.log.length - MAX_LOG_LINES);
  }
}

// ── Subprocess runner ─────────────────────────────────────────────────────

interface SpawnOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  label: string;
  cmd: string;
  args: string[];
  result: OrchestrateResult;
  extraEnv?: Record<string, string>;
  onProgress?: (line: string) => void;
}

function runSubprocess(opts: RunOpts): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(opts.extraEnv ?? {}) };
    const child: ChildProcess = spawn(opts.cmd, opts.args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      stdout += text;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        appendLog(opts.result, `[${opts.label}] ${line}`);
        opts.onProgress?.(line);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      stderr += text;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        appendLog(opts.result, `[${opts.label}!] ${line}`);
      }
    });

    child.on('error', (err) => {
      appendLog(opts.result, `[${opts.label}] spawn-fel: ${err.message}`);
      resolve({ exitCode: 1, stdout, stderr: stderr + err.message });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

// ── Steg 1: Cluster ────────────────────────────────────────────────────────

async function stepCluster(input: OrchestrateInput, result: OrchestrateResult): Promise<void> {
  const clusterFile = join(TMP_DIR, `cluster_${input.category}.json`);
  if (existsSync(clusterFile)) {
    try {
      const existing = JSON.parse(readFileSync(clusterFile, 'utf8')) as { tag_frequency?: Record<string, number> };
      const tagCount = Object.keys(existing.tag_frequency ?? {}).length;
      appendLog(result, `cluster: fil finns redan (${tagCount} taggar) — hoppar`);
      result.progress.cluster = { done: true, tagCount };
      return;
    } catch {
      appendLog(result, `cluster: befintlig fil trasig, regenererar`);
    }
  }

  appendLog(result, `cluster: startar bfl-cluster-real.ts --category=${input.category}`);
  const out = await runSubprocess({
    label: 'cluster',
    cmd: 'node',
    args: [
      '--env-file=.env',
      '--import', 'tsx',
      'BFL-generator/bin/bfl-cluster-real.ts',
      `--category=${input.category}`,
    ],
    result,
  });

  if (out.exitCode !== 0 || !existsSync(clusterFile)) {
    appendLog(result, `cluster: MISSLYCKADES (exit=${out.exitCode})`);
    result.status = 'failed';
    return;
  }
  const parsed = JSON.parse(readFileSync(clusterFile, 'utf8')) as { tag_frequency?: Record<string, number> };
  result.progress.cluster = { done: true, tagCount: Object.keys(parsed.tag_frequency ?? {}).length };
  appendLog(result, `cluster: klar (${result.progress.cluster.tagCount} taggar)`);
}

// ── Steg 2: Batch ──────────────────────────────────────────────────────────

const BATCH_PROGRESS_RE = /^\s*\[(\d+)\/(\d+)\]/;

async function stepBatch(input: OrchestrateInput, result: OrchestrateResult): Promise<void> {
  appendLog(result, `batch: startar bfl-batch.ts --category=${input.category} --count=${input.count} ${input.dryRun ? '(DRY-RUN)' : '--apply'}`);

  const args = [
    '--env-file=.env',
    '--import', 'tsx',
    'BFL-generator/bin/bfl-batch.ts',
    `--category=${input.category}`,
    `--count=${input.count}`,
  ];
  if (!input.dryRun) args.push('--apply');

  const extraEnv: Record<string, string> = {};
  if (input.mockPrompts) extraEnv.MOCK_PROMPTS = '1';

  const out = await runSubprocess({
    label: 'batch',
    cmd: 'node',
    args,
    result,
    extraEnv,
    onProgress: (line) => {
      const m = line.match(BATCH_PROGRESS_RE);
      if (m) {
        const current = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        result.progress.batch.currentItem = current;
        result.progress.batch.requested = total;
      }
    },
  });

  const okMatch = out.stdout.match(/ok:\s+(\d+)/);
  const skipMatch = out.stdout.match(/skip:\s+(\d+)/);
  const errMatch = out.stdout.match(/fel:\s+(\d+)/);
  result.progress.batch.succeeded = okMatch ? parseInt(okMatch[1], 10) : 0;
  result.progress.batch.skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
  result.progress.batch.failed = errMatch ? parseInt(errMatch[1], 10) : 0;
  result.progress.batch.done = true;

  // Kostnad: faktiska BFL-anrop (succeeded + failed) × 4 credits
  const bflCallsMade = result.progress.batch.succeeded + result.progress.batch.failed;
  result.costBflCredits = bflCallsMade * BFL_CREDIT_PER_IMAGE;

  if (out.exitCode !== 0) {
    appendLog(result, `batch: MISSLYCKADES (exit=${out.exitCode})`);
    result.status = bflCallsMade > 0 ? 'partial' : 'failed';
  } else {
    appendLog(result, `batch: klar (ok=${result.progress.batch.succeeded}, skip=${result.progress.batch.skipped}, fel=${result.progress.batch.failed})`);
  }
}

// ── Steg 3: Upload ─────────────────────────────────────────────────────────

async function stepUpload(input: OrchestrateInput, result: OrchestrateResult): Promise<void> {
  appendLog(result, `upload: startar _upload_bfl_to_library.ts --only=${input.category} ${input.dryRun ? '(DRY-RUN)' : '--apply'}`);

  const args = [
    '--env-file=.env', '--import', 'tsx',
    'scripts/_upload_bfl_to_library.ts',
    `--only=${input.category}`,
  ];
  if (!input.dryRun) args.push('--apply');

  const out = await runSubprocess({
    label: 'upload',
    cmd: 'node',
    args,
    result,
  });

  const uploadedMatch = out.stdout.match(/uppladdade \+ registrerade:\s+(\d+)/);
  result.progress.upload.uploaded = uploadedMatch ? parseInt(uploadedMatch[1], 10) : 0;
  result.progress.upload.skipped = 0;
  result.progress.upload.done = true;

  if (out.exitCode !== 0) {
    appendLog(result, `upload: MISSLYCKADES (exit=${out.exitCode})`);
    if (result.status === 'success') result.status = 'partial';
  } else {
    appendLog(result, `upload: klar (${result.progress.upload.uploaded} uppladdade)`);
  }
}

// ── Steg 4: Backfill ───────────────────────────────────────────────────────

async function stepBackfill(input: OrchestrateInput, result: OrchestrateResult): Promise<void> {
  appendLog(result, `backfill: startar _backfill_event_images.ts --category=${input.category} --limit=${input.count} ${input.dryRun ? '(DRY-RUN)' : '--apply'}`);

  const args = [
    '--env-file=.env', '--import', 'tsx',
    'scripts/_backfill_event_images.ts',
    `--category=${input.category}`,
    `--limit=${input.count}`,
  ];
  if (!input.dryRun) args.push('--apply');

  const out = await runSubprocess({
    label: 'backfill',
    cmd: 'node',
    args,
    result,
  });

  const matchMatch = out.stdout.match(/match:\s+(\d+)/);
  const noMatchMatch = out.stdout.match(/noMatch:\s+(\d+)/);
  const errorMatch = out.stdout.match(/\bfel:\s+(\d+)/);
  result.progress.backfill.matched = matchMatch ? parseInt(matchMatch[1], 10) : 0;
  result.progress.backfill.unmatched = noMatchMatch ? parseInt(noMatchMatch[1], 10) : 0;
  result.progress.backfill.errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  result.progress.backfill.done = true;

  if (out.exitCode !== 0) {
    appendLog(result, `backfill: MISSLYCKADES (exit=${out.exitCode})`);
    if (result.status === 'success') result.status = 'partial';
  } else {
    appendLog(result, `backfill: klar (match=${result.progress.backfill.matched}, noMatch=${result.progress.backfill.unmatched})`);
  }
}

// ── CLI-läge: live-progress ────────────────────────────────────────────────

function startCliPoller(result: OrchestrateResult): NodeJS.Timeout | null {
  if (!process.stdout.isTTY) return null;
  const lastLogLen = { n: 0 };
  return setInterval(() => {
    // Skriv ut nya loggrader
    const newLines = result.log.slice(lastLogLen.n);
    lastLogLen.n = result.log.length;
    for (const line of newLines) {
      process.stdout.write(`${line}\n`);
    }
    // Skriv kompakt statusrad
    const b = result.progress.batch;
    if (b.requested > 0) {
      process.stdout.write(`\r[bfl] batch: ${b.succeeded}/${b.requested} (fel: ${b.failed}, skip: ${b.skipped})   `);
    }
  }, 1000);
}

// ── Main orchestration ────────────────────────────────────────────────────

async function main(): Promise<RunStatus> {
  const input = parseArgs(process.argv);

  // Säkerhets-check: hard credit cap
  if (!input.dryRun) {
    const estimated = BFL_CREDIT_PER_IMAGE * input.count;
    if (estimated > input.maxCredits!) {
      console.error(`❌ Credit-spärr: ${estimated} > ${input.maxCredits}. Minska --count eller höj --max-credits.`);
      process.exit(3);
    }
  }

  mkdirSync(RUNS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const runId = input.runId ?? newRunId();
  const result = initResult(input, runId);
  atomicWriteJson(result.runJsonPath, result);

  const cliPoller = input.cli ? startCliPoller(result) : null;

  console.log(`[orchestrate] startar run=${runId} category=${input.category} count=${input.count}`);
  console.log(`[orchestrate] status: ${result.runJsonPath}`);

  try {
    await stepCluster(input, result);
    atomicWriteJson(result.runJsonPath, result);
    if (result.status === 'failed') return finalize(result, cliPoller, input);

    await stepBatch(input, result);
    atomicWriteJson(result.runJsonPath, result);
    if (result.status === 'failed') return finalize(result, cliPoller, input);

    if (!input.dryRun) {
      await stepUpload(input, result);
      atomicWriteJson(result.runJsonPath, result);

      await stepBackfill(input, result);
      atomicWriteJson(result.runJsonPath, result);
    }
  } catch (err) {
    appendLog(result, `orchestrate-fel: ${err instanceof Error ? err.message : 'okänt'}`);
    result.status = 'failed';
  }

  return finalize(result, cliPoller, input);
}

function finalize(result: OrchestrateResult, poller: NodeJS.Timeout | null, input: OrchestrateInput): RunStatus {
  if (poller) clearInterval(poller);
  result.finishedAt = new Date().toISOString();
  if (input.dryRun && result.status === 'success') result.status = 'dry-run';
  atomicWriteJson(result.runJsonPath, result);

  process.stdout.write('\n\n');
  console.log('═'.repeat(70));
  console.log(`[orchestrate] runId=${result.runId}`);
  console.log(`[orchestrate] status=${result.status}`);
  console.log(`[orchestrate] kostnad=${result.costBflCredits} BFL-credits (cap: ${result.maxCredits})`);
  console.log(`[orchestrate] cluster: ${result.progress.cluster.tagCount} taggar`);
  console.log(`[orchestrate] batch:   ${result.progress.batch.succeeded} ok, ${result.progress.batch.failed} fel, ${result.progress.batch.skipped} skip`);
  console.log(`[orchestrate] upload:  ${result.progress.upload.uploaded} uppladdade`);
  console.log(`[orchestrate] backfill:${result.progress.backfill.matched} match, ${result.progress.backfill.unmatched} noMatch, ${result.progress.backfill.errors} fel`);
  console.log(`[orchestrate] state:   ${result.runJsonPath}`);
  console.log('═'.repeat(70));

  return result.status;
}

main().then((status) => {
  if (status === 'failed') process.exit(1);
  if (status === 'partial') process.exit(2);
  process.exit(0);
}).catch((err) => {
  console.error('orchestrate fatal:', err);
  process.exit(1);
});