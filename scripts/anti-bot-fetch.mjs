#!/usr/bin/env node
/**
 * anti-bot-fetch.mjs — Generic Scrapingbee-based fetcher with stealth mode.
 *
 * Auto-detects when direct HTTP fetch is blocked (DataDome, Cloudflare, etc.)
 * and falls back to Scrapingbee with escalating stealth levels.
 *
 * Modes:
 *  - direct: plain HTTP (cheapest)
 *  - render: Scrapingbee with JS rendering (handles most SPAs)
 *  - stealth: Scrapingbee with stealth proxy (handles DataDome/Cloudflare)
 *  - premium: Scrapingbee with premium proxy + stealth
 *
 * Detected by HTTP status codes: 403/503 + presence of DataDome/CF markers.
 *
 * Användning:
 *   node scripts/anti-bot-fetch.mjs --url=URL [--mode=auto]
 *   node scripts/anti-bot-fetch.mjs --url=URL --mode=stealth
 *   node scripts/anti-bot-fetch.mjs --slug=ra-stockholm --url=URL --persist
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
if (!SCRAPINGBEE) { console.error('Missing SCRAPINGBEE_API_KEY'); process.exit(2); }

const SB_PROXY_USER = process.env.SCRAPINGBEE_PROXY_USER;
const SB_PROXY_PASS = process.env.SCRAPINGBEE_PROXY_PASS;

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL_VAL && SUPABASE_KEY_VAL
  ? createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } })
  : null;

const ANTI_BOT_MARKERS = [
  'datadome', 'DataDome', 'x-dd-b', 'cf-ray', 'cloudflare',
  'access denied', 'forbidden', 'captcha', 'cf-chl-bypass',
  'please verify you are human', 'checking your browser',
];

function detectBlocked(html, status) {
  if (status === 403 || status === 503) return true;
  if (!html) return true;
  const lower = html.toLowerCase();
  for (const m of ANTI_BOT_MARKERS) {
    if (lower.includes(m.toLowerCase())) return true;
  }
  // Anti-bot pages are usually small (<10KB) and lack real content
  if (html.length < 3000 && status < 400) return true;
  return false;
}

async function fetchDirect(url, timeout = 8000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0 (research)', Accept: '*/*' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    const body = await r.text();
    return { status: r.status, body, headers: Object.fromEntries(r.headers) };
  } catch (e) {
    return { status: 0, body: '', error: e.message };
  }
}

async function fetchScrapingbee(url, mode = 'render', timeout = 60000) {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE,
    url,
    render_js: 'true',
    wait: '2000',
    timeout: String(timeout),
  });
  if (mode === 'stealth' || mode === 'premium') {
    params.set('stealth_proxy', 'true');
  }
  if (mode === 'premium') {
    params.set('premium_proxy', 'true');
  }
  try {
    const r = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
    const body = await r.text();
    return { status: r.status, body, mode: mode };
  } catch (e) {
    return { status: 0, body: '', error: e.message };
  }
}

export async function smartFetch(url, opts = {}) {
  const mode = opts.mode ?? 'auto';
  const log = opts.log ?? console.log;

  // Step 1: Always try direct first (free, fast)
  log(`  [direct] ${url}`);
  const direct = await fetchDirect(url);
  if (!detectBlocked(direct.body, direct.status)) {
    log(`    → OK (${direct.body.length} bytes, status ${direct.status})`);
    return { ...direct, modeUsed: 'direct' };
  }
  log(`    → blocked (status ${direct.status}, ${direct.body.length} bytes)`);

  // Step 2: Scrapingbee render (handles JS)
  log(`  [render] ${url}`);
  const render = await fetchScrapingbee(url, 'render');
  if (!detectBlocked(render.body, render.status)) {
    log(`    → OK (${render.body.length} bytes, status ${render.status})`);
    return { ...render, modeUsed: 'render' };
  }
  log(`    → still blocked (status ${render.status})`);

  // Step 3: Stealth proxy (handles DataDome, Cloudflare)
  log(`  [stealth] ${url}`);
  const stealth = await fetchScrapingbee(url, 'stealth');
  if (!detectBlocked(stealth.body, stealth.status)) {
    log(`    → OK (${stealth.body.length} bytes, status ${stealth.status})`);
    return { ...stealth, modeUsed: 'stealth' };
  }
  log(`    → still blocked (status ${stealth.status})`);

  // Step 4: Premium proxy
  log(`  [premium] ${url}`);
  const premium = await fetchScrapingbee(url, 'premium');
  log(`    → status ${premium.status}, ${premium.body.length} bytes`);
  return { ...premium, modeUsed: 'premium' };
}

// ─── CLI mode ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('--url='))?.split('=')[1];
  const slug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
  const persist = args.includes('--persist');
  const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'auto';

  if (!url) {
    console.error('Usage: --url=URL [--slug=NAME] [--mode=auto|render|stealth|premium] [--persist]');
    process.exit(2);
  }

  const result = await smartFetch(url, { mode });

  console.log('\n=== RESULT ===');
  console.log(`mode: ${result.modeUsed}`);
  console.log(`status: ${result.status}`);
  console.log(`body: ${result.body.length} bytes`);
  console.log(`first 500 chars: ${result.body.slice(0, 500)}`);

  if (persist && slug && supabase) {
    const events = extractEventsFromBody(result.body, slug, url);
    if (events.length > 0) {
      const rows = events.map((ev) => ({
        source: slug,
        title_sv: ev.name,
        title_en: ev.name,
        start_time: ev.startDate,
        end_time: ev.endDate ?? null,
        // 2026-10-05 — verklig venue-data från HTML-extraction istället för
        // Sergels-torg-fallback. lat/lng null om inte ev.lat/ev.lng kommer
        // från källan — backfill-jobb slår upp koordinater från venues.
        location: (ev.lat != null && ev.lng != null) ? `POINT(${ev.lng} ${ev.lat})` : null,
        lat: ev.lat ?? null,
        lng: ev.lng ?? null,
        ticket_url: ev.url,
        status: 'published', featured: false, view_count: 0,
        // 2026-10-05 — verklig venue-data från HTML-heuristik. venue_full_name
        // och venue_full_address kommer från ev.venue/ev.address.
        venue_full_name: ev.venue ?? null,
        venue_full_address: ev.address ?? null,
        venue_city: null,
        venue_lat: ev.lat ?? null,
        venue_lng: ev.lng ?? null,
        venue_url: null,
        venue_phone: null,
        raw_data: { venue: ev.venue, address: ev.address, fetched_at: new Date().toISOString(), mode: result.modeUsed },
        confidence_score: 70,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        dedup_hash: createHash('sha256').update(`${slug}::${ev.name}::${ev.startDate}`).digest('hex'),
      }));
      const { error: dbErr } = await supabase.from('events').upsert(rows, { onConflict: 'dedup_hash' });
      if (dbErr) console.error('DB error:', dbErr.message);
      else console.log(`Persisted ${rows.length} events`);
    } else {
      console.log('No events extracted from body');
    }
  }
}

function extractEventsFromBody(body, sourceId, sourceUrl) {
  const events = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
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
            lat: d.location?.geo?.latitude != null ? parseFloat(d.location.geo.latitude) : null,
            lng: d.location?.geo?.longitude != null ? parseFloat(d.location.geo.longitude) : null,
          });
        }
        if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
          for (const li of d.itemListElement) {
            const ev = li.item ?? li;
            if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
              events.push({
                name: ev.name,
                startDate: ev.startDate,
                endDate: ev.endDate,
                url: ev.url ?? ev['@id'] ?? null,
                venue: ev.location?.name ?? null,
                address: ev.location?.address ? [ev.location.address.streetAddress, ev.location.address.postalCode, ev.location.address.addressLocality].filter(Boolean).join(', ') : null,
                lat: ev.location?.geo?.latitude != null ? parseFloat(ev.location.geo.latitude) : null,
                lng: ev.location?.geo?.longitude != null ? parseFloat(ev.location.geo.longitude) : null,
              });
            }
          }
        }
      }
    } catch {}
  }
  return events;
}

// Re-export for use in other scripts
export { extractEventsFromBody };

// Run CLI if invoked directly
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || path.basename(process.argv[1]) === 'anti-bot-fetch.mjs') {
  main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
}