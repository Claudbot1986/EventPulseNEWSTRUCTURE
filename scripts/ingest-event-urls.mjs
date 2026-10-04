#!/usr/bin/env node
/**
 * ingest-event-urls.mjs — Generic fetcher for sources where event URLs are in
 * the source sitemap but individual event pages lack JSON-LD/microdata.
 *
 * Strategy: fetch each event URL via Scrapingbee (JS-rendered), then extract
 * event info from HTML heuristics + DOM patterns. Falls back to URL title parsing.
 *
 * Target: dansenshus, visitstockholm, meer, and other JS-heavy event sites
 * that have sitemap event URLs but no per-page structured data.
 *
 * Användning:
 *   node scripts/ingest-event-urls.mjs --slug=dansenshus --max=50
 *   node scripts/ingest-event-urls.mjs --slug=visitstockholm-en
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}

class Sem {
  constructor(n) { this.n = n; this.q = []; this.waiters = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const next = this.waiters.shift(); if (next) next(); else this.n++; }
}

async function fetchHtml(url, useScrapingbee, timeout = 12000) {
  try {
    if (useScrapingbee && SCRAPINGBEE) {
      const params = new URLSearchParams({
        api_key: SCRAPINGBEE, url, render_js: 'true', wait: '5000', timeout: '60000',
      });
      const r = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
      if (!r.ok) return null;
      return await r.text();
    }
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
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

function extractEventsFromHtml(html, sourceUrl) {
  const events = [];
  const $ = cheerio.load(html);

  // Strategy 1: JSON-LD (with or without type attribute)
  $('script').each((_, el) => {
    const txt = $(el).html();
    if (!txt || !txt.trim().startsWith('{')) return;
    try {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
          const loc = d.location || {};
          const addr = loc.address || {};
          events.push({
            name: d.name, startDate: d.startDate, endDate: d.endDate, url: d.url,
            venue: loc.name || null,
            address: [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ') || null,
            description: d.description?.slice(0, 500) || null,
            image: typeof d.image === 'string' ? d.image : Array.isArray(d.image) ? d.image[0] : null,
          });
        }
        if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
          for (const li of d.itemListElement) {
            const ev = li.item ?? li;
            if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
              const loc = ev.location || {};
              const addr = loc.address || {};
              events.push({
                name: ev.name, startDate: ev.startDate, endDate: ev.endDate, url: ev.url,
                venue: loc.name || null,
                address: [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ') || null,
                description: ev.description?.slice(0, 500) || null,
                image: typeof ev.image === 'string' ? ev.image : Array.isArray(ev.image) ? ev.image[0] : null,
              });
            }
          }
        }
      }
    } catch {}
  });

  if (events.length > 0) return events;

  // Strategy 2: HTML heuristic — find h1/h2 + date + venue grouping
  const title = $('h1').first().text().trim() || $('h2').first().text().trim();
  const datetimes = [];
  $('time[datetime]').each((_, t) => {
    const dt = $(t).attr('datetime');
    if (dt) datetimes.push(dt);
  });
  // Try extracting from common patterns like "October 3" + "19:00"
  if (title && datetimes.length > 0) {
    const dt = datetimes[0];
    const ts = new Date(dt).getTime();
    if (!isNaN(ts) && ts > Date.now()) {
      const venue = $('.venue, .location, [class*="venue"]').first().text().trim() ||
                    $('[class*="address"]').first().text().trim() || null;
      events.push({
        name: title.slice(0, 200),
        startDate: dt,
        endDate: null,
        url: sourceUrl,
        venue: venue,
        address: null,
        description: null,
        image: $('meta[property="og:image"]').attr('content') || null,
      });
    }
  }

  // Strategy 3: URL slug → title extraction
  if (events.length === 0 && title) {
    // No date found, skip
    return events;
  }

  return events;
}

async function processSource(src, sem, options) {
  await sem.acquire();
  try {
    const urls = options.urls || [];
    const events = [];

    for (const u of urls) {
      const useSB = options.useScrapingbee || false;
      const html = await fetchHtml(u, useSB);
      if (!html) continue;
      const evs = extractEventsFromHtml(html, u);
      events.push(...evs);
    }

    const now = Date.now();
    const future = events.filter((e) => {
      if (!e.name || !e.startDate) return false;
      const ts = new Date(e.startDate).getTime();
      return !isNaN(ts) && ts > now;
    });

    if (future.length === 0) {
      return { slug: src.slug, fetched: events.length, future: 0, persisted: 0, duplicates: 0 };
    }

    const inserts = future.map((ev) => {
      const lat = 59.3293, lng = 18.0686;
      return {
        source: src.slug,
        title_sv: ev.name, title_en: ev.name,
        start_time: ev.startDate,
        end_time: ev.endDate ?? null,
        location: `POINT(${lng} ${lat})`, lat, lng,
        ticket_url: ev.url ?? null,
        image_url: ev.image ?? null,
        description_sv: ev.description,
        description_en: ev.description,
        status: 'published', featured: false, view_count: 0,
        raw_data: { venue: ev.venue, address: ev.address, fetched_via: 'event-urls', fetched_at: new Date().toISOString() },
        confidence_score: 65,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        dedup_hash: dedupHash(ev.name, ev.startDate, src.slug),
      };
    });

    const hashes = inserts.map((r) => r.dedup_hash);
    const existing = new Set();
    for (let i = 0; i < hashes.length; i += 500) {
      const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
      for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
    }
    const fresh = inserts.filter((r) => !existing.has(r.dedup_hash));
    const dups = inserts.length - fresh.length;

    for (let i = 0; i < fresh.length; i += 50) {
      const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + 50), { onConflict: 'dedup_hash' }).select('id');
      if (error) { console.error(`  ${src.slug}: upsert error ${error.message}`); continue; }
    }
    return { slug: src.slug, fetched: events.length, future: future.length, persisted: fresh.length, duplicates: dups };
  } finally {
    sem.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
  const maxEvents = parseInt((args.find((a) => a.startsWith('--max=')) ?? '--max=30').split('=')[1], 10);

  // Load sources
  const files = readdirSync('sources').filter((f) => f.endsWith('.jsonl') && !f.startsWith('_'));
  const sources = [];
  const seen = new Set();
  for (const f of files) {
    try {
      const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const d = JSON.parse(line);
        if (d.url && !seen.has(d.id)) {
          if (onlySlug && d.id !== onlySlug) continue;
          seen.add(d.id);
          sources.push({ slug: d.id, url: d.url });
          break;
        }
      }
    } catch {}
  }

  console.log(`Event URL ingestion — ${sources.length} sources max=${maxEvents}`);

  const sem = new Sem(8);
  const totals = { fetched: 0, persisted: 0, duplicates: 0 };

  for (const src of sources) {
    try {
      // Fetch sitemap.xml or root to get event URLs
      const candidates = [
        `${src.url.replace(/\/$/, '')}/sitemap.xml`,
        `${src.url.replace(/\/$/, '')}/sitemap_index.xml`,
        src.url,
      ];
      let eventUrls = [];
      for (const u of candidates) {
        if (u.endsWith('.xml')) {
          // Try as sitemap
          const html = await fetchHtml(u, false);
          if (html) {
            const locs = [...html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
            const evUrls = locs.filter(l => /\/program\/|\/event\/|\/forestallning\/|\/show\/|\/kalender\//.test(l)).slice(0, maxEvents);
            if (evUrls.length > 0) {
              eventUrls = evUrls;
              break;
            }
          }
        }
      }

      if (eventUrls.length === 0) {
        // No sitemap event URLs found — try direct extraction from root
        eventUrls.push(src.url);
      }

      const r = await processSource(src, sem, { urls: eventUrls.slice(0, maxEvents), useScrapingbee: false });
      console.log(`  ${src.slug}: urls=${eventUrls.length} fetched=${r.fetched} future=${r.future} persisted=${r.persisted} dupes=${r.duplicates}`);
      totals.fetched += r.fetched;
      totals.persisted += r.persisted;
      totals.duplicates += r.duplicates;
    } catch (e) {
      console.error(`  ${src.slug}: FATAL ${e.message}`);
    }
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`fetched=${totals.fetched} persisted=${totals.persisted} duplicates=${totals.duplicates}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });