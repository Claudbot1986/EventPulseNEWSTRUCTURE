/**
 * T0201 Measurement — kör mot live DB efter migration.
 *
 * Syfte: rapportera nuläge för description-hantering (T0201) — används för
 * verifiering enligt användarens krav §13:
 *   - antal events med source description (baseline)
 *   - antal events med användbara extracted facts (eventpulse_summary_facts)
 *   - antal events med eventpulse_summary
 *   - antal events som fortfarande saknar tillräcklig info
 *   - exempel BEFORE → FACTS → AFTER per källa
 *
 * Migrationsberoende: kräver att båda T0201-migrationerna applicerats:
 *   - 20261005-0001-description-rights-summary.sql
 *   - 20261005-0002-events-public-view-t0201.sql
 *
 * Kör: tsx --env-file=.env 04-Normalizer/_scripts/t0201_measure.ts
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RUNTIME_DIR = resolve(process.cwd(), 'runtime');
mkdirSync(RUNTIME_DIR, { recursive: true });

interface CountRow {
  total: number;
  with_summary: number;
  with_raw_desc: number;
  with_facts: number;
  by_license: Record<string, number>;
  by_source_top: Array<{ source: string; total: number; with_summary: number }>;
  facts_distribution: {
    lt5_facts: number;
    ge5_facts: number;
    ge10_facts: number;
  };
  timestamp: string;
}

async function countColumn(table: string, column: string, filter: string): Promise<number> {
  // PostgREST kan räkna via select('id', { count: 'exact', head: true })
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = q.not(column, 'is', null);
  const { count, error } = await q;
  if (error) {
    // T0201-migration kanske inte applicerad ännu → column doesn't exist
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.warn(`  (column ${column} not yet in ${table} — T0201 migration not applied?)`);
      return 0;
    }
    throw new Error(`count failed (${table}.${column}): ${error.message}`);
  }
  return count ?? 0;
}

async function main() {
  console.log('[t0201-measure] Starting measurement against live DB…');
  const ts = new Date().toISOString();

  // Probe if T0201 migration is applied by trying to select the new column.
  // If it fails, we still produce a baseline report.
  let migrationApplied = false;
  const probe = await supabase.from('events_public').select('eventpulse_summary').limit(1);
  if (probe.error && (probe.error.message.includes('does not exist') || probe.error.code === '42703')) {
    console.warn('  ⚠️  T0201 migration NOT applied — kör baseline (description-coverage) istället.');
  } else if (probe.error) {
    throw new Error(`Probe failed: ${probe.error.message}`);
  } else {
    migrationApplied = true;
    console.log('  ✓ T0201 migration IS applied (eventpulse_summary column found)');
  }

  const totalEvents = await countColumn('events_public', 'id', '');
  console.log(`  total events_public: ${totalEvents}`);

  let withSummary = 0;
  if (migrationApplied) {
    withSummary = await countColumn('events_public', 'eventpulse_summary', 'eventpulse_summary');
    console.log(`  with eventpulse_summary: ${withSummary} (${(100 * withSummary / totalEvents).toFixed(1)}%)`);
  } else {
    console.log('  with eventpulse_summary: N/A (migration ej applicerad)');
  }

  // License-fördelning (T0201-fält — fungerar bara om migration applicerad)
  const licenseCounts: Record<string, number> = {};
  let licenseAvailable = migrationApplied;
  for (const lic of ['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain', 'unknown', null]) {
    const licValue = lic === null ? 'null' : lic;
    let q = supabase.from('events').select('id', { count: 'exact', head: true });
    if (lic === null) {
      q = q.is('description_license', null);
    } else {
      q = q.eq('description_license', lic);
    }
    const { count, error } = await q;
    if (error) {
      licenseAvailable = false;
      break;
    }
    licenseCounts[licValue] = count ?? 0;
  }
  if (licenseAvailable) {
    console.log(`  description_license distribution:`, licenseCounts);
  } else {
    console.warn('  description_license distribution: N/A (migration ej applicerad)');
  }

  // Top 6 källor: hur många har summary?
  const topSources: Array<{ source: string; total: number; with_summary: number }> = [];
  const TOP_SOURCES = ['sthlmlist', 'kulturhuset', 'ticketmaster-se', 'eventbrite-stockholm', 'songkick-stockholm', 'spelning-se'];
  for (const source of TOP_SOURCES) {
    const { count: total } = await supabase
      .from('events_public')
      .select('id', { count: 'exact', head: true })
      .eq('source', source);
    let withSum = 0;
    if (licenseAvailable) {
      const { count } = await supabase
        .from('events_public')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
        .not('eventpulse_summary', 'is', null);
      withSum = count ?? 0;
    }
    topSources.push({ source, total: total ?? 0, with_summary: withSum });
  }

  // Facts-distribution (T0201-fält — fungerar bara om migration applicerad)
  let lt5 = 0, ge5 = 0, ge10 = 0;
  let factsData: unknown[] = [];
  if (licenseAvailable) {
    const { data } = await supabase
      .from('events')
      .select('eventpulse_summary_facts')
      .not('eventpulse_summary_facts', 'is', null)
      .limit(5000);
    factsData = data ?? [];
    for (const row of factsData) {
      const facts = (row as any).eventpulse_summary_facts as Record<string, unknown> | null;
      if (!facts) continue;
      let filled = 0;
      for (const v of Object.values(facts)) {
        if (v !== null && v !== undefined && v !== '') filled++;
      }
      if (filled < 5) lt5++;
      else if (filled >= 10) ge10++;
      else ge5++;
    }
  }
  console.log(`  facts distribution (sample ${factsData.length}):`, { lt5, ge5, ge10 });

  const result: CountRow = {
    total: totalEvents,
    with_summary: withSummary,
    with_raw_desc: licenseCounts['unknown'] ?? 0,
    with_facts: (factsData?.length ?? 0),
    by_license: licenseCounts,
    by_source_top: topSources,
    facts_distribution: { lt5_facts: lt5, ge5_facts: ge5, ge10_facts: ge10 },
    timestamp: ts,
  };

  // Skriv till runtime/desc-coverage-t0201.jsonl
  const outPath = resolve(RUNTIME_DIR, 'desc-coverage-t0201.jsonl');
  writeFileSync(outPath, JSON.stringify(result) + '\n', { flag: 'a' });
  console.log(`\n[t0201-measure] Result written to ${outPath}`);
  console.log(JSON.stringify(result, null, 2));

  // Plocka 4 exempelevents från orelaterade källor för BEFORE → AFTER
  console.log('\n=== BEFORE → EXTRACTED FACTS → AFTER (4 orelaterade källor) ===');
  for (const source of TOP_SOURCES.slice(0, 4)) {
    const { data: sample } = await supabase
      .from('events_public')
      .select('id, title_sv, title_en, description_sv, description_en, description_license, eventpulse_summary, eventpulse_summary_facts, source')
      .eq('source', source)
      .not('eventpulse_summary', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!sample) {
      console.log(`\n--- ${source} ---`);
      console.log('  (no events with summary yet — migration may not be applied or no events processed)');
      continue;
    }

    console.log(`\n--- ${source} ---`);
    console.log(`  id:     ${sample.id}`);
    console.log(`  title:  ${sample.title_sv || sample.title_en}`);
    console.log(`  BEFORE: description_license=${sample.description_license}`);
    console.log(`          description_en="${(sample.description_en || '').slice(0, 80)}…"`);
    console.log(`  FACTS:  ${JSON.stringify(sample.eventpulse_summary_facts)}`);
    console.log(`  AFTER:  ${sample.eventpulse_summary}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[t0201-measure] Failed:', err.message);
    process.exit(1);
  });