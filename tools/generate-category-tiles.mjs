#!/usr/bin/env node
// generate-category-tiles.mjs — exploratory image-generator for the
// EventPulse "Utforska" 18 v2-category tiles (musik, opera, komedi ...).
//
// Reads MINIMAX_API_KEY from project-root .env (NOT committed).
// Outputs downloaded PNGs to tmp/category-tiles/.
//
// USAGE (from project root):
//   node tools/generate-category-tiles.mjs                 # all 18
//   node tools/generate-category-tiles.mjs --only=opera    # one tile
//
// Per user feedback 2026-09-27:
//   - Subject MUST be in the LOWER-RIGHT of the frame, facing LEFT.
//   - Subject based on the category's Swedish name.
//   - Image is square 1024x1024 source (App.js overlays color diagonally).
//   - One image per category.
//
// This is exploratory/dev-only. NOT bundled into the Expo client.

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const KEY = process.env.MINIMAX_API_KEY;
const BASE = 'https://api.minimax.io/v1';
const MODEL = 'image-01';
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'category-tiles');
const SRC = 1024;

if (!KEY) {
  console.error('STOP: MINIMAX_API_KEY not set in project-root .env');
  process.exit(2);
}

// ─── Category prompts ────────────────────────────────────────────────────────
//
// Universal rules baked into every prompt:
//   - Square 1024x1024 source.
//   - Main subject MUST occupy the LOWER-RIGHT QUADRANT of the frame
//     (roughly the bottom-right 50%). The upper-left 50% is left for
//     the tile's solid color overlay (handled by App.js).
//   - The subject's face / front MUST be turned TOWARD THE LEFT of
//     the frame (i.e., looking back toward the upper-left empty area
//     where the colored overlay will sit).
//   - SUBJECT FILL 95-100% — tighter than v1 because App.js clips the
//     source's center horizontal strip (cover-crop with the 40%-wide
//     photo inset). v1's 90-97% fill made the subject read as too small
//     after the crop (per user 2026-09-27 "man ser knappt innehållet").
//   - Cinematic photographic realism. No text, no logos.
//   - Subject's gaze direction is the load-bearing compositional cue —
//     re-state it in plain English per prompt so MiniMax doesn't drop it.

const CATEGORY_DEFS = [
  { key: 'music', bg: '#2D2D3A',
    subject: 'CLOSE-UP of a large pair of bright GREEN on-ear headphones (chunky padded cushions, prominent arched headband) positioned in the LOWER-RIGHT QUADRANT of the frame, the LEFT earcup turned toward the viewer (gazing into the upper-left empty area). Deep LILAC/PURPLE velvet background, soft and slightly textured. Cool studio light from the upper-left. Cinematic photographic realism. NO text, NO logos.' },
  { key: 'opera', bg: '#3A2A2A',
    subject: 'Rows of empty red velvet opera house seats arranged in clear orderly tiered rows, occupying the LOWER-RIGHT QUADRANT of the frame, viewed from a slightly elevated position looking forward toward the orchestra. Ornate gilded baroque balcony railings frame the sides. A single crystal chandelier glows softly above (soft warm pools of light, NOT a blinding spotlight). NO red draperies flowing in frame, NO stage curtain, NO proscenium arch filling the foreground. The focus is entirely on the empty audience seating and the auditorium\'s architecture. Cinematic photographic realism. NO text, NO faces, NO logos.' },
  { key: 'theatre-comedy', bg: '#3A2A2A',
    subject: 'A vintage stand microphone on a heavy round base, positioned in the LOWER-RIGHT QUADRANT, the mic grille aimed LEFT toward the empty upper-left area (as if a comedian about to step in). Warm golden comedy-club spotlight. A hint of BRIGHT VIVID COBALT-BLUE velvet curtain in soft bokeh behind — saturated, eye-catching color, not dark navy. Cinematic, lively. NO text, NO logos, NO faces.' },
  { key: 'theatre-drama', bg: '#3A2A2A',
    subject: 'Heavy crimson velvet theater curtains in warm golden spotlight, the curtain folds occupying the LOWER-RIGHT QUADRANT, the fabric sweeping inward toward the empty upper-left. A single bright spotlight beam from the upper-left, soft dust visible in the beam. Cinematic moody. NO text, NO people, NO stage floor.' },
  { key: 'dance', bg: '#2D3140',
    subject: 'A single pointe ballet slipper resting on a dark wooden stage, positioned in the LOWER-RIGHT QUADRANT. The toe of the slipper points toward the upper-LEFT (the empty area). Pink satin ribbons drape softly to the lower-left edge. Soft top-light from above. Cinematic. NO text, NO logos, NO people.' },
  { key: 'circus', bg: '#3A352D',
    subject: 'A traditional red-and-yellow striped circus tent top peeking into the LOWER-RIGHT QUADRANT, the peak of the tent pointing toward the upper-left empty area. Decorative flags flutter from the tent poles. Warm sunset light. Soft out-of-focus bokeh. Cinematic festive mood. NO text, NO logos.' },
  { key: 'exhibition', bg: '#2D3A35',
    subject: 'A single ornate gold picture frame hanging on a deep teal gallery wall, the frame positioned in the LOWER-RIGHT QUADRANT, its top tilted slightly so the empty gallery wall occupies the upper-left. Soft museum-track lighting from above. The frame contains an abstract impressionist painting in muted blues and greens. Cinematic. NO text.' },
  { key: 'flea-market', bg: '#3A3A2D',
    subject: 'A pile of vintage objects on a weathered wooden table: an old leather-bound book, a brass compass, a small ceramic vase with dried wildflowers. The pile occupies the LOWER-RIGHT QUADRANT, with the tallest item (the vase) reaching toward the upper-left empty area. Soft golden afternoon side-light. Cinematic warm. NO text, NO logos.' },
  { key: 'food', bg: '#3A2D2D',
    subject: 'A rustic ceramic plate with a single beautifully plated dish (pan-seared salmon with herbs and lemon), positioned in the LOWER-RIGHT QUADRANT. A fork and linen napkin peek in from the right edge. Soft warm restaurant lighting from above. Dark moody bokeh background. Cinematic food photography. NO text, NO logos.' },
  { key: 'wine-tasting', bg: '#3A2D2D',
    subject: 'A single elegant wine glass with a small pour of deep red wine, positioned in the LOWER-RIGHT QUADRANT. The glass is angled so the bowl faces the upper-LEFT empty area, catching a soft window-light highlight along the rim. A blurred vineyard row in soft bokeh behind. Cinematic, moody. NO text, NO logos.' },
  { key: 'kids', bg: '#3A352D',
    subject: 'A wooden toy train (engine + two carriages) on a curved track, positioned in the LOWER-RIGHT QUADRANT. The locomotive points toward the upper-LEFT empty area, leading the eye away. Bright primary colors, soft natural daylight from above. A few scattered wooden building blocks in soft bokeh. Cinematic warm. NO text, NO logos.' },
  { key: 'family', bg: '#3A352D',
    subject: 'A pair of small child-sized rain boots (yellow + red) standing on a wet stone step, positioned in the LOWER-RIGHT QUADRANT. A larger adult-sized umbrella hangs from a hook just behind, reaching toward the upper-left empty area. Soft overcast daylight. Cinematic warm. NO text, NO logos, NO faces.' },
  { key: 'film', bg: '#2D353A',
    subject: 'A vintage 35mm film projector with a single glowing reel of celluloid film, positioned in the LOWER-RIGHT QUADRANT. The warm light beam from the lens projects toward the upper-LEFT empty area. Dark cinematic room, soft motes of dust visible in the beam. Cinematic moody. NO text, NO logos.' },
  { key: 'talks-lectures', bg: '#2D3A35',
    subject: 'A wooden lectern with an open leather-bound book and a brass desk lamp, positioned in the LOWER-RIGHT QUADRANT. The book pages are turned toward the upper-LEFT empty area. Warm pool of desk-lamp light. A row of older library books softly out of focus behind. Cinematic scholarly mood. NO text legible on book pages, NO logos.' },
  { key: 'workshop', bg: '#2D3A35',
    subject: 'A well-worn carpenter\'s workbench with a hand plane, brass chisels, and wood shavings curled like scrolls, positioned in the LOWER-RIGHT QUADRANT. A half-finished oak board extends toward the upper-LEFT empty area. Warm side-light from a workshop window. Cinematic craftsman mood. NO text, NO logos.' },
  { key: 'sports', bg: '#2D353A',
    subject: 'A pair of worn leather football boots and a deflated leather football on green grass, positioned in the LOWER-RIGHT QUADRANT. The studs of one boot point toward the upper-LEFT empty area. Late-afternoon stadium light, long shadow toward the lower-right. Cinematic sporty mood. NO text, NO logos.' },
  { key: 'nightlife', bg: '#3A3A2D',
    subject: 'A neon cocktail-bar sign glowing in magenta and cyan, mounted on a dark brick wall, positioned in the LOWER-RIGHT QUADRANT. The brightest neon tube points toward the upper-LEFT empty area, casting colored light onto the brick. Subtle rain-wet reflections on the wall. Cinematic nocturnal mood. NO readable text on the sign, NO logos.' },
  { key: 'community', bg: '#2D3140',
    subject: 'A circle of mismatched ceramic mugs on a wooden community-center table, each casting a soft shadow, the cluster positioned in the LOWER-RIGHT QUADRANT. Steam rises from one mug, drifting toward the upper-LEFT empty area. Warm overhead pendant light. A few chairs pulled in around the table in soft bokeh. Cinematic warm. NO text, NO logos, NO faces.' },
];

// ─── API call (same shape as generate-explore-tiles.mjs) ─────────────────────

async function generate(prompt) {
  const body = {
    model: MODEL,
    prompt,
    response_format: 'url',
    width: SRC,
    height: SRC,
    aspect_ratio: '1:1',
    n: 1,
  };
  const r = await fetch(`${BASE}/image_generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`MiniMax HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const code = j?.base_resp?.status_code;
  if (code !== 0) {
    throw new Error(`MiniMax status_code=${code} msg=${j?.base_resp?.status_msg}`);
  }
  const urls = j?.data?.image_urls ?? [];
  if (!urls.length) throw new Error('No image_urls in response');
  return urls[0];
}

async function download(url, slug) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const fname = `cat-${slug}.jpg`;
  const fpath = path.join(TMP_DIR, fname);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(fpath, buf);
  console.log(`  ✓ ${fname} (${(buf.length / 1024).toFixed(0)} kB)  expires-in-24h`);
  return fpath;
}

function promptFor(def) {
  return [
    `Square ${SRC}x${SRC} photo for a Swedish events app. Category: "${def.key}".`,
    ``,
    `COMPOSITION (load-bearing):`,
    `- The MAIN SUBJECT occupies the LOWER-RIGHT QUADRANT of the frame,`,
    `  filling 95-100% of the frame — almost no empty negative space.`,
    `- The subject's face / front is turned TOWARD THE LEFT of the frame,`,
    `  gazing into the empty UPPER-LEFT area (which the app will fill with`,
    `  a solid colored overlay).`,
    `- Upper-left corner may have soft bokeh for the color overlay to`,
    `  blend into, but the subject itself dominates the frame.`,
    ``,
    `SUBJECT: ${def.subject}`,
    ``,
    `Cinematic photographic realism, slight film grain.`,
    `No text, no logos, no wide black borders.`,
  ].join('\n');
}

// ─── Orchestration ──────────────────────────────────────────────────────────

function arg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

(async () => {
  const only = arg('only');
  const todo = only
    ? CATEGORY_DEFS.filter((d) => d.key === only)
    : CATEGORY_DEFS;

  if (only && todo.length === 0) {
    console.error(`Unknown --only=${only}. Known: ${CATEGORY_DEFS.map((d) => d.key).join(', ')}`);
    process.exit(2);
  }

  console.log(`Using model=${MODEL}, base=${BASE}`);
  console.log(`Output dir: ${TMP_DIR}`);
  console.log(`Generating ${todo.length} tile(s): ${todo.map((d) => d.key).join(', ')}\n`);

  const results = [];
  for (const def of todo) {
    try {
      console.log(`[${def.key}] bg=${def.bg}`);
      const url = await generate(promptFor(def));
      const fpath = await download(url, def.key);
      results.push({ key: def.key, file: fpath });
    } catch (e) {
      console.error(`  ✗ ${def.key}: ${e.message}`);
      results.push({ key: def.key, error: e.message });
    }
  }

  const ok = results.filter((r) => !r.error);
  const fail = results.filter((r) => r.error);
  console.log(`\nDone. ${ok.length}/${results.length} tiles saved to ${TMP_DIR}.`);
  if (fail.length) {
    console.log(`Failed: ${fail.map((f) => f.key).join(', ')}`);
  }
  console.log(`\nURLs valid for 24h. Review, then approve to bake into App.js.`);
})();
