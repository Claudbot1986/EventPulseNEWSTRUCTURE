/**
 * persist-remaining-fb-events.mjs — One-shot persistence of new FB working pages.
 *
 * Används efter en stor discovery-sweep för att faktiskt persistera events
 * från nya working pages (som tidigare hade en bugg där de inte sparades).
 *
 * Run: node scripts/persist-remaining-fb-events.mjs
 */

import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Env loaded via Node's --env-file=.env (Node 20.6+)

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTOR = 'unseenuser~fb-events';
const APIFY_API_KEY_VAL = process.env.APIFY_API_KEY;
const SOURCE_ID = 'fb-events-stockholm-apify';

if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL || !APIFY_API_KEY_VAL) {
  console.error('Missing env vars');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

// Load all unique working pages from data/fb-pages-working.jsonl
const working = readFileSync('data/fb-pages-working.jsonl', 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const slugSet = new Set();
for (const w of working) slugSet.add(w.slug);

function dedup(t, s) {
  return createHash('sha256').update(`${SOURCE_ID}::${t}::${s}`).digest('hex');
}

async function processSlug(slug) {
  const start = Date.now();
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${APIFY_API_KEY_VAL}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageUrls: [`https://www.facebook.com/${slug}`],
        onlyUpcoming: true,
        maxResults: 100,
      }),
    });
    if (!r.ok) return { slug, ok: false, error: `HTTP ${r.status}` };

    const events = await r.json();
    const nowMs = Date.now();
    const future = events.filter((e) => {
      if (e.is_past === true) return false;
      if (e.is_canceled === true) return false;
      const startMs = (e.start_timestamp ?? 0) * 1000;
      return startMs > nowMs || (e.start_utc && new Date(e.start_utc).getTime() > nowMs);
    });

    const rows = future.map((ev) => {
      const lat = (typeof ev.latitude === 'number' && ev.latitude !== 0) ? ev.latitude : 59.3293;
      const lng = (typeof ev.longitude === 'number' && ev.longitude !== 0) ? ev.longitude : 18.0686;
      const startTime = ev.start_utc ?? (ev.start_timestamp ? new Date(ev.start_timestamp * 1000).toISOString() : '');
      return {
        source: SOURCE_ID,
        source_id: String(ev.id ?? ev.url?.split('/').filter(Boolean).pop() ?? ''),
        title_sv: ev.name ?? 'Untitled',
        title_en: ev.name ?? 'Untitled',
        description_sv: ev.description ?? null,
        description_en: ev.description ?? null,
        start_time: startTime,
        end_time: ev.end_utc ?? (ev.end_timestamp ? new Date(ev.end_timestamp * 1000).toISOString() : null),
        venue_id: null,
        organizer_id: null,
        location: `POINT(${lng} ${lat})`,
        lat,
        lng,
        is_free: false,
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: ev.ticket_url ?? ev.url ?? null,
        image_url: ev.cover_photo_url ?? null,
        status: 'published',
        featured: false,
        view_count: ev.attendance_count ?? 0,
        raw_data: null,
        dedup_hash: dedup(ev.name ?? 'Untitled', startTime),
        confidence_score: 55,
        freshness_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        image_generation_status: 'pending',
        image_ai_generated: false,
        image_ai_optout: false,
        is_online: ev.is_online ?? false,
      };
    });

    const hashes = rows.map((r) => r.dedup_hash);
    const existing = new Set();
    for (let i = 0; i < hashes.length; i += 1000) {
      const { data } = await supabase.from('events').select('dedup_hash').in('dedup_hash', hashes.slice(i, i + 1000));
      for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
    }
    const fresh = rows.filter((r) => !existing.has(r.dedup_hash));

    let inserted = 0;
    for (let i = 0; i < fresh.length; i += 50) {
      const batch = fresh.slice(i, i + 50);
      const { data, error } = await supabase.from('events').upsert(batch, { onConflict: 'dedup_hash' }).select('id');
      if (error) continue;
      inserted += data?.length ?? 0;
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return { slug, future: future.length, inserted, elapsed };
  } catch (e) {
    return { slug, ok: false, error: e.message };
  }
}

async function main() {
  const slugs = [...slugSet];

  // Sort: highest future-count first so we get the most value before any timeout
  const futureBySlug = new Map();
  try {
    const lines = readFileSync('data/fb-discovery-results.jsonl', 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.future_events > 0 && slugs.includes(d.slug)) {
          const prev = futureBySlug.get(d.slug) ?? 0;
          if (d.future_events > prev) futureBySlug.set(d.slug, d.future_events);
        }
      } catch {}
    }
  } catch {}
  slugs.sort((a, b) => (futureBySlug.get(b) ?? 0) - (futureBySlug.get(a) ?? 0));

  console.log(`Processing ${slugs.length} pages with concurrency 8...`);
  console.log(`Top 5 expected yields: ${[...futureBySlug.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>`${s}=${c}`).join(', ')}`);
  const queue = [...slugs];
  const CONCURRENCY = 8;
  const results = [];
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processSlug));
    results.push(...batchResults);
    const last = batchResults[batchResults.length - 1];
    console.log(`  done ${results.length}/${slugs.length}: latest ${last.slug} future=${last.future} inserted=${last.inserted} (${last.elapsed}s)`);
  }

  const totalFuture = results.reduce((s, r) => s + (r.future ?? 0), 0);
  const totalInserted = results.reduce((s, r) => s + (r.inserted ?? 0), 0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total future: ${totalFuture}, total inserted: ${totalInserted}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});