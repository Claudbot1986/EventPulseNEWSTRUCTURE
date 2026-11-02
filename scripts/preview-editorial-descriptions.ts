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
/**
 * --random=<seed> — slumpmässigt urval i stället för "första N raderna".
 *
 * Utan denna flagga är urvalet ORDNINGSBEROENDE: PostgREST returnerar raderna
 * i insertordning, så de första N innehåller kluster från samma källa
 * (t.ex. spelning-se) och ger en skev omvandlingsrate. Med flaggan blir
 * urvalet representativt för hela LOW-populationen.
 */
const randomArg = args.find((a) => a.startsWith('--random='));
const RANDOM_SEED = randomArg ? randomArg.slice('--random='.length) : null;
/**
 * --nli=1 aktiverar NLI-judgen (M3 som stöddomare för oVerifierbara claims).
 *
 * DEFAULT = AV, vilket är vad PRODUKTIONEN gör: `maybeRunEditorial`
 * (04-Normalizer/editorial/normalizerIntegration.ts) anropar
 * `runEditorialPipeline` utan `useNliJudge`. Förhandsvisningen ska spegla
 * produktion — annars mäter man något som aldrig händer i drift.
 * Med --nli=1 kan man mäta hur mycket NLI-judgen faktiskt bidrar.
 */
const nliArg = args.find((a) => a.startsWith('--nli='));
const USE_NLI = nliArg ? nliArg.slice('--nli='.length) === '1' : false;

/** Deterministisk shuffle (mulberry32) — samma seed → samma urval. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Urvalet: events som FALLBACK till faktmall (info_level=LOW) — de som
// fortfarande är tråkiga idag. Kategorier: music = musik, resten = icke-musik.
//
// VIKTIGT (2026-11-02): hämtar ALLA matchande rader och slumpar lokalt.
// PostgREST har ett tak på 1 000 rader per fråga, och `.limit(N)` utan
// ordering ger de första N i insertordning — ett ordningsberoende urval med
// kluster från samma källa och en skev omvandlingsrate.
const SELECT_COLS =
  'id,title_sv,source,category_slug,start_time,venue_full_name,venue_city,is_free,price_min_sek,event_profile,raw_description,description_sv,editorial_description,editorial_info_level';

async function fetchAllLow(): Promise<any[]> {
  const out: any[] = [];
  let off = 0;
  for (;;) {
    const { data, error } = await db
      .from('events')
      .select(SELECT_COLS)
      .eq('editorial_info_level', 'LOW')
      .not('event_profile', 'is', null)
      .not('editorial_description', 'is', null)
      .range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    off += 1000;
    if (data.length < 1000) break;
  }
  return out;
}

const allLow = await fetchAllLow();
let music = allLow.filter((e) => e.category_slug === 'music');
let other = allLow.filter((e) => e.category_slug !== 'music');

if (RANDOM_SEED) {
  music = seededShuffle(music, `${RANDOM_SEED}:music`);
  other = seededShuffle(other, `${RANDOM_SEED}:other`);
}

music = music.slice(0, MUSIC_N);
other = other.slice(0, OTHER_N);

const picks = [
  ...music.map((e) => ({ ...e, kind: 'musik' })),
  ...other.map((e) => ({ ...e, kind: 'icke-musik' })),
];

const llm = new MiniMaxM3LlmClient({ apiKey: process.env.MINIMAX_API_KEY! });
const out: any[] = [];

for (const ev of picks) {
  const profileRaw = (ev.event_profile as any)?.profile ?? ev.event_profile;
  // VIKTIGT (2026-11-02): 140 av 5 388 LOW-rader har TOM title_sv men har
  // title_en. Om bara title_sv används förlorar de sitt titel-prefix, och
  // fallback-mallen blir identisk för t.ex. 36 "Jesus Christ Superstar"-rader
  // och 24 "God Jul"-rader. Därför: title_sv → title_en → ''.
  const eventTitle = (ev.title_sv || ev.title_en || '').trim();
  const res: any = await runEditorialPipeline(
    {
      event: {
        title: eventTitle,
        title_sv: ev.title_sv || ev.title_en || undefined,
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
    { useNliJudge: USE_NLI } as any,
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
    id: ev.id,
    title: ev.title_sv,
    source: ev.source,
    category: ev.category_slug,
    raw,
    current: ev.editorial_description,
    current_level: ev.editorial_info_level,
    next: newText,
    next_status: res.status,
    // Ändrades texten alls mot den som redan ligger i DB?
    changed: newText.trim() !== String(ev.editorial_description ?? '').trim(),
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
const changed = out.filter((r) => r.changed).length;
const maxSim = out.length ? Math.max(...out.map((r) => r.similarity)) : 0;
const avgSim = out.length ? out.reduce((a, r) => a + r.similarity, 0) / out.length : 0;
console.log('═'.repeat(100));
console.log(`SAMMANFATTNING: ${out.length} events · ${prosa} klarar grinden (prosa) · ${changed} rader ändras · max similarity ${maxSim.toFixed(3)} · medel ${avgSim.toFixed(3)}`);
console.log(`POPULATION: ${allLow.length} LOW-rader i bas-tabellen (faktmall) — urvalet är ${RANDOM_SEED ? `slumpmässigt (seed=${RANDOM_SEED})` : 'ORDNINGsberoende (första N i insertordning)'}`);
console.log(`NLI-JUDGE: ${USE_NLI ? 'PÅ (--nli=1) — INTE produktionsläget' : 'AV (produktionsläget — maybeRunEditorial kör utan useNliJudge)'}`);
console.log('Ingen rad skrevs till databasen.');

const outDir = resolve(PROJECT_ROOT, 'docs/audit/data');
mkdirSync(outDir, { recursive: true });
const suffix = RANDOM_SEED ? `-${RANDOM_SEED}` : '';
const file = resolve(outDir, `punkt4-forshandsvisning-${new Date().toISOString().slice(0, 10)}${suffix}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      sample: RANDOM_SEED ? `random seed=${RANDOM_SEED}` : 'ordered (first N) — ordningsberoende',
      nli_judge: USE_NLI,
      population_low: allLow.length,
      population_low_music: allLow.filter((e) => e.category_slug === 'music').length,
      population_low_other: allLow.filter((e) => e.category_slug !== 'music').length,
      sample_size: out.length,
      prosa: prosa,
      changed: changed,
      max_similarity: maxSim,
      avg_similarity: avgSim,
      rows: out,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`Fullständig data: ${file}`);
