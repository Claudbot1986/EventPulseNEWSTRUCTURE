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

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const SOURCE_ID = 'stockholmjazz';
const DRY = process.argv.includes('--dry-run');
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const concArg = args.find(a => a.startsWith('--concurrency='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 10;

const SITEMAP = 'https://stockholmjazz.se/sitemap.xml';
const DEFAULT_LAT = 59.3325;
const DEFAULT_LNG = 18.0647;

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
      location: `POINT(${DEFAULT_LNG} ${DEFAULT_LAT})`,
      lat: DEFAULT_LAT, lng: DEFAULT_LNG,
      ticket_url: url,
      image_url: image,
      description_sv: description,
      description_en: description,
      status: 'published',
      featured: false,
      view_count: 0,
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