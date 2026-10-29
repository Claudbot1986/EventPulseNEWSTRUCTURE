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
import { parseSitemapXml, sitemapCandidates, filterEventUrls, selectEventUrls, buildCandidateUrls } from './lib/sitemapDiscovery.mjs';
import { extractAllEvents } from './lib/eventExtraction.mjs';

// ─── Config ──────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.SITEMAP_CONCURRENCY ?? '20', 10); // parallel workers
const RATE_LIMIT_MS = 1000;
const PER_REQUEST_TIMEOUT = 8000;
const SITEMAP_TIMEOUT = 8000;
const PER_PAGE_EVENT_LIMIT = 30; // cap per source
const SOURCE_FILE_PATTERN = /.*\.jsonl$/;

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
  // 2026-10-24 — abort-timern rensades FÖRE body-läsningen. En värd som
  // skickar headers och sedan står still i strömmen hängde därför hela
  // steget i det oändliga (mätt: en CloudFront-värd höll en etablerad
  // socket i 20+ minuter). Timern måste gälla tills texten är läst.
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0 (sitemap crawler)', Accept: '*/*' },
      signal: c.signal,
      redirect: 'follow',
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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

async function fetchAllSitemapUrls(baseUrl, maxDepth = 2) {
  const seen = new Set();
  const allUrls = new Map(); // url → lastmod
  const queue = sitemapCandidates(baseUrl);
  let depth = 0;
  // 2026-10-24 — gräns på hur många sitemap-FILER som läses per källa.
  // En sajt med sitemap-index kan ha hundratals sub-filer, och varje fil
  // kostar ett anrop + en sekunds rate-limit. Utan gräns ägde ett par
  // stora sajter hela steget. Detta är en resursgräns, inte ett urval.
  const MAX_FILES = 25;
  let filesRead = 0;
  while (queue.length > 0 && depth <= maxDepth && filesRead < MAX_FILES) {
    const nextBatch = [];
    for (const url of queue) {
      if (seen.has(url)) continue;
      if (filesRead >= MAX_FILES) break;
      seen.add(url);
      filesRead++;
      await sleep(RATE_LIMIT_MS);
      const xml = await fetchUrl(url);
      if (!xml) continue;
      const { urls, subSitemaps } = parseSitemapXml(xml);
      for (const u of urls) if (!allUrls.has(u.url)) allUrls.set(u.url, u.lastmod);
      for (const s of subSitemaps) nextBatch.push(s);
    }
    queue.length = 0;
    queue.push(...nextBatch);
    depth++;
  }
  return [...allUrls.entries()].map(([url, lastmod]) => ({ url, lastmod }));
}

async function processSource(source, args, sem) {
  const stats = { sitemapUrls: 0, eventUrls: 0, fetched: 0, future: 0, persisted: 0, duplicates: 0, errors: 0 };
  const maxPer = args.maxPerSource;

  const allUrls = await fetchAllSitemapUrls(source.url);
  stats.sitemapUrls = allUrls.length;
  const eventEntries = selectEventUrls(filterEventUrls(allUrls), maxPer);
  const sitemapEventUrls = eventEntries.map((e) => e.url);
  // 2026-10-24 — källans EGEN URL är också en kandidat (regeln ligger i
  // scripts/lib/sitemapDiscovery.mjs → buildCandidateUrls, så gaten S2 kan
  // testa samma kodväg som körningen använder).
  const eventUrls = buildCandidateUrls(source.url, sitemapEventUrls);
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
      // 2026-10-24 — sidan där eventet hittades följer med. Annars fick
      // ticket_url-fallbacken peka på källans FÖRSTA event-URL — en helt
      // orelaterad sida.
      for (const ev of r.events) allEvents.push({ ...ev, pageUrl: r.url });
    } else {
      stats.errors++;
    }
  }

  const now = Date.now();
  const future = allEvents.filter((e) => {
    if (!e.name || !e.startDate) return false;
    const ts = new Date(e.startDate).getTime();
    return !isNaN(ts) && ts > now;
  });

  stats.future = future.length;

  if (allEvents.length === 0 || args.dryRun) {
    // 2026-10-24 — dry-run-loggningen redovisade bara "fetched" (alla
    // extraherade events). Det säger ingenting om hur många som faktiskt
    // kan sparas — det är de FRAMTIDA som persisteras. Utan det gick det
    // inte att skilja "sidan gav inget" från "sidan gav bara förflutna
    // events" i loggen.
    console.log(`  ${source.slug}: sitemap=${stats.sitemapUrls} events=${stats.eventUrls} urls=${JSON.stringify(eventUrls.slice(0, 3))} fetched=${stats.fetched} future=${future.length} errors=${stats.errors}`);
    return stats;
  }

  const inserts = future.map((ev) => {
    const url = ev.url ?? ev.pageUrl ?? eventUrls[0];
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
      // 2026-10-29 — samma fallback som ingest-eventbrite-stockholm.mjs
      // ("T0201.4: category_slug-fallback 'community' för att undvika NULL i
      // DB"). Utan kategori får eventet ALDRIG en biblioteksbild:
      // pickLibraryFallback matchar på venue+category → category → kind →
      // default, och det finns inga bilder med NULL-kategori. 59 events som
      // skapades av det här steget 2026-10-29 stod därför kvar som
      // platshållare i appen trots att biblioteket var fullt.
      category_slug: 'community',
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

  console.log(`  ${source.slug}: sitemap=${stats.sitemapUrls} events=${stats.eventUrls} urls=${JSON.stringify(eventUrls.slice(0, 3))} fetched=${stats.fetched} future=${future.length} persisted=${stats.persisted} dupes=${stats.duplicates} errors=${stats.errors}`);
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

  const totals = { sitemapUrls: 0, eventUrls: 0, fetched: 0, future: 0, persisted: 0, duplicates: 0, errors: 0 };
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
  console.log(`sitemap_urls=${totals.sitemapUrls} event_urls=${totals.eventUrls} fetched=${totals.fetched} future=${totals.future} persisted=${totals.persisted} duplicates=${totals.duplicates} errors=${totals.errors}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});