/**
 * ingest-eventbrite-stockholm.mjs — Paginerad Eventbrite Stockholm-ingestion.
 *
 * Skillnad mot befintlig `eventbriteStockholm.ts` adapter:
 * - Standalone Node (ingen tsx-kräv)
 * - Paginates forward in time (next 6 months by default)
 * - Persists directly to Supabase events table (dedup_hash handles dupes)
 *
 * Respekterar rate-limit (1 req / 3s, BACKLOG.md Stockholm Density Plan Layer 1).
 *
 * Användning:
 *   node scripts/ingest-eventbrite-stockholm.mjs                    # default: 6 months forward
 *   node scripts/ingest-eventbrite-stockholm.mjs --months=12        # 12 months forward
 *   node scripts/ingest-eventbrite-stockholm.mjs --dry-run          # hämta men skriv inte till DB
 *   node scripts/ingest-eventbrite-stockholm.mjs --cities=sodermalm,vasastan,kungsholmen
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const LISTING_BASE = 'https://www.eventbrite.com/d/sweden--stockholm';
const CITY_SLUGS = {
  stockholm: '',
  sodermalm: '/all-events/sodermalms/',
  vasastan: '/all-events/vasastan/',
  kungsholmen: '/all-events/kungsholmens/',
  bromma: '/all-events/bromma/',
  hagersten: '/all-events/haegersten/',
  lidingo: '/all-events/lidingo/',
};
const USER_AGENT = 'EventPulse-Bot/1.0';
const RATE_LIMIT_MS = 3000;
const SOURCE_ID = 'eventbrite-stockholm'; // match the source file + existing DB rows
const DEFAULT_CITY = 'stockholm';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function dedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'manual', // Eventbrite trailing-slash redirects break parsing
  });
  if (r.status === 301 || r.status === 302) {
    const loc = r.headers.get('location');
    if (loc && loc !== url) return fetchPage(loc);
  }
  if (!r.ok) return null;
  return await r.text();
}

function extractEventsFromHtml(html) {
  const events = [];
  // Robust JSON-LD extraction: try <script type="application/ld+json"> blocks
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const content = match[1].trim();
    let data;
    try { data = JSON.parse(content); } catch { continue; }
    // Could be an array of objects or a single one
    const candidates = Array.isArray(data) ? data : [data];
    for (const d of candidates) {
      if (d['@type'] !== 'ItemList') continue;
      const items = d.itemListElement;
      if (!Array.isArray(items)) continue;
      for (const li of items) {
        const ev = li.item ?? li; // some variants inline the event
        if (!ev) continue;
        const t = ev['@type'];
        if (t !== 'Event' && !(Array.isArray(t) && t.includes('Event'))) continue;
        const name = ev.name;
        const startDate = ev.startDate;
        if (!name || !startDate) continue;
        const datePart = startDate.split('T')[0];
        const timePart = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) : '';
        const loc = ev.location || {};
        const address = loc.address
          ? [loc.address.streetAddress, loc.address.postalCode, loc.address.addressLocality].filter(Boolean).join(', ')
          : '';
        const lat = loc.geo?.latitude != null ? parseFloat(loc.geo.latitude) : null;
        const lng = loc.geo?.longitude != null ? parseFloat(loc.geo.longitude) : null;
        events.push({
          name: String(name).trim(),
          startDate,
          endDate: ev.endDate ?? null,
          url: ev.url ?? null,
          image: ev.image ?? null,
          venue: loc.name ?? null,
          address: address || null,
          locality: loc.address?.addressLocality ?? null,
          lat: !isNaN(lat) ? lat : null,
          lng: !isNaN(lng) ? lng : null,
          datePart,
          timePart,
        });
      }
    }
  }
  return events;
}

async function fetchCity(cityKey, months, dryRun) {
  const slug = CITY_SLUGS[cityKey] ?? CITY_SLUGS[DEFAULT_CITY];
  const today = new Date();
  const stats = { fetched: 0, persisted: 0, skippedPast: 0, duplicates: 0 };

  for (let m = 0; m < months; m++) {
    const monthStart = new Date(today);
    monthStart.setMonth(today.getMonth() + m, 1);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthStart.getMonth() + 1, 0); // last day of month

    const startStr = fmtDate(monthStart);
    const url = slug.includes('all-events/')
      ? `${LISTING_BASE}${slug}?start_date=${startStr}`
      : `${LISTING_BASE}${slug}/?start_date=${startStr}`;

    await sleep(RATE_LIMIT_MS);
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.error(`  [${cityKey} ${startStr}] fetch error: ${e.message}`);
      continue;
    }
    if (!html) {
      console.error(`  [${cityKey} ${startStr}] no HTML (status error)`);
      continue;
    }

    const events = extractEventsFromHtml(html);
    stats.fetched += events.length;

    // Filter future events only
    const now = Date.now();
    const future = events.filter((e) => {
      const ts = new Date(e.startDate).getTime();
      if (isNaN(ts)) return false;
      return ts >= now;
    });
    stats.skippedPast += events.length - future.length;

    if (dryRun) {
      console.log(`  [${cityKey} ${startStr}] fetched=${events.length} future=${future.length}`);
      continue;
    }

    // Persist with dedup
    const rows = future.map((ev) => {
      // 2026-10-05 — Använd ev.lat/ev.lng om tillgängligt, annars null
      // (tidigare: Sergels-torg-fallback som var fel för låsta match).
      // Spara verklig venue-data istället för att kasta den.
      const hasCoord = typeof ev.lat === 'number' && ev.lat !== 0
                    && typeof ev.lng === 'number' && ev.lng !== 0;
      const lat = hasCoord ? ev.lat : null;
      const lng = hasCoord ? ev.lng : null;
      const startIso = ev.startDate.includes('T') ? ev.startDate : `${ev.startDate}T00:00:00Z`;
      return {
        source: SOURCE_ID,
        title_sv: ev.name,
        title_en: ev.name,
        start_time: startIso,
        end_time: ev.endDate ?? null,
        location: hasCoord ? `POINT(${lng} ${lat})` : null,
        lat, lng,
        // 2026-10-05 — verklig venue-data från Eventbrite-payload
        venue_full_name: ev.venue ?? null,
        venue_full_address: ev.address ?? null,
        venue_city: ev.locality ?? 'Stockholm',
        venue_lat: lat,
        venue_lng: lng,
        venue_url: null,
        venue_phone: null,
        ticket_url: ev.url,
        image_url: typeof ev.image === 'string' ? ev.image : Array.isArray(ev.image) ? ev.image[0] : null,
        status: 'published',
        featured: false,
        view_count: 0,
        raw_data: {
          venue: ev.venue,
          address: ev.address,
          locality: ev.locality,
          city: ev.locality ?? 'Stockholm',
          fetched_at: new Date().toISOString(),
          city_slug: cityKey,
        },
        confidence_score: 75,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        dedup_hash: dedupHash(ev.name, startIso),
      };
    });

    // Lookup existing hashes to avoid expensive upserts for duplicates
    const hashes = rows.map((r) => r.dedup_hash);
    const existing = new Set();
    for (let i = 0; i < hashes.length; i += 500) {
      const { data } = await supabase
        .from('events')
        .select('dedup_hash')
        .in('dedup_hash', hashes.slice(i, i + 500));
      for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
    }
    const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
    stats.duplicates += rows.length - fresh.length;

    // Batch upsert
    for (let i = 0; i < fresh.length; i += 50) {
      const batch = fresh.slice(i, i + 50);
      const { data, error } = await supabase
        .from('events')
        .upsert(batch, { onConflict: 'dedup_hash' })
        .select('id');
      if (error) {
        console.error(`  [${cityKey} ${startStr}] upsert error: ${error.message}`);
        continue;
      }
      stats.persisted += data?.length ?? 0;
    }

    const pageNew = fresh.length;
    console.log(`  [${cityKey} ${startStr}] fetched=${events.length} future=${future.length} new=${pageNew} (page)`);
  }

  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const months = parseInt((args.find((a) => a.startsWith('--months=')) ?? '--months=6').split('=')[1], 10);
  const dryRun = args.includes('--dry-run');
  const citiesArg = args.find((a) => a.startsWith('--cities='))?.split('=')[1];
  const cities = citiesArg
    ? citiesArg.split(',').filter((c) => CITY_SLUGS[c] !== undefined)
    : [DEFAULT_CITY];

  console.log(`Eventbrite Stockholm ingestion — cities=${cities.join(',')} months=${months} dryRun=${dryRun}`);

  const totals = { fetched: 0, persisted: 0, skippedPast: 0, duplicates: 0 };
  for (const city of cities) {
    console.log(`\n--- ${city} ---`);
    const s = await fetchCity(city, months, dryRun);
    totals.fetched += s.fetched;
    totals.persisted += s.persisted;
    totals.skippedPast += s.skippedPast;
    totals.duplicates += s.duplicates;
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`fetched=${totals.fetched} future=${totals.fetched - totals.skippedPast} persisted=${totals.persisted} duplicates=${totals.duplicates}`);

  // Final DB count
  if (!dryRun) {
    const { count } = await supabase
      .from('events_public')
      .select('*', { count: 'exact', head: true })
      .eq('source', SOURCE_ID);
    console.log(`\nDB ${SOURCE_ID} count: ${count}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});