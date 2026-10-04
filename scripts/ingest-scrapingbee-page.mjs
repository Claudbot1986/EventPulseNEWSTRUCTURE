#!/usr/bin/env node
/**
 * ingest-scrapingbee-page.mjs — Generic Scrapingbee-rendered page fetcher.
 *
 * Används för JS-renderade sidor där vi inte hittar hidden APIs. Först testar vi
 * alltid `discover-hidden-apis.mjs` — om hidden API hittas använd den istället
 * (gratis). Scrapingbee är fallback: kostar credits.
 *
 * Förväntade targets: kulturhuset (JS-rendered event listings), stockholm-jazz,
 * andra single-page-applikationer.
 *
 * Användning:
 *   node scripts/ingest-scrapingbee-page.mjs --slug=kulturhuset --url=https://kulturhuset.se/evenemang/ --pages=5
 *   node scripts/ingest-scrapingbee-page.mjs --slug=kulturhuset --render-only
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SCRAPINGBEE = process.env.SCRAPINGBEE_API_KEY;
const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SCRAPINGBEE) { console.error('Missing SCRAPINGBEE_API_KEY'); process.exit(2); }
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing Supabase env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function render(url) {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE,
    url,
    render_js: 'true',
    wait: '2000',
    timeout: '30000',
  });
  const r = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
    method: 'GET',
  });
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, error: txt.slice(0, 200) };
  }
  return { ok: true, html: await r.text() };
}

function extractEventsFromHtml(html, slug) {
  const events = [];
  // Try JSON-LD first
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        const items = d['@type'] === 'ItemList' && d.itemListElement ? d.itemListElement : [];
        for (const li of items) {
          const ev = li.item ?? li;
          if (!ev || ev['@type'] !== 'Event') continue;
          events.push({
            name: ev.name,
            startDate: ev.startDate,
            endDate: ev.endDate,
            url: ev.url,
            image: typeof ev.image === 'string' ? ev.image : Array.isArray(ev.image) ? ev.image[0] : null,
            venue: ev.location?.name ?? null,
            address: ev.location?.address ? [ev.location.address.streetAddress, ev.location.address.postalCode, ev.location.address.addressLocality].filter(Boolean).join(', ') : null,
            lat: ev.location?.geo?.latitude != null ? parseFloat(ev.location.geo.latitude) : null,
            lng: ev.location?.geo?.longitude != null ? parseFloat(ev.location.geo.longitude) : null,
          });
        }
      }
    } catch {}
  }

  // Fallback: schema.org Event microdata
  if (events.length === 0) {
    const itemRegex = /<[^>]+itemtype=["'][^"']*schema\.org\/Event["'][^>]*>([\s\S]*?)<\/[^>]+itemtype=["'][^"']*schema\.org\/Event["']/gi;
    let im;
    while ((im = itemRegex.exec(html)) !== null) {
      const block = im[1];
      const name = (block.match(/itemprop=["']name["'][^>]*>([^<]+)</i) || [])[1];
      const start = (block.match(/itemprop=["']startDate["'][^>]*\s+datetime=["']([^"']+)["']/i) || block.match(/datetime=["']([^"']+)["'][^>]*itemprop=["']startDate["']/i) || [])[1];
      const url = (block.match(/itemprop=["']url["'][^>]*\s+href=["']([^"']+)["']/i) || [])[1];
      if (name && start) {
        events.push({
          name: name.trim(),
          startDate: start,
          endDate: null,
          url: url ?? null,
          image: null,
          venue: null,
          address: null,
          lat: null,
          lng: null,
        });
      }
    }
  }

  return events;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
  const baseUrl = args.find((a) => a.startsWith('--url='))?.split('=')[1];
  const pages = parseInt((args.find((a) => a.startsWith('--pages=')) ?? '--pages=5').split('=')[1], 10);
  const renderOnly = args.includes('--render-only');
  const dryRun = args.includes('--dry-run');

  if (!slug || !baseUrl) {
    console.error('Usage: --slug=NAME --url=BASE_URL [--pages=N] [--render-only] [--dry-run]');
    process.exit(2);
  }

  console.log(`Scrapingbee ingestion — slug=${slug} base=${baseUrl} pages=${pages}`);

  let totalEvents = 0;
  let totalPersisted = 0;
  let totalCredits = 0;

  for (let p = 1; p <= pages; p++) {
    // Try common pagination URL patterns
    const candidates = [
      `${baseUrl}?page=${p}`,
      `${baseUrl}page/${p}/`,
      `${baseUrl}?p=${p}`,
      `${baseUrl}&page=${p}`,
    ];

    let rendered = null;
    let pageUrl = baseUrl;
    for (const u of candidates) {
      await sleep(1000);
      const r = await render(u);
      totalCredits += 1; // each render attempt = 1 credit minimum (premium)
      if (r.ok) {
        rendered = r.html;
        pageUrl = u;
        break;
      }
    }
    if (!rendered) {
      console.error(`  page ${p}: all pagination patterns failed`);
      continue;
    }
    if (renderOnly) {
      const fs = require('fs');
      fs.writeFileSync(`runtime/${slug}-page-${p}.html`, rendered);
      console.log(`  page ${p}: rendered → runtime/${slug}-page-${p}.html`);
      continue;
    }

    const events = extractEventsFromHtml(rendered, slug);
    const now = Date.now();
    const future = events.filter((e) => {
      const ts = new Date(e.startDate).getTime();
      return !isNaN(ts) && ts > now;
    });
    totalEvents += future.length;
    console.log(`  page ${p} (${pageUrl}): future=${future.length}/${events.length}`);

    if (dryRun || future.length === 0) continue;

    // Persist
    const rows = future.map((ev) => {
      const lat = (typeof ev.lat === 'number' && ev.lat !== 0) ? ev.lat : 59.3293;
      const lng = (typeof ev.lng === 'number' && ev.lng !== 0) ? ev.lng : 18.0686;
      return {
        source: slug,
        title_sv: ev.name,
        title_en: ev.name,
        start_time: ev.startDate,
        end_time: ev.endDate ?? null,
        location: `POINT(${lng} ${lat})`,
        lat, lng,
        ticket_url: ev.url,
        image_url: ev.image,
        status: 'published',
        featured: false,
        view_count: 0,
        raw_data: {
          venue: ev.venue, address: ev.address,
          fetched_at: new Date().toISOString(),
        },
        confidence_score: 65, // Scrapingbee = JS-rendered = lower confidence than API
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: false,
        dedup_hash: dedupHash(ev.name, ev.startDate, slug),
      };
    });

    const hashes = rows.map((r) => r.dedup_hash);
    const existing = new Set();
    for (let i = 0; i < hashes.length; i += 500) {
      const { data: ed } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 500));
      for (const r of ed ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
    }
    const fresh = rows.filter((r) => !existing.has(r.dedup_hash));

    for (let i = 0; i < fresh.length; i += 50) {
      const { data, error } = await supabase.from('events').upsert(fresh.slice(i, i + 50), { onConflict: 'dedup_hash' }).select('id');
      if (error) continue;
      totalPersisted += data?.length ?? 0;
    }
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`events=${totalEvents} persisted=${totalPersisted} credits_used=${totalCredits} (est.)`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});