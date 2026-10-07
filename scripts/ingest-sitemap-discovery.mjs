#!/usr/bin/env node
/**
 * ingest-sitemap-discovery.mjs — Generic sitemap.xml parser + event extractor.
 *
 * For each registered source, fetches /sitemap.xml (or /sitemap_index.xml),
 * parses XML, filters URLs by event patterns, fetches each event page,
 * extracts JSON-LD events, persists with dedup.
 *
 * Patterns filtered:
 *   /event/, /program/, /forestallning/, /konsert/, /show/,
 *   /repertoar/, /utstallning/, /exhibition/, /calendar/, /kalender/,
 *   /agenda/, /evenemang/, /kalenderhandel/, /pagar/, /forestallningar/
 *
 * Användning:
 *   node scripts/ingest-sitemap-discovery.mjs
 *   node scripts/ingest-sitemap-discovery.mjs --dry-run
 *   node scripts/ingest-sitemap-discovery.mjs --max-sources=20
 *   node scripts/ingest-sitemap-discovery.mjs --max-per-source=30
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';

// ─── Config ──────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.SITEMAP_CONCURRENCY ?? '20', 10); // parallel workers
const RATE_LIMIT_MS = 1000;
const PER_REQUEST_TIMEOUT = 8000;
const SITEMAP_TIMEOUT = 8000;
const PER_PAGE_EVENT_LIMIT = 30; // cap per source
const SOURCE_FILE_PATTERN = /.*\.jsonl$/;

const EVENT_PATH_PATTERNS = [
  /\/event/,
  /\/program/,
  /\/forestallning/,
  /\/konsert/,
  /\/show/,
  /\/repertoar/,
  /\/utstallning/,
  /\/exhibition/,
  /\/calendar/,
  /\/kalender/,
  /\/agenda/,
  /\/evenemang/,
  /\/pagar/,
  /\/forestallningar/,
];

const URL_BLACKLIST = [
  /\/wp-content/,
  /\/tag\//,
  /\/category\//,
  /\/author\//,
  /\?add-to-cart/,
  /\/cart\//,
  /\/checkout/,
  /\/login/,
  /\/signup/,
  /\/register/,
  /\/feed\//,
  /\/attachment-/,
];

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}
// sleep helper retained for backwards compat
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchUrl(url, timeout = SITEMAP_TIMEOUT) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0 (sitemap crawler)', Accept: '*/*' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// ─── Concurrency limiter (semaphore) ─────────────────────────────────────────
class Sem {
  constructor(n) { this.n = n; this.q = []; this.waiters = []; }
  async acquire() {
    if (this.n > 0) { this.n--; return; }
    await new Promise((r) => this.waiters.push(r));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.n++;
  }
}

function parseSitemapXml(xml) {
  const urls = [];
  const subSitemaps = [];
  // Extract <loc>...</loc> URLs
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/g;
  let m;
  while ((m = locRegex.exec(xml)) !== null) {
    const u = m[1].trim();
    if (/\.xml(\.gz)?$/i.test(u)) subSitemaps.push(u);
    else urls.push(u);
  }
  return { urls, subSitemaps };
}

async function fetchAllSitemapUrls(baseUrl, maxDepth = 2) {
  const seen = new Set();
  const allUrls = new Set();
  // If baseUrl is already a .xml file, use it directly. Otherwise probe standard sitemap paths.
  const base = baseUrl.replace(/\/$/, '');
  const queue = [];
  if (/\.xml(\.gz)?$/i.test(baseUrl)) {
    queue.push(base);
  } else {
    queue.push(`${base}/sitemap.xml`, `${base}/sitemap_index.xml`);
  }
  let depth = 0;
  while (queue.length > 0 && depth <= maxDepth) {
    const nextBatch = [];
    for (const url of queue) {
      if (seen.has(url)) continue;
      seen.add(url);
      await sleep(RATE_LIMIT_MS);
      const xml = await fetchUrl(url);
      if (!xml) continue;
      const { urls, subSitemaps } = parseSitemapXml(xml);
      for (const u of urls) allUrls.add(u);
      for (const s of subSitemaps) nextBatch.push(s);
    }
    queue.length = 0;
    queue.push(...nextBatch);
    depth++;
  }
  return [...allUrls];
}

function filterEventUrls(urls) {
  const out = [];
  for (const u of urls) {
    if (URL_BLACKLIST.some((re) => re.test(u))) continue;
    if (EVENT_PATH_PATTERNS.some((re) => re.test(u))) out.push(u);
  }
  return out;
}

function extractJsonLdEvents(html, sourceId) {
  const events = [];
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const arr = Array.isArray(data) ? data : [data];
    for (const d of arr) {
      // Direct Event
      if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
        events.push({
          name: d.name,
          startDate: d.startDate,
          endDate: d.endDate,
          url: d.url || null,
          venue: d.location?.name ?? null,
          address: d.location?.address ? [d.location.address.streetAddress, d.location.address.postalCode, d.location.address.addressLocality].filter(Boolean).join(', ') : null,
          lat: d.location?.geo?.latitude != null ? parseFloat(d.location.geo.latitude) : null,
          lng: d.location?.geo?.longitude != null ? parseFloat(d.location.geo.longitude) : null,
        });
      }
      // ItemList with events
      if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
        for (const li of d.itemListElement) {
          const ev = li.item ?? li;
          if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
            events.push({
              name: ev.name,
              startDate: ev.startDate,
              endDate: ev.endDate,
              url: ev.url || null,
              venue: ev.location?.name ?? null,
              address: ev.location?.address ? [ev.location.address.streetAddress, d.location.address.postalCode, ev.location.address.addressLocality].filter(Boolean).join(', ') : null,
              lat: ev.location?.geo?.latitude != null ? parseFloat(ev.location.geo.latitude) : null,
              lng: ev.location?.geo?.longitude != null ? parseFloat(ev.location.geo.longitude) : null,
            });
          }
        }
      }
    }
  }
  return events;
}

function extractMicrodataEvents(html) {
  const events = [];
  const $ = cheerio.load(html);
  $('[itemtype="https://schema.org/Event"], [itemtype*="schema.org/Event"]').each((_, el) => {
    const name = $(el).find('[itemprop="name"]').first().text().trim();
    const start = $(el).find('[itemprop="startDate"]').attr('datetime') || $(el).find('[itemprop="startDate"]').text().trim();
    const end = $(el).find('[itemprop="endDate"]').attr('datetime') || $(el).find('[itemprop="endDate"]').text().trim();
    const url = $(el).find('[itemprop="url"]').attr('href') || null;
    const venue = $(el).find('[itemprop="location"] [itemprop="name"]').first().text().trim() || null;
    if (name && start) {
      events.push({ name, startDate: start, endDate: end, url, venue, address: null, lat: null, lng: null });
    }
  });
  return events;
}

function extractHtmlEvents(html, sourceUrl) {
  const events = [];
  const $ = cheerio.load(html);
  // Pattern 1: <time datetime="..."> followed by nearby h1/h2/h3 with title
  $('time[datetime]').each((_, timeEl) => {
    const dt = $(timeEl).attr('datetime');
    if (!dt) return;
    const ts = new Date(dt).getTime();
    if (isNaN(ts)) return;
    // Walk up to container, then look for title
    const container = $(timeEl).closest('article, .event, .event-card, .event-item, [class*="event"], section, li, div')
      .first();
    const titleEl = container.find('h1, h2, h3, h4, .title, [class*="title"]').first();
    const title = titleEl.text().trim().slice(0, 200) || $(timeEl).parent().find('a').first().text().trim();
    if (!title || title.length < 3) return;
    const link = container.find('a').first().attr('href') || null;
    const fullUrl = link ? (link.startsWith('http') ? link : new URL(link, sourceUrl).href) : sourceUrl;
    events.push({
      name: title,
      startDate: dt,
      endDate: null,
      url: fullUrl,
      venue: null, address: null, lat: null, lng: null,
    });
  });
  return events;
}

