/**
 * fb-discovery-engine.mjs — Facebook Events discovery engine (v2, smart caching).
 *
 * Forbättrad 2026-10-04 för kostnadseffektivitet:
 *   1. onlyUpcoming: true → Apify returnerar bara framtida events
 *   2. Per-page high-water-mark (senaste kända event-ID set)
 *   3. Skip-sla kolde pages: om senaste N körningarna gav 0 nya events → skippa
 *   4. Hot/warm/cold buckets baserat på update-frequency
 *   5. Budget grace-fail när Apify-kredit slut
 *
 * Användning:
 *   node scripts/fb-discovery-engine.mjs --test-all          # Test all candidates
 *   node scripts/fb-discovery-engine.mjs --test-working      # Test known-working
 *   node scripts/fb-discovery-engine.mjs --test-page=SLUG    # Test single page
 *   node scripts/fb-discovery-engine.mjs --force              # Skip skip-on-no-change
 *   node scripts/fb-discovery-engine.mjs --stats              # Show per-page stats
 *
 * Cost-optimal: kör --test-working dagligen — pages med 0 nya events
 * 3 dagar i rad markeras som cold och hoppas automatiskt.
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
const STATS_FILE = 'data/fb-page-stats.jsonl';

// Tunable thresholds
const COLD_THRESHOLD = 3; // 3 consecutive runs with 0 new events → mark cold
const WARM_THRESHOLD = 1; // 1+ new event in last 3 runs → warm
const COLD_SKIP_DAYS = 7; // Cold pages re-tested once per week
const WARM_SKIP_DAYS = 3; // Warm pages re-tested every 3 days
const HOT_SKIP_DAYS = 1;   // Hot pages re-tested daily

const args = process.argv.slice(2);
const TEST_ALL = args.includes('--test-all');
const TEST_WORKING = args.includes('--test-working');
const TEST_PAGE = args.find(a => a.startsWith('--test-page='))?.split('=')[1];
const ADD_PAGE = args.find(a => a.startsWith('--add-page='))?.split('=')[1];
const SHOW_STATS = args.includes('--stats');
const FORCE = args.includes('--force');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}

function loadCandidates() {
  if (!existsSync(CANDIDATES_FILE)) return [];
  return readFileSync(CANDIDATES_FILE, 'utf8').trim().split('\n')
    .filter(l => l.trim()).map(l => JSON.parse(l));
}

function loadWorking() {
  if (!existsSync(WORKING_FILE)) return [];
  return readFileSync(WORKING_FILE, 'utf8').trim().split('\n')
    .filter(l => l.trim()).map(l => JSON.parse(l));
}

function saveWorking(page) {
  appendFileSync(WORKING_FILE, JSON.stringify(page) + '\n');
}

function loadStats() {
  if (!existsSync(STATS_FILE)) return {};
  const lines = readFileSync(STATS_FILE, 'utf8').trim().split('\n').filter(l => l.trim());
  const stats = {};
  for (const l of lines) {
    try {
      const d = JSON.parse(l);
      stats[d.slug] = d;
    } catch {}
  }
  return stats;
}

function saveStat(stat) {
  appendFileSync(STATS_FILE, JSON.stringify(stat) + '\n');
}

function logResult(result) {
  appendFileSync(RESULTS_FILE, JSON.stringify(result) + '\n');
}

// Decide if a page should be tested this run
function shouldTestPage(slug, stats, force = false) {
  if (force) return { should: true, reason: 'force' };
  const s = stats[slug];
  if (!s) return { should: true, reason: 'no history' };
  if (s.consecutiveNoChange >= COLD_THRESHOLD) {
    const lastTestedMs = new Date(s.lastTestedAt).getTime();
    const daysSince = (Date.now() - lastTestedMs) / (1000 * 60 * 60 * 24);
    if (daysSince >= COLD_SKIP_DAYS) return { should: true, reason: 'cold reset' };
    return { should: false, reason: `cold (last ${daysSince.toFixed(1)}d ago, will retry at ${COLD_SKIP_DAYS}d)` };
  }
  if (s.consecutiveNoChange >= 1 && s.lastNewEvents) {
    const lastTestedMs = new Date(s.lastTestedAt).getTime();
    const daysSince = (Date.now() - lastTestedMs) / (1000 * 60 * 60 * 24);
    if (daysSince >= WARM_SKIP_DAYS) return { should: true, reason: 'warm reset' };
    return { should: false, reason: `warm (last ${daysSince.toFixed(1)}d ago)` };
  }
  // Hot (recently had new): always test
  return { should: true, reason: 'hot' };
}

// ─── Apify call ───────────────────────────────────────────────────────────────

async function callApifySinglePage(fbSlug, onlyUpcoming = true) {
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pageUrls: [`https://www.facebook.com/${fbSlug}`],
      onlyUpcoming,
      maxResults: 100,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
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
  let startTime = ev.start_utc ?? '';
  if (!startTime && ev.start_timestamp) {
    startTime = new Date(ev.start_timestamp).toISOString();
  }
  let endTime = ev.end_utc ?? '';
  if (!endTime && ev.end_timestamp) {
    endTime = new Date(ev.end_timestamp).toISOString();
  }
  const title = ev.name ?? 'Untitled';
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
    return startTs > nowMs;
  });

  if (future.length === 0) return { inserted: 0, future: 0 };

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
    if (error) continue;
    inserted += data?.length ?? 0;
  }
  return { inserted, future: future.length, dupes: future.length - rows.length };
}

// Cancellation detection:
// 1. Mark events that come back with is_canceled=true as status='cancelled'
// 2. Mark events that were in seen set but missing from latest fetch (and still future) as cancelled
// 3. Events whose start_time is now in the past are NOT marked — they pass naturally, filtered by events_public
async function detectCancellations(slug, latestEvents) {
  const stats = loadStats();
  const prevStat = stats[slug];
  if (!prevStat?.seenIds || prevStat.seenIds.length === 0) {
    return { cancelled: 0, removed: 0 };
  }

  const nowMs = Date.now();
  const latestIds = new Set();
  const cancelledIds = new Set();

  for (const e of latestEvents) {
    const id = e.id ?? e.url?.split('/').filter(Boolean).pop();
    if (!id) continue;
    latestIds.add(id);
    if (e.is_canceled === true) cancelledIds.add(id);
  }

  // Events we previously saw but are NOT in latest fetch
  const missingIds = prevStat.seenIds.filter((id) => !latestIds.has(id));

  let cancelled = cancelledIds.size;
  const removedIds = [];

  for (const id of missingIds) {
    // Find this event in our DB to check its start_time
    const { data: rows } = await supabase
      .from('events')
      .select('id, start_time, status')
      .eq('source', SOURCE_ID)
      .eq('source_id', String(id))
      .limit(1);

    if (!rows || rows.length === 0) continue;
    const row = rows[0];
    if (row.status === 'cancelled') continue; // already cancelled

    const startMs = new Date(row.start_time).getTime();
    if (startMs > nowMs) {
      // Future event that's missing from FB → mark as cancelled
      removedIds.push(row.id);
      cancelled++;
    }
    // Past events: leave alone, they're filtered out by events_public naturally
  }

  // Apply cancellations to DB
  if (removedIds.length > 0) {
    for (let i = 0; i < removedIds.length; i += 100) {
      const batch = removedIds.slice(i, i + 100);
      await supabase.from('events').update({ status: 'cancelled' }).in('id', batch);
    }
  }

  return { cancelled, removed: removedIds.length };
}

// ─── Main flows ───────────────────────────────────────────────────────────────

async function testPage(slug, name, category, venue, force = false) {
  const stats = loadStats();
  const should = shouldTestPage(slug, stats, force);
  if (!should.should) {
    console.log(`  ⏭  ${slug.padEnd(35)} skipped (${should.reason})`);
    return { slug, ok: true, futureCount: 0, persisted: 0, skipped: true };
  }

  const start = Date.now();
  let result;
  try {
    result = await callApifySinglePage(slug, true); // onlyUpcoming=true
  } catch (e) {
    if (e.message === 'BUDGET_EXHAUSTED') throw e;
    result = { ok: false, error: e.message, events: [] };
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const count = result.events.length;

  const nowMs = Date.now();
  const future = result.events.filter((e) => {
    if (e.is_past === true) return false;
    const startTs = e.start_timestamp ?? 0;
    return startTs > nowMs;
  });
  const futureCount = future.length;

  // Track which event IDs are new vs known
  const prevStat = stats[slug] ?? {};
  const prevIds = new Set(prevStat.seenIds ?? []);
  const newEventIds = future
    .map((e) => e.id ?? e.url?.split('/').filter(Boolean).pop())
    .filter((id) => id && !prevIds.has(id));
  const newCount = newEventIds.length;

  const logEntry = {
    ts: new Date().toISOString(),
    slug, name, category, venue,
    elapsed_s: parseFloat(elapsed),
    total_events: count,
    future_events: futureCount,
    new_events: newCount,
    onlyUpcoming: true,
    ok: result.ok,
    error: result.error ?? null,
    skipped_reason: should.reason,
  };
  logResult(logEntry);

  // Update stats
  const newStat = {
    slug,
    lastTestedAt: new Date().toISOString(),
    lastTotalEvents: count,
    lastFutureCount: futureCount,
    lastNewEvents: newCount,
    consecutiveNoChange: newCount === 0 ? (prevStat.consecutiveNoChange ?? 0) + 1 : 0,
    seenIds: [...prevIds, ...newEventIds].slice(-200), // cap memory
    tier: newCount === 0
      ? (prevStat.tier ?? 'cold')
      : (prevStat.tier === 'cold' || !prevStat.tier) ? 'warm' : 'hot',
  };
  saveStat(newStat);

  if (result.ok && futureCount > 0) {
    if (newCount > 0) {
      const persist = await persistEvents(result.events);
      console.log(`  ✓ ${slug.padEnd(35)} ${count} events (${futureCount} future, ${newCount} NEW), ${elapsed}s — persisted ${persist.inserted}`);
    } else {
      console.log(`  ↻ ${slug.padEnd(35)} ${count} events (${futureCount} future, 0 new), ${elapsed}s — no DB write needed`);
    }

    // Cancellation detection: mark events that disappeared or are marked cancelled
    let cancellationInfo = { cancelled: 0, removed: 0 };
    try {
      cancellationInfo = await detectCancellations(slug, result.events);
      if (cancellationInfo.cancelled > 0) {
        console.log(`    ⚠  cancelled: ${cancellationInfo.cancelled} (${cancellationInfo.removed} removed from FB)`);
      }
    } catch (e) {
      console.log(`    warn: cancellation detection failed: ${e.message}`);
    }

    saveWorking({
      slug, name, category, venue,
      lastEventCount: count,
      lastFutureCount: futureCount,
      lastNewEvents: newCount,
      lastTestedAt: new Date().toISOString(),
      tier: newStat.tier,
    });
    return { slug, ok: true, futureCount, newCount, persisted: newCount > 0 ? futureCount - prevIds.size : 0, skipped: false, cancelled: cancellationInfo.cancelled };
  } else {
    console.log(`  ✗ ${slug.padEnd(35)} ${count} events, ${elapsed}s${result.error ? ` (${result.error.slice(0,40)})` : ''}`);
    return { slug, ok: false, futureCount: 0, newCount: 0, persisted: 0, skipped: false };
  }
}

async function testAll() {
  const candidates = loadCandidates();
  const alreadyWorking = new Set(loadWorking().map(w => w.slug));
  const toTest = candidates.filter(c => !alreadyWorking.has(c.fb));
  console.log(`=== Test all candidates ===`);
  console.log(`Total: ${candidates.length}, already working: ${alreadyWorking.size}, to test: ${toTest.length}\n`);

  const CONCURRENCY = 20;
  const queue = [...toTest];
  const results = [];
  let budgetExhausted = false;
  while (queue.length > 0 && !budgetExhausted) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(c =>
      testPage(c.fb, c.name, c.category, c.venue, FORCE).catch((e) => {
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

  const working = results.filter(r => r.futureCount > 0);
  const noEvents = results.filter(r => r.futureCount === 0);
  const totalFuture = working.reduce((sum, r) => sum + r.futureCount, 0);
  const totalNew = working.reduce((sum, r) => sum + r.newCount, 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Tested: ${results.length}`);
  console.log(`Working (events found): ${working.length}`);
  console.log(`No events: ${noEvents.length}`);
  console.log(`Total future events: ${totalFuture}`);
  console.log(`Total NEW (not in DB): ${totalNew}`);
  working.sort((a, b) => b.newCount - a.newCount);
  for (const w of working) {
    console.log(`  ${w.newCount.toString().padStart(3)} new / ${w.futureCount.toString().padStart(3)} future  ${w.slug}`);
  }

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
  console.log(`=== Test ${working.length} working pages ===`);
  console.log(`Smart skip: warm pages 3-day intervals, cold pages 7-day intervals\n`);

  let totalEvents = 0;
  let totalNew = 0;
  let totalPersisted = 0;
  let totalSkipped = 0;
  for (const w of working) {
    try {
      const r = await testPage(w.slug, w.name, w.category, w.venue, FORCE);
      if (r.skipped) totalSkipped++;
      if (r.futureCount > 0) {
        totalEvents += r.futureCount;
        totalNew += r.newCount ?? 0;
      }
    } catch (e) {
      if (e.message === 'BUDGET_EXHAUSTED') {
        console.log(`\n  Budget exhausted. Stopping.`);
        break;
      }
      console.log(`  ERROR ${w.slug}: ${e.message}`);
    }
  }

  const cost = await fetch('https://api.apify.com/v2/users/me/usage/monthly', {
    headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` }
  }).then(r => r.json()).then(d => {
    const total = Object.values(d.data?.monthlyServiceUsage ?? {}).reduce((s, x) => s + (x.amountAfterVolumeDiscountUsd ?? 0), 0);
    return total;
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Skipped (cold/warm): ${totalSkipped}`);
  console.log(`Tested: ${working.length - totalSkipped}`);
  console.log(`Total future events seen: ${totalEvents}`);
  console.log(`Total NEW events: ${totalNew}`);
  console.log(`Total cancelled: ${results.reduce((s, r) => s + (r.cancelled || 0), 0)}`);
  console.log(`Apify cost: $${cost.toFixed(4)}`);
}

function showStats() {
  const stats = loadStats();
  const working = loadWorking();
  const byTier = {hot: [], warm: [], cold: [], unknown: []};
  for (const w of working) {
    const s = stats[w.slug];
    const tier = s?.tier ?? 'unknown';
    byTier[tier].push({ slug: w.slug, futureCount: s?.lastFutureCount ?? 0, lastNew: s?.lastNewEvents ?? 0, noChange: s?.consecutiveNoChange ?? 0 });
  }

  console.log(`=== Per-page tiers ===`);
  for (const tier of ['hot', 'warm', 'cold', 'unknown']) {
    console.log(`\n${tier.toUpperCase()} (${byTier[tier].length} pages):`);
    for (const p of byTier[tier]) {
      console.log(`  ${p.slug.padEnd(35)}  future=${p.futureCount}  new=${p.lastNew}  noChange×${p.noChange}`);
    }
  }
}

async function main() {
  if (SHOW_STATS) {
    showStats();
    return;
  }
  if (TEST_PAGE) {
    const candidates = loadCandidates();
    const c = candidates.find(c => c.fb === TEST_PAGE);
    if (!c) { console.error(`Unknown page: ${TEST_PAGE}`); process.exit(1); }
    await testPage(c.fb, c.name, c.category, c.venue, FORCE);
  } else if (TEST_WORKING) {
    await testWorkingPages();
  } else if (TEST_ALL) {
    await testAll();
  } else {
    console.log('Usage:');
    console.log('  --test-all              Test all candidate pages');
    console.log('  --test-working          Test known-working (with smart skip)');
    console.log('  --test-page=SLUG        Test a single page');
    console.log('  --stats                 Show per-page tier stats');
    console.log('  --force                 Force-test all (ignore skip logic)');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});