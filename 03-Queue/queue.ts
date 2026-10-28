// Load dotenv FIRST before any other imports that might use process.env
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// .env ligger ETT steg upp från 03-Queue. Sökvägen var '../../../../.env',
// alltså /Users/.env — filen finns inte, så dotenv laddade 0 variabler och
// getConnection() föll tillbaka på 'redis://host.docker.internal:6379', en
// Docker-adress som inte finns på maskinen. Symptom: "Connection is closed"
// för varje CLI som importerar den här modulen utan att REDIS_URL redan
// finns i miljön. Nightly-flödet har aldrig märkt det — launchd-plisten gör
// `set -a; . ./.env`, så där är variabeln redan satt (2026-10-23).
//
// 2026-10-28 — `override: false` i stället för true. Med true kunde .env
// alltid skriva över ett explicit satt REDIS_URL, vilket gjorde det
// omöjligt att peka ett steg mot en trasig Redis (fail-fast-testet gick
// därför mot den levande Redis i stället). Miljövariabel vinner nu över
// .env — rätt ordning. I launchd-fallet är värdena identiska (plisten
// sourcar .env), så ingen beteendeförändring i nattkörningen.
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

import { Queue, Worker, type Job } from 'bullmq';
import type { RawEventInput } from '@eventpulse/shared';
import { DEFAULT_WORKER_CONCURRENCY } from './workerConcurrency';
import { producerOptions, workerOptions, reportQueueErrors } from './redisClient.mjs';

// 2026-10-28 — kopplingen är nu PLAINA options, inte en `{ getConnection }`-
// fabrik. BullMQ behandlar en fabrik som okänd RedisOption och ignorerar
// den (redis-connection.js:35 gör `Object.assign({port,host,retryStrategy}, opts)`)
// — så REDIS_URL användes aldrig och anslutningen gick mot 127.0.0.1:6379
// av slump. Med optioner i stället:
//   - REDIS_URL används som det ska,
//   - `enableOfflineQueue: false` gör att ett kommando under en Redis-utfall
//     misslyckas omedelbart i stället för att ligga i offline-kön i evighet
//     (det var den 2-timmars-hängningen 2026-10-26),
//   - `maxRetriesPerRequest: 1` på producentsidan (se redisClient.mjs).
//
// Se 03-Queue/redisClient.mjs för BullMQ-begränsningarna (blocking-
// anslutningen tvingas till maxRetriesPerRequest=null).

export const rawEventsQueue = reportQueueErrors(
  new Queue<RawEventInput>('raw_events', {
    connection: producerOptions(),
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }),
  'queue:raw_events'
);

// Smoke test queue - uses separate queue name for isolation
export const smokeTestQueue = reportQueueErrors(
  new Queue<RawEventInput>('ingestion_smoke', {
    connection: producerOptions(),
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,  // Clean up immediately in smoke test
      removeOnFail: true,
    },
  }),
  'queue:ingestion_smoke'
);

export const searchSyncQueue = reportQueueErrors(
  new Queue<{ event_id: string; action: 'upsert' | 'delete' }>('search_sync', {
    connection: producerOptions(),
    prefix: 'bull',
  }),
  'queue:search_sync'
);

// AI image generation queue — fired by normalizer after each upsert when
// image_url is null. Processed by imageGenerationWorker.
export const imageGenerationQueue = reportQueueErrors(
  new Queue<{ event_id: string }>('image_generation', {
    connection: producerOptions(),
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  }),
  'queue:image_generation'
);

/**
 * Skapa normalizer-workern.
 *
 * `concurrency` styr hur många events som normaliseras parallellt. Varje
 * jobb gör två LLM-anrop, så fler workers = mer parallell modelltrafik.
 * Se 03-Queue/workerConcurrency.ts för mätning och regler.
 */
export function createNormalizerWorker(
  processor: (job: Job<RawEventInput>) => Promise<void>,
  queueName: string = 'raw_events',
  concurrency: number = DEFAULT_WORKER_CONCURRENCY
) {
  const worker = new Worker<RawEventInput>(queueName, processor, {
    connection: workerOptions(),
    prefix: 'bull',
    concurrency,
  });

  return reportQueueErrors(worker, `worker:${queueName}`);
}

/**
 * Create a normalizer worker for smoke test mode
 * Uses the smoke test queue and lower concurrency
 */
export function createSmokeTestWorker(
  processor: (job: Job<RawEventInput>) => Promise<void>
) {
  const worker = new Worker<RawEventInput>('ingestion_smoke', processor, {
    connection: workerOptions(),
    prefix: 'bull',
    concurrency: 3,  // Lower concurrency for smoke test
  });

  return reportQueueErrors(worker, 'worker:ingestion_smoke');
}

/**
 * Create an image-generation worker.
 * Concurrency kept low (BFL rate-limit friendly).
 */
export function createImageGenerationWorker(
  processor: (job: Job<{ event_id: string }>) => Promise<void>
) {
  const worker = new Worker<{ event_id: string }>('image_generation', processor, {
    connection: workerOptions(),
    prefix: 'bull',
    concurrency: 2,
  });
  return reportQueueErrors(worker, 'worker:image_generation');
}

/**
 * Clear the smoke test queue
 */
export async function clearSmokeTestQueue(): Promise<void> {
  try {
    // Clean all job states
    await smokeTestQueue.clean(0, 100, 'completed');
    await smokeTestQueue.clean(0, 100, 'failed');
    await smokeTestQueue.clean(0, 100, 'wait');
    await smokeTestQueue.clean(0, 100, 'active');

    // Also remove by bulk delete to ensure complete cleanup
    const counts = await smokeTestQueue.getJobCounts();
    if (counts.completed > 0 || counts.failed > 0 || counts.waiting > 0 || counts.active > 0) {
      console.log(`[smoke-test] Cleaned queue: ${counts.completed} completed, ${counts.failed} failed, ${counts.waiting} waiting, ${counts.active} active`);
    } else {
      console.log('[smoke-test] Queue already empty');
    }
  } catch (err) {
    console.log('[smoke-test] Queue cleanup:', (err as Error).message);
  }
}

/**
 * Stäng alla köer och deras Redis-anslutningar.
 *
 * Kortlivade CLI:er (runB, scheduler, e2e) som importerar den här modulen
 * öppnar fyra beständiga ioredis-sockets som annars håller Node:s eventloop
 * öppen för alltid. Utan detta avslutas processen aldrig — bara för att den
 * lyckades köa minst ett event (2026-10-23: B-gates hängde i 8+ min efter
 * att den skrivit sin summary, med fyra ESTABLISHED-sockets till Redis).
 *
 * Anropa detta från alla batch-CLI:er strax före process.exit().
 */
export async function closeAllQueues(): Promise<void> {
  const queues = [rawEventsQueue, smokeTestQueue, searchSyncQueue, imageGenerationQueue];
  await Promise.all(
    queues.map(async (queue) => {
      try {
        await queue.close();
      } catch (err) {
        console.error('[queue] close failed:', (err as Error).message);
      }
    })
  );
}
