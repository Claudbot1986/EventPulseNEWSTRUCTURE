/**
 * scripts/preview-editorial-descriptions.ts
 *
 * FÖRHANDSVISNING — skriver INTE till databasen.
 *
 * Genererar nya beskrivningar med den FAKTA editorial-pipelinen (med den
 * rättade faktualitetsgaten) för ett urval events och skriver ut dem i en
 * tabell tillsammans med:
 *   - rå källbeskrivning (så man kan jämföra)
 *   - nuvarande beskrivning i DB
 *   - ny beskrivning (punkt 4)
 *   - similarity mot källtexten (upphovsrättsbevis)
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/preview-editorial-descriptions.ts
 *   node --env-file=.env --import tsx scripts/preview-editorial-descriptions.ts --music=10 --other=10
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MiniMaxM3LlmClient } from '../04-Normalizer/editorial/editorialWriter.ts';
import { runEditorialPipeline } from '../04-Normalizer/editorial/index.ts';
import { checkIndependence } from '../04-Normalizer/editorial/independenceCheck.ts';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const musicArg = args.find((a) => a.startsWith('--music='));
const otherArg = args.find((a) => a.startsWith('--other='));
const MUSIC_N = musicArg ? Number(musicArg.slice('--music='.length)) : 10;
const OTHER_N = otherArg ? Number(otherArg.slice('--other='.length)) : 10;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Urvalet: events som FALLBACK till faktmall (info_level=LOW) — de som
// fortfarande är tråkiga idag. Kategorier: music = musik, resten = icke-musik.
const { data: music } = await db
  .from('events')
  .select('id,title_sv,source,category_slug,start_time,venue_full_name,venue_city,is_free,price_min_sek,event_profile,raw_description,description_sv,editorial_description,editorial_info_level')
  .eq('category_slug', 'music')
  .eq('editorial_info_level', 'LOW')
  .not('event_profile', 'is', null)
  .not('editorial_description', 'is', null)
  .limit(MUSIC_N);

const { data: other } = await db
  .from('events')
  .select('id,title_sv,source,category_slug,start_time,venue_full_name,venue_city,is_free,price_min_sek,event_profile,raw_description,description_sv,editorial_description,editorial_info_level')
  .neq('category_slug', 'music')
  .eq('editorial_info_level', 'LOW')
  .not('event_profile', 'is', null)
  .not('editorial_description', 'is', null)
  .limit(OTHER_N);

const picks = [
  ...(music ?? []).map((e) => ({ ...e, kind: 'musik' })),
  ...(other ?? []).map((e) => ({ ...e, kind: 'icke-musik' })),
];

const llm = new MiniMaxM3LlmClient({ apiKey: process.env.MINIMAX_API_KEY! });
const out: any[] = [];

for (const ev of picks) {
  const profileRaw = (ev.event_profile as any)?.profile ?? ev.event_profile;
  const res: any = await runEditorialPipeline(
    {
      event: {
        title: ev.title_sv || '',
        title_sv: ev.title_sv,
        category_slug: ev.category_slug,
        start_time: ev.start_time,
        venue_name: ev.venue_full_name,
        city: ev.venue_city,
        is_free: ev.is_free,
        price_min_sek: ev.price_min_sek,
        language: 'sv',
        profile: profileRaw,
      } as any,
      sourceDescription: ev.raw_description || ev.description_sv || null,
      llm,
      maxAttempts: 2,
    } as any,
    { useNliJudge: true } as any,
  );

  const raw = (ev.raw_description || ev.description_sv || '') as string;
  const newText = String(res.text ?? res.final_text ?? '');
  const sim = checkIndependence({
    draft: {
      text: newText,
      word_count: 0,
      info_level: 'LOW',
      meta: { model: 'n/a', prompt_version: 'n/a', generated_at: new Date().toISOString() },
    },
    sourceDescription: raw,
  });

  out.push({
    kind: ev.kind,
    title: ev.title_sv,
    source: ev.source,
    category: ev.category_slug,
    raw,
    current: ev.editorial_description,
    current_level: ev.editorial_info_level,
    next: newText,
    next_status: res.status,
    similarity: sim.max_similarity,
  });
}

const clip = (s: string | null | undefined, n: number) =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

console.log('\n╔' + '═'.repeat(140) + '╗');
console.log('║ PUNKT 4 — FÖRHANDSVISNING (skriver INTE till DB)'.padEnd(141) + '║');
console.log('╚' + '═'.repeat(140) + '╝\n');

for (const kind of ['musik', 'icke-musik']) {
  const rows = out.filter((r) => r.kind === kind);
  if (!rows.length) continue;
  console.log(`\n━━━ ${kind.toUpperCase()} (${rows.length} st) ━━━\n`);
  console.log(
    'Nr | Titel                                        | Källa                  | RÅ källbeskrivning (utdrag)',
  );
  console.log('─'.repeat(150));
  rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)} | ${clip(r.title, 42).padEnd(42)} | ${clip(r.source, 22).padEnd(22)} | ${clip(r.raw, 78)}`);
  });
  console.log('\n   — samma rader, GAMMAL vs NY beskrivning —\n');
  rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${clip(r.title, 60)}`);
    console.log(`    GAMMAL (${r.current_level}, faktmall): ${clip(r.current, 150)}`);
    console.log(`    NY     (${r.next_status}): ${clip(r.next, 150)}`);
    console.log(`    similarity mot råtext: ${r.similarity.toFixed(3)}`);
    console.log('');
  });
}

const prosa = out.filter((r) => r.next_status === 'passed').length;
const maxSim = out.length ? Math.max(...out.map((r) => r.similarity)) : 0;
const avgSim = out.length ? out.reduce((a, r) => a + r.similarity, 0) / out.length : 0;
console.log('═'.repeat(100));
console.log(`SAMMANFATTNING: ${out.length} events · ${prosa} klarar grinden (prosa) · max similarity ${maxSim.toFixed(3)} · medel ${avgSim.toFixed(3)}`);
console.log('Ingen rad skrevs till databasen.');

const outDir = resolve(PROJECT_ROOT, 'docs/audit/data');
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `punkt4-forshandsvisning-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(`Fullständig data: ${file}`);
