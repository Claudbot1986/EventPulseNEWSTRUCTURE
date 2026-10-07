#!/usr/bin/env node
/**
 * ingest-stockholmjazz.mjs — Fetch Stockholm Jazz Festival events.
 *
 * Stockholm Jazz Festival publishes all events via sitemap at:
 *   https://stockholmjazz.se/sitemap.xml (886 URLs, 662 are events)
 *
 * Each event page has JSON-LD MusicEvent with startDate, location (venue).
 * URL pattern: /program/<slug>-YYYY-MM-DD-<id>
 *
 * Strategy:
 *   1. Parse sitemap, filter /program/* URLs (skip /program top-level)
 *   2. Fetch each, extract JSON-LD MusicEvent
 *   3. Filter future events, persist with venue name from location
 *
 * Usage:
 *   node scripts/ingest-stockholmjazz.mjs --dry-run
 */

import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern dränerar kön och bearbetar
// varje event genom normalizer (kategori, dedup, venue_id, T0201).
const rawEventsQueue = new Queue('raw_events', {
  connection: new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null, enableReadyCheck: false }),
});

const SOURCE_ID = 'stockholmjazz';
const DRY = process.argv.includes('--dry-run');
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const concArg = args.find(a => a.startsWith('--concurrency='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 10;

const SITEMAP = 'https://stockholmjazz.se/sitemap.xml';
// 2026-10-05 — DEFAULT_LAT/LNG borttaget. lat/lng sätts från JSON-LD location.geo
// om källan har det, annars null → backfill-jobb fyller på via venue_full_name.

class Sem {
  constructor(n) { this.n = n; this.q = []; this.waiters = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const next = this.waiters.shift(); if (next) next(); else this.n++; }
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–').replace(/&#8217;/g, "'").replace(/&#8221;/g, '"').replace(/&#8220;/g, '"');
}

function dedupHash(url, startIso) {
  return createHash('sha256').update(`${SOURCE_ID}::${url}::${startIso}`).digest('hex');
}

async function fetchSitemapUrls() {
  const r = await fetch(SITEMAP, { headers: { 'User-Agent': 'EventPulse-Bot/1.0' } });
  if (!r.ok) throw new Error(`Sitemap ${r.status}`);
  const xml = await r.text();
  const matches = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)];
  // Filter /program/<slug> (not just /program) and only /program/*-<date>-<id>
  return matches
    .map(m => m[1].trim())
    .filter(u => {
      if (!u.includes('/program/')) return false;
      const path = u.split('/program/')[1] || '';
      // Skip top-level /program
      if (!path || path.length < 5) return false;
      // Skip if no date pattern in slug
      return /-\d{4}-\d{2}-\d{2}/.test(path);
    });
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

function extractMusicEvent(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [_, json] of matches) {
    try {
      const data = JSON.parse(json);
      if (data['@type'] === 'MusicEvent' || data['@type'] === 'Event' ||
          (Array.isArray(data['@type']) && (data['@type'].includes('MusicEvent') || data['@type'].includes('Event')))) {
        return data;
      }
    } catch {}
  }
  return null;
}

function extractDescription(html) {
  // Try meta description
  const m1 = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (m1) return decodeHtml(m1[1]).trim().slice(0, 500);
  const m2 = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (m2) return decodeHtml(m2[1]).trim().slice(0, 500);
  return null;
}

function extractImage(html) {
  const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

async function main() {
  console.log(`[${DRY ? 'DRY' : 'LIVE'}] Fetching Stockholm Jazz sitemap...`);
  const urls = await fetchSitemapUrls();
  // Dedupe by URL (sv + en duplicates exist)
  const unique = [...new Set(urls.map(u => u.replace(/\/en\/program\//, '/program/')))];
  const limited = unique.slice(0, LIMIT);
  console.log(`Got ${urls.length} URLs (${unique.length} unique SV); processing ${limited.length}`);

  const sem = new Sem(CONCURRENCY);
  const nowMs = Date.now();
  let ok = 0, fail = 0, future = 0, past = 0, noData = 0;

  const results = await Promise.all(limited.map(async (url) => {
    await sem.acquire();
    let html = null;
    try {
      html = await fetchHtml(url);
    } finally {
      sem.release();
    }
    if (!html) { fail++; return null; }
    ok++;

    const ev = extractMusicEvent(html);
    if (!ev) { noData++; return null; }

    if (!ev.startDate) { noData++; return null; }
    const ts = new Date(ev.startDate).getTime();
    if (isNaN(ts) || ts < nowMs) { past++; return null; }
    future++;

    const name = decodeHtml(ev.name);
    const description = extractDescription(html);
    const image = extractImage(html);
    const locName = ev.location?.name || null;

    return {
      id: randomUUID(),
      source: SOURCE_ID,
      title_sv: name,
      title_en: name,
      start_time: new Date(ev.startDate).toISOString(),
      end_time: ev.endDate ? new Date(ev.endDate).toISOString() : null,
      // 2026-10-05 — venue_full_* från JSON-LD location. lat/lng lämnas null
      // om källans location saknar geo — backfill-jobb slår upp koordinater
      // från venues-tabellen via fuzzy match på venue_full_name.
      location: null,
      lat: null, lng: null,
      ticket_url: url,
      // 2026-10-04 — Droppa scrape-original (sthlmjazz.se/gdrive) vid import.
      // matchLibraryFirst (i nattjobbet) tilldelar biblioteks-bild.
      image_url: null,
      description_sv: description,
      description_en: description,
      status: 'published',
      featured: false,
      view_count: 0,
      venue_full_name: locName,
      venue_full_address: ev.location?.address?.streetAddress ?? null,
      venue_city: ev.location?.address?.addressLocality ?? 'Stockholm',
      venue_lat: typeof ev.location?.geo?.latitude === 'number' ? ev.location.geo.latitude : null,
      venue_lng: typeof ev.location?.geo?.longitude === 'number' ? ev.location.geo.longitude : null,
      venue_url: null,
      venue_phone: null,
      raw_data: {
        venue: locName,
        location_data: ev.location,
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
      // 2026-10-06 (T0201.4): category_slug-fallback 'community' för att undvika NULL i DB.
      category_slug: 'community',
      dedup_hash: dedupHash(url, ev.startDate),
    };
  }));

  const valid = results.filter(Boolean);
  console.log(`HTML: ok=${ok} fail=${fail}; future=${future} past=${past} noData=${noData}; valid=${valid.length}`);

  if (valid.length === 0) { console.log('Nothing to ingest.'); return; }

  if (DRY) {
    console.log('---first 5 dry-run---');
    for (const e of valid.slice(0, 5)) {
      console.log(JSON.stringify({ title: e.title_sv, start_time: e.start_time, venue: e.raw_data.venue, ticket_url: e.ticket_url }, null, 2));
    }
    return;
  }

  const hashes = valid.map(v => v.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = valid.filter(v => !existing.has(v.dedup_hash));
  console.log(`Existing: ${existing.size}, fresh: ${fresh.length}, dup: ${valid.length - fresh.length}`);

  const BATCH = 50;
  let upserted = 0;
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
        console.error(`queue.add failed for ${row.title_sv ?? row.title_en}: ${e.message}`);
      }
    }
    console.log(`  queued: ${pageQueued}`);

  console.log(`Upserted: ${upserted}`);

  const { count } = await supabase.from('events_public').select('id', { count: 'exact', head: true }).eq('source', SOURCE_ID);
  console.log(`DB events_public for ${SOURCE_ID}: ${count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });