#!/usr/bin/env node
/**
 * _plan_bfl_round2.mjs — beräknar hur många ytterligare BFL-prompts vi behöver
 * för att nå 30 events/bild per kategori, baserat på aktuell DB-data.
 *
 * Output: tmp_image_corpus/_round2_plan.json med uppsättningar × 5 mönster.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const TARGET_EVENTS_PER_IMAGE = 30;
const MIN_IMAGES = 4;

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, select) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// Hämta library-räkning per kategori
const libAll = await fetchAll('image_library', 'category_slug');
const libByCat = {};
for (const r of libAll) {
  const c = r.category_slug ?? '(NULL)';
  libByCat[c] = (libByCat[c] || 0) + 1;
}

// Hämta framtida events per kategori — paginerat manuellt för säkerhets skull
const futureEvAll = [];
let from = 0;
while (true) {
  const { data, error } = await db
    .from('events')
    .select('category_slug')
    .eq('status', 'published')
    .gt('start_time', new Date().toISOString())
    .range(from, from + 999);
  if (error) throw error;
  if (!data || data.length === 0) break;
  futureEvAll.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const evByCat = {};
for (const r of futureEvAll) {
  const c = r.category_slug ?? '(NULL)';
  evByCat[c] = (evByCat[c] || 0) + 1;
}

const plan = [];
let grandTotalNew = 0;
let grandTotalUpsets = 0;

for (const cat of Object.keys(evByCat).sort()) {
  const ev = evByCat[cat];
  const im = libByCat[cat] || 0;
  const need = Math.max(MIN_IMAGES, Math.ceil(ev / TARGET_EVENTS_PER_IMAGE));
  if (need > im) {
    const deficit = need - im;
    // För varje 5 bilder behöver vi en ny uppsättning av 5 mönster
    const upsets = Math.ceil(deficit / 5);
    const itemsInThisCat = upsets * 5;
    grandTotalNew += deficit;
    grandTotalUpsets += upsets;
    plan.push({
      category: cat,
      events: ev,
      images: im,
      need,
      deficit,
      upsets,                  // antal uppsättningar × 5 mönster
      itemsInThisCat,          // totalt antal items att generera (= upsets * 5)
    });
  }
}

writeFileSync('tmp_image_corpus/_round2_plan.json', JSON.stringify(plan, null, 2));

console.log('Round 2 BFL-plan (mål 30 events/bild, min 4 bilder):');
console.log('');
console.log('Kategori'.padEnd(20), 'events'.padStart(7), 'imgs'.padStart(5), 'need'.padStart(5), 'deficit'.padStart(8), 'uppset'.padStart(7));
console.log('-'.repeat(60));
for (const p of plan) {
  console.log(p.category.padEnd(20), String(p.events).padStart(7), String(p.images).padStart(5), String(p.need).padStart(5), String(p.deficit).padStart(8), String(p.upsets).padStart(7));
}
console.log('-'.repeat(60));
console.log('TOTALT'.padEnd(20), ' '.padStart(7), ' '.padStart(5), ' '.padStart(5), String(grandTotalNew).padStart(8), String(grandTotalUpsets).padStart(7));
console.log('');
console.log(`→ tmp_image_corpus/_round2_plan.json`);
console.log(`BFL-credits (1/bild): ~${grandTotalNew} av 1500 kvar`);