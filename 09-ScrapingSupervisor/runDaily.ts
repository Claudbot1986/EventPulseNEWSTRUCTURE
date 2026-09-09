/**
 * runDaily.ts — Daglig körning (launchd-vänlig, ingen bash-wrapper)
 *
 * launchd kan inte köra `/bin/bash`-scripts (posix_spawn error 0x1).
 * Denna fil kör supervisor + ingestionPipeline via child_process.
 *
 * Användning (manuellt):
 *   npx tsx 09-ScrapingSupervisor/runDaily.ts
 *
 * Användning (via launchd):
 *   com.eventpulse.supervisor.plist pekar på node + tsx-cli + runDaily.ts
 */

import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), override: true });

const LOG_DIR = path.join(PROJECT_ROOT, 'runtime', 'scraping-supervisor');
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const SUPERVISOR_TS = path.join(PROJECT_ROOT, '09-ScrapingSupervisor/supervisor.ts');
const PIPELINE_TS = path.join(PROJECT_ROOT, '09-ScrapingSupervisor/ingestionPipeline.ts');
const WORKER_TS = path.join(PROJECT_ROOT, '03-Queue/startWorker.ts');
const WORKER_DRAIN_MS = 15 * 60 * 1000; // dräneringsfönster: 15 min, sedan stopp

function getRunLogPath(): string {
  const isoDate = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `daily-${isoDate}.log`);
}

function log(line: string, fileLog?: string): void {
  const ts = new Date().toISOString();
  const msg = `${ts}  ${line}`;
  console.log(msg);
  if (fileLog) {
    fs.mkdirSync(path.dirname(fileLog), { recursive: true });
    fs.appendFileSync(fileLog, msg + '\n', 'utf8');
  }
}

interface SubResult { exitCode: number; durationMs: number; }

/** Som runSubprocess men dödar processen efter maxMs — för daemon-processer (t.ex. BullMQ-worker) som ska dränera kön inom ett tidsfönster. Kill vid timeout = förväntat (exitCode rapporteras som 0). */
function runSubprocessWithTimeout(name: string, scriptPath: string, fileLog: string, maxMs: number): Promise<SubResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    log(`[step:${name}] start (max ${Math.round(maxMs / 60000)} min)  ${path.relative(PROJECT_ROOT, scriptPath)}`, fileLog);
    const proc = spawn(TSX_BIN, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, EVENTPULSE_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killTimer = setTimeout(() => {
      log(`[step:${name}] dräneringsfönster slut — stoppar`, fileLog);
      proc.kill('SIGTERM');
    }, maxMs);
    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      const exitCode = signal === 'SIGTERM' ? 0 : (code ?? 1);
      log(`[step:${name}] exit code=${exitCode} signal=${signal ?? '-'} duration=${Date.now() - startedAt}ms`, fileLog);
      resolve({ exitCode, durationMs: Date.now() - startedAt });
    });
    proc.on('error', () => {
      clearTimeout(killTimer);
      resolve({ exitCode: 1, durationMs: Date.now() - startedAt });
    });
  });
}

function runSubprocess(name: string, scriptPath: string, fileLog: string): Promise<SubResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    log(`[step:${name}] start  ${path.relative(PROJECT_ROOT, scriptPath)}`, fileLog);
    const proc = spawn(TSX_BIN, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, EVENTPULSE_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuf = '';
    proc.stdout.on('data', (c) => { stdoutBuf += c.toString('utf8'); if (stdoutBuf.length > 50_000) stdoutBuf = stdoutBuf.slice(-50_000); });
    proc.stderr.on('data', (c) => { stdoutBuf += c.toString('utf8'); if (stdoutBuf.length > 50_000) stdoutBuf = stdoutBuf.slice(-50_000); });
    proc.on('exit', (code) => {
      const durationMs = Date.now() - startedAt;
      const exitCode = code ?? 1;
      const tail = stdoutBuf.split('\n').filter(Boolean).slice(-30).join('\n');
      for (const line of tail.split('\n')) log(`[step:${name}]   ${line}`, fileLog);
      log(`[step:${name}] exit code=${exitCode} duration=${durationMs}ms`, fileLog);
      resolve({ exitCode, durationMs });
    });
    proc.on('error', (err) => {
      log(`[step:${name}] spawn error: ${err.message}`, fileLog);
      resolve({ exitCode: 1, durationMs: Date.now() - startedAt });
    });
  });
}

async function main(): Promise<number> {
  const fileLog = getRunLogPath();
  const startedAt = Date.now();

  log(`═══════════════════════════════════════════════════════════`, fileLog);
  log(`  EventPulse daglig körning (runDaily)  │  ${new Date().toISOString().split('T')[0]}`, fileLog);
  log(`═══════════════════════════════════════════════════════════`, fileLog);

  // Steg 1: supervisor (source health)
  log(`[1/2] supervisor — start`, fileLog);
  const supervisor = await runSubprocess('supervisor', SUPERVISOR_TS, fileLog);
  if (supervisor.exitCode !== 0) {
    log(`[1/2] supervisor — FAIL (exit=${supervisor.exitCode}) — fortsätter med pipeline`, fileLog);
  } else {
    log(`[1/2] supervisor — OK`, fileLog);
  }

  // Steg 2: ingestionPipeline (data flow)
  log(`[2/2] ingestionPipeline — start`, fileLog);
  const pipeline = await runSubprocess('ingestionPipeline', PIPELINE_TS, fileLog);
  if (pipeline.exitCode !== 0) {
    log(`[2/2] ingestionPipeline — FAIL (exit=${pipeline.exitCode}) — fortsätter med dränering`, fileLog);
  } else {
    log(`[2/2] ingestionPipeline — OK`, fileLog);
  }

  // Steg 3: dränera BullMQ-kön till Supabase (workern är daemon — tidsbegränsad dränering)
  log(`[3/3] startWorker — dränering`, fileLog);
  const drain = await runSubprocessWithTimeout('startWorker-drain', WORKER_TS, fileLog, WORKER_DRAIN_MS);
  log(`[3/3] startWorker — ${drain.exitCode === 0 ? 'OK' : `FAIL (exit=${drain.exitCode})`}`, fileLog);

  log(`═══════════════════════════════════════════════════════════`, fileLog);
  log(`  KLAR  │  totalDuration=${Date.now() - startedAt}ms`, fileLog);
  log(`═══════════════════════════════════════════════════════════`, fileLog);
  // Misslyckad pipeline (t.ex. bi-steg) blockerar inte dränering — speglas i exit-koden
  return pipeline.exitCode !== 0 ? pipeline.exitCode : drain.exitCode;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('fatal:', e); process.exit(1); });
