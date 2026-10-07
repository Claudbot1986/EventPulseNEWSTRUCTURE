#!/usr/bin/env node
/**
 * _compute_word_probabilities.mjs
 *
 * Per kategori: räkna pointwise mutual information (PMI / TF-IDF) för ord
 * och bigrams. Output: tmp_image_corpus/<cat>_signal.json med
 *   - top_1grams_distinctive  (20 mest avslöjande enstaka ord)
 *   - top_2grams_distinctive  (15 mest avslöjande 2-grams)
 *   - baseline_freq            (rå-frekvens för transparens)
 *
 * Jämförelse görs mot ALLA framtida events (alla kategorier), inte bara
 * bristkategorier. Då blir signalen "hur unik för denna kategori".
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function fetchAllRows(table, select, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

console.log('Hämtar events + venues…');
const events = await fetchAllRows('events', 'id,category_slug,description_sv,description_en,raw_description,start_time');
const venues = await fetchAllRows('venues', 'id,name');
const venueName = new Map(venues.map((v) => [v.id, v.name]));

const now = Date.now();
const future = events.filter((e) => new Date(e.start_time).getTime() >= now);

function pickText(e) {
  return e.description_sv || e.description_en || e.raw_description || '';
}

const STOP = new Set(`
  om och att det som för med av på är i till en vi inte men den de
  the a an of to in for is and or at be this that we you they our your
  sig har kan man sina sitt från med under utan efter över
  ska kommer går blir gör tar ger vid mer än hos vilken vilka
  alla här där när då ännu redan bara också även sedan alltid
  inget ingen inga mycket mest färre
  säger sa berättar handlar om
  boka köp pris priset biljett biljetter fri entré gratis stockholm stad
  evenemanget evenemang kväll kvällen tidigt under hela
  sig själv själva deras dessa
  med vad äpå äi
  text musik av
`.trim().split(/\s+/));

function toks(s) {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function bigrams(toks) {
  const out = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i], b = toks[i + 1];
    if (STOP.has(a) || STOP.has(b)) continue;
    out.push(`${a} ${b}`);
  }
  return out;
}

// ── Byggra global term-frekvens för ALLA kategorier ────────────────────────
const global1 = new Map();
const global2 = new Map();
const catDocs = new Map();

for (const e of future) {
  const cat = e.category_slug ?? '(null)';
  const t = toks(pickText(e));
  if (t.length === 0) continue;
  if (!catDocs.has(cat)) catDocs.set(cat, { n: 0, terms1: new Map(), terms2: new Map() });
  const d = catDocs.get(cat);
  d.n += 1;
  const seen1 = new Set();
  for (const x of t) {
    if (seen1.has(x)) continue;
    seen1.add(x);
    d.terms1.set(x, (d.terms1.get(x) ?? 0) + 1);
    global1.set(x, (global1.get(x) ?? 0) + 1);
  }
  const seen2 = new Set();
  for (const x of bigrams(t)) {
    if (seen2.has(x)) continue;
    seen2.add(x);
    d.terms2.set(x, (d.terms2.get(x) ?? 0) + 1);
    global2.set(x, (global2.get(x) ?? 0) + 1);
  }
}

const totalDocs = future.length;
const N1 = global1.size;
const N2 = global2.size;

function tfidfScore(catCount, globalCount) {
  // TF-IDF: cat_count (= term frequency within cat) * log(N / global_count).
  // Robust för sällsynta ord. N = antal dokument globalt.
  if (globalCount === 0 || catCount === 0) return 0;
  return catCount * Math.log((totalDocs + 1) / (globalCount + 1));
}

// ── Generera signal-JSON per kategori som har brist ───────────────────────
const lib = await fetchAllRows('image_library', 'category_slug');
const libCount = new Map();
for (const r of lib) libCount.set(r.category_slug ?? '(null)', (libCount.get(r.category_slug ?? '(null)') ?? 0) + 1);

const deficits = [...catDocs.entries()]
  .map(([cat, d]) => ({
    cat,
    events: future.filter((e) => (e.category_slug ?? '(null)') === cat).length,
    library: libCount.get(cat) ?? 0,
    docs: d.n,
  }))
  .filter((d) => d.events >= 20 && d.library < 8)
  .sort((a, b) => b.events - a.events);

const outDir = 'tmp_image_corpus';
mkdirSync(outDir, { recursive: true });

console.log(`\nSannolikhetsmodell för ${deficits.length} kategorier:`);
for (const d of deficits) {
  const data = catDocs.get(d.cat);
  const top1 = [...data.terms1.entries()]
    .map(([w, c]) => ({ w, c, score: +tfidfScore(c, global1.get(w) ?? 0).toFixed(2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  const top2 = [...data.terms2.entries()]
    .map(([w, c]) => ({ w, c, score: +tfidfScore(c, global2.get(w) ?? 0).toFixed(2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  const out = {
    category_slug: d.cat,
    events: d.events,
    docs: data.n,
    top_1grams_distinctive: top1,
    top_2grams_distinctive: top2,
    note: 'score = cat_count * log(N / global_count). Higher = more distinctive for this category.',
  };
  writeFileSync(join(outDir, `${d.cat}_signal.json`), JSON.stringify(out, null, 2));

  console.log(`  ${d.cat.padEnd(20)} top1=[${top1.slice(0, 4).map((x) => `${x.w}(${x.score})`).join(', ')}] top2=[${top2.slice(0, 3).map((x) => `${x.w}(${x.score})`).join(' | ')}]`);
}
console.log('\nKlart. Varje kategori har nu _signal.json med PMI-viktade toppord.');