/**
 * T0201 Backfill — kör T0201-summary-logiken mot alla befintliga events.
 *
 * Vad den gör:
 *   1. Läser events i batch om 500 (med rådescription från events-tabellen).
 *   2. Kör samma faktakonstruktion + license-resolution som normalizer.ts.
 *   3. Skriver eventpulse_summary + license + facts + provenance + raw_description
 *      tillbaka till events-tabellen.
 *   4. Skriver resultat till runtime/t0201-backfill-results.jsonl för
 *      BEFORE → FACTS → AFTER-rapportering.
 *
 * Säkerhet:
 *   - Idempotent (körs flera gånger = samma resultat).
 *   - Använder samma moduler som normalizer.ts (samma logik).
 *   - Uppdaterar ALDRIG andra fält.
 *
 * Kör: tsx --env-file=.env 04-Normalizer/_scripts/t0201_backfill.ts [--limit=N]
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import {
  buildEventpulseFacts,
  buildEventpulseSummary,
  chooseFact,
  SOURCE_PRIORITY,
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
const RESULTS_PATH = resolve(RUNTIME_DIR, 't0201-backfill-results.jsonl');

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const totalLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

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
  with_summary: number;
  without_summary: number;
  by_license: Record<string, number>;
  by_source: Record<string, { total: number; with_summary: number }>;
  facts_distribution: { lt5: number; ge5_lt10: number; ge10: number };
}

async function main() {
  console.log('[t0201-backfill] Starting…');
  console.log(`[t0201-backfill] limit=${totalLimit ?? 'all'}`);

  const counts: Counts = {
    scanned: 0,
    with_summary: 0,
    without_summary: 0,
    by_license: { pressbild: 0, 'copyright-with-attribution': 0, 'partner-licensed': 0, 'public-domain': 0, unknown: 0 },
    by_source: {},
    facts_distribution: { lt5: 0, ge5_lt10: 0, ge10: 0 },
  };

  // Hämta alla events (eller limit) — paginerat om det behövs
  const PAGE = 500;
  let offset = 0;
  const samples: Array<any> = [];  // För BEFORE → AFTER-rapport

  while (true) {
    const remaining = totalLimit != null ? totalLimit - counts.scanned : Infinity;
    if (remaining <= 0) break;
    const fetchSize = Math.min(PAGE, remaining);

    const { data: events, error } = await supabase
      .from('events')
      .select('id, source, title_sv, title_en, description_sv, description_en, category_slug, venue_id, start_time, end_time, is_free, price_min_sek, price_max_sek, raw_data')
      .eq('status', 'published')
      .range(offset, offset + fetchSize - 1);

    if (error) {
      console.error('[t0201-backfill] Fetch error:', error.message);
      break;
    }
    if (!events || events.length === 0) break;

    // Plocka venue_id → venues.name via en andra query (behöver bara en gång per batch)
    const venueIds = [...new Set(events.filter(e => e.venue_id).map(e => e.venue_id))];
    let venueMap: Record<string, string> = {};
    if (venueIds.length > 0) {
      const { data: venues } = await supabase
        .from('venues')
        .select('id, name')
        .in('id', venueIds);
      for (const v of venues ?? []) venueMap[v.id] = v.name;
    }

    const updates: Array<any> = [];

    for (const ev of events as EventRow[]) {
      counts.scanned++;

      // raw.description från raw_data (eller direkt)
      const rawDesc = ev.description_sv ?? ev.description_en ?? extractFromRawData(ev.raw_data);

      // License
      const lic = resolveDescriptionLicense({ source: ev.source });

      // Venue name
      const venueName = ev.venue_id ? (venueMap[ev.venue_id] ?? null) : null;

      // Facts
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

      // Retention
      const filledCount = countFilledFacts(facts as unknown as Record<string, unknown>);
      const cap = shouldCaptureRawDescription({ license: lic.license, filledFactCount: filledCount });
      const rawDescToStore = cap.capture ? rawDesc : null;
      const rawDescCapturedAt = cap.capture ? new Date().toISOString() : null;

      // Räkna
      counts.by_license[lic.license] = (counts.by_license[lic.license] ?? 0) + 1;
      const src = ev.source ?? 'unknown';
      if (!counts.by_source[src]) counts.by_source[src] = { total: 0, with_summary: 0 };
      counts.by_source[src].total++;
      if (summary) {
        counts.with_summary++;
        counts.by_source[src].with_summary++;
      } else {
        counts.without_summary++;
      }
      if (filledCount < 5) counts.facts_distribution.lt5++;
      else if (filledCount >= 10) counts.facts_distribution.ge10++;
      else counts.facts_distribution.ge5_lt10++;

      updates.push({
        id: ev.id,
        description_license: lic.license,
        description_attribution: lic.attribution,
        description_source_url: null,
        raw_description: rawDescToStore,
        raw_description_captured_at: rawDescCapturedAt,
        eventpulse_summary: summary,
        eventpulse_summary_facts: facts,
        eventpulse_summary_provenance: provenance,
        eventpulse_summary_generated_at: summary ? new Date().toISOString() : null,
        eventpulse_summary_model: 'deterministic-v1',
      });

      // Spara första sample med summary per källa för BEFORE → AFTER-rapport
      if (summary && samples.length < 8 && (!samples.find(s => s.source === ev.source))) {
        samples.push({
          id: ev.id,
          source: ev.source,
          title: ev.title_sv ?? ev.title_en,
          license: lic.license,
          raw_desc_excerpt: (rawDesc ?? '').slice(0, 200),
          facts,
          summary,
        });
      }
    }

    // Batch-update via UPDATE för varje event (vi behöver uppdatera 10 fält)
    // Använder service_role — går endast mot events-tabellen (inte vyn).
    // 2026-10-07 — Promise.all med concurrency=20 istället för serial await.
    // Per-event UPDATE tog ~500ms mot Supabase, så 14k events = ~2h serial.
    // Med 20 parallella UPDATEs per batch blir det ~2-3 min totalt.
    const UPDATE_CONCURRENCY = 20;
    let updateCursor = 0;
    let batchErrors = 0;
    while (updateCursor < updates.length) {
      const slice = updates.slice(updateCursor, updateCursor + UPDATE_CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map((upd) =>
          supabase.from('events').update({
            description_license: upd.description_license,
            description_attribution: upd.description_attribution,
            description_source_url: upd.description_source_url,
            raw_description: upd.raw_description,
            raw_description_captured_at: upd.raw_description_captured_at,
            eventpulse_summary: upd.eventpulse_summary,
            eventpulse_summary_facts: upd.eventpulse_summary_facts,
            eventpulse_summary_provenance: upd.eventpulse_summary_provenance,
            eventpulse_summary_generated_at: upd.eventpulse_summary_generated_at,
            eventpulse_summary_model: upd.eventpulse_summary_model,
          }).eq('id', upd.id)
        )
      );
      for (const r of results) {
        if (r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)) {
          batchErrors++;
        }
      }
      updateCursor += slice.length;
    }
    if (batchErrors > 0) {
      console.warn(`[t0201-backfill] ${batchErrors} UPDATE errors in this batch`);
    }

    console.log(`[t0201-backfill] processed ${counts.scanned}, with_summary=${counts.with_summary}`);
    offset += fetchSize;
    if (events.length < fetchSize) break;
  }

  console.log('\n=== Resultat ===');
  console.log(JSON.stringify({
    scanned: counts.scanned,
    with_summary: counts.with_summary,
    without_summary: counts.without_summary,
    summary_pct: (100 * counts.with_summary / counts.scanned).toFixed(1) + '%',
    by_license: counts.by_license,
    facts_distribution: counts.facts_distribution,
  }, null, 2));

  // BEFORE → FACTS → AFTER samples
  console.log('\n=== BEFORE → EXTRACTED FACTS → AFTER (exempel) ===');
  for (const s of samples) {
    console.log(`\n--- ${s.source} ---`);
    console.log(`  title:  ${s.title}`);
    console.log(`  license: ${s.license}`);
    console.log(`  BEFORE (raw_description excerpt):`);
    console.log(`    "${s.raw_desc_excerpt}${s.raw_desc_excerpt.length >= 200 ? '…' : ''}"`);
    console.log(`  FACTS:`);
    for (const [k, v] of Object.entries(s.facts)) {
      if (v !== null && v !== undefined && v !== '') {
        console.log(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
    console.log(`  AFTER (eventpulse_summary):`);
    console.log(`    "${s.summary}"`);
  }

  // Spara till JSONL
  appendFileSync(RESULTS_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    counts,
    samples,
  }) + '\n');
  console.log(`\n[t0201-backfill] Saved to ${RESULTS_PATH}`);
}

function extractFromRawData(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw.description ?? raw.shortDescription ?? null;
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[t0201-backfill] Failed:', err.message);
    process.exit(1);
  });