function extractAllEvents(html, sourceUrl) {
  const jsonLd = extractJsonLdEvents(html);
  const microdata = extractMicrodataEvents(html);
  const htmlEvents = extractHtmlEvents(html, sourceUrl);
  // Dedup by (name, startDate) within this page
  const seen = new Set();
  const all = [];
  for (const ev of [...jsonLd, ...microdata, ...htmlEvents]) {
    const key = `${ev.name}|${ev.startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(ev);
  }
  return all;
}

async function processSource(source, args, sem) {
  const stats = { sitemapUrls: 0, eventUrls: 0, fetched: 0, persisted: 0, duplicates: 0, errors: 0 };
  const maxPer = args.maxPerSource;

  const allUrls = await fetchAllSitemapUrls(source.url);
  stats.sitemapUrls = allUrls.length;
  const eventUrls = filterEventUrls(allUrls).slice(0, maxPer);
  stats.eventUrls = eventUrls.length;

  // Parallel fetch of event URLs (sem-bounded)
  const pageResults = await Promise.all(eventUrls.map(async (u) => {
    await sem.acquire();
    try {
      const html = await fetchUrl(u, PER_REQUEST_TIMEOUT);
      if (!html) return { ok: false };
      const events = extractAllEvents(html, u);
      return { ok: true, url: u, events };
    } finally {
      sem.release();
    }
  }));

  const allEvents = [];
  for (const r of pageResults) {
    if (r.ok) {
      stats.fetched += r.events.length;
      allEvents.push(...r.events);
    } else {
      stats.errors++;
    }
  }

  if (allEvents.length === 0 || args.dryRun) {
    console.log(`  ${source.slug}: sitemap=${stats.sitemapUrls} events=${stats.eventUrls} fetched=${stats.fetched} errors=${stats.errors}`);
    return stats;
  }

  const now = Date.now();
  const future = allEvents.filter((e) => {
    if (!e.name || !e.startDate) return false;
    const ts = new Date(e.startDate).getTime();
    return !isNaN(ts) && ts > now;
  });

  const inserts = future.map((ev) => {
    const url = ev.url ?? eventUrls.find((u) => true);
    // 2026-10-05 — verklig geo från sitemap-event istället för Sergels-torg-fallback.
    const lat = (typeof ev.lat === 'number' && ev.lat !== 0) ? ev.lat : null;
    const lng = (typeof ev.lng === 'number' && ev.lng !== 0) ? ev.lng : null;
    return {
      source: source.slug,
      title_sv: ev.name,
      title_en: ev.name,
      start_time: ev.startDate,
      end_time: ev.endDate ?? null,
      location: (lat != null && lng != null) ? `POINT(${lng} ${lat})` : null,
      lat, lng,
      ticket_url: ev.url,
      status: 'published',
      featured: false,
      view_count: 0,
      // 2026-10-05 — verklig venue-data från JSON-LD eller HTML-heuristik.
      venue_full_name: ev.venue ?? null,
      venue_full_address: ev.address ?? null,
      venue_city: null,
      venue_lat: lat,
      venue_lng: lng,
      venue_url: null,
      venue_phone: null,
      raw_data: {
        venue: ev.venue, address: ev.address,
        fetched_via: 'sitemap',
        fetched_at: new Date().toISOString(),
      },
      confidence_score: 60,
      freshness_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      image_generation_status: 'pending',
      image_ai_generated: false,
      image_ai_optout: false,
      is_online: false,
      dedup_hash: dedupHash(ev.name, ev.startDate, source.slug),
    };
  });

  // Filter existing
  const hashes = inserts.map((r) => r.dedup_hash);
  const existing = new Set();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
    for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }
  let fresh = inserts.filter((r) => !existing.has(r.dedup_hash));
  stats.duplicates += inserts.length - fresh.length;

  // 2026-10-07 — dedupe INOM batchen. Annars ger Postgres
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" när två
  // rader i samma upsert-chunk har samma dedup_hash (t.ex. sthlmlist,
  // stockholmsmassan har ofta 2–3 events med identisk (title,start) från
  // multi-day-serier eller scrape-dubletter).
  const seenHash = new Map();
  for (const row of fresh) {
    if (!seenHash.has(row.dedup_hash)) seenHash.set(row.dedup_hash, row);
  }
  const dedupedCount = fresh.length - seenHash.size;
  if (dedupedCount > 0) {
    console.log(`  ${source.slug}: in-batch dedup removed ${dedupedCount} duplicate dedup_hash rows`);
  }
  fresh = Array.from(seenHash.values());

  for (let i = 0; i < fresh.length; i += 50) {
    const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + 50), { onConflict: 'dedup_hash' }).select('id');
    if (error) {
      console.error(`  ${source.slug}: upsert error ${error.message}`);
      continue;
    }
    stats.persisted += data?.length ?? 0;
  }

  console.log(`  ${source.slug}: sitemap=${stats.sitemapUrls} events=${stats.eventUrls} fetched=${stats.fetched} persisted=${stats.persisted} dupes=${stats.duplicates} errors=${stats.errors}`);
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxSources = parseInt((args.find((a) => a.startsWith('--max-sources=')) ?? '--max-sources=999').split('=')[1], 10);
  const maxPerSource = parseInt((args.find((a) => a.startsWith('--max-per-source=')) ?? '--max-per-source=30').split('=')[1], 10);
  const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

  // Load sources
  const sourceFiles = readdirSync('sources').filter((f) => SOURCE_FILE_PATTERN.test(f) && !f.startsWith('_'));
  const sources = [];
  const seen = new Set();
  for (const f of sourceFiles) {
    try {
      const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const d = JSON.parse(line);
        if (d.url && !seen.has(d.id) && d.id) {
          if (onlySlug && d.id !== onlySlug) continue;
          seen.add(d.id);
          sources.push({ slug: d.id, url: d.url });
          break;
        }
      }
    } catch {}
  }
  sources.sort((a, b) => a.slug.localeCompare(b.slug));
  const selected = sources.slice(0, maxSources);

  console.log(`Sitemap ingestion — ${selected.length} sources dryRun=${dryRun} concurrency=${CONCURRENCY}`);

  const totals = { sitemapUrls: 0, eventUrls: 0, fetched: 0, persisted: 0, duplicates: 0, errors: 0 };
  const sem = new Sem(CONCURRENCY);
  await Promise.all(selected.map(async (src) => {
    try {
      const stats = await processSource(src, { dryRun, maxPerSource }, sem);
      for (const k of Object.keys(totals)) totals[k] += stats[k];
    } catch (e) {
      console.error(`  ${src.slug}: FATAL ${e.message}`);
      totals.errors++;
    }
  }));

  console.log(`\n=== TOTAL ===`);
  console.log(`sitemap_urls=${totals.sitemapUrls} event_urls=${totals.eventUrls} fetched=${totals.fetched} persisted=${totals.persisted} duplicates=${totals.duplicates} errors=${totals.errors}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});