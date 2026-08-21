// Audit query runner — read-only Supabase samples for Content Rights Audit Phase A.5
// Uses SERVICE_ROLE key to bypass RLS for inventory purposes only.
//
// Run via: npx tsx docs/audit/data/run-audit-queries.ts
// Writes JSON files into docs/audit/data/ — committed audit artifacts.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT_DIR = process.env.OUT_DIR || '/Volumes/2TB filer/NEWSTRUCTURE-COPY/docs/audit/data';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function save(name: string, data: unknown) {
  const p = join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`saved: ${p}`);
}

async function countByColumn(column: string) {
  const { count: total } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true });
  const { count: notNull } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .not(column, 'is', null);
  return { total: total ?? 0, notNull: notNull ?? 0, nulls: (total ?? 0) - (notNull ?? 0) };
}

function bucketChars(values: Array<string | null>): Record<string, number> {
  const buckets: Record<string, number> = {
    null: 0,
    '0': 0,
    '1-50': 0,
    '51-150': 0,
    '151-500': 0,
    '501-1500': 0,
    '1501+': 0,
  };
  for (const v of values) {
    if (v === null || v === undefined) {
      buckets.null++;
      continue;
    }
    const len = v.length;
    if (len === 0) buckets['0']++;
    else if (len <= 50) buckets['1-50']++;
    else if (len <= 150) buckets['51-150']++;
    else if (len <= 500) buckets['151-500']++;
    else if (len <= 1500) buckets['501-1500']++;
    else buckets['1501+']++;
  }
  return buckets;
}

