#!/usr/bin/env node
/**
 * ingest-ra-stockholm.mjs — Resident Advisor Stockholm events.
 *
 * Scrape https://ra.co/events/sweden/stockholm
 * RA serverar JSON-LD events i HTML, så detta är en enkel HTTP-hämtning.
 * Rate-limit: 1 req / 2s (artighet mot RA).
 *
 * Användning:
 *   node scripts/ingest-ra-stockholm.mjs
 *   node scripts/ingest-ra-stockholm.mjs --dry-run
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const RA_URL = 'https://ra.co/events/se/stockholm';
const SOURCE_ID = 'ra-stockholm';
const RATE_LIMIT_MS = 3000;
const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern dränerar kön och bearbetar
// varje event genom normalizer (kategori, dedup, venue_id, T0201).
const rawEventsQueue = new Queue('raw_events', {
  connection: new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null, enableReadyCheck: false }),
});

function dedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchEvents() {
  // Direct first (free)
  let r;
  try {
    r = await fetch(RA_URL, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'text/html' },
    });
    if (r.ok) {
      const body = await r.text();
      if (body.length > 5000) return body;
    }
  } catch {}
  // Fallback: Scrapingbee stealth_proxy (RA uses DataDome)
  if (SCRAPINGBEE) {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE,
      url: RA_URL,
      render_js: 'true',
      stealth_proxy: 'true',  // REQUIRED for RA
    });
    const sb = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
    if (!sb.ok) return null;
    return await sb.text();
  }
  return null;
}

function extractEvents(html) {
  const events = [];
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const arr = Array.isArray(data) ? data : [data];
    for (const d of arr) {
      if (d['@type'] !== 'Event') continue;
      events.push({
        name: d.name,
        startDate: d.startDate,
        endDate: d.endDate,
        url: d.url,
        venue: d.location?.name ?? null,
        address: d.location?.address ? [d.location.address.streetAddress, d.location.address.postalCode, d.location.address.addressLocality].filter(Boolean).join(', ') : null,
        lat: d.location?.geo?.latitude != null ? parseFloat(d.location.geo.latitude) : null,
        lng: d.location?.geo?.longitude != null ? parseFloat(d.location.geo.longitude) : null,
      });
    }
  }
  return events;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Resident Advisor Stockholm — ${dryRun ? 'DRY RUN' : 'REAL'}`);

  await sleep(RATE_LIMIT_MS);
  const html = await fetchEvents();
  if (!html) {
    console.error('Failed to fetch RA page');
    process.exit(2);
  }

  const events = extractEvents(html);
  const now = Date.now();
  const future = events.filter((e) => {
    if (!e.name || !e.startDate) return false;
    const ts = new Date(e.startDate).getTime();
    return !isNaN(ts) && ts > now;
  });

  console.log(`fetched=${events.length} future=${future.length}`);
  if (events.length > 0) {
    console.log(`Sample: ${events[0].name} @ ${events[0].startDate}`);
  }

  if (dryRun || future.length === 0) {
    process.exit(0);
  }

  const rows = future.map((ev) => {
    // 2026-10-05 — null istället för Sergels-torg-fallback.
    const hasCoord = typeof ev.lat === 'number' && ev.lat !== 0
                    && typeof ev.lng === 'number' && ev.lng !== 0;
    const lat = hasCoord ? ev.lat : null;
    const lng = hasCoord ? ev.lng : null;
    return {
      source: SOURCE_ID,
      title_sv: ev.name,
      title_en: ev.name,
      start_time: ev.startDate,
      end_time: ev.endDate ?? null,
      location: hasCoord ? `POINT(${lng} ${lat})` : null,
      lat, lng,
      venue_full_name: ev.venue ?? null,
      venue_full_address: ev.address ?? null,
      venue_city: null,
      venue_lat: lat,
      venue_lng: lng,
      venue_url: null,
      venue_phone: null,
      ticket_url: ev.url,
      status: 'published',
      featured: false,
      view_count: 0,
      raw_data: {
        venue: ev.venue, address: ev.address,
        fetched_at: new Date().toISOString(),
      },
      confidence_score: 80,
      freshness_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
      // 2026-10-06 (T0201.4): category_slug-fallback 'community' för att undvika NULL i DB.
      category_slug: 'community',
      dedup_hash: dedupHash(ev.name, ev.startDate),
    };
  });

  // Filter existing
  const hashes = rows.map((r) => r.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
  console.log(`persisting ${fresh.length} new (${rows.length - fresh.length} duplicates)`);

      // T0201.5: push till raw_events BullMQ-queue (ersätter direkt-upsert).
    // Workern dränerar kön och kör normalizer (kategori, dedup, T0201).
    let pageQueued = 0;
    for (const row of fresh) {
      try {
        const raw = {
          title: row.title_sv ?? row.title_en ?? '',
          description: row.description_sv ?? row.description_en ?? null,
          start_time: row.start_time,
          end_time: row.end_time ?? null,
          venue_name: row.venue_full_name ?? null,
          venue_address: row.venue_full_address ?? null,
          lat: row.lat ?? null,
          lng: row.lng ?? null,
          categories: row.category_slug ? [row.category_slug] : [],
          is_free: !!row.is_free,
          price_min_sek: row.price_min_sek ?? null,
          price_max_sek: row.price_max_sek ?? null,
          ticket_url: row.ticket_url ?? null,
          image_url: null,
          source: row.source,
          source_id: null,
          detected_language: null,
          raw_payload: {
            venue: row.venue_full_name,
            city: row.venue_city,
            fetched_via: 'MIGRATED',
            fetched_at: new Date().toISOString(),
          },
        };
        await rawEventsQueue.add(`MIGRATED-${row.dedup_hash.slice(0, 16)}`, raw, {
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });
        pageQueued++;
      } catch (e) {
        console.error(`queue.add failed for ${row.title_sv ?? row.title_en}: ${e.message}`);
      }
    }
    console.log(`  queued: ${pageQueued}`);


  const { count } = await supabase.from('events_public').select('*', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`\nDB ${SOURCE_ID} total: ${count}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e); process.exit(1);
});