/**
 * run-batch-from-sources — Kör specifika källor genom C-htmlGate OCH
 * leverera resultatet till databasen.
 *
 * Usage: npx tsx run-batch-from-sources.ts --sources "a,b,c" [--batch-id 25] [--dry-run] [--no-deliver]
 *
 * 2026-10-24 — detta argument var en NO-OP innan. Skriptet parseade
 * `--sources` och skrev ut källnamnen i en loggrad, men själva batchen
 * läste `runtime/postB-preC-queue.jsonl` (buildInitialPool). En operatör som
 * bad C-gaten köra en specifik fail-källa fick därför ingenting att köra —
 * det fanns ingen väg att köra om en källa som failat en gång.
 *
 * Nu: källorna såddas in i postB-preC-kön och skickas vidare som explicita
 * kandidater, så `--sources` betyder vad det låter betyda.
 *
 * 2026-10-24 (andra rundan) — `--sources` betydde fortfarande inte "kör och
 * få events i DB". C-gaten skriver sina events till
 * `03-Queue/03-extractedevents/C/`, men de når databasen via
 * `importToEventPulse.ts` → `drainQueue.ts`, och de två stegen körs bara i
 * nattens cron. Mätt: 10 extraherade events (historiska-museet,
 * livrustkammaren, kammarencom) låg på disk hela dagen utan att synas i
 * Supabase.
 *
 * Efter batchen körs därför import + drain (se tools/deliverExtracted.ts).
 * `--no-deliver` hoppar över det steget (t.ex. när man bara vill se vad
 * C-gaten hittar).
 *
 * Seeding: 02-Ingestion/tools/requeue-sources.ts (samma köpost-format som
 * B-gatens addToPostBPreCQueue).
 */

import { existsSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDynamicPoolBatch } from './run-dynamic-pool.js';
import { nextBatchNumber as nextBatchNumberIn } from './batchNumber.js';
import { runRequeue } from '../tools/requeue-sources';
import {
  planDelivery,
  deliverExtractedToDatabase,
  type CommandRunner,
} from '../tools/deliverExtracted';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, 'reports');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const sourcesArg = args.find(a => a.startsWith('--sources='))?.split('=')[1];
const batchIdArg = args.find(a => a.startsWith('--batch-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const noDeliver = args.includes('--no-deliver');

if (!sourcesArg) {
  console.error('Usage: npx tsx run-batch-from-sources.ts --sources="a,b,c" [--batch-id=25] [--dry-run] [--no-deliver]');
  process.exit(1);
}

const sources = sourcesArg.split(',').map(s => s.trim()).filter(Boolean);

/**
 * Nästa fria batch-nummer.
 *
 * Logiken ligger i batchNumber.ts (med test) — den låg tidigare inline här
 * och var trasig: `.test(d)?.[1]` ger alltid undefined (test() returnerar
 * boolean), så max blev 0 och varje operatörskörning fick batch-nummer 1.
 * Effekten: körning två och tre resume:ade batch-1:s pool-state, körde
 * ingen enda källa och rapporterade den första körningens siffror.
 */
function nextBatchNumber(): number {
  return nextBatchNumberIn(REPORTS_DIR);
}

const batchId = batchIdArg ? parseInt(batchIdArg, 10) : nextBatchNumber();

/** Kör ett kommando i repot och returnerar exit-koden. */
const runCommand: CommandRunner = (command, cmdArgs) =>
  new Promise(resolve => {
    const child = spawn(command, cmdArgs, { stdio: 'inherit', cwd: REPO_ROOT });
    child.on('error', () => resolve(1));
    child.on('exit', code => resolve(code ?? 1));
  });

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
})
  .then(async result => {
    console.log(`\nBatch ${batchId} completed!`);
    console.log(`Rounds: ${result.poolRoundNumber}`);
    console.log(`Exited: ${result.totalExited}`);
    console.log(`Active: ${result.totalActive}`);
    console.log(`Stop reason: ${result.stopReason}`);
    console.log(`Queue distribution:`, result.queueDistribution);

    if (noDeliver) {
      console.log('\n[deliver] --no-deliver — inga events levererades till databasen.');
      return;
    }

    // 3) Leverera till databasen: import → drain.
    const plan = planDelivery(sources, { repoRoot: REPO_ROOT });
    if (plan.sourceIds.length === 0) {
      console.log('\n[deliver] Ingen av källorna producerade en extraherad fil — inget att leverera.');
      return;
    }
    console.log(`\n[deliver] Levererar ${plan.sourceIds.length} källor: ${plan.sourceIds.join(', ')}`);
    const delivery = await deliverExtractedToDatabase(plan, runCommand, { repoRoot: REPO_ROOT });
    if (!delivery.drained) {
      console.error('[deliver] Leveransen misslyckades — inga events i databasen.');
      process.exitCode = 1;
      return;
    }
    console.log('[deliver] Klart — eventsen är i databasen.');
  })
  .catch(err => {
    console.error('Batch failed:', err);
    process.exit(1);
  });