async function main() {
  const results: Record<string, unknown> = {};

  // 0. Total event count
  const { count: total } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true });
  results.total_events = total ?? 0;
  console.log(`total events: ${results.total_events}`);

  // 1. Coverage per column
  const cols = [
    'image_url',
    'title_en',
    'title_sv',
    'description_en',
    'description_sv',
    'source',
    'source_id',
    'ticket_url',
    'organizer_id',
    'start_time',
    'end_time',
    'venue_id',
    'is_free',
    'price_min_sek',
    'price_max_sek',
    'confidence_score',
  ];
  const coverage: Record<string, { total: number; notNull: number; nulls: number; pctNotNull: number }> = {};
  for (const c of cols) {
    const r = await countByColumn(c);
    coverage[c] = {
      total: r.total,
      notNull: r.notNull,
      nulls: r.nulls,
      pctNotNull: r.total > 0 ? Math.round((r.notNull / r.total) * 10000) / 100 : 0,
    };
  }
  results.column_coverage = coverage;
  save('01-column-coverage.json', coverage);

  // 2. Count events by source
  const { data: bySource, error: srcErr } = await supabase
    .from('events')
    .select('source')
    .not('source', 'is', null);
  if (srcErr) throw srcErr;
  const sourceCounts: Record<string, number> = {};
  for (const row of bySource ?? []) {
    const s = (row as any).source ?? '(null)';
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  }
  const sourceRanking = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));
  results.events_by_source = sourceRanking;
  save('02-events-by-source.json', sourceRanking);

  // 3. Sample WITH image_url (5 rows)
  const { data: withImage } = await supabase
    .from('events')
    .select('id, title_en, source, image_url, start_time')
    .not('image_url', 'is', null)
    .order('start_time', { ascending: false })
    .limit(5);
  save('03-sample-events-with-image.json', withImage);

  // 4. Sample WITHOUT image_url (5 rows)
  const { data: withoutImage } = await supabase
    .from('events')
    .select('id, title_en, source, start_time')
    .is('image_url', null)
    .order('start_time', { ascending: false })
    .limit(5);
  save('04-sample-events-without-image.json', withoutImage);

  // 5. Sample events from each source type (1 per top 10 sources)
  const top10Sources = sourceRanking.slice(0, 10).map((s) => s.source);
  const samplesBySource: Array<{ source: string; id: string; title_en: string | null; image_url: string | null; start_time: string | null }> = [];
  for (const source of top10Sources) {
    const { data } = await supabase
      .from('events')
      .select('id, title_en, image_url, start_time')
      .eq('source', source)
      .order('start_time', { ascending: false })
      .limit(1);
    if (data && data[0]) {
      samplesBySource.push({ source, ...(data[0] as any) });
    }
  }
  save('05-sample-events-by-source.json', samplesBySource);

  // 6. organizer_id coverage
  const { count: withOrg } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .not('organizer_id', 'is', null);
  const { count: withoutOrg } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .is('organizer_id', null);
  results.organizer_coverage = {
    total: results.total_events,
    withOrganizer: withOrg ?? 0,
    withoutOrganizer: withoutOrg ?? 0,
  };

  // 7. organizer + provenance totals
  const { count: organizerCount } = await supabase
    .from('organizers')
    .select('id', { count: 'exact', head: true });
  results.total_organizers = organizerCount ?? 0;

  const { count: provCount } = await supabase
    .from('event_provenance')
    .select('id', { count: 'exact', head: true });
  results.total_event_provenance_rows = provCount ?? 0;

  // 9. Sample event_provenance (5 rows)
  const { data: provSample } = await supabase
    .from('event_provenance')
    .select('id, event_id, source, source_event_id, source_url, fetched_at, confidence')
    .order('fetched_at', { ascending: false })
    .limit(5);
  save('06-sample-event-provenance.json', provSample);

  // 10. Sample organizers (5)
  const { data: orgSample } = await supabase
    .from('organizers')
    .select('id, slug, display_name, homepage_url, source')
    .order('created_at', { ascending: false })
    .limit(5);
  save('07-sample-organizers.json', orgSample);

  // 11. Text length distribution (500-row sample)
  const { data: textSample } = await supabase
    .from('events')
    .select('title_en, title_sv, description_en, description_sv')
    .limit(500);
  const buckets = {
    title_en: bucketChars((textSample ?? []).map((r: any) => r.title_en)),
    title_sv: bucketChars((textSample ?? []).map((r: any) => r.title_sv)),
    description_en: bucketChars((textSample ?? []).map((r: any) => r.description_en)),
    description_sv: bucketChars((textSample ?? []).map((r: any) => r.description_sv)),
  };
  results.text_length_buckets_sample_n500 = buckets;
  save('08-text-length-buckets.json', buckets);

  // 12. Confidence score distribution (500-row sample)
  const { data: confSample } = await supabase
    .from('events')
    .select('confidence_score')
    .limit(500);
  const confBuckets: Record<string, number> = {};
  for (const r of confSample ?? []) {
    const c = (r as any).confidence_score;
    if (c === null || c === undefined) {
      confBuckets['null'] = (confBuckets['null'] ?? 0) + 1;
    } else {
      const bucket = Math.floor(c / 10) * 10;
      const key = `${bucket}-${bucket + 9}`;
      confBuckets[key] = (confBuckets[key] ?? 0) + 1;
    }
  }
  results.confidence_distribution_sample_n500 = confBuckets;
  save('09-confidence-distribution.json', confBuckets);

  // 13. Image URL host distribution (top 30)
  const { data: imageRows } = await supabase
    .from('events')
    .select('image_url')
    .not('image_url', 'is', null)
    .limit(2000);
  const hostCounts: Record<string, number> = {};
  for (const r of imageRows ?? []) {
    const url = (r as any).image_url as string | null;
    if (!url) continue;
    try {
      const h = new URL(url).host;
      hostCounts[h] = (hostCounts[h] ?? 0) + 1;
    } catch {
      hostCounts.__invalid__ = (hostCounts.__invalid__ ?? 0) + 1;
    }
  }
  const hostRanking = Object.entries(hostCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([host, count]) => ({ host, count }));
  results.image_url_hosts_top30 = hostRanking;
  save('10-image-url-hosts-top30.json', hostRanking);

  save('00-summary.json', results);
  console.log('done');
}

main().catch((err) => {
  console.error('audit query failed', err);
  process.exit(1);
});