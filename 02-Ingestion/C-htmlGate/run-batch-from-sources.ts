/**
 * run-batch-from-sources — Kör specifika källor genom C-htmlGate.
 *
 * Usage: npx tsx run-batch-from-sources.ts --sources "a,b,c" [--batch-id 25] [--dry-run]
 *
 * 2026-10-24 — detta argument var en NO-OP innan. Skriptet parseade
 * `--sources` och skrev ut källnamnen i en loggrad, men själva batchen
 * läste `runtime/postB-preC-queue.jsonl` (buildInitialPool). En operatör som
 * bad C-gaten köra en specifik fail-källa fick därför ingenting att köra —
 * det fanns ingen väg att köra om en källa som failat en gång.
 *
 * Nu: källorna såddas in i postB-preC-kön och skickas vidare som explicita
 * kandidater, så `--sources` betyder vad den låter betyda.
 *
 * Seeding: 02-Ingestion/tools/requeue-sources.ts (samma köpost-format som
 * B-gatens addToPostBPreCQueue).
 */

import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDynamicPoolBatch } from './run-dynamic-pool.js';
import { runRequeue } from '../tools/requeue-sources';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, 'reports');

const args = process.argv.slice(2);
const sourcesArg = args.find(a => a.startsWith('--sources='))?.split('=')[1];
const batchIdArg = args.find(a => a.startsWith('--batch-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

if (!sourcesArg) {
  console.error('Usage: npx tsx run-batch-from-sources.ts --sources="a,b,c" [--batch-id=25] [--dry-run]');
  process.exit(1);
}

const sources = sourcesArg.split(',').map(s => s.trim()).filter(Boolean);

/** Nästa fria batch-nummer — en återanvänd nummerering resume:ar gammal pool-state. */
function nextBatchNumber(): number {
  if (!existsSync(REPORTS_DIR)) return 1;
  const max = readdirSync(REPORTS_DIR)
    .map(d => /^batch-(\d+)$/.exec(d)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .reduce((a, b) => Math.max(a, b), 0);
  return max + 1;
}

const batchId = batchIdArg ? parseInt(batchIdArg, 10) : nextBatchNumber();

console.log(`Starting batch ${batchId} with ${sources.length} sources: ${sources.join(', ')}`);

// 1) Sådd källorna i postB-preC-kön (C-gatens enda ingång).
const requeue = runRequeue({
  sourceIds: sources,
  reason: 'run-batch-from-sources',
  dryRun,
});
for (const p of requeue.plan) {
  console.log(`[requeue] ${p.sourceId}: ${p.outcome} — ${p.detail}`);
}
if (requeue.written === 0 && requeue.plan.some(p => p.outcome === 'queued') === false) {
  const anyQueued = requeue.plan.some(p => p.outcome === 'already_queued');
  if (!anyQueued) {
    console.error('Ingen källa kunde köas — inget att köra i C.');
    process.exit(1);
  }
}
if (dryRun) {
  console.log('[dry-run] Ingen C-körning.');
  process.exit(0);
}

// 2) Kör C-gaten med exakt de här källorna som explicita kandidater.
runDynamicPoolBatch({
  batchNum: batchId,
  batchType: 'normal',
  sources,
}).then(result => {
  console.log(`\nBatch ${batchId} completed!`);
  console.log(`Rounds: ${result.poolRoundNumber}`);
  console.log(`Exited: ${result.totalExited}`);
  console.log(`Active: ${result.totalActive}`);
  console.log(`Stop reason: ${result.stopReason}`);
  console.log(`Queue distribution:`, result.queueDistribution);
}).catch(err => {
  console.error('Batch failed:', err);
  process.exit(1);
});
