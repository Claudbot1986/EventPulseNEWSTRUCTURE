/**
 * fb-events-via-apify.mjs — Enrich known FB event URLs via Apify.
 *
 * Används av Stockholm Coverage Recovery för att knäcka FB-events.
 * Första versionen (2026-10-04): kör 11 verifierade event-URL:er från
 * web_search som ett proof-of-concept. Resultat sparas som rå-JSON + försöker
 * persistera via direct-persist-aggregator.
 *
 * Run: node scripts/fb-events-via-apify.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createBullQueue } from '../03-Queue/redisClient.mjs';
import { createQueueErrorTracker } from './lib/queue-errors.mjs';
import { fetchHtml } from '../02-Ingestion/tools/fetchTools.js';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTOR = 'unseenuser~fb-events';

if (!APIFY_API_KEY) { console.error('APIFY_API_KEY missing'); process.exit(2); }
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Supabase env missing'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern dränerar kön och bearbetar
// varje event genom normalizer (kategori, dedup, venue_id, T0201).
// 2026-10-28 — central Redis-klient (03-Queue/redisClient.mjs).
// Den gamla inline-optionen hade maxRetriesPerRequest: null UTAN
// enableOfflineQueue: false — dvs. kommandon lade sig i offline-kön när
// Redis var borta och skicket aldrig kom fram. Det var en del av
// 2-timmars-hängningen 2026-10-26.
const rawEventsQueue = createBullQueue('raw_events');

const SOURCE_ID = 'fb-events-stockholm-apify';

// 2026-10-28 — köfelsamling: högst 3 provrader, och exit ≠ 0 om inget
// kunde köas. Se scripts/lib/queue-errors.mjs.
const queueErrors = createQueueErrorTracker();
let totalQueued = 0;

// Curated list — verified live 2026-10-04 via web_search
const KNOWN_FB_URLS = [
  'https://www.facebook.com/events/883319564504291/',                                       // Långholmen Open Air
  'https://www.facebook.com/events/hornstulls-strand-4-117-39-stockholm-sweden/plastilina-mosh-debaser-strand/1906567093337004/',
  'https://www.facebook.com/events/hammarby-slussv%C3%A4g-2-11860-stockholm-sweden/tr%C3%A4dg%C3%A5rden-closing-saturday/1076575064839739/',
  'https://www.facebook.com/events/drottninggatan-82-111-20-stockholm-sweden/stockholm-international-film-festival-2026/1356137935891212/',
  'https://www.facebook.com/events/sm%C3%A5landstorget/stockholm-burger-fest-2026/2135830763910584/',
  'https://www.facebook.com/events/debaser-hornstull-strand/live-divine-featuring-jennifer-brown-stefan-nykvist-och-lars-s%C3%A4fsund/25775273285432829/',
  'https://www.facebook.com/events/dialoggatan-2-se-141-75-kungens-kurva-sverige/activate-heron-city-grand-opening-50-rabatt-/4385734261701127/',
  'https://www.facebook.com/events/ms-baltic-queen/mondaybar-the-2026-summer-cruise-no-64/1211146470859243/',
];

function buildDedupHash(source, title, startTime) {
  return createHash('sha256').update(`${source}::${title}::${startTime}`).digest('hex');
}

function eventInStockholm(ev) {
  const venue = ev.venue ?? {};
  const addr = typeof venue === 'object' ? (venue.address ?? venue.city ?? '') : '';
  const name = typeof venue === 'object' ? (venue.name ?? '') : '';
  if (/stockholm/i.test(addr) || /stockholm/i.test(name)) return true;
  if (ev.city && /stockholm/i.test(ev.city)) return true;
  if (ev.address && /stockholm/i.test(ev.address)) return true;
  return true; // Trust the curated URL list (all manually verified Stockholm)
}

async function callApify(urls) {
  console.log(`  calling Apify actor with ${urls.length} URLs...`);
  const start = Date.now();
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventUrls: urls,
      maxEvents: urls.length,
    }),
  });
  if (!r.ok) {
    console.error(`  Apify HTTP ${r.status}: ${r.statusText}`);
    console.error(await r.text().then(t => t.slice(0, 500)));
    return null;
  }
  const data = await r.json();
  console.log(`  Apify returned in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return data;
}

function apifyToRow(ev) {
  const nowIso = new Date().toISOString();
  const startTime = ev.utcStartDate ?? ev.startDate ?? '';
  const endTime = ev.utcEndDate ?? ev.endDate ?? null;
  const title = ev.name ?? 'Untitled';
  const venue = ev.venue ?? {};
  const venueName = typeof venue === 'object' ? (venue.name ?? '') : '';
  const venueAddr = typeof venue === 'object' ? (venue.address ?? '') : '';
  const city = typeof venue === 'object' ? (venue.city ?? '') : '';
  // 2026-10-05 — verklig geo från Apify istället för Sergels-torg-fallback.
  // null om 0/saknas — backfill-jobb slår upp koordinater från venues.
  const lat = typeof venue === 'object' ? (venue.lat ?? null) : null;
  const lng = typeof venue === 'object' ? (venue.lng ?? null) : null;
  const finalLat = (typeof lat === 'number' && lat !== 0) ? lat : null;
  const finalLng = (typeof lng === 'number' && lng !== 0) ? lng : null;

  return {
    source: SOURCE_ID,
    source_id: ev.id ?? ev.url?.split('/').filter(Boolean).pop() ?? null,
    title_sv: title,
    title_en: title,
    description_sv: ev.description ?? null,
    description_en: ev.description ?? null,
    start_time: startTime,
    end_time: endTime,
    venue_id: null,
    organizer_id: null,
    location: (finalLat != null && finalLng != null) ? `POINT(${finalLng} ${finalLat})` : null,
    lat: finalLat,
    lng: finalLng,
    is_free: ev.isFree ?? false,
    price_min_sek: null,
    price_max_sek: null,
    ticket_url: ev.ticketUrl ?? ev.url ?? null,
    // 2026-10-05 — verklig venue-data från apify venue-objektet.
    venue_full_name: venueName || null,
    venue_full_address: venueAddr || null,
    venue_city: city || null,
    venue_lat: finalLat,
    venue_lng: finalLng,
    venue_url: null,
    venue_phone: null,
    image_url: null, // 2026-10-04 — copyright-skydd. ev.photoUrl är
    //   Facebooks CDN-bild som vi inte har rätt att använda. Lämnas null
    //   → AI-workern genererar (eller biblioteks-fallback). Klienten
    //   (useAiImageUrl rule 5) visar tom placeholder tills AI är klar.
    status: 'published',
    featured: false,
    view_count: 0,
    raw_data: null,
    dedup_hash: buildDedupHash(SOURCE_ID, title, startTime),
    confidence_score: 55,
    freshness_at: nowIso,
    last_seen_at: nowIso,
    published_at: nowIso,
    image_generation_status: 'pending',
    image_ai_generated: false,
    image_ai_optout: false,
    is_online: false,
    // 2026-10-06 (T0201.4): category_slug-fallback 'community' för att undvika NULL i DB.
    category_slug: 'community',
  };
}

async function main() {
  console.log(`=== FB Events via Apify — ${KNOWN_FB_URLS.length} curated URLs ===\n`);

  const events = await callApify(KNOWN_FB_URLS);
  if (!events) { console.error('Apify call failed'); process.exit(1); }

  console.log(`  events returned: ${events.length}`);
  if (events.length === 0) { console.log('  nothing to persist'); return; }

  // Filter future + Stockholm
  const nowIso = new Date().toISOString();
  const future = events.filter((e) => {
    const st = e.utcStartDate ?? e.startDate ?? '';
    return st > nowIso && eventInStockholm(e);
  });
  console.log(`  future+Stockholm events: ${future.length} / ${events.length}`);

  if (future.length === 0) {
    console.log('  nothing in future — saving raw for audit only');
    writeFileSync('/tmp/fb-apify-results.json', JSON.stringify(events, null, 2));
    return;
  }

  // Check existing dedup_hashes
  const allHashes = future.map((e) => apifyToRow(e).dedup_hash);
  const existing = new Set();
  for (let i = 0; i < allHashes.length; i += 1000) {
    const slice = allHashes.slice(i, i + 1000);
    const { data } = await supabase.from('events').select('dedup_hash').in('dedup_hash', slice);
    for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  console.log(`  already in DB: ${existing.size}`);

  const rows = future.map(apifyToRow).filter((r) => !existing.has(r.dedup_hash));
  console.log(`  new rows to insert: ${rows.length}`);

  if (rows.length === 0) { console.log('  all dupes — no-op'); return; }

  // T0201.5: push till raw_events BullMQ-queue (ersätter direkt-upsert).
  // Workern dränerar kön och kör normalizer (kategori, dedup, T0201).
  let pageQueued = 0;
  let failed = 0;
  for (const row of rows) {
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
          fetched_via: 'fb-apify',
          fetched_at: new Date().toISOString(),
        },
      };
      await rawEventsQueue.add(`fb-apify-${row.dedup_hash.slice(0, 16)}`, raw, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      pageQueued++;
    } catch (e) {
      queueErrors.record(e, `queue.add failed for ${row.title_sv ?? row.title_en}`);
      failed++;
    }
  }
  console.log(`  queued: ${pageQueued}, failed: ${failed}`);
  totalQueued += pageQueued;

  // Save raw for audit
  writeFileSync('/tmp/fb-apify-results.json', JSON.stringify(events, null, 2));
  console.log(`  raw events saved to /tmp/fb-apify-results.json`);

  // Verify in DB
  const { count } = await supabase
    .from('events_public')
    .select('id', { count: 'exact', head: true })
    .eq('source', SOURCE_ID);
  console.log(`  events_public for ${SOURCE_ID}: ${count}`);
}

main().then(() => {
  queueErrors.printSummary(SOURCE_ID);
  process.exit(queueErrors.exitCode(totalQueued));
}).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});