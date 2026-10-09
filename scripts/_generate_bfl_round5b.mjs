#!/usr/bin/env node
/**
 * _generate_bfl_round5b.mjs — ersätt de 60 flaggade bilderna (58 theatre-drama
 * + 2 kids) med nya prompts som undviker:
 *   - body_lying / dödsbädd
 *   - close-up-barnansikten
 *   - vapen, våld, knivar, blod
 *
 * Strategi:
 *   - theatre-drama: A_wide-prompt FOKUS på teater-scen utan kropp, ingen
 *     död, ingen dödsbädd. Ljussättning, foajé, ridå, publik från sidan.
 *   - kids: A_wide-prompt med publik-i-rörelse / scenen med rekvisita —
 *     INGA close-ups på barnansikten.
 *
 *   node scripts/_generate_bfl_round5b.mjs --apply
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY && !process.argv.includes('--dry-run')) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 180_000;
const CONCURRENCY = 2;

const dryRun = !process.argv.includes('--apply');
const root = join(process.cwd(), 'local_image_library');

async function generateOne(prompt) {
  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: 1024, height: 576, steps: 28, prompt_upsampling: false }),
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
      return { buf: Buffer.from(await img.arrayBuffer()), id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error(`BFL timeout (180s)`);
}

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly, no bodies lying down, no death scenes, no funeral scenes';

// ── 58 nya theatre-drama-prompts (varierade scen-beskrivningar) ──
const THEATRE_DRAMA_PROMPTS = [
  'Wide editorial photograph of a Stockholm theater stage during the rehearsal break between acts. Empty rows of velvet seats in soft house light, gilded balcony railings warm in the upper reaches, a single spot illuminates a closed red curtain. Calm intermission atmosphere, no people in frame, no events occurring, no bodies.',
  'Wide editorial photograph of a Stockholm stage seen from the upper balcony during a quiet dress rehearsal. The wooden stage floor catches a wash of cool blue light, a few scattered scripts on a side table, no performers visible. Architectural composition, theatrical but peaceful, no bodies lying, no death imagery.',
  'Wide editorial photograph of a Stockholm Dramaten auditorium from a side angle. Empty wooden seats in tiered rows lead down toward an empty stage bathed in soft amber work-light. A single closed curtain hangs in folds. Quiet anticipation mood, no people in frame, no somber themes.',
  'Wide editorial photograph of a Stockholm theater lobby with plush red carpet and brass chandeliers. The auditorium doors stand open showing the distant glow of the stage. No people visible, architectural focus, warm interior tones, calm and welcoming atmosphere.',
  'Wide editorial photograph of a Stockholm theater stage at intermission, viewed from behind the audience. House lights reveal the backs of heads in soft focus while the curtain remains closed on a dim stage. Warm tungsten glow, no somber or death-related imagery.',
  'Wide editorial photograph of the gilded proscenium arch of a Stockholm theater, framing a softly lit stage with minimal set pieces: a wooden chair, a table with a vase of flowers. Empty seats in the foreground. Warm amber wash, peaceful composition, no body imagery.',
  'Wide editorial photograph of a Stockholm theater stage during technical rehearsal. Visible rig of overhead spotlights, a single chair center stage under a tight warm beam, dark backdrop. Industrial-theatrical mood, no somber scenes, no bodies.',
  'Wide editorial photograph of a Stockholm theater seen from the orchestra pit angle. Empty stage with rich red curtain, three-quarter view showing seats rising on both sides. Warm afternoon light filtering through high windows, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater foyer with marble floors and warm pendant lights. Staircases lead up toward balcony doors slightly ajar, a single coat check counter visible. Architectural peacefulness, no somber imagery, no people.',
  'Wide editorial photograph of a Stockholm stage with abstract minimal set — a single tall window-backdrop catching blue daylight, a wooden floor scuffed from rehearsal. Empty seats in shadow, no performers visible, calm pre-show atmosphere, no death imagery.',
  'Wide editorial photograph of a Stockholm theater auditorium at the moment the house lights dim, seen from the rear. Hundreds of empty seats catch a fading warm glow before a curtain begins to rise on a soft blue stage. Anticipatory and warm, no somber themes.',
  'Wide editorial photograph of a Stockholm theater during a daytime workshop. Open scripts and coffee cups on a side table, an empty stage with afternoon sun streaming through tall windows. Workshop atmosphere, candid and warm, no somber themes.',
  'Wide editorial photograph of a Stockholm theater lobby after a performance. Empty plush benches, scattered programs on a wooden table, the auditorium door ajar showing faint warm light from the stage. Post-show calm, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater from the side wing. Backstage ropes, sandbags, and a single work light illuminate a closed curtain. Industrial preparation mood, no somber or death-related themes.',
  'Wide editorial photograph of a Stockholm theater seen from the uppermost balcony. A vast sweep of empty seats leads down to a small stage where a single house light glows. Dramatic but peaceful composition, no somber mood.',
  'Wide editorial photograph of a Stockholm stage with a simple abstract set piece — a single suspended white cube catching blue stage light, polished wooden floor reflecting. Empty seats in shadow, minimalist and calm, no death scenes.',
  'Wide editorial photograph of a Stockholm theater auditorium seen from the box seats. Rich wood paneling frames a view down to the stage with a single closed curtain and warm work light. Elegant composition, no somber themes.',
  'Wide editorial photograph of a Stockholm theater during a morning rehearsal. Daylight streams through tall windows onto an empty stage with a few chairs and music stands. Calm start-of-day atmosphere, no somber or death-related imagery.',
  'Wide editorial photograph of a Stockholm theater stage framed by heavy red curtains pulled back. A simple white scrim backdrop catches blue light, no set pieces, no performers. Empty hall atmosphere, no somber mood.',
  'Wide editorial photograph of a Stockholm theater seen from the orchestra level center. The proscenium frames a softly lit stage with a single wooden stool center-stage. Warm amber work light, empty seats in tiered rows, peaceful composition, no death imagery.',
  'Wide editorial photograph of a Stockholm theater lobby during intermission. Patrons mill about with programs in hand, but the composition shows the architectural space more than individuals. Marble columns, brass chandeliers, warm tones, no somber themes.',
  'Wide editorial photograph of a Stockholm theater backstage. Rigging, costume rails with colorful garments, a single stage light glowing. Industrial preparation mood, no somber or death-related imagery.',
  'Wide editorial photograph of a Stockholm theater stage in profile. The wing of the set visible at left, the open stage catching a wash of warm amber, a closed curtain at right. Empty seats in shadow, theatrical but calm, no death scenes.',
  'Wide editorial photograph of a Stockholm theater auditorium seen from the stage looking out at empty seats. A single work light glows in the booth, warm wood tones. Reverse-viewpoint, peaceful composition, no somber mood.',
  'Wide editorial photograph of a Stockholm theater during set construction. Wooden flats being assembled on stage, tools and paint visible, work lights illuminating the scene. Active preparation, no somber themes, no bodies.',
  'Wide editorial photograph of a Stockholm theater auditorium from the upper balcony side. Rows of empty seats descend toward a softly lit stage with a single closed curtain. Warm tungsten glow, peaceful composition, no death imagery.',
  'Wide editorial photograph of a Stockholm theater lobby with art deco mirrors and brass fixtures. Daylight from a high skylight falls on empty benches, scattered programs on a table. Calm and welcoming, no somber themes.',
  'Wide editorial photograph of a Stockholm theater stage with rich red curtain closed, framing the proscenium arch with gilded moldings. A single house light glows at the apex. Empty hall atmosphere, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater at the close of a performance. The curtain is fully closed, house lights are coming up slowly, scattered programs left on seats. Post-show calm, warm tones, no somber themes.',
  'Wide editorial photograph of a Stockholm theater stage with a single chair and a vase of flowers under a soft warm spotlight. Empty seats in shadow, minimalist composition, peaceful atmosphere, no death imagery.',
  'Wide editorial photograph of a Stockholm theater auditorium from the box seats at a three-quarter angle. Empty seats, gilded railings, a single amber house light. Architectural elegance, warm tones, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater stage during a lighting check. Multiple colors of stage light sweep across an empty wooden floor, no set, no people. Technical preparation mood, peaceful composition, no somber themes.',
  'Wide editorial photograph of a Stockholm theater seen from the rear of the orchestra level. Tiered seats lead back toward the stage with a single warm spot. Empty hall mood, calm anticipation, no death imagery.',
  'Wide editorial photograph of a Stockholm theater with the curtain raised revealing an empty stage. Soft blue work light, polished wooden floor reflecting. Empty hall atmosphere, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater at midday between shows. Daylight fills the lobby, a coffee cup and program on a side table, the auditorium visible through open doors. Mid-day calm, no somber themes.',
  'Wide editorial photograph of a Stockholm theater auditorium from the side aisle. Seats in receding rows toward a softly lit stage with a closed curtain. Warm wood tones, peaceful composition, no death imagery.',
  'Wide editorial photograph of a Stockholm theater stage with abstract geometric set pieces — three tall white panels catching blue light, polished floor. Empty seats in shadow, minimalist mood, no somber themes, no death scenes.',
  'Wide editorial photograph of a Stockholm theater foyer with sweeping marble staircase leading up to balcony level. Brass banister, warm pendant lights, architectural grandeur. No people, peaceful composition, no somber mood.',
  'Wide editorial photograph of a Stockholm theater during a technical run. Stage manager at a prompt corner visible in silhouette, a closed curtain center stage. Operational mood, warm work light, no somber themes, no bodies lying.',
  'Wide editorial photograph of a Stockholm theater seen from the upper balcony center. A vast sweep of empty seats leads down to a small stage with a single spot. Calm anticipation, warm tones, no somber mood, no death imagery.',
  'Wide editorial photograph of a Stockholm theater lobby with plush red carpet and brass chandeliers. Patrons walking up a staircase seen from behind, no close-up faces. Architectural composition, warm interior, no death scenes.',
  'Wide editorial photograph of a Stockholm theater stage during a quiet moment between scene changes. A single chair center stage, a closed curtain, soft amber work light. Peaceful pre-scene atmosphere, no somber themes.',
  'Wide editorial photograph of a Stockholm theater auditorium from the side box. Rich wood paneling, a view down to the stage with a single warm spot, empty seats. Elegant composition, no somber mood, no death imagery.',
  'Wide editorial photograph of a Stockholm theater seen from the orchestra pit looking up at the stage. Proscenium arch frames an empty stage with a single closed curtain. Warm work light, no somber themes, no death scenes.',
  'Wide editorial photograph of a Stockholm theater at the moment before curtain rise. Audience in soft focus from behind, looking at a closed red curtain lit warm amber. Anticipation mood, no somber themes, no death imagery.',
  'Wide editorial photograph of a Stockholm theater backstage with costume rails, hats on hooks, a single warm work light. Industrial preparation mood, no somber themes, no death scenes, no bodies.',
  'Wide editorial photograph of a Stockholm theater stage with an empty wooden chair center stage, a closed curtain, soft amber wash. Empty hall atmosphere, peaceful composition, no somber mood, no death imagery.',
  'Wide editorial photograph of a Stockholm theater auditorium during the day with natural light through tall windows. Empty seats lead down to a softly lit stage. Calm mid-day atmosphere, no somber themes, no death scenes.',
  'Wide editorial photograph of a Stockholm theater lobby with mirrored walls reflecting brass chandeliers. No people visible, plush benches empty, warm tones. Architectural peacefulness, no somber mood.',
  'Wide editorial photograph of a Stockholm theater stage with a single suspended light bulb glowing warm amber above an empty wooden floor. Empty hall atmosphere, minimalist and calm, no somber themes, no death imagery.',
  'Wide editorial photograph of a Stockholm theater auditorium from the upper balcony with a view through to the stage. Closed curtain lit warm amber, empty seats descending. Anticipatory mood, no somber themes, no death scenes.',
  'Wide editorial photograph of a Stockholm theater during set strike after a show. Stage crew in silhouette rolling flats offstage, scattered props on the floor. Active post-show work, no somber themes, no bodies.',
  'Wide editorial photograph of a Stockholm theater foyer at the start of an evening. Warm pendant lights over marble floors, no patrons visible, programs stacked on a counter. Anticipatory calm, no somber mood, no death imagery.',
  'Wide editorial photograph of a Stockholm theater stage with the curtain raised, revealing a single wooden table and chair under warm amber light. Empty hall, minimalist composition, no somber themes, no death scenes.',
  'Wide editorial photograph of a Stockholm theater auditorium seen from the side wing of the stage. Stage edge visible, empty hall draped down, soft amber work light. Industrial-theatrical mood, no somber themes.',
  'Wide editorial photograph of a Stockholm theater during an afternoon rehearsal. A few scripts on a music stand center stage, daylight through tall windows. Calm preparation mood, no somber themes, no death imagery.',
  'Wide editorial photograph of a Stockholm theater seen from the uppermost balcony box. Empty seats descending to a small stage with a single warm spot. Architectural composition, no somber mood, no death scenes.',
  'Wide editorial photograph of a Stockholm theater lobby with art deco glass chandeliers and marble floors. Daylight from high windows, plush empty benches. Calm and welcoming, no somber themes, no bodies lying.',
];

// ── 2 nya kids-prompts (publik/rekvisita, EJ close-up-barnansikten) ──
const KIDS_PROMPTS = [
  'Wide editorial photograph of a Stockholm children\'s theater stage during a colorful puppet show performance. Audience members visible from behind in silhouette, bright puppets on stage, warm stage lighting. No close-up faces of children visible, focus on the stage and the backs of audience heads, family-friendly.',
  'Wide editorial photograph of a Stockholm children\'s theater lobby decorated with bright paper crafts and streamers. Empty benches with backpacks, scattered craft supplies on a wooden table, daytime daylight. No people in frame, focus on colorful decor, family-friendly atmosphere, no close-up faces.',
];

async function processItem({ category, pattern, rep, prompt }) {
  const dir = join(root, category);
  mkdirSync(dir, { recursive: true });
  // Använd ett unikt suffix för round5b så det inte kolliderar med befintliga hashar
  const hash = createHash('sha256').update(prompt + 'r5b').digest('hex').slice(0, 10);
  const fname = `bfl5b_${pattern.toLowerCase()}_r${rep}_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);
  if (existsSync(imgPath) && existsSync(metaPath)) return { ok: true, skipped: true };
  if (dryRun) return { ok: true, dryRun: true };
  try {
    const { buf, id, seed } = await generateOne(prompt);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: category, pattern, rep, round: '5b',
      prompt, model: 'flux-pro-1.1', bfl_id: id, seed,
      generated_at: new Date().toISOString(), bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
      replacement_for: '1_per_30_image_library_2026-10-07-retry-after-safety-flag',
    }, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const items = [];
THEATRE_DRAMA_PROMPTS.forEach((p, i) => items.push({ category: 'theatre-drama', pattern: 'A_wide', rep: i, prompt: `${p} ${SAFETY_SUFFIX}.` }));
KIDS_PROMPTS.forEach((p, i) => items.push({ category: 'kids', pattern: 'A_wide', rep: i, prompt: `${p} ${SAFETY_SUFFIX}.` }));

console.log(`Genererar ${items.length} round5b-ersättningar (${THEATRE_DRAMA_PROMPTS.length} theatre-drama + ${KIDS_PROMPTS.length} kids), concurrency=${CONCURRENCY}, dryRun=${dryRun}`);

let cursor = 0, ok = 0, errs = 0;
async function worker() {
  while (cursor < items.length) {
    const idx = cursor++;
    const it = items[idx];
    const r = await processItem(it);
    if (r.ok) {
      ok++;
      if (ok % 5 === 0) console.log(`  ${ok}/${items.length} ok (senaste: ${it.category}/${it.pattern}_r${it.rep})`);
    } else {
      errs++;
      console.error(`  ✗ ${it.category}/${it.pattern}_r${it.rep}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nKlart: ${ok} nya, ${errs} fel — på ${elapsed}s`);
console.log(`Credits-användning: ${ok} av ~1333 kvar`);
console.log(`Nästa: kör _stamp_bfl_round5b.ts för att stämpla + WebP.`);