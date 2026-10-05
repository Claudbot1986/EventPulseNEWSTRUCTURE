#!/usr/bin/env node
/**
 * ingest-livespot-stockholm.mjs — Livespot.se API ingestion för Stockholm events.
 *
 * Livespot samlar events från massor av svenska venues i en JSON-API.
 * För Stockholm bara finns 5,494 events tillgängliga!
 *
 * Användning:
 *   node scripts/ingest-livespot-stockholm.mjs
 *   node scripts/ingest-livespot-stockholm.mjs --pages=10
 *   node scripts/ingest-livespot-stockholm.mjs --start-date=2026-10-01 --end-date=2027-03-31
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SOURCE_ID = 'livespot-stockholm';
const RATE_LIMIT_MS = 1000;
const DEFAULT_LIMIT = 100;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

function dedupHash(externalId) {
  return createHash('sha256').update(`${SOURCE_ID}::${externalId}`).digest('hex');
}

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

async function main() {
  const args = process.argv.slice(2);
  const startDate = args.find((a) => a.startsWith('--start-date='))?.split('=')[1] ?? '2026-10-01';
  const endDate = args.find((a) => a.startsWith('--end-date='))?.split('=')[1] ?? '2027-06-30';
  const maxPages = parseInt((args.find((a) => a.startsWith('--pages=')) ?? '--pages=999').split('=')[1], 10);

  console.log(`Livespot Stockholm — ${startDate} to ${endDate}, max ${maxPages} pages`);

  const totals = { fetched: 0, persisted: 0, duplicates: 0, pages: 0 };
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

    const rows = future.map((ev) => {
      // 2026-10-05 — Använd verklig venue-data från API:t istället för
      // Sergels-torg-default. Livespot skickar venue-namn (t.ex.
      // "Entréhallen Nybroplan") + city. lat/lng är null i livespot-svaret
      // — vi sätter koordinater från vårt venues-register när vi hittar
      // en match via backfill-venue-geocode.mjs efter denna ingestion.
      //
      // Här sparar vi venue_full_name (sant värde från source) och
      // venue_city. lat/lng lämnas null om inte annars tillgängligt
      // (livespot saknar koordinater) — backfill-jobb fyller på senare.
      const venueName = ev.venue ?? null;
      const venueCity = ev.city ?? null;
      const lat = null; // backfill-jobb fyller på från venues-tabellen
      const lng = null;
      return {
        source: SOURCE_ID,
        title_sv: ev.name,
        title_en: ev.name,
        start_time: ev.start_date,
        end_time: ev.end_date ?? null,
        location: null, // backfill-jobb sätter om match finns
        lat, lng,
        // 2026-10-05 — verklig venue-data från source-payload.
        venue_full_name: venueName,
        venue_full_address: null, // livespot skickar inte address
        venue_city: venueCity,
        venue_lat: null,
        venue_lng: null,
        venue_url: null,
        venue_phone: null,
        ticket_url: ev.url ?? null,
        // 2026-10-04 — Droppa scrape-original livespot.se-img vid import.
        // Tidigare sparades ev.image_url rakt av, vilket gjorde livespot-
        // events till "anomalier" (image_url satt men image_ai_generated=
        // false / image_generation_status != 'library_fallback') → UI
        // visade tom placeholder. image_generation_status='pending' låter
        // matchLibraryFirst (i nattlys cron) hämta en biblioteks-bild i
        // nästa körning — samma kontrakt som övriga källor följer.
        image_url: null,
        description_sv: ev.description_sv ?? null,
        description_en: ev.description_en ?? null,
        is_free: ev.price_min === 0,
        price_min_sek: ev.price_min != null ? Math.round(parseFloat(ev.price_min)) : null,
        price_max_sek: ev.price_max != null ? Math.round(parseFloat(ev.price_max)) : null,
        status: 'published',
        featured: false,
        view_count: 0,
        raw_data: {
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
        confidence_score: 80,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        dedup_hash: dedupHash(ev.id ?? `${ev.name}::${ev.start_date}`),
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
    totals.duplicates += rows.length - fresh.length;

    // Batch upsert
    for (let i = 0; i < fresh.length; i += 50) {
      const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + 50), { onConflict: 'dedup_hash' }).select('id');
      if (error) {
        console.error(`  page ${page}: upsert error ${error.message}`);
        continue;
      }
      totals.persisted += data?.length ?? 0;
    }

    console.log(`  page ${page}: fetched=${events.length} future=${future.length} new=${fresh.length} (${totals.persisted} total)`);
    page++;
    totals.pages = page - 1;
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`fetched=${totals.fetched} persisted=${totals.persisted} duplicates=${totals.duplicates} pages=${totals.pages}`);

  const { count } = await supabase.from('events_public').select('*', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`DB ${SOURCE_ID} total: ${count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });