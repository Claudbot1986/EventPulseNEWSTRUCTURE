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
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { RawEventInput } from '@eventpulse/shared';
import { DEFAULT_WORKER_CONCURRENCY } from './workerConcurrency';

// Lazy connection to avoid ENOTFOUND at import time
let _connection: IORedis | null = null;

function getConnection(): IORedis {
  if (!_connection) {
    const redisUrl = process.env.REDIS_URL || 'redis://host.docker.internal:6379';
    console.log('[queue] Using Redis URL:', redisUrl);
    _connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    });
  }
  return _connection;
}

// RUNTIME-PRESERVING NOTE (2026-09-04, batch B K2): bullmq's
// ConnectionOptions does not accept a { getConnection } factory. At runtime
// bullmq treats this object as plain RedisOptions (unknown key ignored) and
// connects with its own defaults — the lazy-connection factory above is never
// invoked by bullmq. The cast below types the queue correctly WITHOUT changing
// runtime; honest contract cleanup is a separate queue-task (see
// 23-Active-Task-Queue).
export const rawEventsQueue = new Queue<RawEventInput>('raw_events', {
  connection: { getConnection } as unknown as ConnectionOptions,
  prefix: 'bull',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Smoke test queue - uses separate queue name for isolation
export const smokeTestQueue = new Queue<RawEventInput>('ingestion_smoke', {
  connection: { getConnection } as unknown as ConnectionOptions,
  prefix: 'bull',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,  // Clean up immediately in smoke test
    removeOnFail: true,
  },
});

export const searchSyncQueue = new Queue<{ event_id: string; action: 'upsert' | 'delete' }>(
  'search_sync',
  { connection: { getConnection } as unknown as ConnectionOptions, prefix: 'bull' }
);

// AI image generation queue — fired by normalizer after each upsert when
// image_url is null. Processed by imageGenerationWorker.
export const imageGenerationQueue = new Queue<{ event_id: string }>(
  'image_generation',
  {
    connection: { getConnection } as unknown as ConnectionOptions,
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  }
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
    connection: { getConnection } as unknown as ConnectionOptions,
    prefix: 'bull',
    concurrency,
  });

  return worker;
}

/**
 * Create a normalizer worker for smoke test mode
 * Uses the smoke test queue and lower concurrency
 */
export function createSmokeTestWorker(
  processor: (job: Job<RawEventInput>) => Promise<void>
) {
  const worker = new Worker<RawEventInput>('ingestion_smoke', processor, {
    connection: { getConnection } as unknown as ConnectionOptions,
    prefix: 'bull',
    concurrency: 3,  // Lower concurrency for smoke test
  });

  return worker;
}

/**
 * Create an image-generation worker.
 * Concurrency kept low (BFL rate-limit friendly).
 */
export function createImageGenerationWorker(
  processor: (job: Job<{ event_id: string }>) => Promise<void>
) {
  return new Worker<{ event_id: string }>('image_generation', processor, {
    connection: { getConnection } as unknown as ConnectionOptions,
    prefix: 'bull',
    concurrency: 2,
  });
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
