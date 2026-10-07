#!/usr/bin/env node
/**
 * _generate_bfl_torka_replacement.mjs — generera 1 ny säker community-bild
 * som ersätter den creepy "Torka aldrig tårar utan handskar"-bilden.
 *
 * Den creepy bilden (maskerad person, intensiv blick, rök) användes av
 * 81 events som library_fallback. Vi ersätter med en varm, neutral
 * community-scen som funkar för alla typer av community-events.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;

// Säker community-prompt — Stockholm, varmt, inga nära ansikten, inga hotfulla motiv.
const PROMPT = 'Wide shot of a warm Stockholm community cultural center interior on Södermalm, soft afternoon daylight filling the space, simple stacked tables with coffee cups and reading materials, a few people seated calmly in the background reading or talking, wooden floors, plants on windowsills, neutral calm atmosphere, no close-up of faces, no threatening imagery, no tools or implements in hands, no gloves, welcoming everyday community scene.';
const HASH = createHash('sha256').update(PROMPT + 'community').digest('hex').slice(0, 10);
const FNAME = `bfl_replacement_community_${HASH}`;
const DIR = join(process.cwd(), 'local_image_library', 'community');

mkdirSync(DIR, { recursive: true });

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

console.log(`Genererar 1 community-ersättningsbild...`);
const { buf, id, seed } = await generateOne(PROMPT);
const imgPath = join(DIR, `${FNAME}.png`);
const metaPath = join(DIR, `${FNAME}.json`);
writeFileSync(imgPath, buf);
writeFileSync(metaPath, JSON.stringify({
  category_slug: 'community',
  pattern: 'replacement',
  rep: 0,
  round: 'community-replacement',
  prompt: PROMPT,
  model: 'flux-pro-1.1',
  bfl_id: id,
  seed,
  generated_at: new Date().toISOString(),
  bytes: buf.length,
  local_path: imgPath.replace(process.cwd() + '/', ''),
  replacement_for: 'torkaaldrigtrarutanhandskarblirmusikalsttsupppgtalejon-gtalejon',
}, null, 2));
console.log(`✓ ${imgPath} (${buf.length} bytes)`);
console.log(`Klart.`);