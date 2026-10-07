#!/usr/bin/env node
/**
 * _generate_bfl_round4.mjs — generera 2 extra theatre-drama-bilder för
 * att kompensera för de 2 D_detail-bilder som BFL genererade med handske+kniv
 * trots anti-variationer (close-up-pattern triggar händer-motiv).
 *
 * Använder BARA patterns som inte close-up:ar händer:
 *   - A_wide (wide shots)
 *   - C_environment (tomma scener)
 *
 *   node scripts/_generate_bfl_round4.mjs [--dry-run]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY && !process.argv.includes('--dry-run')) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;

const dryRun = process.argv.includes('--dry-run');
const root = join(process.cwd(), 'local_image_library');

// Hårdkodade prompts — kopierade från v4 men med extra anti-kniv-fraser
// och INGEN close-up av händer.
const NEW_PROMPTS = [
  {
    pattern: 'A_wide',
    prompt: 'Wide establishing shot of a grand Stockholm theater interior before a performance begins, ornate gilded balcony railings in the foreground, plush red velvet seats stretching back into soft shadow, a single figure in dark formal wear standing still on the dim stage, no hands or implements visible, warm chandelier light spilling from above.',
  },
  {
    pattern: 'C_environment',
    prompt: 'Empty theater stage between rehearsals at a Stockholm Dramaten venue, dust suspended in shafts of afternoon light from tall windows, scattered scripts and an untouched coffee cup on a side table, the wooden floor scuffed from footwork, no person close to camera, focus on architectural space and quiet mood.',
  },
];

async function generateOne(prompt, width = 1024, height = 576) {
  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width, height, steps: 28, prompt_upsampling: false }),
  });
  if (!submit.ok) throw new Error(`BFL submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { id, polling_url } = await submit.json();

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(polling_url, { headers: { 'x-key': BFL_KEY, accept: 'application/json' } });
    if (!poll.ok) throw new Error(`BFL poll ${poll.status}`);
    const pd = await poll.json();
    if (pd.status === 'Ready') {
      const img = await fetch(pd.result.sample);
      if (!img.ok) throw new Error(`image fetch ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      return { buf, id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error(`BFL timeout`);
}

const cat = 'theatre-drama';
const dir = join(root, cat);
mkdirSync(dir, { recursive: true });

console.log(`Genererar 2 round4-theatre-drama-bilder (A_wide + C_environment)…`);

for (let i = 0; i < NEW_PROMPTS.length; i++) {
  const p = NEW_PROMPTS[i];
  const hash = createHash('sha256').update(p.prompt + 'r4').digest('hex').slice(0, 10);
  const fname = `bfl4_${p.pattern.toLowerCase()}_r0_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);

  if (existsSync(imgPath) && existsSync(metaPath)) {
    console.log(`  skip ${cat}/${fname}.png`);
    continue;
  }

  if (dryRun) {
    console.log(`  [dry-run] skulle generera ${cat}/${fname}.png`);
    continue;
  }

  try {
    const { buf, id, seed } = await generateOne(p.prompt);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: cat,
      pattern: p.pattern,
      rep: 0,
      round: 4,
      prompt: p.prompt,
      model: 'flux-pro-1.1',
      bfl_id: id,
      seed,
      generated_at: new Date().toISOString(),
      bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
      replacement_for: 'knife_glove_review_2026-10-07_r4',
    }, null, 2));
    console.log(`  ✓ ${cat}/${fname}.png (${buf.length} bytes)`);
  } catch (err) {
    console.error(`  ✗ ${cat}/${fname}.png: ${err.message}`);
  }
}
console.log(`Klart.`);