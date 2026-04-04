// Load dotenv FIRST before any other imports that might use process.env
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), override: true });

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { RawEventInput } from '@eventpulse/shared';

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

export const rawEventsQueue = new Queue<RawEventInput>('raw_events', {
  connection: { getConnection },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Smoke test queue - uses separate queue name for isolation
export const smokeTestQueue = new Queue<RawEventInput>('ingestion_smoke', {
  connection: { getConnection },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,  // Clean up immediately in smoke test
    removeOnFail: true,
  },
});

export const searchSyncQueue = new Queue<{ event_id: string; action: 'upsert' | 'delete' }>(
  'search_sync',
  { connection: { getConnection } }
);

export function createNormalizerWorker(
  processor: (job: Job<RawEventInput>) => Promise<void>,
  queueName: string = 'raw_events'
) {
  const worker = new Worker<RawEventInput>(queueName, processor, {
    connection: { getConnection },
    concurrency: 5,
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
    connection: { getConnection },
    concurrency: 3,  // Lower concurrency for smoke test
  });

  return worker;
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
