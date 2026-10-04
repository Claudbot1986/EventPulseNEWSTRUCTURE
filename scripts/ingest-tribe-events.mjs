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
import { readFileSync, existsSync } from 'fs';

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

      // Tribe doesn't expose lat/lng directly. Default to Stockholm if venue exists.
      const hasVenue = !!venueName;
      const lat = hasVenue ? 59.3293 : null;
      const lng = hasVenue ? 18.0686 : null;

      return {
        source: slug,
        title_sv: title,
        title_en: title,
        start_time: startTime,
        end_time: ev.end_date || null,
        location: hasVenue ? `POINT(${lng} ${lat})` : null,
        lat,
        lng,
        ticket_url: ev.url || ev.rest_url || null,
        image_url: null, // tribe often has image in custom field
        status: 'published',
        featured: false,
        view_count: 0,
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

    for (let i = 0; i < fresh.length; i += 50) {
      const batch = fresh.slice(i, i + 50);
      const { data, error } = await supabase.from('events').upsert(batch, { onConflict: 'dedup_hash' }).select('id');
      if (error) {
        console.error(`  page ${page}: upsert error ${error.message}`);
        continue;
      }
      stats.persisted += data?.length ?? 0;
    }

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

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});