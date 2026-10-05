#!/usr/bin/env node
/**
 * ingest-direct-jsonld.mjs — Generic fetcher för källor med JSON-LD på landing-sidan.
 *
 * Till skillnad från sitemap-discovery som kräver URL-patterns i sitemap,
 * extraherar denna direkt JSON-LD events från source-filen URL.
 *
 * Användning:
 *   node scripts/ingest-direct-jsonld.mjs                    # alla 196+ sources
 *   node scripts/ingest-direct-jsonld.mjs --slug=dansenshus  # en source
 *   node scripts/ingest-direct-jsonld.mjs --dry-run
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';

const CONCURRENCY = parseInt(process.env.JSONLD_CONCURRENCY ?? '10', 10);
const PER_REQUEST_TIMEOUT = 12000;

const SUB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUB || !SK) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUB, SK, { auth: { persistSession: false } });

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}

class Sem {
  constructor(n) { this.n = n; this.q = []; this.waiters = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const next = this.waiters.shift(); if (next) next(); else this.n++; }
}

async function fetchHtml(url, timeout = PER_REQUEST_TIMEOUT) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0 (events discovery)', Accept: 'text/html' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function extractJsonLd(html) {
  const events = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        // Direct Event
        if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
          events.push(extractEvent(d));
        }
        // ItemList with nested Events (Luma, etc.)
        if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
          for (const li of d.itemListElement) {
            const ev = li.item ?? li;
            if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
              events.push(extractEvent(ev));
            }
          }
        }
      }
    } catch {}
  }
  return events;
}

function extractEvent(d) {
  const loc = d.location || {};
  const addr = loc.address || {};
  const address = [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ') || null;
  return {
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate || null,
    url: d.url || null,
    venue: loc.name || null,
    address,
    lat: loc.geo?.latitude != null ? parseFloat(loc.geo.latitude) : null,
    lng: loc.geo?.longitude != null ? parseFloat(loc.geo.longitude) : null,
    description: d.description?.slice(0, 500) || null,
  };
}

async function processSource(src, sem) {
  await sem.acquire();
  try {
    const html = await fetchHtml(src.url);
    if (!html) return { slug: src.slug, error: 'fetch failed' };

    const events = extractJsonLd(html);
    const now = Date.now();
    const future = events.filter((e) => {
      if (!e.name || !e.startDate) return false;
      const ts = new Date(e.startDate).getTime();
      return !isNaN(ts) && ts > now;
    });

    if (future.length === 0) {
      return { slug: src.slug, error: 'no future events', fetched: events.length };
    }

    const inserts = future.map((ev) => {
      // 2026-10-05 — null istället för Sergels-torg-fallback om lat/lng
      // saknas. Verklig venue-data sparas för backfill-jobb.
      const hasCoord = typeof ev.lat === 'number' && ev.lat !== 0
                    && typeof ev.lng === 'number' && ev.lng !== 0;
      const lat = hasCoord ? ev.lat : null;
      const lng = hasCoord ? ev.lng : null;
      return {
        source: src.slug,
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
        description_sv: ev.description,
        description_en: ev.description,
        status: 'published', featured: false, view_count: 0,
        raw_data: { venue: ev.venue, address: ev.address, fetched_via: 'direct-jsonld', fetched_at: new Date().toISOString() },
        confidence_score: 70,
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
      if (error) {
        console.error(`  ${src.slug}: upsert error ${error.message}`);
        continue;
      }
    }

    return {
      slug: src.slug,
      fetched: events.length,
      future: future.length,
      persisted: fresh.length,
      duplicates: dups,
    };
  } finally {
    sem.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

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

  console.log(`Direct JSON-LD ingestion — ${sources.length} sources dryRun=${dryRun} concurrency=${CONCURRENCY}`);

  const totals = { fetched: 0, future: 0, persisted: 0, duplicates: 0, errors: 0 };
  const sem = new Sem(CONCURRENCY);

  const promises = sources.map(async (src) => {
    try {
      const r = await processSource(src, sem);
      if (r.error) {
        console.log(`  ${r.slug}: ${r.error}${r.fetched !== undefined ? ` (fetched=${r.fetched})` : ''}`);
        totals.errors++;
      } else {
        console.log(`  ${r.slug}: fetched=${r.fetched} future=${r.future} persisted=${r.persisted} dupes=${r.duplicates}`);
        totals.fetched += r.fetched;
        totals.future += r.future;
        totals.persisted += r.persisted;
        totals.duplicates += r.duplicates;
      }
    } catch (e) {
      console.error(`  ${src.slug}: FATAL ${e.message}`);
      totals.errors++;
    }
  });

  await Promise.all(promises);

  console.log(`\n=== TOTAL ===`);
  console.log(`fetched=${totals.fetched} future=${totals.future} persisted=${totals.persisted} duplicates=${totals.duplicates} errors=${totals.errors}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });