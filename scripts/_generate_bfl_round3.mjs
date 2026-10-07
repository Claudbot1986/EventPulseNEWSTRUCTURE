#!/usr/bin/env node
/**
 * _generate_bfl_round3.mjs — generera 15 nya BFL-items som ERSÄTTER de
 * 15 olämpliga (handske+kniv) som vision-granskningen fångade 2026-10-07.
 *
 * Fördelning (samma som de som togs bort):
 *   theatre-drama    : 12 items
 *   dance            :  1 item
 *   exhibition       :  1 item
 *   talks-lectures   :  1 item
 *
 * För varje kategori bygger vi items från befintliga v4-prompts (5 mönster)
 * och väljer N uppsättningar × 5 mönster. För att undvika handske+kniv-
 * motiv varje gång lägger vi till anti-motiv-fraser i variations-poolen.
 *
 * Användning:
 *   node scripts/_generate_bfl_round3.mjs
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Variations-pool: varje variation är konstruerad för att styra bort från
// handske + kniv-motiv och in mot neutrala Stockholm-miljöer. Vi använder
// ALLA variationer för att maximera chansen att någon variant undviker
// problematiska motiv — BFL är stokastiskt.
const VARIATIONS = [
  'in warm window-lit indoor setting, hands naturally resting at sides or in pockets, no tools or props in hands',
  'under soft overcast Nordic daylight, no sharp objects, no gloves, hands empty',
  'with a subtle cinematic atmosphere, focus on faces and expressions, hands not visible or holding everyday items only',
  'during a quiet weekday matinee, audience members seated calmly, no threatening imagery, hands relaxed',
  'with shallow depth of field focused on a stage area, no close-up of hands, no implements visible',
  'in soft diffused daylight, people standing or seated naturally, no weapons, no cutting tools, hands ungloved',
  'under neutral cool interior lighting, empty stage or gallery space, no close-up of hands or implements',
  'with rich saturated color palette of the venue itself, no person close to camera, focus on architecture',
  'shot from a wide audience angle showing the whole venue, hands small and indistinct, no objects in hands',
  'shot from an elevated balcony angle, focus on spatial composition, hands not visible in foreground',
  'with calm ambient warmth, no sudden movements, no aggressive gestures, hands at rest',
  'in a peaceful cultural venue interior, people walking or standing calmly, hands free of objects',
];

const CATEGORY_PLAN = {
  'theatre-drama': 12,
  'dance': 1,
  'exhibition': 1,
  'talks-lectures': 1,
};

async function generateFor(cat, targetCount) {
  const v4Path = join('tmp_image_corpus', `${cat}_prompts_v4.json`);
  if (!existsSync(v4Path)) {
    return { cat, error: 'no v4 prompts' };
  }
  const v4 = JSON.parse(readFileSync(v4Path, 'utf8'));
  const v4Prompts = v4.prompts || [];
  if (v4Prompts.length < 4) {
    return { cat, error: 'too few patterns' };
  }

  // Bygg items: mål = targetCount items, fördelat jämnt över v4-prompts
  // (mönster). För variation: rotera bland variations, plus bas-prompt.
  const items = [];
  for (let i = 0; i < targetCount; i++) {
    const promptObj = v4Prompts[i % v4Prompts.length];
    const rep = Math.floor(i / v4Prompts.length);
    const variation = VARIATIONS[(i * 5) % VARIATIONS.length];
    const basePrompt = promptObj.prompt;
    // Sätt in variations-frasen i slutet (eller byt ut om den slutar med .)
    let prompt;
    if (basePrompt.endsWith('.')) {
      prompt = basePrompt.slice(0, -1) + `, ${variation}.`;
    } else {
      prompt = `${basePrompt}, ${variation}`;
    }
    items.push({
      category: cat,
      pattern: promptObj.pattern,
      rep,
      prompt,
      seed: `r3-${i}`,
      jev_q1: v4.jev_q1,
      jev_q2: v4.jev_q2,
      model: v4.model,
      replacement_for: 'knife_glove_review_2026-10-07',
    });
  }

  return {
    category_slug: cat,
    jev_q1: v4.jev_q1,
    jev_q2: v4.jev_q2,
    model: v4.model,
    source_prompts_count: v4Prompts.length,
    target_count: targetCount,
    items,
  };
}

console.log(`Genererar round3-ersättningar för 15 olämpliga bilder…`);
let totalItems = 0;
for (const [cat, count] of Object.entries(CATEGORY_PLAN)) {
  const r = await generateFor(cat, count);
  if (r.error) {
    console.error(`  ✗ ${cat}: ${r.error}`);
    continue;
  }
  const outPath = join('tmp_image_corpus', `${cat}_prompts_round3.json`);
  writeFileSync(outPath, JSON.stringify(r, null, 2));
  totalItems += r.items.length;
  console.log(`  ✓ ${cat.padEnd(20)} ${r.items.length} items → ${outPath}`);
}
console.log(`\nKlart: ${totalItems} items att generera via BFL`);