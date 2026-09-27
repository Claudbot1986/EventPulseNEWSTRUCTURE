/**
 * analyze-dedup.ts
 *
 * Undersöker varför vissa titlar har 100+ events. Är det:
 *   - Serie-events (samma pjäs, olika datum) — INTE en bugg
 *   - Dedup-bugg (samma event, samma datum, olika källa) — ÄR en bugg
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/analyze-dedup.ts
 *
 * Output till stdout (analyseras i nästa steg).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

interface Row {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  dedup_hash: string;
  source: string | null;
  venue_id: string | null;
  start_time: string | null;
}

const PAGE = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[dedup] FATAL: ${msg}`);
  process.exit(1);
}

function pickTitle(r: Row): string {
  return r.title_sv ?? r.title_en ?? '';
}

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, dedup_hash, source, venue_id, start_time')
      .range(offset, offset + PAGE - 1);
    if (error) fail(`Supabase fetch failed: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    rows.push(...(data as Row[]));
    hasMore = data.length === PAGE;
    offset += PAGE;
  }
  return rows;
}

function classifyGroup(rows: Row[]): 'series' | 'dedup-bug' | 'mixed' | 'no-date' {
  const startTimes = new Set(rows.map((r) => r.start_time).filter((t): t is string => t !== null));
  const dedupHashes = new Set(rows.map((r) => r.dedup_hash));

  if (startTimes.size === 0) return 'no-date';

  // Om varje event har unikt start_time och unikt dedup_hash → serie
  if (startTimes.size === rows.length && dedupHashes.size === rows.length) {
    return 'series';
  }

  // Om alla har samma start_time men olika dedup_hash → dedup-bugg
  if (startTimes.size === 1 && dedupHashes.size > 1) {
    return 'dedup-bug';
  }

  return 'mixed';
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i env.');
  }

  // eslint-disable-next-line no-console
  console.error('[dedup] fetching all events...');
  const rows = await fetchAll();
  // eslint-disable-next-line no-console
  console.error(`[dedup] fetched ${rows.length} events`);

  // Gruppera på titel
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const t = pickTitle(r);
    if (!t) continue;
    const bucket = groups.get(t);
    if (bucket) bucket.push(r);
    else groups.set(t, [r]);
  }

  // Filtrera till grupper med > 1 events, sortera på antal
  const dups = Array.from(groups.entries())
    .filter(([, arr]) => arr.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  // eslint-disable-next-line no-console
  console.error(`[dedup] ${dups.length} unika titlar har >1 events`);
  // eslint-disable-next-line no-console
  console.error(`[dedup] top 30:\n`);

  let totalSeries = 0;
  let totalBug = 0;
  let totalMixed = 0;
  let totalNoDate = 0;

  for (const [title, arr] of dups.slice(0, 30)) {
    const startTimes = new Set(arr.map((r) => r.start_time).filter((t): t is string => t !== null));
    const dedupHashes = new Set(arr.map((r) => r.dedup_hash));
    const sources = new Set(arr.map((r) => r.source).filter((s): s is string => s !== null));
    const venues = new Set(arr.map((r) => r.venue_id).filter((v): v is string => v !== null));

    const cls = classifyGroup(arr);
    if (cls === 'series') totalSeries += arr.length;
    else if (cls === 'dedup-bug') totalBug += arr.length;
    else if (cls === 'mixed') totalMixed += arr.length;
    else totalNoDate += arr.length;

    // Förkorta titlar för tabell
    const t = title.length > 60 ? title.slice(0, 57) + '...' : title;
    // eslint-disable-next-line no-console
    console.log(
      `${String(arr.length).padStart(4)} | ${String(startTimes.size).padStart(3)} datum | ${String(dedupHashes.size).padStart(3)} hash | ${String(sources.size).padStart(2)} src | ${cls.padEnd(10)} | ${t}`,
    );
  }

  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error('[dedup] klassificering av top 30 (totalt antal events):');
  // eslint-disable-next-line no-console
  console.error(`  serie-events (olika datum, olika källa): ${totalSeries}`);
  // eslint-disable-next-line no-console
  console.error(`  dedup-bugg (samma datum, olika källa):  ${totalBug}`);
  // eslint-disable-next-line no-console
  console.error(`  mixed:                                  ${totalMixed}`);
  // eslint-disable-next-line no-console
  console.error(`  no-date (saknar start_time):            ${totalNoDate}`);

  // Specialanalys: "Omfamnad på Kulturhuset Stadsteatern"
  const omfamnad = groups.get('Omfamnad på Kulturhuset Stadsteatern') ?? [];
  if (omfamnad.length > 0) {
    // eslint-disable-next-line no-console
    console.error('');
    // eslint-disable-next-line no-console
    console.error(`[dedup] "Omfamnad på Kulturhuset Stadsteatern" — ${omfamnad.length} events:`);
    const startTimes = new Set(omfamnad.map((r) => r.start_time).filter((t): t is string => t !== null));
    const sources = new Set(omfamnad.map((r) => r.source).filter((s): s is string => s !== null));
    const venues = new Set(omfamnad.map((r) => r.venue_id).filter((v): v is string => v !== null));
    // eslint-disable-next-line no-console
    console.error(`  unika datum:        ${startTimes.size}`);
    // eslint-disable-next-line no-console
    console.error(`  unika sources:      ${sources.size}`);
    // eslint-disable-next-line no-console
    console.error(`  unika venue_id:     ${venues.size}`);
    // eslint-disable-next-line no-console
    console.error(`  källor:             ${[...sources].slice(0, 10).join(', ')}${sources.size > 10 ? ` (+${sources.size - 10})` : ''}`);
    // eslint-disable-next-line no-console
    console.error(`  första 5 datumen:   ${[...startTimes].sort().slice(0, 5).join(', ')}`);
    // eslint-disable-next-line no-console
    console.error(`  sista 5 datumen:    ${[...startTimes].sort().slice(-5).join(', ')}`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});