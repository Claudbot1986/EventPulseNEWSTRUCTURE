/**
 * scripts/measure-desc-coverage.mjs
 *
 * Mäter description-täckning i events_public.
 * Används för baseline + före/efter-jämförelse av fixarna 5.1, 5.2, 5.3.
 *
 * Output:
 *   - Skriver JSON-line till stdout (en rad per körning) + lägger till
 *     en rad i runtime/desc-coverage-history.jsonl med tidsstämpel.
 *   - Skriver runtime/desc-coverage-by-source.jsonl med per-source-statistik.
 *
 * Miljövariabler (.env):
 *   SUPABASE_URL — t.ex. https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service_role JWT (krävs för full read)
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Pagination params
const PAGE = 1000;

async function fetchAllEvents() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events_public')
      .select('id, source, description_sv, description_en, venue_id, ticket_url')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim().length >= 10;
}

function bucket(events) {
  const stats = {
    total: events.length,
    descSv: 0,
    descEn: 0,
    descAny: 0,
    descBoth: 0,
    descEmpty: 0,
    descMin10: 0,
  };
  for (const e of events) {
    const hasSv = isNonEmpty(e.description_sv);
    const hasEn = isNonEmpty(e.description_en);
    if (hasSv) stats.descSv++;
    if (hasEn) stats.descEn++;
    if (hasSv || hasEn) stats.descAny++;
    if (hasSv && hasEn) stats.descBoth++;
    if (!hasSv && !hasEn) stats.descEmpty++;
    if (
      isNonEmpty(e.description_sv) ||
      isNonEmpty(e.description_en)
    ) {
      stats.descMin10++;
    }
  }
  // Length buckets
  const lengthBuckets = { '0': 0, '1-9': 0, '10-49': 0, '50-99': 0, '100-299': 0, '300+': 0 };
  for (const e of events) {
    const svLen = isNonEmpty(e.description_sv) ? e.description_sv.trim().length : 0;
    const enLen = isNonEmpty(e.description_en) ? e.description_en.trim().length : 0;
    const len = Math.max(svLen, enLen);
    if (len === 0) lengthBuckets['0']++;
    else if (len < 10) lengthBuckets['1-9']++;
    else if (len < 50) lengthBuckets['10-49']++;
    else if (len < 100) lengthBuckets['50-99']++;
    else if (len < 300) lengthBuckets['100-299']++;
    else lengthBuckets['300+']++;
  }
  return { ...stats, lengthBuckets };
}

function perSourceBreakdown(events) {
  const bySource = new Map();
  for (const e of events) {
    const s = e.source || 'unknown';
    if (!bySource.has(s)) {
      bySource.set(s, { source: s, descSv: 0, descEn: 0, descAny: 0, total: 0 });
    }
    const row = bySource.get(s);
    row.total++;
    if (isNonEmpty(e.description_sv)) row.descSv++;
    if (isNonEmpty(e.description_en)) row.descEn++;
    if (isNonEmpty(e.description_sv) || isNonEmpty(e.description_en)) row.descAny++;
  }
  return [...bySource.values()]
    .map((r) => ({
      ...r,
      svPct: r.total ? Math.round((r.descSv / r.total) * 100) : 0,
      enPct: r.total ? Math.round((r.descEn / r.total) * 100) : 0,
      anyPct: r.total ? Math.round((r.descAny / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

async function main() {
  console.log(`[measure-desc-coverage] START ${new Date().toISOString()}`);
  const events = await fetchAllEvents();
  console.log(`[measure-desc-coverage] fetched ${events.length} events`);

  const overall = bucket(events);
  const bySource = perSourceBreakdown(events);

  const summary = {
    timestamp: new Date().toISOString(),
    total: overall.total,
    pct_desc_sv: overall.total ? Math.round((overall.descSv / overall.total) * 1000) / 10 : 0,
    pct_desc_en: overall.total ? Math.round((overall.descEn / overall.total) * 1000) / 10 : 0,
    pct_desc_any: overall.total ? Math.round((overall.descAny / overall.total) * 1000) / 10 : 0,
    pct_desc_both: overall.total ? Math.round((overall.descBoth / overall.total) * 1000) / 10 : 0,
    pct_desc_empty: overall.total ? Math.round((overall.descEmpty / overall.total) * 1000) / 10 : 0,
    pct_desc_min10: overall.total ? Math.round((overall.descMin10 / overall.total) * 1000) / 10 : 0,
    length_buckets: overall.lengthBuckets,
  };

  console.log('[measure-desc-coverage] overall:', summary);

  // Ensure runtime dirs
  const historyDir = path.join(process.cwd(), 'runtime', 'desc-coverage');
  fs.mkdirSync(historyDir, { recursive: true });
  const historyPath = path.join(historyDir, 'history.jsonl');
  fs.appendFileSync(historyPath, JSON.stringify(summary) + '\n');
  console.log(`[measure-desc-coverage] appended to ${historyPath}`);

  const bySourcePath = path.join(historyDir, 'by-source.jsonl');
  const bySourceLine = JSON.stringify({ timestamp: summary.timestamp, sources: bySource });
  fs.appendFileSync(bySourcePath, bySourceLine + '\n');
  console.log(`[measure-desc-coverage] appended ${bySource.length} source rows to ${bySourcePath}`);

  // Print top 25 sources
  console.log('\n[measure-desc-coverage] TOP 25 SOURCES:');
  console.log('SOURCE'.padEnd(35), '| TOTAL | SV% | EN% | ANY%');
  console.log('-'.repeat(75));
  for (const r of bySource.slice(0, 25)) {
    console.log(
      r.source.toString().padEnd(35),
      '|',
      String(r.total).padStart(5),
      '|',
      String(r.svPct).padStart(3),
      '|',
      String(r.enPct).padStart(3),
      '|',
      String(r.anyPct).padStart(3)
    );
  }

  console.log(`[measure-desc-coverage] DONE`);
}

main().catch((err) => {
  console.error('[measure-desc-coverage] FAILED:', err);
  process.exit(1);
});