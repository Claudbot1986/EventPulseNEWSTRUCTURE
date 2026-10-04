/**
 * fb-discovery-engine.mjs — Facebook Events discovery engine.
 *
 * Systematically discovers Stockholm FB-event-organizer pages, tests each
 * against Apify, persists all events found. Maintains a "working pages"
 * registry so we can re-poll daily without re-testing dead pages.
 *
 * Usage:
 *   node scripts/fb-discovery-engine.mjs --test-all          # Test all 150 candidates
 *   node scripts/fb-discovery-engine.mjs --test-working      # Test only known-working pages
 *   node scripts/fb-discovery-engine.mjs --test-page=SLUG    # Test a single page
 *   node scripts/fb-discovery-engine.mjs --add-page=NAME    # Add a new candidate page
 *
 * Strategy (Fas 1D, 2026-10-04):
 *   1. Read candidate list from data/fb-pages-stockholm-candidates.jsonl
 *   2. Test each against Apify `unseenuser~fb-events`
 *   3. Persist any events found via direct upsert to Supabase
 *   4. Build/append to data/fb-pages-working.jsonl (proven-working pages)
 *   5. Cost: ~$0.005-0.05 per page test, ~$0.01 per page per daily re-poll
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTOR = process.env.APIFY_FB_ACTOR ?? 'unseenuser~fb-events';
const SOURCE_ID = 'fb-events-stockholm-apify';

if (!APIFY_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing APIFY_API_KEY or Supabase env');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const CANDIDATES_FILE = 'data/fb-pages-stockholm-candidates.jsonl';
const WORKING_FILE = 'data/fb-pages-working.jsonl';
const RESULTS_FILE = 'data/fb-discovery-results.jsonl';

const args = process.argv.slice(2);
const TEST_ALL = args.includes('--test-all');
const TEST_WORKING = args.includes('--test-working');
const TEST_PAGE = args.find(a => a.startsWith('--test-page='))?.split('=')[1];
const ADD_PAGE = args.find(a => a.startsWith('--add-page='))?.split('=')[1];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}

function eventInStockholm(ev) {
  const venue = ev.venue ?? {};
  const addr = typeof venue === 'object' ? (venue.address ?? venue.city ?? '') : '';
  const name = typeof venue === 'object' ? (venue.name ?? '') : '';
  // Trust the curated page list — they were selected as Stockholm-relevant
  return true;
}

function loadCandidates() {
  if (!existsSync(CANDIDATES_FILE)) return [];
  return readFileSync(CANDIDATES_FILE, 'utf8')
    .trim().split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function loadWorking() {
  if (!existsSync(WORKING_FILE)) return [];
  return readFileSync(WORKING_FILE, 'utf8')
    .trim().split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function saveWorking(page) {
  appendFileSync(WORKING_FILE, JSON.stringify(page) + '\n');
}

function logResult(result) {
  appendFileSync(RESULTS_FILE, JSON.stringify(result) + '\n');
}

// ─── Apify call ───────────────────────────────────────────────────────────────

async function callApifySinglePage(fbSlug, maxEvents = 50) {
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pageUrls: [`https://www.facebook.com/${fbSlug}`],
      maxEvents,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    // Detect budget exhaustion to short-circuit subsequent calls
    if (r.status === 403 && /monthly limit|usage limit|quota/i.test(text)) {
      throw new Error('BUDGET_EXHAUSTED');
    }
    return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 100)}`, events: [] };
  }
  const events = await r.json();
  return { ok: true, events: Array.isArray(events) ? events : [] };
}

// ─── Persist events ───────────────────────────────────────────────────────────

function apifyToRow(ev) {
  const nowIso = new Date().toISOString();

  // Apify `unseenuser~fb-events` returns fields like:
  // start_timestamp (epoch ms), start_utc (ISO string), start_time_formatted,
  // is_past (boolean), days_until_event, day_time_sentence
  // Not: startDate / utcStartDate
  let startTime = ev.start_utc ?? '';
  if (!startTime && ev.start_timestamp) {
    startTime = new Date(ev.start_timestamp).toISOString();
  }

  let endTime = ev.end_utc ?? '';
  if (!endTime && ev.end_timestamp) {
    endTime = new Date(ev.end_timestamp).toISOString();
  }

  const title = ev.name ?? 'Untitled';

  // Lat/lng are top-level on the actor output, not inside venue
  const lat = (typeof ev.latitude === 'number' && ev.latitude !== 0) ? ev.latitude : 59.3293;
  const lng = (typeof ev.longitude === 'number' && ev.longitude !== 0) ? ev.longitude : 18.0686;

  return {
    source: SOURCE_ID,
    source_id: ev.id ?? ev.url?.split('/').filter(Boolean).pop() ?? null,
    title_sv: title,
    title_en: title,
    description_sv: ev.description ?? null,
    description_en: ev.description ?? null,
    start_time: startTime,
    end_time: endTime || null,
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
    dedup_hash: buildDedupHash(title, startTime),
    confidence_score: 55,
    freshness_at: nowIso,
    last_seen_at: nowIso,
    published_at: nowIso,
    image_generation_status: 'pending',
    image_ai_generated: false,
    image_ai_optout: false,
    is_online: ev.is_online ?? false,
  };
}

async function persistEvents(allEvents) {
  const nowMs = Date.now();
  const future = allEvents.filter((e) => {
    if (e.is_past === true) return false;
    const startTs = e.start_timestamp ?? 0;
    if (startTs > nowMs) return true;
    if (e.start_utc && new Date(e.start_utc).getTime() > nowMs) return true;
    return false;
  });

  if (future.length === 0) return { inserted: 0, future: 0 };

  // Check existing
  const allHashes = future.map((e) => apifyToRow(e).dedup_hash);
  const existing = new Set();
  for (let i = 0; i < allHashes.length; i += 1000) {
    const slice = allHashes.slice(i, i + 1000);
    const { data } = await supabase.from('events').select('dedup_hash').in('dedup_hash', slice);
    for (const r of data ?? []) if (r.dedup_hash) existing.add(r.dedup_hash);
  }

  const rows = future.map(apifyToRow).filter((r) => !existing.has(r.dedup_hash));
  if (rows.length === 0) return { inserted: 0, future: future.length, dupes: future.length };

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { data, error } = await supabase.from('events').upsert(batch, { onConflict: 'dedup_hash' }).select('id');
    if (error) { console.error(`    persist error: ${error.message}`); continue; }
    inserted += data?.length ?? 0;
  }
  return { inserted, future: future.length, dupes: future.length - rows.length };
}

// ─── Main flows ───────────────────────────────────────────────────────────────

async function testPage(slug, name, category, venue, maxEvents = 30) {
  const start = Date.now();
  const result = await callApifySinglePage(slug, maxEvents);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const count = result.events.length;
  const nowMs = Date.now();
  const future = result.events.filter((e) => {
    if (e.is_past === true) return false;
    const startTs = e.start_timestamp ?? 0;
    if (startTs > nowMs) return true;
    if (e.start_utc && new Date(e.start_utc).getTime() > nowMs) return true;
    return false;
  });
  const futureCount = future.length;

  const logEntry = {
    ts: new Date().toISOString(),
    slug, name, category, venue,
    elapsed_s: parseFloat(elapsed),
    total_events: count,
    future_events: futureCount,
    ok: result.ok,
    error: result.error ?? null,
  };
  logResult(logEntry);

  if (result.ok && futureCount > 0) {
    const persist = await persistEvents(result.events);
    console.log(`  ✓ ${slug.padEnd(35)} ${count} events (${futureCount} future), ${elapsed}s — persisted ${persist.inserted} new`);
    saveWorking({
      slug, name, category, venue,
      lastEventCount: count,
      lastFutureCount: futureCount,
      lastTestedAt: new Date().toISOString(),
    });
    return { slug, ok: true, futureCount, persisted: persist.inserted };
  } else {
    console.log(`  ✗ ${slug.padEnd(35)} ${count} events, ${elapsed}s${result.error ? ` (${result.error.slice(0,40)})` : ''}`);
    return { slug, ok: false, futureCount: 0, persisted: 0 };
  }
}

async function testAll() {
  const candidates = loadCandidates();
  const alreadyWorking = new Set(loadWorking().map(w => w.slug));
  const toTest = candidates.filter(c => !alreadyWorking.has(c.fb));
  console.log(`=== Test all candidates ===`);
  console.log(`Total: ${candidates.length}, already working: ${alreadyWorking.size}, to test: ${toTest.length}\n`);

  // Run in parallel — 20 concurrent (Apify allows up to 32)
  const CONCURRENCY = 20;
  const queue = [...toTest];
  const results = [];
  let budgetExhausted = false;
  while (queue.length > 0 && !budgetExhausted) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(c =>
      testPage(c.fb, c.name, c.category, c.venue).catch((e) => {
        if (e.message === 'BUDGET_EXHAUSTED') {
          budgetExhausted = true;
          return { slug: c.fb, error: 'BUDGET_EXHAUSTED', futureCount: 0 };
        }
        return { slug: c.fb, error: e.message };
      })
    ));
    if (batchResults.some((r) => r.error === 'BUDGET_EXHAUSTED')) {
      budgetExhausted = true;
    }
    results.push(...batchResults);
  }
  if (budgetExhausted) {
    console.log(`\n  WARN: Apify budget exhausted — stopped after ${results.length} pages. Will resume when credits refill (1:a nästa månad).`);
  }

  // Summary
  const working = results.filter(r => r.futureCount > 0);
  const noEvents = results.filter(r => r.futureCount === 0);
  const totalFuture = working.reduce((sum, r) => sum + r.futureCount, 0);
  const totalPersisted = working.reduce((sum, r) => sum + r.persisted, 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Tested: ${results.length}`);
  console.log(`Working (events found): ${working.length}`);
  console.log(`No events: ${noEvents.length}`);
  console.log(`Total future events discovered: ${totalFuture}`);
  console.log(`Total new persisted: ${totalPersisted}`);
  console.log(`\nWorking pages:`);
  working.sort((a, b) => b.futureCount - a.futureCount);
  for (const w of working) {
    console.log(`  ${w.futureCount.toString().padStart(3)} ${w.slug}`);
  }

  // Get final cost
  const cost = await fetch('https://api.apify.com/v2/users/me/usage/monthly', {
    headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` }
  }).then(r => r.json()).then(d => {
    const total = Object.values(d.data?.monthlyServiceUsage ?? {}).reduce((s, x) => s + (x.amountAfterVolumeDiscountUsd ?? 0), 0);
    return total;
  });
  console.log(`\nApify cost this cycle: $${cost.toFixed(4)}`);
}

async function testWorkingPages() {
  const working = loadWorking();
  console.log(`=== Test ${working.length} working pages ===\n`);
  let totalEvents = 0;
  let totalPersisted = 0;
  for (const w of working) {
    const r = await testPage(w.slug, w.name, w.category, w.venue, 50);
    if (r.futureCount > 0) {
      totalEvents += r.futureCount;
      totalPersisted += r.persisted;
    }
  }
  console.log(`\nTotal future events: ${totalEvents}, new persisted: ${totalPersisted}`);
}

async function addPage(name, slug, category, venue) {
  const candidates = loadCandidates();
  if (candidates.find(c => c.fb === slug)) {
    console.log(`  ${slug} already in candidates`);
  } else {
    candidates.push({ category, name, fb: slug, venue });
    writeFileSync(CANDIDATES_FILE, candidates.map(c => JSON.stringify(c)).join('\n') + '\n');
    console.log(`  added ${slug} to candidates`);
  }
  return testPage(slug, name, category, venue);
}

async function main() {
  if (TEST_PAGE) {
    const candidates = loadCandidates();
    const c = candidates.find(c => c.fb === TEST_PAGE);
    if (!c) {
      console.error(`Unknown page: ${TEST_PAGE}`);
      process.exit(1);
    }
    await testPage(c.fb, c.name, c.category, c.venue, 50);
  } else if (ADD_PAGE) {
    const parts = ADD_PAGE.split('|');
    if (parts.length < 4) {
      console.error('Format: --add-page=NAME|SLUG|CATEGORY|VENUE');
      process.exit(1);
    }
    await addPage(...parts);
  } else if (TEST_WORKING) {
    await testWorkingPages();
  } else if (TEST_ALL) {
    await testAll();
  } else {
    console.log('Usage:');
    console.log('  --test-all              Test all candidate pages');
    console.log('  --test-working          Test only known-working pages');
    console.log('  --test-page=SLUG        Test a single page');
    console.log('  --add-page=NAME|SLUG|CAT|VENUE   Add a candidate and test it');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});