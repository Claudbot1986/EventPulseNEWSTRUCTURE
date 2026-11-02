/**
 * scripts/backfill-editorial-for-events.ts — rikta beskrivnings-backfill.
 *
 * 2026-11-02 — användarens beslut: de events som saknar beskrivning ska
 * tas in i den nattliga ingestion-kedjan, och de som behöver ändring ska
 * backfillas.
 *
 * Det här skriptet kör den **ÄKTA produktionsvägen**
 * (`maybeRunEditorial` i 04-Normalizer/editorial/normalizerIntegration.ts) på
 * redan existerande rader. Samma grindar, samma brandvägg, samma fallback
 * som nattkedjan — skillnaden är bara att eventet redan finns i DB.
 *
 * Viktigt: skriptet bygger INTE profilen själv — det gör maybeRunEditorial
 * (via buildEventProfile), precis som i drift. Efter körningen har raden
 * både `event_profile` och `editorial_description` (prosa om grinden
 * klarar, annars den deterministiska FACT-texten).
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/backfill-editorial-for-events.ts \
 *     --ids-from=docs/audit/data/events-without-description-HEM-flow-2026-11-02.csv \
 *     --dry-run
 *   ... --apply
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { maybeRunEditorial } from '../04-Normalizer/editorial/normalizerIntegration';

const PROJECT_ROOT = process.cwd();

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const APPLY = process.argv.includes('--apply');
const idsFrom = argOf('ids-from');
const idsArg = argOf('ids');

let ids: string[] = [];
if (idsFrom) {
  ids = fs
    .readFileSync(path.resolve(PROJECT_ROOT, idsFrom), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(',')[0].replace(/"/g, '').trim())
    .filter(Boolean);
} else if (idsArg) {
  ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
}
if (ids.length === 0) {
  console.error('FATAL: ange --ids-from=<csv> eller --ids=a,b,c');
  process.exit(1);
}

process.env.EDITORIAL_ENABLED = '1';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(
  `BACKFILL: ${ids.length} events · läge: ${APPLY ? 'APPLY (skriver)' : 'DRY-RUN (skriver inte)'}\n`,
);

const rows: any[] = [];
let off = 0;
for (;;) {
  const { data, error } = await db
    .from('events')
    .select(
      'id,title_sv,title_en,category_slug,start_time,end_time,venue_full_name,venue_city,is_free,price_min_sek,source,raw_description,description_sv,description_en',
    )
    .in('id', ids)
    .range(off, off + 999);
  if (error) throw error;
  if (!data?.length) break;
  rows.push(...data);
  off += 1000;
  if (data.length < 1000) break;
}

// Parallellt — RpmGuarden i editorialWriter pacar MiniMax-anropen.
const stats = { prosa: 0, faktmall: 0, minimal: 0, fel: 0 };
const perSource = new Map<string, { prosa: number; annat: number }>();

await Promise.all(
  rows.map(async (ev) => {
    try {
      await maybeRunEditorial(
        { supabase: db },
        {
          event_id: ev.id,
          title: ev.title_sv || ev.title_en || '',
          title_sv: ev.title_sv || ev.title_en || undefined,
          category_slug: ev.category_slug,
          venue_name: ev.venue_full_name,
          city: ev.venue_city,
          start_time: ev.start_time,
          end_time: ev.end_time,
          price_min_sek: ev.price_min_sek,
          is_free: ev.is_free,
          language: 'sv',
          source: ev.source,
          raw_description: ev.raw_description || ev.description_sv || ev.description_en || null,
        },
      );
    } catch (err) {
      stats.fel++;
      console.log(`  ✗ ${ev.id}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }),
);

// Verifiera i DB (read-only)
const after: any[] = [];
off = 0;
for (;;) {
  const { data, error } = await db
    .from('events')
    .select('id,source,editorial_description,editorial_info_level,editorial_model,event_profile')
    .in('id', ids)
    .range(off, off + 999);
  if (error) throw error;
  if (!data?.length) break;
  after.push(...data);
  off += 1000;
  if (data.length < 1000) break;
}

for (const r of after) {
  const hasText = (r.editorial_description || '').trim().length > 0;
  const hasProfile = !!r.event_profile && Object.keys(r.event_profile).length > 0;
  if (hasText && r.editorial_info_level && r.editorial_info_level !== 'LOW' && r.editorial_info_level !== 'VERY_LOW') {
    stats.prosa++;
  } else if (hasText) {
    stats.faktmall++;
  } else {
    stats.fel++;
  }
  const b = perSource.get(r.source) ?? { prosa: 0, annat: 0 };
  if (hasText && r.editorial_info_level !== 'LOW' && r.editorial_info_level !== 'VERY_LOW') b.prosa++;
  else b.annat++;
  perSource.set(r.source, b);
}

console.log('\n=== RESULTAT ===');
console.log(`  prosa:    ${stats.prosa}`);
console.log(`  faktmall: ${stats.faktmall}`);
console.log(`  minimal:  ${stats.minimal}`);
console.log(`  utan text:${stats.fel}`);
console.log('\nper källa:');
for (const [s, b] of [...perSource.entries()].sort((a, b) => b[1].prosa - a[1].prosa)) {
  console.log(`  ${s.padEnd(26)} prosa=${b.prosa} annat=${b.annat}`);
}
if (!APPLY) console.log('\n(inget skrevs — lägg till --apply)');
