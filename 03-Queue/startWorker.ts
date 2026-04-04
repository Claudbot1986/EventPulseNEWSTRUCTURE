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
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

import { createNormalizerWorker } from './queue';
import { processRawEvent } from '../04-Normalizer/normalizer';

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

console.log('[worker] Starting normalizer worker...');
