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
import {
  makeRunId,
  writeIngestionRunSummary,
  type IngestionRunStage,
} from '../02-Ingestion/tools/runRecorder';

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

/**
 * parseRunStats — extrahera riktiga siffror från ingestionPipeline-stdout.
 *
 * Tidigare skrev runDaily 0/0/0/0 till ingestion_runs.jsonl. Nu plockar vi
 * `sourcesAttempted` från sista `[N/M]`-raden och `totalEventsFound` från
 * `KLAR  │  N events till bullmq`-raden i importToEventPulse.
 *
 * Exporterad för test i tests/runDaily_summary.test.ts.
 */
export function parseRunStats(stdout: string): { sourcesAttempted: number; totalEventsFound: number } {
  let sourcesAttempted = 0;
  let totalEventsFound = 0;

  // Plocka sista [N/M] — det är totalen (270/270 = klar). Pattern: [123/270]
  const sourceMatches = stdout.match(/\[(\d+)\/(\d+)\][^\n]*/g);
  if (sourceMatches) {
    let maxDenom = 0;
    for (const m of sourceMatches) {
      const numMatch = m.match(/\[(\d+)\/(\d+)\]/);
      if (numMatch) {
        const denom = parseInt(numMatch[2], 10);
        if (denom > maxDenom) {
          maxDenom = denom;
        }
      }
    }
    sourcesAttempted = maxDenom;
  }

  // Plocka "N events till bullmq" — total events som gick in i kön
  const eventsMatch = stdout.match(/(\d+)\s+events\s+till\s+bullmq/);
  if (eventsMatch) {
    totalEventsFound = parseInt(eventsMatch[1], 10);
  }

  return { sourcesAttempted, totalEventsFound };
}

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

interface SubResult { exitCode: number; durationMs: number; stdoutTail: string; }

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
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      log(`[step:${name}] dräneringsfönster slut — stoppar`, fileLog);
      proc.kill('SIGTERM');
    }, maxMs);
    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      // 2026-09-15: workern fångar SIGTERM själv och avslutar med numerisk kod
      // 143 (signal=null) — då missar den gamla maskningen signal==='SIGTERM'
      // och steget loggades som falsk FAIL varje natt. Dränerings-timeout är
      // alltid förväntat → 0.
      const exitCode = timedOut || signal === 'SIGTERM' ? 0 : (code ?? 1);
      log(`[step:${name}] exit code=${exitCode} signal=${signal ?? '-'} duration=${Date.now() - startedAt}ms`, fileLog);
      resolve({ exitCode, durationMs: Date.now() - startedAt, stdoutTail: '' });
    });
    proc.on('error', () => {
      clearTimeout(killTimer);
      resolve({ exitCode: 1, durationMs: Date.now() - startedAt, stdoutTail: '' });
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
      resolve({ exitCode, durationMs, stdoutTail: tail });
    });
    proc.on('error', (err) => {
      log(`[step:${name}] spawn error: ${err.message}`, fileLog);
      resolve({ exitCode: 1, durationMs: Date.now() - startedAt, stdoutTail: '' });
    });
  });
}

async function main(): Promise<number> {
  const fileLog = getRunLogPath();
  const startedAt = Date.now();
  const startTs = new Date(startedAt).toISOString();
  const runId = makeRunId('daily');
  const stages: IngestionRunStage[] = [];
  let exitCode = 0;
  let errorSummary: string | null = null;
  let runStats: { sourcesAttempted: number; totalEventsFound: number } = { sourcesAttempted: 0, totalEventsFound: 0 };

  try {
    log(`═══════════════════════════════════════════════════════════`, fileLog);
    log(`  EventPulse daglig körning (runDaily)  │  ${new Date().toISOString().split('T')[0]}`, fileLog);
    log(`═══════════════════════════════════════════════════════════`, fileLog);

    // Steg 1: supervisor (source health)
    log(`[1/3] supervisor — start`, fileLog);
    const supervisor = await runSubprocess('supervisor', SUPERVISOR_TS, fileLog);
    stages.push({ stage: 'A', ok: supervisor.exitCode === 0, durationMs: supervisor.durationMs, itemsOut: 0 });
    if (supervisor.exitCode !== 0) {
      log(`[1/3] supervisor — FAIL (exit=${supervisor.exitCode}) — fortsätter med pipeline`, fileLog);
    } else {
      log(`[1/3] supervisor — OK`, fileLog);
    }

    // Steg 2: ingestionPipeline (data flow — inkluderar bridge + runD-scrapingbee som steg 1d)
    log(`[2/3] ingestionPipeline — start`, fileLog);
    const pipeline = await runSubprocess('ingestionPipeline', PIPELINE_TS, fileLog);
    stages.push({ stage: 'B', ok: pipeline.exitCode === 0, durationMs: pipeline.durationMs, itemsOut: 0 });
    if (pipeline.exitCode !== 0) {
      log(`[2/3] ingestionPipeline — FAIL (exit=${pipeline.exitCode}) — fortsätter med dränering`, fileLog);
      errorSummary = `pipeline exit=${pipeline.exitCode}`;
    } else {
      log(`[2/3] ingestionPipeline — OK`, fileLog);
    }

    // Extrahera riktiga siffror från pipeline-stdout (tidigare hårdkodat 0/0/0/0)
    runStats = parseRunStats(pipeline.stdoutTail);
    log(`[stats] sourcesAttempted=${runStats.sourcesAttempted} totalEventsFound=${runStats.totalEventsFound}`, fileLog);

    // Steg 3: dränera BullMQ-kön till Supabase (workern är daemon — tidsbegränsad dränering)
    log(`[3/3] startWorker — dränering`, fileLog);
    const drain = await runSubprocessWithTimeout('startWorker-drain', WORKER_TS, fileLog, WORKER_DRAIN_MS);
    stages.push({ stage: 'D', ok: drain.exitCode === 0, durationMs: drain.durationMs, itemsOut: 0 });
    log(`[3/3] startWorker — ${drain.exitCode === 0 ? 'OK' : `FAIL (exit=${drain.exitCode})`}`, fileLog);

    log(`═══════════════════════════════════════════════════════════`, fileLog);
    log(`  KLAR  │  totalDuration=${Date.now() - startedAt}ms`, fileLog);
    log(`═══════════════════════════════════════════════════════════`, fileLog);
    // Misslyckad pipeline (t.ex. bi-steg) blockerar inte dränering — speglas i exit-koden
    exitCode = pipeline.exitCode !== 0 ? pipeline.exitCode : drain.exitCode;
    return exitCode;
  } finally {
    // Logga batch-körning till runtime/ingestion_runs.jsonl (även vid fel)
    const endTs = new Date().toISOString();
    const ok = stages.every((s) => s.ok);
    writeIngestionRunSummary({
      runId,
      triggerSource: 'daily',
      startTs,
      endTs,
      durationMs: Date.now() - startedAt,
      ok,
      sourcesAttempted: runStats.sourcesAttempted,
      sourcesSucceeded: ok ? runStats.sourcesAttempted : 0,
      sourcesFailed: ok ? 0 : (runStats.sourcesAttempted || 1),
      totalEventsFound: runStats.totalEventsFound,
      totalEventsPersisted: 0, // persistering sker i workern, summeras separat
      stagesCompleted: stages,
      errorSummary,
      pid: process.pid,
      reportPath: null,
    });
  }
}

// Kör bara main() när filen exekveras direkt — inte vid import (tester).
// Detta förhindrar att tester råkar starta en riktig daglig körning.
const _invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (_invokedDirectly && !process.env.VITEST) {
  main().then((c) => process.exit(c)).catch((e) => { console.error('fatal:', e); process.exit(1); });
}
