/**
 * ingest-aggregator.ts — One-shot ingestion of a single aggregator source.
 *
 * Används av Stockholm Coverage Recovery Plan (Fas 1B) för att lägga till
 * nya aggregators snabbare än full A-pipelinen.
 *
 * Pipeline (mimics runA-extract + importToEventPulse):
 *   1. Fetch URL med rätt User-Agent + delay för robots
 *   2. Extract JSON-LD via 02-Ingestion/F-eventExtraction/extractor
 *   3. Write raw events to 03-Queue/03-extractedevents/{sourceId}.jsonl
 *   4. Import via BullMQ raw_events queue (importToEventPulse-style)
 *   5. Start a normalizer worker briefly to drain the queue
 *
 * Usage:
 *   npx tsx scripts/ingest-aggregator.ts <sourceId>
 *
 * Idempotent: om events redan finns i DB med samma dedup_hash → no-op.
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

import { fetchHtml } from '../02-Ingestion/tools/fetchTools';
import { extractFromJsonLd } from '../02-Ingestion/F-eventExtraction/extractor';
import { getSource } from '../02-Ingestion/tools/sourceRegistry';
import { rawEventsQueue, createNormalizerWorker } from '../03-Queue/queue';
import { processRawEvent } from '../04-Normalizer/normalizer';

const EXTRACTED_DIR = path.resolve(__dirname, '..', '03-Queue', '03-extractedevents');

interface SourceTruth {
  id: string;
  url: string;
  name: string;
  type: string;
  city?: string;
  preferredPath: string;
  metadata?: Record<string, any>;
}

function isStockholmSource(source: SourceTruth): boolean {
  return (source.city ?? '').trim() === 'Stockholm';
}

function isInBounds(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (lat < 59.0 || lat > 60.0) return false;
  if (lng < 17.5 || lng > 19.0) return false;
  return true;
}

function eventInStockholm(e: any): boolean {
  // Trust aggregator URL (e.g. /stockholm in path) — already implies scope.
  // For JSON-LD events without geo, check city/address fields.
  if (e.city && typeof e.city === 'string' && /stockholm/i.test(e.city)) return true;
  if (e.address && typeof e.address === 'string' && /stockholm/i.test(e.address)) return true;
  if (e.venue && typeof e.venue === 'string' && /stockholm/i.test(e.venue)) return true;
  // Geo if present
  if (e.geo?.lat != null && e.geo?.lng != null) return isInBounds(e.geo.lat, e.geo.lng);
  if (e.lat != null && e.lng != null) return isInBounds(e.lat, e.lng);
  // No geo info → trust URL scope
  return true;
}

async function ingest(sourceId: string): Promise<void> {
  console.log(`=== Ingest ${sourceId} ===`);

  const source = getSource(sourceId) as SourceTruth | null;
  if (!source) {
    throw new Error(`Source ${sourceId} not found in sources/`);
  }
  console.log(`  url: ${source.url}`);
  console.log(`  city: ${source.city ?? '?'} (Stockholm-only: ${isStockholmSource(source)})`);

  // 1) Fetch
  console.log('  fetching...');
  const fetchResult = await fetchHtml(source.url, {
    userAgent: 'EventPulse/1.0 (event-ingestion; +https://eventpulse.app)',
    respectRobots: true,
    timeoutMs: 30_000,
  });

  if (!fetchResult.success || !fetchResult.html) {
    throw new Error(`Fetch failed for ${source.url}: ${fetchResult.error ?? 'no html'} (final=${fetchResult.finalUrl ?? '?'}, redirects=${fetchResult.redirectChain?.length ?? 0})`);
  }
  console.log(`  fetched ${fetchResult.html.length} bytes (${fetchResult.statusCode})`);

  // 2) Extract JSON-LD
  const extractResult = extractFromJsonLd(fetchResult.html, source.url, sourceId);

  console.log(`  parsed: ${extractResult.events.length} events (${extractResult.parseErrors.length} errors)`);
  if (extractResult.parseErrors.length > 0) {
    console.log(`  first 3 errors: ${extractResult.parseErrors.slice(0, 3).join(' | ').slice(0, 200)}`);
  }

  // 3) Apply Stockholm filter (relaxed: trust URL scope + venue text)
  let filtered = extractResult.events.filter(eventInStockholm);
  const before = extractResult.events.length;
  if (before !== filtered.length) {
    console.log(`  stockholm-filter: ${before} → ${filtered.length}`);
  }

  if (filtered.length === 0) {
    console.log('  no events to ingest');
    return;
  }

  // 4) Write raw events to extractedevents/
  const outFile = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  let written = 0;
  for (const ev of filtered) {
    const line = JSON.stringify({ ...ev, source: sourceId, sourceUrl: source.url }) + '\n';
    fs.appendFileSync(outFile, line);
    written++;
  }
  console.log(`  wrote ${written} events → ${outFile}`);

  // 5) Enqueue to raw_events via BullMQ
  console.log('  enqueuing to raw_events queue...');
  let enqueued = 0;
  for (const ev of filtered) {
    const safeTitle = (ev.title ?? 'untitled').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80);
    const jobId = `${sourceId}--${safeTitle}--${ev.startDate ?? ''}`;
    await rawEventsQueue.add(jobId, {
      title: ev.title ?? '',
      description: ev.description ?? null,
      // ParsedEvent has date (YYYY-MM-DD) + time (HH:MM) — combine to ISO.
      // If time missing, use T00:00:00; normalizer rejects only past dates.
      start_time: (ev.date && ev.time)
          ? `${ev.date}T${ev.time}:00+02:00`
          : (ev.date ? `${ev.date}T00:00:00+02:00` : ''),
      end_time: (ev.endDate && ev.endTime)
          ? `${ev.endDate}T${ev.endTime}:00+02:00`
          : (ev.endDate ? `${ev.endDate}T00:00:00+02:00` : null),
      venue_name: ev.venue ?? ev.location?.name ?? null,
      venue_address: ev.address ?? ev.location?.address ?? null,
      lat: ev.geo?.lat ?? ev.lat ?? null,
      lng: ev.geo?.lng ?? ev.lng ?? null,
      categories: ev.category ? [ev.category] : [],
      is_free: ev.isFree ?? false,
      price_min_sek: ev.priceMin ?? null,
      price_max_sek: ev.priceMax ?? null,
      ticket_url: ev.ticketUrl ?? ev.url ?? null,
      image_url: ev.imageUrl ?? ev.image ?? null,
      source: sourceId,
      source_id: null,
      detected_language: 'sv',
      raw_payload: ev as any,
    }, { jobId });
    enqueued++;
  }
  console.log(`  enqueued ${enqueued} jobs`);

  // 6) Start normalizer worker briefly to drain
  console.log('  starting normalizer worker (will exit when queue empty)...');
  const worker = createNormalizerWorker(processRawEvent);
  let processed = 0;
  let failed = 0;
  worker.on('completed', () => { processed++; });
  worker.on('failed', (_job, err) => { failed++; console.error(`  [worker] failed: ${err.message}`); });

  // Wait up to 90s for queue to drain
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    const counts = await rawEventsQueue.getJobCounts();
    const pending = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    if (pending === 0) {
      console.log(`  queue drained (processed=${processed}, failed=${failed})`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await worker.close();
  console.log(`=== DONE ${sourceId}: extracted=${extractResult.events.length}, filtered=${filtered.length}, enqueued=${enqueued}, processed=${processed}, failed=${failed} ===`);
}

const sourceId = process.argv[2];
if (!sourceId) {
  console.error('Usage: npx tsx scripts/ingest-aggregator.ts <sourceId>');
  process.exit(2);
}

ingest(sourceId).then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});