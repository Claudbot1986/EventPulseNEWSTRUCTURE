#!/usr/bin/env node
/**
 * _generate_bfl_round5.mjs — generera BFL-bilder enligt EXAKT 1/30-events
 * regeln för kategorier med underskott i image_library.
 *
 * Källa:
 *   - tmp_image_corpus/_summary.json → events + library per kategori
 *   - tmp_image_corpus/<cat>_prompts_v4.json → 5 mönster (A/B/C/D/E)
 *
 * Regler (2026-10-07):
 *   - 1 bild per 30 events för kategorier med lib < ceil(events/30)
 *   - Skippa music/community (redan mättade: lib > ceil/30)
 *   - 4 mönster: A_wide / B_medium / C_environment / E_intimate (skippa D_detail)
 *   - Hård safety-fras i varje prompt:
 *       "no weapons, no knives, no blood, no gloves, no hands holding
 *        objects, no close-up faces of minors, no violence, child-safe imagery"
 *
 * Output:
 *   - tmp_image_corpus/<cat>_prompts_round5.json — plan (items + prompts)
 *   - Förhandsvisning i stdout (default --dry-run)
 *
 *   node scripts/_generate_bfl_round5.mjs [--apply]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const dryRun = !process.argv.includes('--apply');
const root = join(process.cwd(), 'tmp_image_corpus');

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly';

// Skippa D_detail helt — round3 visade att close-up-pattern triggar
// handskar/kniv-motiv även med anti-variationer.
const PATTERNS_USED = ['A_wide', 'B_medium', 'C_environment', 'E_intimate'];

const TARGET_PER_30 = 30; // 1 bild / 30 events
const MIN_IMAGES_FOR_SMALL = 20;  // användarbeslut 2026-10-08: < 50 events ⇒ minst 20 bilder
const SMALL_THRESHOLD = 50;        // under detta ⇒ min-regeln, över ⇒ 1/30

function loadSummary() {
  const path = join(root, '_summary.json');
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function need(events, library) {
  // Kvot-regel (användarbeslut 2026-10-08):
  //   events < 50 ⇒ target = MIN_IMAGES_FOR_SMALL (20)
  //   events ≥ 50 ⇒ target = ceil(events / 30)
  const target = events < SMALL_THRESHOLD ? MIN_IMAGES_FOR_SMALL : Math.ceil(events / TARGET_PER_30);
  return Math.max(0, target - library);
}

function buildPrompt(basePrompt, pattern, variationIdx) {
  // Mönster-specifika variationer — roterar fraser för att inte alla
  // bilder i samma kategori blir identiska.
  const A_VARIATIONS = [
    'in soft northern daylight, shallow depth of field, editorial Stockholm color tones',
    'with warm tungsten and window light mixed, ambient interior glow',
    'overcast Nordic daylight, muted color palette, atmospheric perspective',
    'late afternoon golden hour light, long shadows, calm mood',
  ];
  const B_VARIATIONS = [
    'candid moment mid-action, subjects seen in three-quarter view',
    'two or three figures mid-activity, documentary photography style',
    'subjects in natural poses, ambient room light, photojournalistic feel',
    'group moment with shared attention, soft available light',
  ];
  const C_VARIATIONS = [
    'no people in focus, focus on architecture and ambient details',
    'empty venue space between events, quiet stillness, soft light',
    'room geometry and atmospheric lighting, no foreground subjects',
    'objects and surfaces arranged naturally, no human presence',
  ];
  const E_VARIATIONS = [
    'human presence in silhouette or from behind, no close-up faces',
    'back-view or side-angle, emotional warmth through body language only',
    'subjects seen from a respectful distance, atmosphere over facial detail',
    'candid ambient moment, focus on surrounding light and space',
  ];

  const pool = pattern === 'A_wide' ? A_VARIATIONS
    : pattern === 'B_medium' ? B_VARIATIONS
    : pattern === 'C_environment' ? C_VARIATIONS
    : E_VARIATIONS;

  const variation = pool[variationIdx % pool.length];

  // Avsluta basePrompt med variation + safety-fras.
  let base = basePrompt.trim().replace(/[.,;:]\s*$/, '');
  return `${base}, ${variation}. ${SAFETY_SUFFIX}.`;
}

async function planFor(cat, info) {
  const v4Path = join(root, `${cat}_prompts_v4.json`);
  if (!existsSync(v4Path)) return { cat, error: 'no v4 prompts' };
  const v4 = JSON.parse(readFileSync(v4Path, 'utf8'));
  const promptsByPattern = Object.fromEntries(
    (v4.prompts || []).map((p) => [p.pattern, p.prompt])
  );

  const needCount = need(info.events, info.library);
  if (needCount === 0) return { cat, skipped: 'saturated' };

  const items = [];
  let i = 0;
  for (const pattern of PATTERNS_USED) {
    if (items.length >= needCount) break;
    if (!promptsByPattern[pattern]) continue; // pattern saknas i v4
    // Generera 1 bild per mönster × upprepningar tills vi når needCount.
    while (items.length < needCount) {
      const rep = Math.floor(items.length / PATTERNS_USED.length);
      const prompt = buildPrompt(promptsByPattern[pattern], pattern, items.length);
      items.push({
        category: cat,
        pattern,
        rep,
        prompt,
        jev_q1: v4.jev_q1,
        jev_q2: v4.jev_q2,
        model: v4.model,
        round: 5,
        seed: `r5-${i++}`,
        replacement_for: '1_per_30_image_library_2026-10-07',
      });
    }
  }

  return {
    category_slug: cat,
    events: info.events,
    library: info.library,
    target_count: needCount,
    jev_q1: v4.jev_q1,
    jev_q2: v4.jev_q2,
    model: v4.model,
    source_prompts_count: PATTERNS_USED.length,
    items,
  };
}

const summary = loadSummary();
const plan = {};
let total = 0;

for (const [cat, info] of Object.entries(summary)) {
  const r = await planFor(cat, info);
  if (r.error) { console.error(`  ✗ ${cat}: ${r.error}`); continue; }
  if (r.skipped) { console.log(`  · ${cat.padEnd(20)} saturated (${info.library}/${Math.ceil(info.events/30)})`); continue; }
  plan[cat] = r;
  total += r.items.length;
  console.log(`  ✓ ${cat.padEnd(20)} ${info.events} events / ${info.library} lib → ${r.items.length} nya (1/${TARGET_PER_30})`);
}

console.log(`\nTotalt: ${total} items i ${Object.keys(plan).length} kategorier (${dryRun ? 'dry-run' : 'apply'})`);

if (dryRun) {
  console.log(`\n[DRY-RUN] Skicka --apply för att skriva ${total} prompts-filer.`);
  // Visa första exemplet per mönster för sanity-check.
  const seen = new Set();
  for (const r of Object.values(plan)) {
    for (const it of r.items) {
      const k = `${r.category_slug}:${it.pattern}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`\n--- ${r.category_slug} / ${it.pattern} ---`);
      console.log(it.prompt);
      break;
    }
  }
  process.exit(0);
}

for (const [cat, r] of Object.entries(plan)) {
  const outPath = join(root, `${cat}_prompts_round5.json`);
  writeFileSync(outPath, JSON.stringify(r, null, 2));
  console.log(`  → ${outPath}`);
}
console.log(`\nKlart. Kör _generate_bfl_round5_images.mjs --apply för att skicka prompts till BFL.`);