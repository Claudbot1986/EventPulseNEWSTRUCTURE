#!/usr/bin/env node
/**
 * drainQueue — dränerar normalizer-kön och AVSLUTAR rent.
 *
 * Varför detta finns (2026-10-23): alla producenter i ingestion-kedjan skriver
 * till BullMQ-kön `raw_events`, men ingen dränerar den. `runDaily.ts:224` har
 * en 15-minuters drain — men det är INTE det som launchd kör. Plisten
 * com.eventpulse.ingestion kör scripts/ingestion-cron.ts, som saknar
 * drain-steg helt. Mätt 2026-10-23: 3 548 jobb väntande, äldsta från
 * 2026-10-20, 0 persisterade av nattens 1 147 "funna" events.
 *
 * Kedjan producerade alltså events som aldrig nådde databasen. Det här steget
 * är den sista milen.
 *
 * Bounded: avslutar när kön är tom, när maxMs gått, eller vid SIGTERM.
 * Avslutas via closeAllQueues() + stopAiImageWorker() — annars håller en öppen
 * ioredis-socket eventloopen levande för alltid (samma fel som B-gates hade).
 *
 * Usage:
 *   npx tsx 03-Queue/drainQueue.ts                    # töm kön, max 30 min
 *   npx tsx 03-Queue/drainQueue.ts --max-ms 300000   # max 5 min
 *   npx tsx 03-Queue/drainQueue.ts --status           # bara djup, ingen drain
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 03-Queue/drainQueue.ts ligger i samma katalog som queue.ts, så .env ligger
// ETT steg upp: '../.env'. Med '../../.env' laddades 0 variabler ("injecting
// env (0)") och queue.ts föll tillbaka på 'redis://host.docker.internal:6379'
// — en dator som inte kör Docker — vilket gav "Connection is closed" (2026-10-23).
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { createNormalizerWorker, closeAllQueues, rawEventsQueue } from './queue.js';
// 2026-10-23 — processor:n MÅSTE vara den riktiga normalizern. Tidigare skickades
// en räknande stub: `createNormalizerWorker(async () => { completed++ })`. Det
// markeraade varje jobb som "completed" utan att persistera en enda rad — en
// fejk-drain som såg grön ut i loggen. Se .cursor/rules/no-simulated-production-
// ingestion.mdc. countWorkerCompletions() i verify-fixes.mjs räknar
// "[worker] Job completed"-rader, så en stub-räknare hade gett E3 grönt på
// noll persisterade events.
import { processRawEvent } from '../04-Normalizer/normalizer.js';
import { stopAiImageWorker } from '../08-Agent/workers/aiImageWorker.js';

const args = process.argv.slice(2);
const maxMsIdx = args.indexOf('--max-ms');
const maxMs = maxMsIdx !== -1 && args[maxMsIdx + 1] ? parseInt(args[maxMsIdx + 1], 10) : 1_800_000;
const POLL_MS = 2_000;

async function depth(): Promise<{ waiting: number; active: number; failed: number }> {
  // Utan argument returnerar getJobCounts alla typer. Med typer som argument
  // returnerar den bara de som finns i just det anropet — vilket gav undefined
  // i startloggen när kön var full (2026-10-23).
  const counts = await rawEventsQueue.getJobCounts();
  return { waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0 };
}

async function main(): Promise<void> {
  const start = await depth();

  if (args.includes('--status')) {
    console.log(JSON.stringify(start, null, 2));
    // --status importerar stopAiImageWorker, vilket öppnar två Redis-sockets på
    // modulnivå. Utan att stänga dem avslutas processen aldrig — mätt 2026-10-23
    // levde tre --status-processer kvar i timmar (lsof: 1 etablerad socket vardera).
    await stopAiImageWorker();
    await closeAllQueues();
    process.exit(0);
  }

  console.log(`[drain] start: waiting=${start.waiting} active=${start.active} failed=${start.failed} maxMs=${maxMs}`);

  let completed = 0;
  let failed = 0;
  const worker = createNormalizerWorker(async (job) => {
    await processRawEvent(job);
    completed += 1;
    console.log(`[worker] Job completed — ${completed}/${start.waiting}`);
  });
  worker.on('failed', (_job, err) => {
    failed += 1;
    console.error(`[drain] job failed: ${err.message}`);
  });

  const stop = async (reason: string): Promise<void> => {
    const d = await depth();
    console.log(`[drain] avslutar (${reason}): completed=${completed} failed=${failed} kvar=${d.waiting} active=${d.active}`);
    await worker.close();
    await stopAiImageWorker();
    await closeAllQueues();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  process.on('SIGINT', () => { void stop('SIGINT'); });

  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const d = await depth();
    if (d.waiting === 0 && d.active === 0) return void (await stop('kö tom'));
  }
  await stop(`maxMs=${maxMs} uppnått`);
}

main().catch((err) => {
  console.error('[drain] fel:', err);
  process.exit(1);
});