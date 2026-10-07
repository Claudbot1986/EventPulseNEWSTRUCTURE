#!/usr/bin/env node
/**
 * ingest-livespot-stockholm.mjs — Livespot.se API ingestion för Stockholm events.
 *
 * T0201 (2026-10-05): REWRITTEN — push via raw_events queue istället för direkt
 * upsert till events-tabellen. Detta gör att events passerar genom:
 *   1. raw_events BullMQ-queue (med idempotens per external_id)
 *   2. processRawEvent i 04-Normalizer/normalizer.ts
 *      a. categorySlug-mappning (via categories[]-array + source-default)
 *      b. T0201: eventpulse_summary, description_license, raw_description
 *      c. dedup_hash, geo-propagation
 *   3. link_health-check (via check_link_health.ts som körs separat)
 *
 * Resultat: livespot-events får samma behandling som övriga källor —
 * category_slug, T0201-summary, license, link_status.
 *
 * Användning:
 *   node scripts/ingest-livespot-stockholm.mjs
 *   node scripts/ingest-livespot-stockholm.mjs --pages=10
 *   node scripts/ingest-livespot-stockholm.mjs --start-date=2026-10-01 --end-date=2027-03-31
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const SOURCE_ID = 'livespot-stockholm';
const RATE_LIMIT_MS = 1000;
const DEFAULT_LIMIT = 100;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
if (!process.env.SUPABASE_URL) { console.error('Missing SUPABASE_URL'); process.exit(2); }

// ── Queue connection (lazy) ─────────────────────────────────────────────────
let connection;
function getConnection() {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

const rawEventsQueue = new Queue('raw_events', { connection: getConnection() });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchPage(page, batchSize, startDate, endDate) {
  const params = new URLSearchParams({
    limit: String(batchSize),
    page: String(page),
    city: 'Stockholm',
  });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const url = `https://livespot.se/api/events?${params}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'application/json' },
  });
  if (!r.ok) return null;
  return await r.json();
}

/**
 * Map livespot's categories-array till normalizer-compatible categories[].
 * Livespot returnerar fria strängar (t.ex. "Teater", "Musik") — vi mappar
 * dem till våra kanon-slugs (music, community, etc.).
 *
 * Livespot "Teater" → "theater" → "theater"
 * Livespot "Musik"   → "music"   → "concert"
 * Livespot "Standup" → "standup" → "standup"
 *
 * Om okänt, lämnas kategorin som livespot-råsträng så normalizer-fallback kan
 * hantera den via categoryKeywords.ts.
 */
function normalizeLivespotCategories(rawCategories) {
  if (!Array.isArray(rawCategories)) return [];
  const map = {
    'teater': 'theater',
    'teatern': 'theater',
    'musik': 'music',
    'music': 'music',
    'konsert': 'music',
    'konserter': 'music',
    'standup': 'standup',
    'comedy': 'standup',
    'utställning': 'art-exhibitions',
    'exhibition': 'art-exhibitions',
    'festival': 'festival',
    'film': 'film',
    'bio': 'film',
    'screening': 'film',
    'workshop': 'workshop',
    'kurs': 'workshop',
    'sport': 'sport',
    'idrott': 'sport',
    'barn': 'community',
    'family': 'community',
    'community': 'community',
    'mat': 'community',
    'food': 'community',
    'dryck': 'community',
    'drink': 'community',
  };
  const result = [];
  for (const c of rawCategories) {
    if (typeof c !== 'string') continue;
    const lower = c.toLowerCase().trim();
    const mapped = map[lower];
    if (mapped && !result.includes(mapped)) result.push(mapped);
    else if (!mapped && !result.includes(lower)) result.push(lower);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const startDate = args.find((a) => a.startsWith('--start-date='))?.split('=')[1] ?? '2026-10-01';
  const endDate = args.find((a) => a.startsWith('--end-date='))?.split('=')[1] ?? '2027-06-30';
  const maxPages = parseInt((args.find((a) => a.startsWith('--pages=')) ?? '--pages=999').split('=')[1], 10);

  console.log(`Livespot Stockholm — ${startDate} to ${endDate}, max ${maxPages} pages`);

  const totals = { fetched: 0, queued: 0, skipped: 0, pages: 0 };
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    await sleep(RATE_LIMIT_MS);
    const data = await fetchPage(page, DEFAULT_LIMIT, startDate, endDate);
    if (!data || !data.data) {
      console.error(`  page ${page}: fetch failed`);
      break;
    }
    const events = data.data;
    totals.fetched += events.length;
    if (page === 1 && data.meta?.total) {
      totalPages = Math.min(data.meta.totalPages || 1, maxPages);
      console.log(`  total: ${data.meta.total}, pages: ${totalPages}`);
    }
    if (events.length === 0) break;

    const now = Date.now();
    const future = events.filter((e) => {
      const ts = new Date(e.start_date).getTime();
      return !isNaN(ts) && ts > now;
    });

    if (future.length === 0) {
      console.log(`  page ${page}: ${events.length} events (0 future)`);
      page++;
      continue;
    }

    // Build RawEventInput payloads and push to raw_events queue
    let pageQueued = 0;
    for (const ev of future) {
      const venueName = ev.venue ?? null;
      const venueCity = ev.city ?? null;
      const categories = normalizeLivespotCategories(ev.categories ?? []);

      const raw = {
        title: ev.name,
        description: ev.description_sv ?? ev.description ?? null,
        start_time: ev.start_date,
        end_time: ev.end_date ?? null,
        venue_name: venueName,
        venue_address: null,
        lat: null,           // backfill-jobb fyller på från venues-tabellen
        lng: null,
        categories,
        category: categories[0] ?? null,
        is_free: ev.price_min === 0 || ev.price_min === '0',
        price_min_sek: ev.price_min != null ? Math.round(parseFloat(ev.price_min)) : null,
        price_max_sek: ev.price_max != null ? Math.round(parseFloat(ev.price_max)) : null,
        ticket_url: ev.url ?? null,
        image_url: null,
        source: SOURCE_ID,
        source_id: ev.id,
        detected_language: ev.description_sv ? 'sv' : (ev.description_en ? 'en' : null),
        raw_payload: {
          venue: ev.venue,
          city: ev.city,
          availability: ev.availability,
          categories: ev.categories ?? [],
          performers: ev.performers ?? [],
          source: ev.source,
          external_id: ev.id,
          livespot_slug: ev.slug,
          fetched_at: new Date().toISOString(),
        },
      };

      // Skippa tomma titlar eller ogiltiga start_time
      if (!raw.title || !raw.start_time) {
        totals.skipped++;
        continue;
      }

      try {
        // BullMQ jobId kan inte innehålla ":". Idempotens hanteras istället
        // av normalizerns dedup_hash på events.category_slug/source_id.
        await rawEventsQueue.add(`livespot-${ev.id}`, raw, {
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });
        pageQueued++;
      } catch (e) {
        console.error(`  page ${page}: queue.add failed for ${ev.id}: ${e.message}`);
      }
    }

    totals.queued += pageQueued;
    totals.pages++;
    console.log(`  page ${page}: fetched=${events.length} future=${future.length} queued=${pageQueued} skipped=${totals.skipped - (totals.queued - pageQueued)}`);
    page++;
  }

  console.log(`\n=== Resultat ===`);
  console.log(`Pages: ${totals.pages}`);
  console.log(`Fetched: ${totals.fetched}`);
  console.log(`Queued (raw_events): ${totals.queued}`);
  console.log(`Skipped: ${totals.skipped}`);

  // Vänta lite så BullMQ hinner flusha
  await sleep(500);

  await rawEventsQueue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});