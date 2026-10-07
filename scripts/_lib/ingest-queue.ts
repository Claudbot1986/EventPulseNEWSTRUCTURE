/**
 * _lib/ingest-queue.ts — Delbar helper för att pusha RawEventInput till
 * raw_events BullMQ-queue istället för direkt-upsert.
 *
 * T0201.5 (Steg 3, 2026-10-06): migrering av alla ingest-scripts till att
 * gå via normalizer istället för direkt upsert. Detta ger oss automatiskt:
 *   - canonicalizeCategorySlug (raw → kanon-slug)
 *   - dedup_hash + cross-source dedup
 *   - venue-id resolution + geo-propagation
 *   - T0201: eventpulse_summary, description_license, raw_description
 *   - image_generation_status='pending' (workern plockar upp)
 *
 * Säkerhet:
 *   - Idempotent (normalizer dedupar via dedup_hash på unique-index).
 *   - BullMQ jobId får INTE innehålla ":" → använd "-".
 *   - Stale events (queue inte dränerad) bearbetas vid nästa worker-run.
 *
 * Användning i ingest-scripts:
 *   import { rawEventsQueue } from '../03-Queue/queue.js';  // TS-vägen
 *   ELLER
 *   import { Queue } from 'bullmq';                          // mjs-vägen
 *
 *   await rawEventsQueue.add('sourceName-event-id', rawEventInput, {
 *     removeOnComplete: 1000,
 *     removeOnFail: 5000,
 *   });
 */

import type { RawEventInput } from '@eventpulse/shared';

/**
 * Required columns for any ingest-script that pushes via queue.
 * Use this shape when building the raw object to ensure compatibility
 * with normalizer's validation.
 */
export interface QueueableRawEvent extends RawEventInput {
  // Inherits all required fields from shared package
}

/**
 * Helper to build a safe job name from source + source_id.
 * BullMQ rejects ":" in jobId but accepts it in jobName.
 * Returns a string like "livespot-abc123def456" (safe as jobId).
 */
export function makeJobId(source: string, sourceId: string | null | undefined, suffix?: string): string {
  const id = sourceId ?? 'no-id';
  return suffix ? `${source}-${id}-${suffix}` : `${source}-${id}`;
}

/**
 * Standard queue options (idempotens-friendly).
 */
export const QUEUE_OPTIONS = Object.freeze({
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
});

/**
 * Standard log output for ingest-scripts:
 *   "[source] 12345 events queued to raw_events"
 */
export function logQueueResult(source: string, queued: number, failed: number): void {
  console.log(`[${source}] ${queued} events queued to raw_events${failed > 0 ? `, ${failed} failed` : ''}`);
}