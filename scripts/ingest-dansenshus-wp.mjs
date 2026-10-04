#!/usr/bin/env node
/**
 * ingest-dansenshus-wp.mjs — Fetch Dansens Hus events via WordPress REST +
 * direct HTML scraping for show dates.
 *
 * Dansens Hus (Swedish dance venue) exposes a Custom Post Type `dh_event`:
 *   https://dansenshus.se/wp-json/wp/v2/dh_event?per_page=100&page=N
 *
 * Show dates are rendered server-side as <span class="dates"> in the
 * single-event template — no JS render needed.
 *
 * Steps:
 *   1. Paginate REST, collect all posts (slug, link)
 *   2. Direct-fetch each link, extract <span class="dates"> from HTML
 *   3. Parse Swedish date ranges "24-26 september 2026" or single dates
 *   4. Filter future events, persist via Supabase upsert on dedup_hash
 *
 * Usage:
 *   node scripts/ingest-dansenshus-wp.mjs --dry-run
 *   node scripts/ingest-dansenshus-wp.mjs --concurrency=10
 */

import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const SOURCE_ID = 'dansenshus';
const DRY = process.argv.includes('--dry-run');
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const concArg = args.find(a => a.startsWith('--concurrency='));
const cutoffArg = args.find(a => a.startsWith('--cutoff='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 10;
const CUTOFF_DATE = cutoffArg ? cutoffArg.split('=')[1] : '2024-01-01';

const REST = 'https://dansenshus.se/wp-json/wp/v2/dh_event';
const VENUE_LAT = 59.3297; // Barnhusgatan 12-14
const VENUE_LNG = 18.0686;
const VENUE_ADDR = 'Barnhusgatan 12-14, 111 23 Stockholm';

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

function parseSvDateRange(text) {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const clean = norm.replace(/^datum\s*:?\s*/, '').trim();
  // Range: "<d1>-<d2> <month> <year>" or "<d1>–<d2> <month> <year>"
  const rangeMatch = clean.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-zåäöé]+)\s+(\d{4})/i);
  if (rangeMatch) {
    const d1 = parseInt(rangeMatch[1], 10);
    const d2 = parseInt(rangeMatch[2], 10);
    const monthKey = rangeMatch[3].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const month = SV_MONTHS[monthKey];
    const year = parseInt(rangeMatch[4], 10);
    if (!month) return null;
    return {
      start: new Date(Date.UTC(year, month - 1, d1, 19, 0, 0)),
      end: new Date(Date.UTC(year, month - 1, d2, 23, 59, 59)),
    };
  }
  const singleMatch = clean.match(/^(\d{1,2})\s+([a-zåäöé]+)\s+(\d{4})/i);
  if (singleMatch) {
    const day = parseInt(singleMatch[1], 10);
    const monthKey = singleMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const month = SV_MONTHS[monthKey];
    const year = parseInt(singleMatch[3], 10);
    if (!month) return null;
    return {
      start: new Date(Date.UTC(year, month - 1, day, 19, 0, 0)),
      end: new Date(Date.UTC(year, month - 1, day, 23, 59, 59)),
    };
  }
  return null;
}

function stripHtml(html) {
  if (!html) return null;
  return decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 500) || null;
}

function extractImage(html) {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/);
  return m ? m[1] : null;
}

function extractDatesFromHtml(html) {
  const m = html.match(/<span[^>]*class=["']dates["'][^>]*>([^<]+)<\/span>/i);
  return m ? m[1].trim() : null;
}

function dedupHash(slug, startIso) {
  return createHash('sha256').update(`${SOURCE_ID}::${slug}::${startIso}`).digest('hex');
}

async function fetchAllRest() {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${REST}?per_page=100&page=${page}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'application/json' } });
    if (!r.ok) {
      console.error(`REST ${page} failed: ${r.status}`);
      break;
    }
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
    page++;
    if (page > 20) break;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
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
  console.log(`[${DRY ? 'DRY' : 'LIVE'}] Fetching Dansens Hus events via WP REST...`);
  const posts = await fetchAllRest();
  console.log(`Fetched ${posts.length} posts from REST`);

  const cutoff = new Date(CUTOFF_DATE).getTime();
  const candidates = posts.filter(p => new Date(p.date).getTime() >= cutoff);
  const limited = candidates.slice(0, LIMIT);
  console.log(`Filtered to ${candidates.length} candidates (cutoff ${CUTOFF_DATE}); processing ${limited.length}`);

  const sem = new Sem(CONCURRENCY);
  const now = Date.now();
  let ok = 0, fail = 0, futureEvents = 0, pastEvents = 0, noDate = 0;

  const results = await Promise.all(limited.map(async (post) => {
    const slug = post.slug;
    const link = post.link;
    const title = post.title?.rendered ? decodeHtml(post.title.rendered).trim() : null;
    const wpContent = post.content?.rendered || '';
    const wpExcerpt = post.excerpt?.rendered || '';
    const wpImage = extractImage(wpContent) || extractImage(wpExcerpt);

    await sem.acquire();
    let html = null;
    try {
      html = await fetchHtml(link);
    } finally {
      sem.release();
    }

    if (!html) { fail++; return null; }
    ok++;

    const dateText = extractDatesFromHtml(html);
    if (!dateText) { noDate++; return null; }

    const range = parseSvDateRange(dateText);
    if (!range) { noDate++; return null; }

    if (range.start.getTime() < now) { pastEvents++; return null; }
    futureEvents++;

    const description = stripHtml(wpExcerpt) || stripHtml(wpContent);
    const renderedImage = extractImage(html);

    return {
      id: randomUUID(),
      source: SOURCE_ID,
      title_sv: title,
      title_en: title,
      start_time: range.start.toISOString(),
      end_time: range.end.toISOString(),
      location: `POINT(${VENUE_LNG} ${VENUE_LAT})`,
      lat: VENUE_LAT, lng: VENUE_LNG,
      ticket_url: link,
      image_url: renderedImage || wpImage,
      description_sv: description,
      description_en: description,
      status: 'published',
      featured: false,
      view_count: 0,
      raw_data: {
        slug,
        wp_id: post.id,
        venue: 'Dansens Hus',
        address: VENUE_ADDR,
        date_text: dateText,
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
      dedup_hash: dedupHash(slug, range.start.toISOString()),
    };
  }));

  const valid = results.filter(Boolean);

  console.log(`HTML: ok=${ok} fail=${fail}; future=${futureEvents} past=${pastEvents} noDate=${noDate}; valid=${valid.length}`);

  if (valid.length === 0) {
    console.log('Nothing to ingest.');
    return;
  }

  if (DRY) {
    console.log('---first 5 dry-run---');
    for (const e of valid.slice(0, 5)) {
      console.log(JSON.stringify({ title: e.title_sv, start_time: e.start_time, ticket_url: e.ticket_url, raw_data_date_text: e.raw_data.date_text }, null, 2));
    }
    return;
  }

  // Persist with batch upsert
  const BATCH = 50;
  let upserted = 0;
  let totalDuplicates = 0;

  // Filter existing by dedup_hash
  const hashes = valid.map(v => v.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  const fresh = valid.filter(v => !existing.has(v.dedup_hash));
  totalDuplicates = valid.length - fresh.length;
  console.log(`Existing: ${existing.size}, fresh: ${fresh.length}, duplicates: ${totalDuplicates}`);

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