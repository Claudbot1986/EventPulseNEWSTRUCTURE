/**
 * verify-runDaily-count.ts — bevis att countWorkerCompletions mäter workerns riktiga stdout.
 *
 * Skapar EN worker-batch mot befintlig BullMQ-kö (2753 events väntar), fångar
 * workerns stdout, och anropar både `countWorkerCompletions` (vad runDaily nu
 * använder) och en naiv "raden 'completed' finns någonstans"-räknare.
 *
 * Pass = båda räknarna överensstämmer OCH > 0.
 * Fail = workern producerade inga [worker]-rader (kö tom? worker död?).
 *
 * 2026-10-21 — den här filen är ett testbevis, inte en regressionstest. Tas bort
 * efter verifiering eller flyttas till tests/ om den visar sig ha värde.
 */

import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { countWorkerCompletions } from '../09-ScrapingSupervisor/runDaily.js';

const TSX_BIN = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const WORKER = path.resolve(process.cwd(), '03-Queue/startWorker.ts');

async function main(): Promise<void> {
  const DRAIN_MS = 25_000;
  console.log(`[verify] startar worker i ${DRAIN_MS}ms för att mäta countWorkerCompletions`);
  const proc = spawn(TSX_BIN, [WORKER], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let stdoutBuf = '';
  proc.stdout.on('data', (c: Buffer) => { stdoutBuf += c.toString('utf8'); });
  proc.stderr.on('data', (c: Buffer) => { stdoutBuf += c.toString('utf8'); });
  await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_MS));
  proc.kill('SIGTERM');
  await new Promise<void>((resolve) => proc.on('exit', () => resolve()));

  const completedLines = (stdoutBuf.match(/\[worker\] Job \d+ completed/g) ?? []).length;
  const counter = countWorkerCompletions(stdoutBuf);
  const anyFailure = (stdoutBuf.match(/\[worker\] Job \d+ failed/g) ?? []).length;

  console.log(`[verify] totala "[worker] Job N completed"-rader: ${completedLines}`);
  console.log(`[verify] countWorkerCompletions: ${counter}`);
  console.log(`[verify] "[worker] Job N failed"-rader: ${anyFailure}`);

  if (completedLines === 0) {
    console.error('[verify] FAIL: workern producerade inga [worker]-rader. BullMQ-kön tom? Worker dog?');
    process.exit(1);
  }
  if (counter !== completedLines) {
    console.error(`[verify] FAIL: countWorkerCompletions (${counter}) !== faktiskt antal rader (${completedLines})`);
    process.exit(1);
  }
  if (counter <= 0) {
    console.error('[verify] FAIL: counter <= 0');
    process.exit(1);
  }
  console.log(`[verify] PASS — countWorkerCompletions räknar riktiga [worker]-rader`);
}

main().catch((e) => { console.error('[verify] fatal:', e); process.exit(1); });
