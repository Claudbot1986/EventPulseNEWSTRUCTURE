// scripts/fix-dead-link-status-fast.mjs — Parallel version
//
// Same logic as fix-dead-link-status.mjs but uses Promise.all with bounded
// concurrency for the HTTP fetches (was: serial 8s+/row * 600+ rows = 1+ hour).
// Now: ~20 concurrent = 30-60 seconds total.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPaths = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const p of envPaths) {
  try {
    const raw = readFileSync(p, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] == null) process.env[m[1]] = m[2];
    }
  } catch {}
}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CONCURRENCY = 25;
const VERIFY_TIMEOUT_MS = 8000;

// Sources that still have dead rows left
const TARGET_SOURCES = ['spelning-se', 'ticketmaster', 'ticketmaster-linkoping', 'kth-2'];

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'EventPulse/1.0 (link-health-recheck)' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function classify(status) {
  if (status >= 200 && status < 400) return 'live';
  if (status === 404 || status === 410) return 'dead';
  return 'unknown'; // 401/403/5xx/timeout
}

async function processSource(source) {
  console.log(`\n=== ${source} ===`);
  const { data: rows, error } = await supabase
    .from('events')
    .select('id, ticket_url')
    .eq('source', source)
    .eq('link_status', 'dead');
  if (error) { console.error('  fetch error:', error.message); return; }
  console.log(`  Dead rows to verify: ${rows.length}`);
  if (rows.length === 0) return;

  const t0 = Date.now();
  const updates = await mapWithConcurrency(rows, async (row) => {
    const url = (row.ticket_url ?? '').trimEnd();
    if (!url) return { id: row.id, link_status: 'unknown' };
    try {
      const res = await fetchWithTimeout(url, VERIFY_TIMEOUT_MS);
      return { id: row.id, link_status: classify(res.status) };
    } catch {
      return { id: row.id, link_status: 'unknown' };
    }
  }, CONCURRENCY);

  const stats = { live: 0, dead: 0, unknown: 0 };
  for (const u of updates) stats[u.link_status]++;
  console.log(`  Classified in ${((Date.now() - t0) / 1000).toFixed(1)}s: live=${stats.live} dead=${stats.dead} unknown=${stats.unknown}`);

  // Bulk update via RPC would be ideal; we use individual updates with Promise.all
  // since service_role bypasses RLS — each update is fast (~50ms).
  const nowIso = new Date().toISOString();
  const t1 = Date.now();
  await mapWithConcurrency(updates, async (u) => {
    await supabase.from('events').update({
      link_status: u.link_status,
      link_last_checked_at: nowIso,
    }).eq('id', u.id);
  }, 30);
  console.log(`  Updated in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  return stats;
}

const totalStats = { live: 0, dead: 0, unknown: 0 };
for (const source of TARGET_SOURCES) {
  const s = await processSource(source);
  if (s) {
    totalStats.live += s.live;
    totalStats.dead += s.dead;
    totalStats.unknown += s.unknown;
  }
}

console.log(`\n=== TOTAL ===`);
console.log(`  live:    ${totalStats.live}`);
console.log(`  dead:    ${totalStats.dead} (kept as 'dead')`);
console.log(`  unknown: ${totalStats.unknown} (auth-wall or 5xx — shown in events_public but flagged)`);