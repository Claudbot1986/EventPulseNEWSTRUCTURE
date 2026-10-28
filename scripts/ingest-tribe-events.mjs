#!/usr/bin/env node
/**
 * ingest-tribe-events.mjs — Generic The Events Calendar (WordPress plugin) fetcher.
 *
 * Upptäckt via `scripts/discover-hidden-apis.mjs`: 5+ svenska event-sajter kör
 * WordPress + The Events Calendar-plugin som exponerar events via REST-API:
 *   GET /wp-json/tribe/events/v1/events?per_page=N&page=M&start_date=YYYY-MM-DD
 *
 * Respekterar rate-limit (1 req/2s — conservative). Persists directly to
 * Supabase events table (dedup_hash handles dupes).
 *
 * Användning:
 *   node scripts/ingest-tribe-events.mjs                    # default: alla kända sources
 *   node scripts/ingest-tribe-events.mjs --slug=aik         # en specifik source
 *   node scripts/ingest-tribe-events.mjs --dry-run          # hämta men skriv inte
 *   node scripts/ingest-tribe-events.mjs --pages=5          # max 5 sidor per source
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createBullQueue } from '../03-Queue/redisClient.mjs';
import { createQueueErrorTracker } from './lib/queue-errors.mjs';
import { readFileSync, existsSync } from 'fs';

// 2026-10-28 — köfelsamling: högst 3 provrader, och exit ≠ 0 om inget
// kunde köas. Se scripts/lib/queue-errors.mjs.
const queueErrors = createQueueErrorTracker();
let totalQueued = 0;

// Sources known to expose /wp-json/tribe/events/v1/events
// Upptäckta via discover-hidden-apis.mjs (2026-10-04). Uppdatera när nya hittas.
const TRIBE_SOURCES = [
  { slug: 'aik', baseUrl: 'https://aik.se' },
  { slug: 'aik-se-kalender', baseUrl: 'https://aik.se' },
  { slug: 'formex', baseUrl: 'https://formex.se' },
  { slug: 'kungstradgarden', baseUrl: 'https://www.allamassor.se' },
  { slug: 'stockholmsmassan', baseUrl: 'https://stockholmsmassan.se' },
];

const USER_AGENT = 'EventPulse-Bot/1.0';
const RATE_LIMIT_MS = 2000;
const DEFAULT_PER_PAGE = 50;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern dränerar kön och bearbetar
// varje event genom normalizer (kategori, dedup, venue_id, T0201).
// 2026-10-28 — central Redis-klient (03-Queue/redisClient.mjs).
// Den gamla inline-optionen hade maxRetriesPerRequest: null UTAN
// enableOfflineQueue: false — dvs. kommandon lade sig i offline-kön när
// Redis var borta och skicket aldrig kom fram. Det var en del av
// 2-timmars-hängningen 2026-10-26.
const rawEventsQueue = createBullQueue('raw_events');

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchEventsPage(baseUrl, page, perPage = DEFAULT_PER_PAGE) {
  const url = `${baseUrl}/wp-json/tribe/events/v1/events?per_page=${perPage}&page=${page}&start_date=${new Date().toISOString().slice(0, 10)}&order=asc`;
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data; // shape: { events: [...], total, total_pages, rest_url, next_rest_url }
}

async function fetchOneSource(src, args) {
  const { slug, baseUrl } = src;
  const maxPages = args.maxPages;
  const dryRun = args.dryRun;
  const stats = { fetched: 0, persisted: 0, duplicates: 0, errors: 0 };

  console.log(`\n--- ${slug} (${baseUrl}) ---`);

  let page = 1;
  let totalPages = null;
  while (true) {
    if (maxPages && page > maxPages) break;
    if (totalPages !== null && page > totalPages) break;

    await sleep(RATE_LIMIT_MS);
    let data;
    try {
      data = await fetchEventsPage(baseUrl, page);
    } catch (e) {
      console.error(`  page ${page}: fetch error ${e.message}`);
      stats.errors++;
      break;
    }
    if (!data) {
      console.error(`  page ${page}: HTTP error`);
      stats.errors++;
      break;
    }

    const events = data.events || [];
    const now = Date.now();
    const future = events.filter((ev) => {
      const startMs = ev.start_date ? new Date(ev.start_date).getTime() : 0;
      return startMs > now;
    });
    stats.fetched += events.length;

    if (totalPages === null) {
      totalPages = data.total_pages ?? Math.ceil((data.total ?? events.length) / DEFAULT_PER_PAGE);
      console.log(`  total=${data.total}, total_pages=${totalPages}, future=${future.length}/${events.length}`);
    } else {
      console.log(`  page ${page}: fetched=${events.length} future=${future.length}`);
    }

    if (dryRun || future.length === 0) {
      page++;
      continue;
    }

    // Persist
    const rows = future.map((ev) => {
      const startTime = ev.start_date || (ev.start_date_utc ? `${ev.start_date_utc}Z` : null);
      const title = ev.title?.rendered ?? ev.title ?? 'Untitled';
      const venueName = ev.venue?.venue ?? ev.venue?.name ?? null;
      const address = [ev.venue?.address, ev.venue?.city, ev.venue?.country].filter(Boolean).join(', ') || null;

      // 2026-10-05 — verklig venue-data. Tribe-events-API:t ger venue-namn +
      // address men INTE lat/lng. Vi lämnar lat/lng null så backfill-jobb
      // (backfill-venue-geocode.mjs) slår upp koordinater från venues-tabellen
      // via fuzzy match på venue_full_name. Det är bättre att ha null och rätt
      // position senare än Sergels-torg-fallback nu.
      const hasVenue = !!venueName;

      return {
        source: slug,
        title_sv: title,
        title_en: title,
        start_time: startTime,
        end_time: ev.end_date || null,
        location: null,
        lat: null,
        lng: null,
        ticket_url: ev.url || ev.rest_url || null,
        image_url: null, // tribe often has image in custom field
        status: 'published',
        featured: false,
        view_count: 0,
        // 2026-10-05 — verklig venue-data från tribe-API:t. venue_full_address
        // fångar address + city + country (om city/country är separata fält).
        // venue_full_address är primär (bättre än separata fält om adressen är
        // komplett).
        venue_full_name: venueName,
        venue_full_address: hasVenue ? (ev.venue?.address ?? null) : null,
        venue_city: ev.venue?.city ?? null,
        venue_lat: null,
        venue_lng: null,
        venue_url: null,
        venue_phone: null,
        raw_data: {
          venue: venueName,
          address,
          cost: ev.cost ?? null,
          description: ev.description?.rendered ?? null,
          organizer: ev.organizer?.organizer ?? null,
          categories: ev.categories?.map((c) => c.name ?? c.slug) ?? [],
          fetched_at: new Date().toISOString(),
        },
        confidence_score: 70,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        // 2026-10-06 (T0201.4): category_slug-fallback 'community' för att undvika NULL i DB.
        category_slug: 'community',
        dedup_hash: dedupHash(title, startTime, slug),
      };
    });

    // Filter existing
    const hashes = rows.map((r) => r.dedup_hash);
    const existing = new Set();
    for (let i = 0; i < hashes.length; i += 500) {
      const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
      for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
    }
    const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
    stats.duplicates += rows.length - fresh.length;

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
    // 2026-10-24 — persisted-räknaren var död: den deklarerades och skrevs
    // ut men inkrementerades aldrig, så Tribe-raden lög ("persisted=0" trots
    // att 17 rader köades). Det som faktiskt persisteras här är kön
    // (raw_events) — workern normaliserar och skriver sedan raderna.
    stats.persisted += pageQueued;
    page++;
  }

  console.log(`  ${slug} done: fetched=${stats.fetched} persisted=${stats.persisted} duplicates=${stats.duplicates}`);
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxPages = parseInt((args.find((a) => a.startsWith('--pages=')) ?? '--pages=10').split('=')[1], 10);
  const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

  let sources = TRIBE_SOURCES;
  if (slugArg) {
    sources = TRIBE_SOURCES.filter((s) => s.slug === slugArg);
    if (sources.length === 0) {
      console.error(`Unknown slug: ${slugArg}. Known: ${TRIBE_SOURCES.map((s) => s.slug).join(', ')}`);
      process.exit(2);
    }
  }

  console.log(`Tribe Events Calendar ingestion — sources=${sources.length} pages=${maxPages} dryRun=${dryRun}`);
  const totals = { fetched: 0, persisted: 0, duplicates: 0, errors: 0 };
  for (const src of sources) {
    const stats = await fetchOneSource(src, { maxPages, dryRun });
    totals.fetched += stats.fetched;
    totals.persisted += stats.persisted;
    totals.duplicates += stats.duplicates;
    totals.errors += stats.errors;
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`fetched=${totals.fetched} persisted=${totals.persisted} duplicates=${totals.duplicates} errors=${totals.errors}`);
}

main().then(() => {
  queueErrors.printSummary('tribe-events');
  process.exit(queueErrors.exitCode(totalQueued));
}).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});