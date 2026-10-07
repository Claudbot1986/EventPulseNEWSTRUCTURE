#!/usr/bin/env node
/**
 * _gather_descriptions_full.mjs — sammanställer HELA beskrivningskorpusen
 * per bristkategori (inte bara nyckelord).
 *
 * Bygger en state-fil som M3 ska se:
 *   category_slug
 *   events_count
 *   library_now
 *   sample_events_with_full_descriptions   (15-20 st)
 *   corpus_signature   (typisk mening, längdfördelning, vanligaste fraserna)
 *   description_examples   (10 utvalda representativa description_sv/en)
 *
 * Skriver tmp_image_corpus/<cat>_full.json som input till promptgeneratorn.
 *
 *   node scripts/_gather_descriptions_full.mjs
 *   node scripts/_gather_descriptions_full.mjs --only theatre-drama
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');

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

console.log('Hämtar events…');
const events = await fetchAllRows(
  'events',
  'id,title_sv,title_en,description_sv,description_en,raw_description,venue_id,start_time,category_slug'
);
const venues = await fetchAllRows('venues', 'id,name');
const venueName = new Map(venues.map((v) => [v.id, v.name]));

const now = Date.now();
const future = events.filter((e) =>
  new Date(e.start_time).getTime() >= now
);

const libCount = new Map();
for (const cat of new Set(events.map((e) => e.category_slug ?? '(null)'))) {
  // Räkolna från befintlig _summary om den finns, annars hämta library
}
// Hämta library
const library = await fetchAllRows('image_library', 'category_slug');
for (const r of library) {
  const k = r.category_slug ?? '(null)';
  libCount.set(k, (libCount.get(k) ?? 0) + 1);
}

const seen = new Set(future.map((e) => e.category_slug ?? '(null)'));
let deficits = [...seen].map((c) => ({
  cat: c,
  events: future.filter((e) => (e.category_slug ?? '(null)') === c).length,
  library: libCount.get(c) ?? 0,
})).filter((d) => d.events >= 20 && d.library < 8)
  .sort((a, b) => b.events - a.events);

if (only) deficits = deficits.filter((d) => d.cat === only);

const outDir = 'tmp_image_corpus';
mkdirSync(outDir, { recursive: true });

function pickText(e) {
  return e.description_sv || e.description_en || e.raw_description || '';
}

function clipWords(s, n) {
  const words = s.split(/\s+/);
  if (words.length <= n) return s;
  return words.slice(0, n).join(' ') + '…';
}

for (const d of deficits) {
  const rows = future
    .filter((e) => (e.category_slug ?? '(null)') === d.cat)
    .map((e) => ({
      title: e.title_sv || e.title_en,
      venue: venueName.get(e.venue_id) ?? null,
      desc: pickText(e),
    }))
    .filter((r) => r.desc && r.desc.length > 50);

  // 1) Korpus-signatur: längd, typisk mening, unika adj/fras
  const lens = rows.map((r) => r.desc.length).sort((a, b) => a - b);
  const medianLen = lens[Math.floor(lens.length / 2)] ?? 0;
  const avgLen = lens.length ? Math.round(lens.reduce((s, n) => s + n, 0) / lens.length) : 0;
  const maxLen = lens.at(-1) ?? 0;

  // Ta första meningen från första 10 beskrivningar för att visa "tonen"
  const toneSamples = rows.slice(0, 10).map((r) => {
    const first = r.desc.split(/(?<=[.!?])\s+/)[0] ?? '';
    return clipWords(first, 36);
  }).filter(Boolean);

  // 2) 10 utvalda representativa beskrivningar (korta, för att rymmas i M3-context)
  // Välj spridning: korta, medellånga, långa
  const sample = [];
  const targets = [80, 200, 350, 500];
  for (const t of targets) {
    const near = rows.find((r) => Math.abs(r.desc.length - t) < 100);
    if (near && !sample.includes(near)) sample.push(near);
  }
  // Fyll på från början för säkerhets skull
  for (const r of rows) {
    if (sample.length >= 12) break;
    if (!sample.includes(r)) sample.push(r);
  }

  // 3) Nyckelfraser (2-grams) från alla beskrivningar
  const stop = new Set(`
    om och att det som för med av på är i till en vi inte men den de
    the a an of to in for is and or at be this that we you they our your
    sig har kan man sina sitt från med under utan efter över
    ska kommer går blir gör tar ger vid mer än hos vilken vilka
    alla här där när då ännu redan bara också även sedan alltid
    inget ingen inga mycket mest färre
    säger sa berättar handlar om
    boka köp pris priset biljett biljetter fri entré gratis stockholm stad
    evenemanget evenemang kväll kvällen tidigt
  `.trim().split(/\s+/));
  const bi = new Map();
  for (const r of rows) {
    const toks = r.desc.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
    for (let i = 0; i < toks.length - 1; i++) {
      const a = toks[i], b = toks[i + 1];
      if (stop.has(a) || stop.has(b)) continue;
      const k = `${a} ${b}`;
      bi.set(k, (bi.get(k) ?? 0) + 1);
    }
  }
  const topBigrams = [...bi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const out = {
    category_slug: d.cat,
    events: d.events,
    library_now: d.library,
    approx_images_needed: Math.max(1, Math.ceil(d.events / 100) - d.library),
    description_corpus_size: rows.length,
    median_desc_len: medianLen,
    avg_desc_len: avgLen,
    max_desc_len: maxLen,
    tone_samples: toneSamples,
    top_bigrams: topBigrams,
    sample_events_with_descriptions: sample.slice(0, 10).map((r) => ({
      title: r.title,
      venue: r.venue,
      description_preview: clipWords(r.desc, 80), // ~80 ord, ~1 mening
    })),
  };

  const fp = join(outDir, `${d.cat}_full.json`);
  writeFileSync(fp, JSON.stringify(out, null, 2));
  console.log(`✓ ${d.cat.padEnd(20)} events=${d.events} corpus=${rows.length} median=${medianLen}c → ${fp}`);
}