/**
 * direct-persist-aggregator.ts — Bypass BullMQ + normalizer; write to events table directly.
 *
 * Används av Stockholm Coverage Recovery Plan (Fas 1B) för att snabbt persistera
 * nya aggregators utan att behöva en running BullMQ worker.
 *
 * Strategi (per 2026-10-04-Stockholm-Coverage-Recovery-Plan.md):
 *   1. Fetch URL
 *   2. Extract JSON-LD via extractor (get ParsedEvent[])
 *   3. For each parsed event:
 *      - Lookup venue in DB or fallback to Stockholm geo
 *      - dedup_hash = SHA-256("source::{title_sv}::{start_time}")
 *      - confidence_score = 60 (aggregator data is decent but unverified)
 *      - status = 'published' if date is in future else skip
 *   4. Upsert in batches via Supabase REST (PostgREST upsert by dedup_hash)
 *
 * Run: npx tsx scripts/direct-persist-aggregator.ts <sourceId>
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

import { fetchHtml } from '../02-Ingestion/tools/fetchTools';
import { extractFromJsonLd } from '../02-Ingestion/F-eventExtraction/extractor';
import { getSource } from '../02-Ingestion/tools/sourceRegistry';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const EXTRACTED_DIR = path.resolve(__dirname, '..', '03-Queue', '03-extractedevents');
const CONFIDENCE_SCORE = 60; // Aggregator quality
const BATCH_SIZE = 50;
// 2026-10-05 — STOCKHOLM_FALLBACK borttaget. lat/lng sätts från extractor-output
// (geo.lat/geo.lng) eller null. Backfill-jobb slår upp koordinater från venues
// baserat på venue_full_name om källan saknar geo.

function buildDedupHash(source: string, title: string, startTime: string): string {
  return createHash('sha256').update(`${source}::${title}::${startTime}`).digest('hex');
}

function eventInStockholm(e: any): boolean {
  if (e.city && typeof e.city === 'string' && /stockholm/i.test(e.city)) return true;
  if (e.address && typeof e.address === 'string' && /stockholm/i.test(e.address)) return true;
  if (e.venue && typeof e.venue === 'string' && /stockholm/i.test(e.venue)) return true;
  if (e.geo?.lat != null && e.geo?.lng != null) {
    if (e.geo.lat >= 59.0 && e.geo.lat <= 60.0 && e.geo.lng >= 17.5 && e.geo.lng <= 19.0) return true;
  }
  if (e.lat != null && e.lng != null) {
    if (e.lat >= 59.0 && e.lat <= 60.0 && e.lng >= 17.5 && e.lng <= 19.0) return true;
  }
  return true; // Trust aggregator URL scope
}

async function fetchExistingHashes(dedupHashes: string[]): Promise<Set<string>> {
  if (dedupHashes.length === 0) return new Set();
  // PostgREST `.in()` accepts up to ~10k values; chunk if needed.
  const CHUNK = 1000;
  const found = new Set<string>();
  for (let i = 0; i < dedupHashes.length; i += CHUNK) {
    const slice = dedupHashes.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('events')
      .select('dedup_hash')
      .in('dedup_hash', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.dedup_hash) found.add(row.dedup_hash);
    }
  }
  return found;
}

async function ingest(sourceId: string): Promise<void> {
  console.log(`=== Direct-persist ${sourceId} ===`);

  const source = getSource(sourceId);
  if (!source) {
    throw new Error(`Source ${sourceId} not found`);
  }
  console.log(`  url: ${source.url}`);
  console.log(`  city: ${source.city ?? '?'}`);

  // 1) Fetch
  console.log('  fetching...');
  const fetchResult = await fetchHtml(source.url, {
    userAgent: 'EventPulse/1.0 (event-ingestion; +https://eventpulse.app)',
    respectRobots: true,
    timeoutMs: 30_000,
  });
  if (!fetchResult.success || !fetchResult.html) {
    throw new Error(`Fetch failed for ${source.url}: ${fetchResult.error ?? 'no html'}`);
  }
  console.log(`  fetched ${fetchResult.html.length} bytes`);

  // 2) Extract
  const extractResult = extractFromJsonLd(fetchResult.html, source.url, sourceId);
  console.log(`  parsed: ${extractResult.events.length} events`);

  // 3) Filter Stockholm
  const stockholm = extractResult.events.filter(eventInStockholm);
  if (stockholm.length < extractResult.events.length) {
    console.log(`  stockholm-filter: ${extractResult.events.length} → ${stockholm.length}`);
  }

  // 4) Build normalized rows
  const nowIso = new Date().toISOString();
  const rows = stockholm.map((ev) => {
    const startTime = (ev.date && ev.time)
      ? `${ev.date}T${ev.time}:00+02:00`
      : (ev.date ? `${ev.date}T00:00:00+02:00` : '');
    const endTime = (ev.endDate && ev.endTime)
      ? `${ev.endDate}T${ev.endTime}:00+02:00`
      : null;
    const title = ev.title ?? 'Untitled';
    const dedupHash = buildDedupHash(sourceId, title, startTime);

    return {
      source: sourceId,
      source_id: null,
      title_sv: title,
      title_en: title,
      description_sv: ev.description ?? null,
      description_en: ev.description ?? null,
      start_time: startTime,
      end_time: endTime,
      venue_id: null,
      organizer_id: null,
      // 2026-10-05 — verklig geo från extractor-output (geo.lat/geo.lng) eller
      // null. Inga Sergels-torg-fallback. Backfill-jobb slår upp koordinater
      // från venues baserat på venue_full_name om geo saknas.
      location: (ev.geo?.lat != null && ev.geo?.lng != null)
        ? `POINT(${ev.geo.lng} ${ev.geo.lat})`
        : null,
      lat: ev.geo?.lat ?? null,
      lng: ev.geo?.lng ?? null,
      is_free: ev.isFree ?? false,
      price_min_sek: ev.priceMin ?? null,
      price_max_sek: ev.priceMax ?? null,
      ticket_url: ev.ticketUrl ?? ev.url ?? null,
      image_url: ev.imageUrl ?? ev.image ?? null,
      status: 'published',
      featured: false,
      view_count: 0,
      // 2026-10-05 — verklig venue-data från JSON-LD location-fält.
      venue_full_name: ev.venue ?? null,
      venue_full_address: ev.address ?? null,
      venue_city: ev.city ?? null,
      venue_lat: ev.geo?.lat ?? null,
      venue_lng: ev.geo?.lng ?? null,
      venue_url: null,
      venue_phone: null,
      raw_data: null,
      dedup_hash: dedupHash,
      confidence_score: CONFIDENCE_SCORE,
      freshness_at: nowIso,
      last_seen_at: nowIso,
      published_at: nowIso,
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
    };
  }).filter((r) => r.start_time > nowIso); // Only future events

  console.log(`  future rows to upsert: ${rows.length}`);

  if (rows.length === 0) {
    console.log('  nothing to insert');
    return;
  }

  // 5) Check existing dedup_hashes
  const allHashes = rows.map((r) => r.dedup_hash);
  const existing = await fetchExistingHashes(allHashes);
  const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
  console.log(`  already in DB: ${existing.size}, fresh: ${fresh.length}`);

  if (fresh.length === 0) {
    console.log('  all events already exist — no-op');
    return;
  }

  // 6) Upsert in batches
  let inserted = 0;
  let failed_rows = 0;
  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const batch = fresh.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('events')
      .upsert(batch, { onConflict: 'dedup_hash', ignoreDuplicates: false })
      .select('id');
    if (error) {
      console.error(`  batch error at ${i}: ${error.message}`);
      failed_rows += batch.length;
      continue;
    }
    inserted += data?.length ?? 0;
  }
  console.log(`  inserted/updated: ${inserted}, failed: ${failed_rows}`);

  // 7) Save raw extraction for audit
  const outFile = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  let written = 0;
  fs.writeFileSync(outFile, '');
  for (const ev of stockholm) {
    fs.appendFileSync(outFile, JSON.stringify({ ...ev, source: sourceId, sourceUrl: source.url }) + '\n');
    written++;
  }
  console.log(`  wrote ${written} raw events to ${outFile}`);

  console.log(`=== DONE ${sourceId} ===`);
}

const sourceId = process.argv[2];
if (!sourceId) {
  console.error('Usage: npx tsx scripts/direct-persist-aggregator.ts <sourceId>');
  process.exit(2);
}

ingest(sourceId).then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});