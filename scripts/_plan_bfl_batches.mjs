#!/usr/bin/env node
/**
 * _plan_bfl_batches.mjs — multiplicera 5 mönster per kategori till totalt 163
 * bildgenereringar (mål 30 events/bild). Skriver ut batch-plan + total lista.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TARGET_EVENTS_PER_IMAGE = 30;
const MIN_BATCH = 4; // minst 4 av 5 mönster per kategori

const cats = readdirSync('tmp_image_corpus')
  .filter((f) => f.endsWith('_full.json'))
  .map((f) => f.replace('_full.json', ''));

const plan = [];
let grandTotal = 0;
for (const cat of cats) {
  const full = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_full.json`), 'utf8'));
  const prompts = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_prompts_v3.json`), 'utf8'));

  const need = full.approx_images_needed;
  if (need === 0) continue;

  // Vi har 5 mönster. För att nå `need` bilder multiplicerar vi varje mönster ceil(need/5) ggr.
  const repetitions = Math.max(1, Math.ceil(need / 5));
  const total = repetitions * 5;

  const items = [];
  for (let r = 0; r < repetitions; r++) {
    for (const p of prompts.prompts) {
      items.push({ cat, prompt: p.prompt, pattern: p.pattern, rep: r });
    }
  }
  plan.push({ cat, need, repetitions, total, items });
  grandTotal += total;
}

writeFileSync('tmp_image_corpus/_bfl_plan.json', JSON.stringify(plan, null, 2));

console.log('BFL batch-plan (30 events/bild, 5 mönster per repetition):');
console.log('');
console.log('category'.padEnd(20) + 'need'.padStart(6) + 'reps'.padStart(6) + 'total'.padStart(7));
console.log('-'.repeat(40));
for (const p of plan) {
  console.log(p.cat.padEnd(20) + String(p.need).padStart(6) + String(p.repetitions).padStart(6) + String(p.total).padStart(7));
}
console.log('-'.repeat(40));
console.log('TOTALT'.padEnd(20) + ' '.repeat(6) + ' '.repeat(6) + String(grandTotal).padStart(7));
console.log(`\n→ tmp_image_corpus/_bfl_plan.json`);
console.log(`BFL-credits (1 per bild, flux-pro-1.1): ~${grandTotal} av 1000`);