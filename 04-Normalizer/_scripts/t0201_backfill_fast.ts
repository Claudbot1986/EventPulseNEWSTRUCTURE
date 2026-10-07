/**
 * T0201 Fast Backfill — parallelliserad per-event UPDATE.
 *
 * Hastighetsförbättring: Promise.all med concurrency 20 istället för sekventiell.
 * Förväntad hastighet: ~2000 events/min istället för ~200 events/min.
 *
 * Säkerhet: idempotent, ALDRIG rader, endast UPDATE av T0201-fält.
 *
 * Kör: tsx --env-file=.env 04-Normalizer/_scripts/t0201_backfill_fast.ts
 */

import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import {
  buildEventpulseFacts,
  buildEventpulseSummary,
} from '../eventpulseSummary';
import {
  resolveDescriptionLicense,
} from '../descriptionLicense';
import {
  shouldCaptureRawDescription,
  countFilledFacts,
} from '../rawDescriptionRetention';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RUNTIME_DIR = resolve(process.cwd(), 'runtime');
mkdirSync(RUNTIME_DIR, { recursive: true });
const RESULTS_PATH = resolve(RUNTIME_DIR, 't0201-backfill-fast-results.jsonl');

const READ_BATCH = 500;
const CONCURRENCY = 20;

interface EventRow {
  id: string;
  source: string | null;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  venue_id: string | null;
  start_time: string | null;
  end_time: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  raw_data: any | null;
}

interface Counts {
  scanned: number;
  updated: number;
  failed: number;
  with_summary: number;
  without_summary: number;
  by_license: Record<string, number>;
  by_source: Record<string, { total: number; with_summary: number }>;
  facts_distribution: { lt5: number; ge5_lt10: number; ge10: number };
}

const counts: Counts = {
  scanned: 0,
  updated: 0,
  failed: 0,
  with_summary: 0,
  without_summary: 0,
  by_license: { pressbild: 0, 'copyright-with-attribution': 0, 'partner-licensed': 0, 'public-domain': 0, unknown: 0 },
  by_source: {},
  facts_distribution: { lt5: 0, ge5_lt10: 0, ge10: 0 },
};

const samples: any[] = [];
let rawEventsLogged = 0;

function extractFromRawData(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw.description ?? raw.shortDescription ?? null;
}

async function updateEvent(row: any): Promise<void> {
  const { error } = await supabase.from('events').update({
    description_license: row.license,
    description_attribution: row.attribution,
    raw_description: row.raw_description,
    raw_description_captured_at: row.raw_description_captured_at,
    eventpulse_summary: row.eventpulse_summary,
    eventpulse_summary_facts: row.eventpulse_summary_facts,
    eventpulse_summary_provenance: row.eventpulse_summary_provenance,
    eventpulse_summary_generated_at: row.eventpulse_summary_generated_at,
    eventpulse_summary_model: row.eventpulse_summary_model,
  }).eq('id', row.id);
  if (error) {
    counts.failed++;
    if (counts.failed < 5) console.error(`[backfill] UPDATE ${row.id} failed:`, error.message);
  } else {
    counts.updated++;
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function processBatch(events: EventRow[], venueMap: Record<string, string>) {
  const rows = events.map(ev => {
    counts.scanned++;
    const src = ev.source ?? 'unknown';
    if (!counts.by_source[src]) counts.by_source[src] = { total: 0, with_summary: 0 };
    counts.by_source[src].total++;

    const rawDesc = ev.description_sv ?? ev.description_en ?? extractFromRawData(ev.raw_data);
    const lic = resolveDescriptionLicense({ source: ev.source });
    const venueName = ev.venue_id ? (venueMap[ev.venue_id] ?? null) : null;

    const { facts, provenance } = buildEventpulseFacts({
      category_slug: ev.category_slug,
      venue_name: venueName,
      city: 'Stockholm',
      start_time: ev.start_time,
      end_time: ev.end_time,
      is_free: ev.is_free,
      price_min_sek: ev.price_min_sek,
      price_max_sek: ev.price_max_sek,
      title: ev.title_sv ?? ev.title_en,
      raw_description: rawDesc,
      source: ev.source,
    });
    const summary = buildEventpulseSummary(facts);

    const filledCount = countFilledFacts(facts as unknown as Record<string, unknown>);
    const cap = shouldCaptureRawDescription({ license: lic.license, filledFactCount: filledCount });

    counts.by_license[lic.license] = (counts.by_license[lic.license] ?? 0) + 1;
    if (summary) {
      counts.with_summary++;
      counts.by_source[src].with_summary++;
      rawEventsLogged++;
      if (samples.length < 8 && (!samples.find(s => s.source === src))) {
        samples.push({
          id: ev.id,
          source: src,
          title: ev.title_sv ?? ev.title_en,
          license: lic.license,
          raw_desc_excerpt: (rawDesc ?? '').slice(0, 200),
          facts,
          summary,
        });
      }
    } else {
      counts.without_summary++;
    }
    if (filledCount < 5) counts.facts_distribution.lt5++;
    else if (filledCount >= 10) counts.facts_distribution.ge10++;
    else counts.facts_distribution.ge5_lt10++;

    return {
      id: ev.id,
      license: lic.license,
      attribution: lic.attribution,
      raw_description: cap.capture ? (rawDesc ?? null) : null,
      raw_description_captured_at: cap.capture ? new Date().toISOString() : null,
      eventpulse_summary: summary,
      eventpulse_summary_facts: facts,
      eventpulse_summary_provenance: provenance,
      eventpulse_summary_generated_at: summary ? new Date().toISOString() : null,
      eventpulse_summary_model: 'deterministic-v1',
    };
  });

  await runWithConcurrency(rows, CONCURRENCY, updateEvent);
}

async function main() {
  console.log('[t0201-backfill-fast] Starting (concurrency=' + CONCURRENCY + ')…');
  const startedAt = Date.now();

  let offset = 0;
  while (true) {
    const { data: events, error } = await supabase
      .from('events')
      .select('id, source, title_sv, title_en, description_sv, description_en, category_slug, venue_id, start_time, end_time, is_free, price_min_sek, price_max_sek, raw_data')
      .eq('status', 'published')
      .is('eventpulse_summary', null)
      .range(offset, offset + READ_BATCH - 1);

    if (error) {
      console.error('[backfill] SELECT failed:', error.message);
      break;
    }
    if (!events || events.length === 0) break;

    const venueIds = [...new Set(events.filter(e => e.venue_id).map(e => e.venue_id))];
    let venueMap: Record<string, string> = {};
    if (venueIds.length > 0) {
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', venueIds);
      for (const v of venues ?? []) venueMap[v.id] = v.name;
    }

    const beforeUpdated = counts.updated;
    await processBatch(events as EventRow[], venueMap);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    const rate = (counts.updated / Math.max(1, (Date.now() - startedAt) / 60000)).toFixed(0);
    console.log(`[backfill] batch done: scanned=${counts.scanned}, updated=${counts.updated}, failed=${counts.failed}, elapsed=${elapsed}s, rate=${rate}/min`);

    if (events.length < READ_BATCH) break;
    offset += READ_BATCH;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('\n=== Resultat ===');
  console.log(JSON.stringify({
    elapsed_sec: elapsedSec,
    scanned: counts.scanned,
    updated: counts.updated,
    failed: counts.failed,
    with_summary: counts.with_summary,
    without_summary: counts.without_summary,
    summary_pct: counts.scanned > 0 ? (100 * counts.with_summary / counts.scanned).toFixed(1) + '%' : 'N/A',
    by_license: counts.by_license,
    facts_distribution: counts.facts_distribution,
  }, null, 2));

  // Top-källor
  console.log('\n=== Top-källor ===');
  const topSources = Object.entries(counts.by_source)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12);
  for (const [src, c] of topSources) {
    console.log(`  ${src.padEnd(30)}: ${String(c.with_summary).padStart(5)} / ${String(c.total).padStart(5)} (${(100 * c.with_summary / c.total).toFixed(0)}%)`);
  }

  // Samples
  console.log('\n=== BEFORE → FACTS → AFTER (exempel) ===');
  for (const s of samples) {
    console.log(`\n--- ${s.source} ---`);
    console.log(`  title:   ${s.title}`);
    console.log(`  license: ${s.license}`);
    console.log(`  BEFORE: "${s.raw_desc_excerpt}${s.raw_desc_excerpt.length >= 200 ? '…' : ''}"`);
    console.log(`  FACTS:`);
    for (const [k, v] of Object.entries(s.facts)) {
      if (v !== null && v !== undefined && v !== '') {
        const str = JSON.stringify(v);
        console.log(`    ${k}: ${str.length > 80 ? str.slice(0, 80) + '…' : str}`);
      }
    }
    console.log(`  AFTER: "${s.summary}"`);
  }

  appendFileSync(RESULTS_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    elapsed_sec: elapsedSec,
    counts,
    samples,
  }) + '\n');
  console.log(`\n[backfill] Saved to ${RESULTS_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[backfill] Failed:', err.message);
    process.exit(1);
  });