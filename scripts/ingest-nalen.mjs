#!/usr/bin/env node
/**
 * ingest-nalen.mjs — Fetch Nalen events via sitemap + title-date extraction.
 *
 * Nalen (Stockholm music venue) lists concerts at:
 *   https://www.nalen.com/sitemap.xml
 *
 * 285 konsert URLs total. Date format: "8 september 2025" or
 * "4 oktober 2026". Often appears as the FIRST swedish-date in <title>
 * or page content.
 *
 * Strategy:
 *   1. Fetch sitemap, get all /sv/konsert/* URLs
 *   2. Fetch each page, parse first sv-date from HTML
 *   3. Filter future, persist via Supabase
 *
 * Usage:
 *   node scripts/ingest-nalen.mjs --dry-run
 *   node scripts/ingest-nalen.mjs --concurrency=10
 */

import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const SOURCE_ID = 'nalen';
const DRY = process.argv.includes('--dry-run');
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const concArg = args.find(a => a.startsWith('--concurrency='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 6;

const SITEMAP = 'https://www.nalen.com/sitemap.xml';
const VENUE_LAT = 59.3375; // Nalen, Regeringsgatan
const VENUE_LNG = 18.0647;
const VENUE_ADDR = 'Regeringsgatan 74, 111 39 Stockholm';

const SV_MONTHS = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

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

function parseSvDate(text) {
  // "8 september 2025" or "4 oktober 2026"
  const m = text.match(/(\d{1,2})\s+([a-zåäöé]+)\s+(\d{4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthKey = m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = SV_MONTHS[monthKey];
  const year = parseInt(m[3], 10);
  if (!month) return null;
  return new Date(Date.UTC(year, month - 1, day, 19, 30, 0));
}

function findEarliestFutureDate(html, allDates) {
  // Find first sv-date >= today
  const now = Date.now();
  let earliest = null;
  for (const d of allDates) {
    const ts = d.getTime();
    if (ts >= now && (earliest === null || ts < earliest.getTime())) {
      earliest = d;
    }
  }
  return earliest;
}

function extractDatesFromHtml(html) {
  // Find all sv-date patterns
  const regex = /(\d{1,2})\s+([a-zåäöé]+)\s+(\d{4})/gi;
  const dates = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const d = parseSvDate(match[0]);
    if (d) dates.push(d);
  }
  return dates;
}

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? decodeHtml(m[1]).trim() : null;
}

function extractDescription(html) {
  // Try meta description
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (m) return decodeHtml(m[1]).trim().slice(0, 500);
  // Try og:description
  const m2 = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (m2) return decodeHtml(m2[1]).trim().slice(0, 500);
  return null;
}

function extractImage(html) {
  // Try og:image first
  const m1 = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (m1) return m1[1];
  // Try first JSON-LD image
  const m2 = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (m2) {
    try {
      const data = JSON.parse(m2[1]);
      if (typeof data.image === 'string') return data.image;
      if (Array.isArray(data.image) && data.image[0]) return typeof data.image[0] === 'string' ? data.image[0] : data.image[0].url;
    } catch {}
  }
  return null;
}

function dedupHash(slugVal, startIso) {
  return createHash('sha256').update(`${SOURCE_ID}::${slugVal}::${startIso}`).digest('hex');
}

async function fetchSitemapUrls() {
  const r = await fetch(SITEMAP, { headers: { 'User-Agent': 'EventPulse-Bot/1.0' } });
  if (!r.ok) throw new Error(`Sitemap ${r.status}`);
  const xml = await r.text();
  const matches = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)];
  return matches.map(m => m[1].trim()).filter(u => u.includes('/sv/konsert/'));
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

async function main() {
  console.log(`[${DRY ? 'DRY' : 'LIVE'}] Fetching Nalen sitemap...`);
  const urls = await fetchSitemapUrls();
  const limited = urls.slice(0, LIMIT);
  console.log(`Got ${urls.length} konsert URLs; processing ${limited.length}`);

  const sem = new Sem(CONCURRENCY);
  const nowMs = Date.now();
  let ok = 0, fail = 0, future = 0, past = 0, noDate = 0;

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

    // Extract slug from URL
    const slugMatch = url.match(/\/sv\/konsert\/([^/?#]+)/);
    const slug = slugMatch ? slugMatch[1] : null;

    // Get title; date is in title format "Artist | <date> | Nalen, Stockholm"
    const title = extractTitle(html);
    let startDate = null;
    if (title) {
      // Look for date in title
      const dateMatch = title.match(/(\d{1,2})\s+([a-zåäöé]+)\s+(\d{4})/i);
      if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const monthKey = dateMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const month = SV_MONTHS[monthKey];
        const year = parseInt(dateMatch[3], 10);
        if (month) startDate = new Date(Date.UTC(year, month - 1, day, 19, 30, 0));
      }
    }
    if (!startDate) { noDate++; return null; }
    if (startDate.getTime() < nowMs) { past++; return null; }
    future++;

    // Extract clean title (strip "| date | venue" suffix)
    let cleanTitle = title ? title.split('|')[0].trim() : null;
    if (!cleanTitle) cleanTitle = slug;

    const description = extractDescription(html);
    const image = extractImage(html);

    return {
      id: randomUUID(),
      source: SOURCE_ID,
      title_sv: cleanTitle,
      title_en: cleanTitle,
      start_time: startDate.toISOString(),
      end_time: null,
      location: `POINT(${VENUE_LNG} ${VENUE_LAT})`,
      lat: VENUE_LAT, lng: VENUE_LNG,
      ticket_url: url,
      image_url: image,
      description_sv: description,
      description_en: description,
      status: 'published',
      featured: false,
      view_count: 0,
      raw_data: {
        slug,
        venue: 'Nalen',
        address: VENUE_ADDR,
        title_full: title,
        dates_count: 1,
        fetched_at: new Date().toISOString(),
      },
      confidence_score: 75,
      freshness_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
      dedup_hash: dedupHash(slug || url, startDate.toISOString()),
    };
  }));

  const valid = results.filter(Boolean);

  console.log(`HTML: ok=${ok} fail=${fail}; future=${future} past=${past} noDate=${noDate}; valid=${valid.length}`);

  if (valid.length === 0) {
    console.log('Nothing to ingest.');
    return;
  }

  if (DRY) {
    console.log('---first 5 dry-run---');
    for (const e of valid.slice(0, 5)) {
      console.log(JSON.stringify({ title: e.title_sv, start_time: e.start_time, ticket_url: e.ticket_url, dates_count: e.raw_data.dates_count }, null, 2));
    }
    return;
  }

  // Filter existing
  const hashes = valid.map(v => v.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = valid.filter(v => !existing.has(v.dedup_hash));
  console.log(`Existing: ${existing.size}, fresh: ${fresh.length}, duplicates: ${valid.length - fresh.length}`);

  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('events')
      .upsert(batch, { onConflict: 'dedup_hash', ignoreDuplicates: false })
      .select('id');
    if (error) {
      console.error(`Batch ${i / BATCH} error:`, error.message);
      continue;
    }
    upserted += data?.length ?? 0;
  }
  console.log(`Upserted: ${upserted}`);

  const { count } = await supabase
    .from('events_public')
    .select('id', { count: 'exact', head: true })
    .eq('source', SOURCE_ID);
  console.log(`DB events_public for ${SOURCE_ID}: ${count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });