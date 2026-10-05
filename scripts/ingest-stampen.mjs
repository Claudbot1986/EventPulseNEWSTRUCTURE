#!/usr/bin/env node
/**
 * ingest-stampen.mjs — Fetch Stampen (Stockholm jazz/blues bar) events.
 *
 * Stampen uses WordPress + The Events Calendar plugin. JSON-LD events are
 * embedded directly in /events/ page HTML.
 *
 * Strategy:
 *   1. Fetch /events/?eventDisplay=month
 *   2. Parse JSON-LD events (each script tag is an Event)
 *   3. Filter future, persist
 *
 * Stampen publishes ~10-15 upcoming events at any time.
 *
 * Usage:
 *   node scripts/ingest-stampen.mjs --dry-run
 */

import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const SOURCE_ID = 'stampen';
const DRY = process.argv.includes('--dry-run');
const VENUE_LAT = 59.3325; // Stora Nygatan 5 (Gamla Stan)
const VENUE_LNG = 18.0725;
const VENUE_ADDR = 'Stora Nygatan 5, 111 27 Stockholm';

const URLS = [
  'https://stampen.se/events/',
  'https://stampen.se/events/?eventDisplay=month',
  'https://stampen.se/program/',
];

function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–').replace(/&#8217;/g, "'").replace(/&#8221;/g, '"').replace(/&#8220;/g, '"')
    .replace(/&#8216;/g, "'").replace(/&#8217;/g, "'");
}

function dedupHash(url, startIso) {
  return createHash('sha256').update(`${SOURCE_ID}::${url}::${startIso}`).digest('hex');
}

async function fetchHtml(url, timeoutMs = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'text/html' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function extractEvents(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const events = [];
  for (const [_, json] of matches) {
    try {
      const data = JSON.parse(json);
      if (data['@type'] === 'Event' || (Array.isArray(data['@type']) && data['@type'].includes('Event'))) {
        events.push(data);
      } else if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
        for (const item of data.itemListElement) {
          const e = item.item || item;
          if (e && (e['@type'] === 'Event')) events.push(e);
        }
      }
    } catch {}
  }
  return events;
}

async function main() {
  console.log(`[${DRY ? 'DRY' : 'LIVE'}] Fetching Stampen events...`);
  const allEvents = new Map(); // dedupe by url
  for (const url of URLS) {
    const html = await fetchHtml(url);
    if (!html) { console.log(`  ${url}: failed`); continue; }
    const events = extractEvents(html);
    console.log(`  ${url}: ${events.length} events`);
    for (const e of events) {
      if (e.offers?.url && !allEvents.has(e.offers.url)) {
        allEvents.set(e.offers.url, e);
      } else if (!e.offers?.url && e.url && !allEvents.has(e.url)) {
        allEvents.set(e.url, e);
      }
    }
  }
  console.log(`Unique events: ${allEvents.size}`);

  const now = Date.now();
  const rows = [];
  for (const e of allEvents.values()) {
    if (!e.startDate) continue;
    const ts = new Date(e.startDate).getTime();
    if (isNaN(ts) || ts < now) continue;

    const url = e.offers?.url || e.url || null;
    const name = e.name ? decodeHtml(e.name) : null;
    const description = e.description ? decodeHtml(e.description.replace(/<[^>]+>/g, ' ')).slice(0, 500) : null;
    const image = Array.isArray(e.image) ? (typeof e.image[0] === 'string' ? e.image[0] : e.image[0]?.url) : null;
    const price = e.offers?.price ? parseFloat(e.offers.price) : null;
    const isFree = price === 0;

    rows.push({
      id: randomUUID(),
      source: SOURCE_ID,
      title_sv: name,
      title_en: name,
      start_time: e.startDate,
      end_time: e.endDate || null,
      location: `POINT(${VENUE_LNG} ${VENUE_LAT})`,
      lat: VENUE_LAT, lng: VENUE_LNG,
      ticket_url: url,
      image_url: image,
      description_sv: description,
      description_en: description,
      is_free: isFree,
      price_min_sek: price && price > 0 ? Math.round(price) : null,
      price_max_sek: price && price > 0 ? Math.round(price) : null,
      status: 'published',
      featured: false,
      view_count: 0,
      // 2026-10-05 — verklig venue-data. Stampen har fast adress i Gamla Stan.
      venue_full_name: 'Stampen',
      venue_full_address: VENUE_ADDR,
      venue_city: 'Stockholm',
      venue_lat: VENUE_LAT,
      venue_lng: VENUE_LNG,
      venue_url: 'https://stampen.se',
      venue_phone: null,
      raw_data: {
        venue: 'Stampen',
        address: VENUE_ADDR,
        fetched_at: new Date().toISOString(),
      },
      confidence_score: 85,
      freshness_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
      dedup_hash: dedupHash(url || name, e.startDate),
    });
  }
  console.log(`Future events to ingest: ${rows.length}`);

  if (rows.length === 0) { console.log('Nothing to ingest.'); return; }

  if (DRY) {
    for (const e of rows.slice(0, 3)) {
      console.log(JSON.stringify({ title: e.title_sv, start_time: e.start_time, url: e.ticket_url }, null, 2));
    }
    return;
  }

  const hashes = rows.map(r => r.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = rows.filter(r => !existing.has(r.dedup_hash));
  console.log(`Existing: ${existing.size}, fresh: ${fresh.length}, dup: ${rows.length - fresh.length}`);

  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + BATCH), { onConflict: 'dedup_hash' }).select('id');
    if (error) { console.error(`Batch err: ${error.message}`); continue; }
    upserted += data?.length ?? 0;
  }
  console.log(`Upserted: ${upserted}`);

  const { count } = await supabase.from('events_public').select('id', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`DB events_public for ${SOURCE_ID}: ${count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });