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

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
const SOURCE_ID = 'posh-stockholm';
const RATE_LIMIT_MS = 2000;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

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
    const lat = 59.3293; // default Stockholm
    const lng = 18.0686;
    return {
      source: SOURCE_ID,
      title_sv: ev.name, title_en: ev.name,
      start_time: ev.startDate,
      end_time: ev.endDate ?? null,
      location: `POINT(${lng} ${lat})`,
      lat, lng,
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

  for (let i = 0; i < fresh.length; i += 50) {
    const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + 50), { onConflict: 'dedup_hash' }).select('id');
    if (error) { console.error(error.message); continue; }
    console.log(`  batch: ${data?.length} inserted`);
  }

  const { count } = await supabase.from('events_public').select('*', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`\nDB ${SOURCE_ID} total: ${count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });