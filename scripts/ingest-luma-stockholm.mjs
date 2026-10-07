#!/usr/bin/env node
/**
 * ingest-luma-stockholm.mjs — Luma.com Stockholm events via Scrapingbee.
 *
 * Lu.ma är Next.js — kräver JS-rendering för att hitta events.
 * Använder Scrapingbee för att rendera + extrahera events.
 *
 * Kategorier som crawlas:
 *   tech, business, social, health, arts
 *
 * Användning:
 *   node scripts/ingest-luma-stockholm.mjs
 *   node scripts/ingest-luma-stockholm.mjs --dry-run
 *   node scripts/ingest-luma-stockholm.mjs --categories=tech,business
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import * as cheerio from 'cheerio';

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
const SOURCE_ID = 'luma-stockholm';
const RATE_LIMIT_MS = 3000;
const DEFAULT_CATEGORIES = ['tech', 'business', 'social', 'health', 'arts'];

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SCRAPINGBEE) { console.error('Missing SCRAPINGBEE_API_KEY'); process.exit(2); }
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing Supabase'); process.exit(2); }

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

async function render(url) {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE,
    url,
    render_js: 'true',
    wait: '3000',
    timeout: '30000',
  });
  const r = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
  if (!r.ok) return null;
  return await r.text();
}

function extractEvents(html) {
  const events = [];
  // Lu.ma renders events server-side in __NEXT_DATA__ or in DOM
  // Try 1: JSON-LD (with type attribute AND without — Luma uses bare <script>)
  const re1 = /<script[^>]*?type=["']application\/ld\+json["'][^>]*?>([\s\S]*?)<\/script>/gi;
  const re2 = /<script>([\s\S]*?)<\/script>/gi;
  let m;
  const seen = new Set();
  const tryParse = (raw) => {
    let data;
    try { data = JSON.parse(raw.trim()); } catch { return []; }
    const arr = Array.isArray(data) ? data : [data];
    const out = [];
    for (const d of arr) {
      if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
        out.push({
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
      // ItemList wrapper (Luma uses this)
      if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
        for (const li of d.itemListElement) {
          const ev = li.item ?? li;
          if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
            out.push({
              name: ev.name,
              startDate: ev.startDate,
              endDate: ev.endDate,
              url: ev.url ?? ev['@id'] ?? null,
              venue: ev.location?.name ?? null,
              address: ev.location?.address ? [ev.location.address.streetAddress, ev.location.address.postalCode, ev.location.address.addressLocality].filter(Boolean).join(', ') : null,
              lat: ev.location?.geo?.latitude != null ? parseFloat(ev.location.geo.latitude) : null,
              lng: ev.location?.geo?.longitude != null ? parseFloat(ev.location.geo.longitude) : null,
            });
          }
        }
      }
    }
    return out;
  };

  // Try 1: JSON-LD — match type attr flexibly (handles data-next-head sibling attrs)
  while ((m = re1.exec(html)) !== null) {
    const parsed = tryParse(m[1]);
    for (const ev of parsed) {
      if (!seen.has(ev.name + ev.startDate)) {
        seen.add(ev.name + ev.startDate);
        events.push(ev);
      }
    }
  }
  // Try 2: bare <script> tags with JSON (Luma)
  while ((m = re2.exec(html)) !== null) {
    const raw = m[1];
    if (!raw.trim().startsWith('{')) continue;
    const parsed = tryParse(raw);
    for (const ev of parsed) {
      if (!seen.has(ev.name + ev.startDate)) {
        seen.add(ev.name + ev.startDate);
        events.push(ev);
      }
    }
  }
  // Try 2: __NEXT_DATA__
  if (events.length === 0) {
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        const find = (obj, depth = 0) => {
          if (depth > 5 || !obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            for (const item of obj) {
              if (item && item.name && (item.start_at || item.startDate)) {
                events.push({
                  name: item.name,
                  startDate: item.start_at || item.startDate,
                  endDate: item.end_at || item.endDate || null,
                  url: item.url || item.full_url || `https://lu.ma/${item.slug || item.short_id}`,
                  venue: item.geo_address_info?.address ?? item.venue?.name ?? null,
                  address: item.geo_address_info?.address ?? null,
                  lat: item.geo_lat ?? null,
                  lng: item.geo_lng ?? null,
                });
              } else {
                find(item, depth + 1);
              }
            }
          } else {
            for (const v of Object.values(obj)) find(v, depth + 1);
          }
        };
        find(data);
      } catch {}
    }
  }
  // Try 3: DOM-based extraction (Lu.ma uses data-event-id attrs)
  if (events.length === 0) {
    const $ = cheerio.load(html);
    $('[data-event-id], a[href^="/e/"], a[href*="lu.ma/e/"]').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      if (text && text.length > 5) {
        const href = $el.attr('href') || '';
        const url = href.startsWith('http') ? href : `https://lu.ma${href}`;
        events.push({
          name: text.slice(0, 200),
          startDate: new Date(Date.now() + 7 * 86400_000).toISOString(), // placeholder future date
          endDate: null, url, venue: null, address: null, lat: null, lng: null,
        });
      }
    });
  }
  return events;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cats = (args.find((a) => a.startsWith('--categories=')) ?? `--categories=${DEFAULT_CATEGORIES.join(',')}`).split('=')[1].split(',');

  console.log(`Luma Stockholm — categories=${cats.join(',')} dryRun=${dryRun}`);

  const allEvents = [];
  for (const cat of cats) {
    await sleep(RATE_LIMIT_MS);
    const url = `https://lu.ma/discover/stockholm/${cat}`;
    const html = await render(url);
    if (!html) {
      console.error(`  ${cat}: render failed`);
      continue;
    }
    const events = extractEvents(html);
    console.log(`  ${cat}: ${events.length} events`);
    for (const ev of events) allEvents.push({ ...ev, category: cat });
  }

  // Filter future only
  const now = Date.now();
  const future = allEvents.filter((e) => {
    const ts = new Date(e.startDate).getTime();
    return !isNaN(ts) && ts > now;
  });
  console.log(`\nTotal: ${allEvents.length} future: ${future.length}`);

  if (allEvents.length > 0) {
    console.log('Sample events:');
    for (const ev of allEvents.slice(0, 5)) {
      console.log(`  - ${ev.name.slice(0, 60)} @ ${ev.startDate}`);
    }
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
        category: ev.category,
        fetched_at: new Date().toISOString(),
      },
      confidence_score: 65,
      freshness_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
      // 2026-10-06 (T0201.4): category_slug-fallback 'community' (se ingest-direct-jsonld.mjs).
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

  // T0201.5: push till raw_events BullMQ-queue istället för direkt upsert.
  // Workern dränerar och kör normalizer (kategori, dedup, T0201).
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
          fetched_via: 'luma',
          fetched_at: new Date().toISOString(),
        },
      };
      await rawEventsQueue.add(`luma-${row.dedup_hash.slice(0, 16)}`, raw, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      pageQueued++;
    } catch (e) {
      console.error(`queue.add failed for ${row.title_sv}: ${e.message}`);
    }
  }
  console.log(`  queued: ${pageQueued}`);

  const { count } = await supabase.from('events_public').select('*', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`\nDB ${SOURCE_ID} total: ${count}`);
}

main().then(async () => { await rawEventsQueue.close(); process.exit(0); }).catch((e) => { console.error('FATAL:', e); process.exit(1); });