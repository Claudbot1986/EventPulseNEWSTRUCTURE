/**
 * imageGenerationWorker.ts — consumes 'image_generation' queue.
 *
 * Fired by normalizer when an event is upserted WITHOUT image_url.
 * Generates one AI image via 08-Agent/services/imageGen and updates the event.
 *
 * Idempotent:
 *   - Job ID = `img-<event_id>` → re-firing same event updates the same job
 *   - Pre-check: if event already has image_url, skip
 *
 * Run: npx tsx 03-Queue/imageGenerationWorker.ts
 *
 * Concurrency: 2 (BFL rate-limit friendly — see queue.ts createImageGenerationWorker).
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Job } from 'bullmq';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { createImageGenerationWorker } from './queue';
import { generateForEvent, type EventInput } from '../08-Agent/services/imageGen';

async function processImageJob(job: Job<{ event_id: string }>): Promise<void> {
  const { event_id } = job.data;
  console.log(`[imageWorker] Processing ${event_id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 3})`);

  // Hämta event för att verifiera och hämta nödvändig data
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: event, error: fetchErr } = await supabase
    .from('events')
    .select('id, title_sv, title_en, description_sv, description_en, category_slug, venue_id, image_url, venues(name)')
    .eq('id', event_id)
    .single();

  if (fetchErr || !event) {
    console.error(`[imageWorker] Event ${event_id} not found:`, fetchErr?.message);
    throw new Error(`Event ${event_id} not found`);
  }

  // Idempotens-kontroll: hoppa över om bilden redan finns
  if (event.image_url) {
    console.log(`[imageWorker] Event ${event_id} redan har image_url — skippar`);
    return;
  }

  const input: EventInput = {
    id: event.id,
    title_sv: event.title_sv,
    title_en: event.title_en,
    description_sv: event.description_sv,
    description_en: event.description_en,
    category_slug: event.category_slug,
    venues: event.venues,
  };

  try {
    const result = await generateForEvent(input);
    console.log(`[imageWorker] ✓ ${event_id} → ${result.imageUrl.slice(0, 80)}... (${result.costCents}¢)`);
  } catch (err) {
    console.error(`[imageWorker] ✗ ${event_id} failed:`, (err as Error).message);
    throw err; // BullMQ kommer retry:a enligt job.options.attempts/backoff
  }
}

const worker = createImageGenerationWorker(processImageJob);

worker.on('completed', (job) => {
  console.log(`[imageWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[imageWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

worker.on('ready', () => {
  console.log('[imageWorker] Image generation worker ready, consuming image_generation queue');
});

console.log('[imageWorker] Starting image generation worker...');
