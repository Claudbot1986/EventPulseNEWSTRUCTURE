/**
 * importToEventPulse.ts — EventPulse Import
 *
 * Läser events från 03-Queue/03-extractedevents/{sourceId}.jsonl,
 * enquear varje event till bullmq `raw_events` (→ normalizer → Supabase),
 * och flyttar källan till EVENTPULSE-APP-queue.jsonl.
 *
 * Flöde: preUI → runA-extract → extractedevents/ → importToEventPulse → Supabase → EVENTPULSE-APP
 *
 * Usage:
 *   npx tsx 03-Queue/importToEventPulse.ts              # alla extractedevents/
 *   npx tsx 03-Queue/importToEventPulse.ts --limit N     # N källor
 *   npx tsx 03-Queue/importToEventPulse.ts --dry-run      # testa utan att köra
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

// ── Paths ────────────────────────────────────────────────────────────────────

const RUNTIME_DIR     = path.resolve(__dirname, '..');
const PREUI_Q         = path.join(RUNTIME_DIR, 'runtime', 'preUI-queue.jsonl');
const EVENTPULSE_Q    = path.join(RUNTIME_DIR, 'runtime', 'EVENTPULSE-APP-queue.jsonl');
const EXTRACTED_DIR   = path.resolve(__dirname, '03-extractedevents');

// ── BullMQ ───────────────────────────────────────────────────────────────────

interface RawEventInput {
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  categories: string[];
  is_free: boolean;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  source: string;
  source_id: string | null;
  detected_language: 'sv' | 'en' | 'other' | null;
  raw_payload: Record<string, unknown>;
}

async function enqueueRawEvent(raw: RawEventInput): Promise<void> {
  const { Queue } = await import('bullmq');
  const { getConnection } = await import('./queue.js');

  const q = new Queue('raw_events', {
    connection: { getConnection },
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

  const safeTitle = (raw.source_id ?? raw.title).replace(/[^a-zA-Z0-9-_]/g, '_');
  const jobId = `${raw.source}--${safeTitle}`;
  await q.add(jobId, raw, { jobId });
  await q.close();
}

// ── Queue helpers ───────────────────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason?: string;
  workerNotes?: string;
}

function readQueueEntries(file: string): QueueEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l) as QueueEntry)
    .filter(e => e !== null && 'sourceId' in e);
}

function removeFromPreUI(sourceId: string): void {
  if (!fs.existsSync(PREUI_Q)) return;
  const lines = fs.readFileSync(PREUI_Q, 'utf-8').split('\n');
  const filtered = lines.filter(l => {
    if (!l.trim()) return true;
    try { return JSON.parse(l).sourceId !== sourceId; }
    catch { return true; }
  });
  fs.writeFileSync(PREUI_Q, filtered.join('\n') + '\n');
}

function appendToEventPulseApp(sourceId: string, eventsEnqueued: number): void {
  // Always rewrite queue with deduplication (idempotent write)
  const existing = readQueueEntries(EVENTPULSE_Q);
  if (existing.some(e => e.sourceId === sourceId)) {
    console.log(`[import] ${sourceId}: redan i EVENTPULSE-APP — hoppar över duplicat`);
    return;
  }
  const newEntry: QueueEntry = {
    sourceId,
    queueName: 'EVENTPULSE-APP',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: 'importToEventPulse',
    workerNotes: `${eventsEnqueued} events importerade`,
  };
  const allEntries = [...existing, newEntry];
  fs.writeFileSync(EVENTPULSE_Q, allEntries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

// ── Extracted event reading ─────────────────────────────────────────────────

interface ExtractedEvent {
  title?: string | { rendered: string };
  name?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string | null;
  startTime?: string;
  endTime?: string;
  venue_name?: string | null;
  venue_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  categories?: string[];
  category?: string;
  is_free?: boolean;
  price_min_sek?: number | null;
  price_max_sek?: number | null;
  ticket_url?: string | null;
  url?: string | null;
  image_url?: string | null;
  source_id?: string | null;
  detected_language?: 'sv' | 'en' | 'other' | null;
  raw_payload?: Record<string, unknown>;
  // Fields from extractFromJsonLd (date/time as separate fields)
  date?: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  venue?: string;
  address?: string;
  city?: string;
  [key: string]: unknown;
}

function extractTitle(ev: ExtractedEvent): string {
  const t = ev.title;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && 'rendered' in t) return (t as { rendered: string }).rendered;
  return ev.name ?? 'Unknown';
}

function extractDescription(ev: ExtractedEvent): string | null {
  const d = ev.description;
  if (typeof d === 'string') return d;
  return null;
}

function extractStartTime(ev: ExtractedEvent): string {
  if (ev.start_time) return ev.start_time;
  if (ev.startTime) return ev.startTime;
  return toIsoStartTime(ev.date, ev.time);
}

function extractEndTime(ev: ExtractedEvent): string | null {
  if (ev.end_time) return ev.end_time;
  if (ev.endTime) return ev.endTime;
  return toIsoEndTime(ev.endDate, ev.endTime, ev.date, ev.time);
}

function toIsoStartTime(date?: string, time?: string): string {
  if (!date) return '';
  if (time) {
    const [h, m] = time.split(':');
    return `${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00.000Z`;
  }
  return `${date}T00:00:00.000Z`;
}

function toIsoEndTime(endDate?: string, endTime?: string, startDate?: string, startTime?: string): string | null {
  if (endDate && endTime) {
    const [h, m] = endTime.split(':');
    return `${endDate}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00.000Z`;
  }
  if (endDate) return `${endDate}T23:59:59.000Z`;
  return null;
}

function readExtractedEvents(sourceId: string): ExtractedEvent[] {
  const file = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l) as ExtractedEvent)
    .filter(e => e !== null);
}

function toRawEvent(sourceId: string, ev: ExtractedEvent): RawEventInput {
  return {
    title:          extractTitle(ev),
    description:    extractDescription(ev),
    start_time:     extractStartTime(ev),
    end_time:       extractEndTime(ev),
    venue_name:     ev.venue_name ?? ev.venue ?? null,
    venue_address:  ev.venue_address ?? ev.address ?? null,
    lat:            ev.lat ?? null,
    lng:            ev.lng ?? null,
    categories:     ev.categories ?? (ev.category ? [ev.category] : []),
    is_free:        ev.is_free ?? false,
    price_min_sek:  ev.price_min_sek ?? null,
    price_max_sek:  ev.price_max_sek ?? null,
    ticket_url:     ev.ticket_url ?? ev.url ?? null,
    image_url:      ev.image_url ?? null,
    source:         sourceId,
    source_id:      ev.source_id ?? null,
    detected_language: ev.detected_language ?? null,
    raw_payload:    ev.raw_payload ?? {},
  };
}

// ── Import logic ─────────────────────────────────────────────────────────────

async function importSource(sourceId: string, dryRun: boolean): Promise<{ enqueued: number; errors: number }> {
  const events = readExtractedEvents(sourceId);
  if (events.length === 0) {
    console.log(`[import] ${sourceId}: ingen event-data i extractedevents/ → hoppar`);
    return { enqueued: 0, errors: 0 };
  }

  console.log(`[import] ${sourceId}: ${events.length} events`);

  let enqueued = 0;
  let errors = 0;

  for (const ev of events) {
    try {
      const raw = toRawEvent(sourceId, ev);
      if (dryRun) {
        console.log(`[import:dry-run]   "${raw.title}"`);
        enqueued++;
      } else {
        await enqueueRawEvent(raw);
        enqueued++;
      }
    } catch (err) {
      console.error(`[import]   ✗ fel: ${(err as Error).message}`);
      errors++;
    }
  }

  if (!dryRun) {
    removeFromPreUI(sourceId);
    appendToEventPulseApp(sourceId, enqueued);
  }

  return { enqueued, errors };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1]
    ? parseInt(args[limitIdx + 1], 10)
    : Infinity;

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EventPulse-import  │  extractedevents → Supabase     ');
  console.log('═══════════════════════════════════════════════════════════');
  if (dryRun) console.log('  [DRY-RUN]');

  if (!fs.existsSync(EXTRACTED_DIR)) {
    console.log('\n  extractedevents/ finns inte — kör runA-extract först.');
    process.exit(1);
  }

  const sourceFiles = fs.readdirSync(EXTRACTED_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace(/\.jsonl$/, ''))
    .slice(0, limit);

  if (sourceFiles.length === 0) {
    console.log('\n  Inga extracted events hittade.');
    process.exit(0);
  }

  console.log(`\n  ${sourceFiles.length} källor att importera\n`);

  let totalEnqueued = 0;
  let totalErrors = 0;
  let processed = 0;

  for (const sourceId of sourceFiles) {
    processed++;
    const result = await importSource(sourceId, dryRun);
    totalEnqueued += result.enqueued;
    totalErrors += result.errors;
    console.log(`  [${processed}/${sourceFiles.length}] ${sourceId}: ${result.enqueued} events`);
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  KLAR  │  ${totalEnqueued} events till bullmq  │  ${totalErrors} errors`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[import] Fatalt fel:', err);
  process.exit(1);
});
