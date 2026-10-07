#!/usr/bin/env node
/**
 * _gather_category_corpus.mjs
 *
 * Sammanställer rå korpus per kategori för bibliotek-bristkategorier.
 * Skriver ut:
 *   - antal events per kategori
 *   - ordmoln-signaler (vanligaste orden i titlar + råbeskrivningar)
 *   - 3 representativa titlar/venue-kombinationer
 *   - JSON-fil per kategori med alla titlar + descriptions för vidare klustring
 *
 * node scripts/_gather_category_corpus.mjs
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function fetchAllRows(table, select, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// 1) image_library-fyllnad
const library = await fetchAllRows('image_library', 'category_slug');

const libCount = new Map();
for (const r of library) {
  const k = r.category_slug ?? '(null)';
  libCount.set(k, (libCount.get(k) ?? 0) + 1);
}

// 2) framtida events, bara de vi bryr oss om
console.log('Hämtar events…');
const events = await fetchAllRows(
  'events',
  'id,title_sv,title_en,description_sv,description_en,raw_description,venue_id,start_time,category_slug,image_url'
);
const now = Date.now();
const future = events.filter((e) =>
  e.status !== 'unlisted' && new Date(e.start_time).getTime() >= now
);

// 3) Hämta venues för att kunna ge kontext
const venues = await fetchAllRows('venues', 'id,name,slug');

// venue id → name
const venueName = new Map(venues.map((v) => [v.id, v.name]));

// 4) Hitta bristkategorier (library == 0 eller väldigt få)
const deficitCats = [];
const seen = new Set(future.map((e) => e.category_slug ?? '(null)'));
for (const c of seen) {
  const n = future.filter((e) => (e.category_slug ?? '(null)') === c).length;
  const lib = libCount.get(c) ?? 0;
  deficitCats.push({ cat: c, events: n, library: lib });
}
deficitCats.sort((a, b) => b.events - a.events);

console.log('');
console.log('Bristsituation per kategori (framtida events vs library-bilder):');
console.log('');
console.log('category_slug'.padEnd(20) + 'events'.padStart(8) + 'library'.padStart(10) + 'need_new'.padStart(12));
console.log('-'.repeat(50));
for (const d of deficitCats) {
  const needNew = Math.max(0, Math.ceil(d.events / 100) - d.library); // ~1 bild per 100 events som tumregel
  console.log(
    d.cat.padEnd(20) +
    String(d.events).padStart(8) +
    String(d.library).padStart(10) +
    String(needNew).padStart(12)
  );
}

// 5) Skapa JSON-korpus per bristkategori
const outDir = join(process.cwd(), 'tmp_image_corpus');
mkdirSync(outDir, { recursive: true });

const stop = new Set(`
  om och att det som för med av på är i till en vi inte men den de
  the a an of to in for is and or at be this that we you they our
  sig har kan man sina sina sitt från med under utan efter över
  ska ska kommer går blir gör tar ger vid mer än hos vilken vilka
  alla alla här där när då ännu redan bara också även sedan alltid
  inget ingen inga mycket lite fler mest färre
  säger sa säger sade berättar handlar handlar om handlar
  boka boka köp pris priset biljett biljetter fri entré gratis
  stockholm stad city
  i pågår pågår löpande
`
  .trim()
  .split(/\s+/));

function tokens(s) {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

for (const d of deficitCats) {
  if (d.events < 20) continue; // bara kategorier med substans
  const rows = future
    .filter((e) => (e.category_slug ?? '(null)') === d.cat)
    .map((e) => ({
      id: e.id,
      title_sv: e.title_sv,
      title_en: e.title_en,
      desc_sv: e.description_sv?.slice(0, 400),
      desc_en: e.description_en?.slice(0, 400),
      raw: e.raw_description?.slice(0, 400),
      venue: venueName.get(e.venue_id) ?? null,
      start: e.start_time,
      has_img: !!e.image_url,
    }));

  // Enkel ord-räkning
  const freq = new Map();
  for (const r of rows) {
    for (const t of tokens([r.title_sv, r.title_en, r.desc_sv, r.desc_en, r.raw].filter(Boolean).join(' '))) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

  // 3 representativa titlar + venues
  const samples = rows.slice(0, 5).map((r) => ({ title: r.title_sv || r.title_en, venue: r.venue }));

  const json = {
    category_slug: d.cat,
    events: d.events,
    library_count: d.library,
    approx_images_needed: Math.max(1, Math.ceil(d.events / 100) - d.library),
    top_words: top,
    sample_events: samples,
    full_corpus: rows,
  };

  const fp = join(outDir, `${d.cat}.json`);
  writeFileSync(fp, JSON.stringify(json, null, 2));

  console.log('');
  console.log(`=== ${d.cat}  (${d.events} events, ${d.library} library, ~${json.approx_images_needed} nya) ===`);
  console.log('  Top ord:', top.slice(0, 12).map(([w, c]) => `${w}(${c})`).join(' '));
  console.log('  Sample:', samples.map((s) => s.title).join(' | '));
  console.log(`  → skrev ${fp}`);
}