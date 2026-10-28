#!/usr/bin/env node
/**
 * ingest-posh-stockholm.mjs — Posh.vip Stockholm events.
 *
 * Scrape https://posh.vip/discover (om svenska är topp-nivå)
 * eller https://posh.vip/?q=stockholm
 *
 * Posh är Next.js — kan kräva Scrapingbee för JS-rendering.
 *
 * Användning:
 *   node scripts/ingest-posh-stockholm.mjs
 *   node scripts/ingest-posh-stockholm.mjs --dry-run
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createBullQueue } from '../03-Queue/redisClient.mjs';
import { createQueueErrorTracker } from './lib/queue-errors.mjs';

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
const SOURCE_ID = 'posh-stockholm';

// 2026-10-28 — köfelsamling. Före detta skrevs EN rad per misslyckad event
// (nattet 26 okt: 583 KB identiska felrader) och skriptet avslutade exit 0
// även när INGENTING kunde köas. Nu: högst 3 provrader, och exit ≠ 0 om
// inget alls kom in.
const queueErrors = createQueueErrorTracker();
let totalQueued = 0;
const RATE_LIMIT_MS = 2000;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern dränerar kön och bearbetar
// varje event genom normalizer (kategori, dedup, venue_id, T0201).
// 2026-10-28 — central Redis-klient (03-Queue/redisClient.mjs).
// Den gamla inline-optionen hade maxRetriesPerRequest: null UTAN
// enableOfflineQueue: false — dvs. kommandon lade sig i offline-kön när
// Redis var borta och skicket aldrig kom fram. Det var en del av
// 2-timmars-hängningen 2026-10-26.
const rawEventsQueue = createBullQueue('raw_events');

function dedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchUrl(url, useScrapingbee = false) {
  if (useScrapingbee && SCRAPINGBEE) {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE, url, render_js: 'true', wait: '2000', timeout: '30000',
    });
    const r = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
    if (!r.ok) return null;
    return await r.text();
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'text/html' } });
  if (!r.ok) return null;
  return await r.text();
}

function extractEvents(html) {
  const events = [];
  // JSON-LD
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
          events.push({
            name: d.name,
            startDate: d.startDate,
            endDate: d.endDate,
            url: d.url,
            venue: d.location?.name ?? null,
            address: d.location?.address ? [d.location.address.streetAddress, d.location.address.postalCode, d.location.address.addressLocality].filter(Boolean).join(', ') : null,
          });
        }
      }
    } catch {}
  }
  return events;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Posh.vip Stockholm — ${dryRun ? 'DRY RUN' : 'REAL'}`);

  // Try multiple URL patterns
  const candidates = [
    'https://posh.vip/discover',
    'https://posh.vip/?q=stockholm',
    'https://posh.vip/cities/stockholm',
  ];

  const allEvents = [];
  for (const url of candidates) {
    await sleep(RATE_LIMIT_MS);
    // Try direct first, then Scrapingbee if direct fails
    let html = await fetchUrl(url, false);
    if (!html || !html.includes('event')) {
      if (SCRAPINGBEE) {
        console.log(`    trying Scrapingbee for ${url}`);
        html = await fetchUrl(url, true);
      }
    }
    if (!html) {
      console.log(`  ${url}: failed`);
      continue;
    }
    const events = extractEvents(html);
    console.log(`  ${url}: ${events.length} events`);
    allEvents.push(...events);
  }

  // Filter future
  const now = Date.now();
  const future = allEvents.filter((e) => {
    const ts = new Date(e.startDate).getTime();
    return !isNaN(ts) && ts > now;
  });
  console.log(`\nTotal: ${allEvents.length} future: ${future.length}`);

  if (allEvents.length > 0) {
    console.log('Sample:');
    for (const ev of allEvents.slice(0, 5)) {
      console.log(`  - ${ev.name.slice(0, 60)} @ ${ev.startDate}`);
    }
  }

  if (dryRun || future.length === 0) process.exit(0);

  const rows = future.map((ev) => {
    // 2026-10-05 — Spara verklig venue-data från posh-payload istället
    // för Sergels-torg-default. POSH skickar venue-namn + address.
    // lat/lng lämnas null tills backfill-jobb hittar match i venues-tabellen.
    return {
      source: SOURCE_ID,
      title_sv: ev.name, title_en: ev.name,
      start_time: ev.startDate,
      end_time: ev.endDate ?? null,
      location: null, // backfill-jobb sätter vid match
      lat: null,
      lng: null,
      // 2026-10-05 — verklig venue-data från POSH-source
      venue_full_name: ev.venue ?? null,
      venue_full_address: ev.address ?? null,
      venue_city: 'Stockholm',
      venue_lat: null,
      venue_lng: null,
      venue_url: null,
      venue_phone: null,
      ticket_url: ev.url,
      status: 'published', featured: false, view_count: 0,
      raw_data: { venue: ev.venue, address: ev.address, fetched_at: new Date().toISOString() },
      confidence_score: 60,
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

  const hashes = rows.map((r) => r.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
  console.log(`Persisting ${fresh.length} new (${rows.length - fresh.length} duplicates)`);

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
        queueErrors.record(e, `queue.add failed for ${row.title_sv ?? row.title_en}`);
      }
    }
    console.log(`  queued: ${pageQueued}`);
    totalQueued += pageQueued;


  const { count } = await supabase.from('events_public').select('*', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`\nDB ${SOURCE_ID} total: ${count}`);
}

main().then(async () => {
  await rawEventsQueue.close();
  queueErrors.printSummary(SOURCE_ID);
  process.exit(queueErrors.exitCode(totalQueued));
}).catch((e) => { console.error('FATAL:', e); process.exit(1); });