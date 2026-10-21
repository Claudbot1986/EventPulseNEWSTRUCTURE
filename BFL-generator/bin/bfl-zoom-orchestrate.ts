/**
 * BFL-generator/bin/bfl-zoom-orchestrate.ts
 *
 * Tunna wrappern som dashboardens /api/bfl/zoom-run anropar.
 * Tar --count, --categories, --model, --variant, --out,
 * spawnar bfl-zoom-batch.ts som subprocess och skriver run-state till
 * tmp/bfl_runs/zoom_<runId>.json (samma mönster som befintlig BFL-orchestrator).
 *
 * Rör INTE bfl_orchestrate.ts eller bfl-batch.ts.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const RUNS_DIR = join(PROJECT_ROOT, 'tmp', 'bfl_runs');

function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RunState {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
  count: number;
  categories: string[];
  model: string;
  variant: string;
  out: string;
  pid: number | null;
  exitCode: number | null;
  log: string[];
  imageCount: number;
}

function writeState(state: RunState): void {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const p = join(RUNS_DIR, `zoom_${state.runId}.json`);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, p);
}

function readState(runId: string): RunState | null {
  if (!/^[A-Za-z0-9_\-:]+$/.test(runId)) return null;
  const p = join(RUNS_DIR, `zoom_${runId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as RunState; }
  catch { return null; }
}

function parseArgs(argv: string[]): RunState & { count: number } {
  const out: RunState & { count: number; resetState: boolean } = {
    runId: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    count: 10,
    categories: [],
    model: 'image-01',
    variant: 'legacy',
    out: 'local_image_library_stamped',
    pid: null,
    exitCode: null,
    log: [],
    imageCount: 0,
    resetState: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--count=')) out.count = parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--categories=')) {
      out.categories = arg.slice(13).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--model=')) out.model = arg.slice(8);
    else if (arg.startsWith('--variant=')) out.variant = arg.slice(10);
    else if (arg.startsWith('--out=')) out.out = arg.slice(6);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice(9);
    else if (arg === '--reset-state') out.resetState = true;
  }
  if (!out.runId) out.runId = newRunId();
  return out;
}

async function main(): Promise<void> {
  const state = parseArgs(process.argv);
  console.log(`[zoom-orchestrator] runId=${state.runId} count=${state.count} categories=${state.categories.join(',') || '*'} model=${state.model} resetState=${state.resetState}`);
  writeState(state);

  const args = [
    '--env-file=.env',
    '--import', 'file:///Users/claudgashi/EventPulse/node_modules/tsx/dist/loader.mjs',
    'BFL-generator/bin/bfl-zoom-batch.ts',
    `--count=${state.count}`,
    state.categories.length ? `--categories=${state.categories.join(',')}` : '',
    `--model=${state.model}`,
    `--variant=${state.variant}`,
    `--out=${state.out}`,
    `--run-id=${state.runId}`,  // ← NY: batch skriver progress till samma run-state-fil
    state.resetState ? '--reset-state' : '',
  ].filter(Boolean);

  const { spawn } = await import('node:child_process');
  console.log(`[zoom-orchestrator] spawning: ${process.execPath} ${args.join(' ')}`);
  state.log.push(`spawning: ${process.execPath} ${args.join(' ')}`);
  writeState(state);

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,  // överlever om dashboard eller orchestrator dör
  });
  child.unref();
  state.pid = child.pid ?? null;
  state.log.push(`spawned pid=${state.pid}`);
  writeState(state);
  console.log(`[zoom-orchestrator] spawned pid=${state.pid}`);

  child.stdout?.on('data', (d: Buffer) => {
    const lines = d.toString('utf8').split('\n').filter(Boolean);
    state.log.push(...lines);
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    // Skriv INTE state här — race mot batch's finalizeRunState. Endast child.on('close')
    // (som kör EFTER batch är klar) får skriva state.status.
    // Log-samlingen ovan används enbart för UI-poll, inte för status-beslut.
  });
  child.stderr?.on('data', (d: Buffer) => {
    const lines = d.toString('utf8').split('\n').filter(Boolean);
    state.log.push(...lines.map((l) => `[stderr] ${l}`));
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    // Skriv INTE state från stderr heller — child.on('close') är enda state-skrivare.
  });
  child.on('close', (code) => {
    // B3-fix: orchestrator är inte längre primary source för slut-status.
    // Batch skriver status='success'/'failed' via finalizeRunState när den är klar.
    // Om child.on('close') triggar INNAN batch hunnit skriva slut-state, gör vi en
    // sista write för att inte lämna run-state i 'running'-läge.
    const statePath = join(RUNS_DIR, `zoom_${state.runId}.json`);
    let prev: any = {};
    try { prev = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* ignore */ }
    if (prev.status === 'running' || !prev.status) {
      state.exitCode = code;
      state.finishedAt = new Date().toISOString();
      state.status = code === 0 ? 'success' : 'failed';
      state.log.push(`[orchestrator] child closed code=${code} (batch hann inte skriva slut-status)`);
      writeState(state);
    } else {
      // Batch skrev redan slut-status — bekräfta bara orhestrator's exit
      state.exitCode = code;
      state.status = prev.status; // behåll batch's status (single source of truth)
      state.finishedAt = prev.finishedAt ?? new Date().toISOString();
      state.imageCount = prev.imageCount ?? state.imageCount;
      state.log.push(`[orchestrator] child closed code=${code} (batch skrev redan status=${prev.status})`);
      writeState(state);
    }
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    state.log.push(`spawn error: ${err.message}`);
    state.status = 'failed';
    state.finishedAt = new Date().toISOString();
    writeState(state);
  });
}

main().catch((err) => {
  console.error('[zoom-orchestrator] FATAL:', err);
  process.exit(1);
});

// Exportera för server.ts om det vill polla via readState
export { readState as readZoomRunState };