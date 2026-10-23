/**
 * Minimal normalizer worker starter for NEWSTRUCTURE.
 * Consumes from raw_events queue, runs processRawEvent per job.
 * Run: npx tsx 03-Queue/startWorker.ts
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// .env ligger ETT steg upp från 03-Queue (../.env) — samma sökväg som
// queue.ts och drainQueue.ts. Tidigare stod '../../.env' här, vilket pekade
// på /Users/claudgashi/.env (filen finns inte) → dotenv laddade 0 variabler.
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { createNormalizerWorker, closeAllQueues } from './queue';
import { processRawEvent } from '../04-Normalizer/normalizer';
import { stopAiImageWorker } from '../08-Agent/workers/aiImageWorker';

const worker = createNormalizerWorker(processRawEvent);

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed — "${job.data.title}"`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
});

worker.on('ready', () => {
  console.log('[worker] Normalizer worker ready, consuming raw_events queue');
});

/**
 * Graceful shutdown — 2026-10-23.
 *
 * UTAN denna handler dog processen OMEDELBART på SIGTERM (Node-default),
 * medan jobb var i-flight. BullMQ lämnade då jobbet i `active` med en
 * utgången lås — de fick varken completed, failed eller retry, och eventet
 * persisterades ALDRIG. Mätt 2026-10-23: 5 jobb (sigterm-test-*) fastnade i
 * `active` med `locked=false` efter att runDaily.ts skickade SIGTERM efter
 * 15 minuters dräneringsfönster.
 *
 * Ordningen nedan är viktig: worker.close() väntar på ALLA pågående jobb
 * (BullMQ WhenCurrentJobsFinished) och först därefter stängs Redis-sockets.
 * Stängs socketarna först blir jobben "Connection is closed." — vilket
 * markerar redan persisterade events som failed (26 jobb, samma dag).
 */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[worker] ${signal} mottaget — avslutar graceful (väntar på pågående jobb)...`);

  const forceExit = setTimeout(() => {
    console.error(
      `[worker] ${signal}: graceful-stängning överskred ${GRACEFUL_SHUTDOWN_TIMEOUT_MS} ms — avslutar hårt`,
    );
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  forceExit.unref?.();

  try {
    // 1) Vänta på in-flight jobb — de ska få chans att persistera.
    await worker.close();
    // 2) Stäng ai-image-workern och dess delade IORedis-instans.
    await stopAiImageWorker();
    // 3) Stäng övriga BullMQ-köer (search_sync, raw_events, ...).
    await closeAllQueues();
    clearTimeout(forceExit);
    console.log('[worker] avslutad rent');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExit);
    console.error('[worker] fel vid avslut:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

console.log('[worker] Starting normalizer worker...');
