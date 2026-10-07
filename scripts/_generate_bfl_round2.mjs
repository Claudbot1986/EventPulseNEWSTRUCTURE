#!/usr/bin/env node
/**
 * _generate_bfl_round2.mjs — generera varianter av v4-prompts för round 2.
 *
 * Tar befintliga v4-prompts (5 mönster per kategori) och skapar N uppsättningar
 * × 5 mönster per kategori baserat på round2-planen. För variation används
 * små word-bokser som läggs till/på-s BES mot promptsarna (different variable naming).
 *
 * Exempel för theatre-drama:
 *   v4:    5 mönster (uppsättning 0)
 *   round2: 11 uppsättningar × 5 mönster = 55 items
 *
 * Output: tmp_image_corpus/<cat>_prompts_round2.json (items-lista, inte prompts-objekt)
 *
 * Användning:
 *   node scripts/_generate_bfl_round2.mjs [--only theatre-drama]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Word-bokser för variation — små neutrala adj-fraser som kan läggas in.
// Vi fäster dem i mitten av prompten för att inte störa strukturen.
const VARIATIONS = [
  'in warm evening light',
  'under overcast Nordic daylight',
  'with subtle cinematic atmosphere',
  'during a quiet weekday matinee',
  'on a busy weekend evening',
  'with a hint of golden hour glow',
  'in soft diffused daylight',
  'under dramatic cool lighting',
  'with rich saturated color palette',
  'shot from a low audience angle',
  'shot from an elevated balcony angle',
  'with shallow depth of field',
];

async function generateVariants(cat) {
  const v4Path = join('tmp_image_corpus', `${cat}_prompts_v4.json`);
  if (!existsSync(v4Path)) {
    console.error(`  ✗ ${cat}: saknar v4-prompts`);
    return { cat, error: 'no v4 prompts' };
  }
  const v4 = JSON.parse(readFileSync(v4Path, 'utf8'));
  const v4Prompts = v4.prompts || [];
  if (v4Prompts.length < 4) {
    console.error(`  ✗ ${cat}: v4-prompts har för få mönster (${v4Prompts.length})`);
    return { cat, error: 'too few patterns' };
  }

  const planPath = join('tmp_image_corpus', '_round2_plan.json');
  if (!existsSync(planPath)) {
    console.error(`  ✗ _round2_plan.json saknas — kör _plan_bfl_round2.mjs först`);
    return { cat, error: 'no round2 plan' };
  }
  const plans = JSON.parse(readFileSync(planPath, 'utf8'));
  const entry = plans.find((p) => p.category === cat);
  if (!entry) {
    return { cat, skipped: true };
  }
  const upsets = entry.upsets;

  // Bygg items-lista: för varje uppsättning × 5 mönster
  // Uppsättning 0 = original v4-prompts, uppsättning 1-N = variant av uppsättning 0
  const items = [];
  for (let s = 0; s < upsets; s++) {
    for (let p = 0; p < v4Prompts.length; p++) {
      const promptObj = v4Prompts[p];
      let prompt = promptObj.prompt;
      const seed = `${s}-${p}`;
      if (s > 0) {
        // Lägg till variations-fras på en slumpmässig plats (efter 2nd mening eller i slutet)
        const variation = VARIATIONS[(s * 3 + p) % VARIATIONS.length];
        if (prompt.endsWith('.')) {
          prompt = prompt.slice(0, -1) + `, ${variation}.`;
        } else {
          prompt = `${prompt}, ${variation}`;
        }
      }
      items.push({
        category: cat,
        pattern: promptObj.pattern,
        rep: s,
        prompt,
        seed,                  // används i filnamnet för att hålla isklar varianter
        jev_q1: v4.jev_q1,
        jev_q2: v4.jev_q2,
        model: v4.model,
      });
    }
  }

  const out = {
    category_slug: cat,
    jev_q1: v4.jev_q1,
    jev_q2: v4.jev_q2,
    model: v4.model,
    source_set_count: upsets,
    source_prompts_count: v4Prompts.length,
    items,
  };
  writeFileSync(join('tmp_image_corpus', `${cat}_prompts_round2.json`), JSON.stringify(out, null, 2));
  return { cat, ok: true, items: items.length, upsets };
}

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');

const plans = JSON.parse(readFileSync(join('tmp_image_corpus', '_round2_plan.json'), 'utf8'));
const cats = (only ? [only] : plans.map((p) => p.category)).filter((c) => {
  // Hoppa över kategorier utan korpus-vorer.
  // Korpus kräver att vi har full.json
  return existsSync(join('tmp_image_corpus', `${c}_full.json`));
});

console.log(`Genererar round2-varianter för ${cats.length} kategorier…`);

let totalItems = 0;
for (const cat of cats) {
  const r = await generateVariants(cat);
  if (r.ok) {
    totalItems += r.items;
    console.log(`  ✓ ${cat.padEnd(20)} ${r.items} items (${r.upsets} uppsättningar × ${Math.floor(r.items / r.upsets)} mönster)`);
  } else if (!r.skipped) {
    console.error(`  ✗ ${cat}: ${r.error}`);
  }
}
console.log(`\nKlart: ${totalItems} items att generera via BFL`);
console.log(`→ tmp_image_corpus/<cat>_prompts_round2.json`);