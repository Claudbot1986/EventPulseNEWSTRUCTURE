#!/usr/bin/env node
// generate-explore-tiles.mjs — exploratory image-generator for the
// EventPulse "Utforska"-tile section (Spotify-inspired mockup).
//
// Reads MINIMAX_API_KEY from project-root .env (NOT committed).
// Outputs JSON + downloaded PNGs to tmp/explore-tiles/.
//
// USAGE (from project root):
//   node tools/generate-explore-tiles.mjs --phase=strip            # 1 row × 10 tiles
//   node tools/generate-explore-tiles.mjs --phase=grid             # 5 rows × 10 tiles
//   node tools/generate-explore-tiles.mjs --phase=tile --label=Ikväl
//
// This is exploratory/dev-only. NOT bundled into the Expo client.
// See /Users/claudgashi/.claude/plans/floofy-snacking-whistle.md

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
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'explore-tiles');

if (!KEY) {
  console.error('STOP: MINIMAX_API_KEY not set in project-root .env');
  process.exit(2);
}

// ─── Tile labels (Swedish, Spotify-style) ────────────────────────────────────
const STRIP = ['Ikväll', 'Helg', 'Gratis', 'Utomhus', 'Stämningsfullt', 'Debutant', 'Sista chansen', 'Kägelbanan', 'Sent', 'Stadshagen'];
const ROWS = [
  STRIP,
  ['Tyst', 'Skratt', 'Solo', 'Familj', 'Mörkret', 'Ljuset', 'Värme', 'Svalka', 'Nära', 'Långt'],
  ['Snabbt', 'Långsamt', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag', 'Nyår'],
  ['Hösten', 'Vintern', 'Våren', 'Sommaren', 'Morgon', 'Kväll', 'Natt', 'Midnatt', 'Dag', 'Skymning'],
  ['Ensamt', 'Tillsammans', 'Hemma', 'Borta', 'Högt', 'Lågt', 'Vilt', 'Lugnt', 'Dans', 'Sång'],
];

const PALETTE = ['#FFB454', '#7FD9A4', '#E85C7F', '#5B7CE6', '#A77BF0', '#F47C3C', '#3CB7B7', '#E5D358', '#A9B0BE', '#15151B'];

// ─── Prompts ─────────────────────────────────────────────────────────────────
// Spotify "Utforska"-style: solid color background + photo subject clipped from
// the right side + bold white/light word on the left. We instruct the model
// to NOT render the word — we typeset it in React Native on the device, with
// pixel-perfect font matching TOKENS.fontSize.xl. The image carries only the
// background color + photo subject.

// Square photographic source prompts. We generate 1024x1024 with the SUBJECT
// filling 90-97% of the frame (per user feedback 2026-09-21), then sharp
// slices off the left side diagonally and fills with the TOKENS bg color to
// produce the final 1280x914 7:5 tile. This way MiniMax only has to deliver
// ONE good photograph — we control layout, proportions, and color ourselves.
const TILE_DEFS = {
  // label → { bg (#hex for the diagonal-fill color), subject_prompt }
  'Ikväll': {
    bg: '#1A2B4A',
    subject: 'CLOSE-UP PORTRAIT of a Stockholm cyclist at night. The helmet and upper body dominate the frame, filling 90-97 percent of it (portrait crop, not a wide landscape). Helmet, shoulders, handlebars, and the bright bike headlight visible. The cyclist is turning their head to look LEFT (toward viewers left), or looking directly at the camera with eyes visible through the helmet visor. Lit from below by a warm bike headlight glow on the chin and helmet edge. Dark navy-blue out-of-focus background, NO trees, NO buildings, NO street, just a soft out-of-focus night-city bokeh. Cinematic moody portrait, like a film still.',
  },
  'Helg': {
    bg: '#3D7A56',
    subject: 'CLOSE-UP of strawberries and red currants on a bright cream/white picnic cloth, filling 90-97% of the frame (no landscape background). Sunlight catches the red fruit. A pair of sunglasses rests on the cloth. A small Swedish wildflower in the corner. Bright, sunny, weekend mood. NO people, NO hands, NO faces — just fruit on cloth in sunlight.',
  },
  'Gratis': {
    bg: '#7FD9A4',
    subject: 'CLOSE-UP of an outstretched open hand holding a single paper ticket (hand + ticket filling ~70% of the frame). Warm sunlight on the palm and ticket. Summer leaves in soft out-of-focus bokeh behind. Composition fills ~90% of the frame. NO face, NO body — just hand and ticket in sunlight.',
  },
  'Live': {
    bg: '#3B1F66',
    subject: 'A LARGE vintage stand-mounted microphone dominates the right half, mic+stand filling ~70% of the frame height. A spotlight cone glints off the grille. A guitar headstock peeks into lower-right corner. The composition fills ~95% of the frame.',
  },
  'Imorgon': {
    bg: '#5C4670',
    subject: 'CLOSE-UP of a ceramic coffee cup on a windowsill, the cup filling ~70% of the frame. Gentle steam rises, backlit by soft lilac dawn light. An out-of-focus water horizon at dawn behind. NO people, NO faces, NO hands — just the cup and steam in morning light.',
  },
  'Teater': {
    bg: '#5E1F2B',
    subject: 'CLOSE-UP of heavy crimson theater curtains in warm golden spotlight, the fabric folds filling ~85% of the frame. A single spotlight beam from the upper left, soft dust visible in the beam. The composition fills ~95% of the frame. NO people, NO text, NO stage floor — just curtain folds and light.',
  },
  'Chill': {
    bg: '#2E4A62',
    subject: 'CLOSE-UP of headphones resting on a sofa cushion beside a mug of tea, filling ~70% of the frame. Soft blue evening window light, out-of-focus raindrops on the glass behind. Cozy, calm, low light. NO people, NO faces — just headphones and mug.',
  },
  'Skratt': {
    bg: '#6B4226',
    subject: 'CLOSE-UP of a microphone on a stand at a comedy club, warm stage lighting from above, a single bright spotlight on the mic grille filling ~60% of the frame. Warm golden stage glow, soft bokeh of an audience in the background. A hint of joyful energy. NO faces, NO text — just mic and warm comedy-club light.',
  },
  'Stämningsfullt': {
    bg: '#5C1A2A',
    subject: 'A LARGE brass candlestick with a single bright candle flame dominates the center, filling ~70% of the frame height. Flame is the brightest point. A glass of red wine just behind. Warm bokeh of distant flames. The composition fills ~95% of the frame.',
  },
  'Sista chans': {
    bg: '#8B2A33',
    subject: 'A LARGE paper ticket held close to the lens, filling ~70% of the frame. The corner is curling and tearing. A faded rubber-stamp mark is visible. Warm sunset glow. The composition fills ~90% of the frame.',
  },
};

function tilePrompt(label, def) {
  // Subject must fill 90-97% of the frame. Square 1024x1024 source.
  return [
    `Square 1024x1024 photo for a Swedish events app. The word is "${label}".`,
    `SUBJECT FILL: the subject fills 90-97% of the frame — almost no empty`,
    `negative space, no wide empty border. SUBJECT-DOMINANT composition.`,
    ``,
    `${def.subject}`,
    ``,
    `Cinematic photographic realism, slight film grain, moody.`,
    `No text, no logos. No wide black borders.`,
  ].join('\n');
}


function stripPrompt(labels) {
  return [
    `A single horizontal strip image for a Swedish events app home screen.`,
    `It contains exactly ${labels.length} wide tiles arranged left-to-right,`,
    `separated by a thin dark gap (~12px), with NO outer border or padding.`,
    `Each tile is a 16:9 cell. Within each cell:`,
    `solid saturated background color (one color per cell; rotate through a`,
    `rich palette: amber, magenta, indigo, emerald, plum, terracotta, teal,`,
    `sand, slate, deep-violet), with a photographic subject clipped into the`,
    `right ~40% — softly overlapping the cell's right edge. The left ~60% of`,
    `each cell is the solid color with a subtle vignette into the subject.`,
    `Each cell represents this word: ${labels.join(', ')}. The subject in`,
    `each cell must evoke that word (e.g. "Ikväl" → street lamps, "Gratis" →`,
    `open palms / open-air concert, "Stämningsfullt" → candlelight).`,
    `Strict rules: NO text on the image whatsoever. NO logos. NO borders.`,
    `NO padding around the strip. The whole frame IS the 10 tiles.`,
    `Cinematic photography, soft grain, editorial mood, nocturnal Stockholm feel.`,
    `Aspect 21:9 (ultrawide). Output exactly 2048 × ~880 px so each tile is ~204px wide.`,
  ].join(' ');
}

// ─── API call ────────────────────────────────────────────────────────────────

async function generate(prompt, opts = {}) {
  // Per MiniMax docs, aspect_ratio takes priority if BOTH it and width/height
  // are provided. But empirically the model ignores aspect_ratio when it
  // conflicts with a different natural composition — so we pass width+height
  // explicitly and ALSO set aspect_ratio to keep the docs honest.
  const body = {
    model: MODEL,
    prompt,
    response_format: 'url',
    n: opts.n ?? 1,
  };
  if (opts.width && opts.height) {
    body.width = opts.width;
    body.height = opts.height;
    body.aspect_ratio = opts.width >= opts.height
      ? `${Math.round((opts.width / opts.height) * 10) / 10}:1`.replace(/\.0:/, ':').replace(/:1\./, ':1.')
      : `1:${Math.round((opts.height / opts.width) * 10) / 10}`;
    // ↑ messy. Just use one of the documented ratios closest to the target.
    const targetR = opts.width / opts.height;
    const ratios = { '1:1': 1, '16:9': 16 / 9, '4:3': 4 / 3, '3:2': 3 / 2, '2:3': 2 / 3, '3:4': 3 / 4, '9:16': 9 / 16, '21:9': 21 / 9 };
    let best = '1:1';
    let bestDiff = Infinity;
    for (const [name, r] of Object.entries(ratios)) {
      const d = Math.abs(Math.log(r / targetR));
      if (d < bestDiff) { bestDiff = d; best = name; }
    }
    body.aspect_ratio = best;
  } else if (opts.aspect_ratio) {
    body.aspect_ratio = opts.aspect_ratio;
  }
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
  return { urls, requested: { width: body.width, height: body.height, aspect_ratio: body.aspect_ratio } };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

function arg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

async function downloadAll(urls, label) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const fname = `${label}-${String(i + 1).padStart(2, '0')}.jpg`;
    const fpath = path.join(TMP_DIR, fname);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Download failed ${r.status} for ${u}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(fpath, buf);
    console.log(`  ✓ ${fname} (${buf.length} bytes)  expires-in-24h`);
    out.push({ file: fpath, source_url: u, expires_in_h: 24 });
  }
  return out;
}

async function phaseStrip() {
  console.log('PHASE strip: 1×10 tiles, single combined strip image');
  const urls = await generate(stripPrompt(STRIP), { aspect_ratio: '21:9', n: 1 });
  const paths = await downloadAll(urls, 'strip');
  console.log(`\nSaved ${paths.length} strip image(s) to ${TMP_DIR}`);
  console.log('URLs valid for 24h. View, then approve/disapprove.');
  return paths;
}

async function phaseGrid() {
  console.log('PHASE grid: 5×10 tiles, generating one row at a time and stitching');
  // MiniMax doesn't give us 5×10 in one go reliably. We do 5 rows and stitch.
  const rowPaths = [];
  for (let i = 0; i < ROWS.length; i++) {
    const labels = ROWS[i];
    console.log(`  row ${i + 1}/${ROWS.length}: ${labels.join(', ')}`);
    const urls = await generate(stripPrompt(labels), { aspect_ratio: '21:9', n: 1 });
    const p = await downloadAll(urls, `grid-r${i + 1}`);
    rowPaths.push(p[0]);
  }
  console.log(`\nSaved ${rowPaths.length} row images. Stitching happens OUT OF BAND`);
  console.log('(sharp is already in devDeps). Script intentionally leaves stitch to user.');
  return rowPaths;
}

async function phaseTile() {
  const label = arg('label');
  if (!label) { console.error('--label=... required for tile phase'); process.exit(2); }
  const def = TILE_DEFS[label];
  if (!def) {
    console.error(`No TILE_DEFS entry for "${label}". Add one to tools/generate-explore-tiles.mjs first.`);
    console.error(`Known labels: ${Object.keys(TILE_DEFS).join(', ')}`);
    process.exit(2);
  }
  const prompt = tilePrompt(label, def);
  // Per user feedback 2026-09-21: stop auto-producing sharp-bearbetade -final
  // versions while we're still picking style. We generate the RAW square
  // 1024x1024 source only. Batch-sharp-processing will happen once you OK
  // the style on multiple tiles.
  const SRC = 1024;
  console.log(`PHASE tile (raw only): label="${label}", bg=${def.bg}, ${SRC}x${SRC}`);
  const { urls } = await generate(prompt, { width: SRC, height: SRC, n: 1 });
  const slug = label.toLowerCase().replace(/\s+/g, '-').replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o');
  const paths = await downloadAll(urls, `tile-src-${slug}`);
  console.log(`  Source saved (raw): ${paths[0].file}`);
  console.log(`  No -final produced. Review the raw, then say OK and we'll batch-process.`);
  return paths;
}

(async () => {
  const phase = arg('phase') || 'strip';
  console.log(`Using model=${MODEL}, base=${BASE}`);
  console.log(`Output dir: ${TMP_DIR}\n`);

  try {
    if (phase === 'strip') await phaseStrip();
    else if (phase === 'grid') await phaseGrid();
    else if (phase === 'tile') await phaseTile();
    else { console.error(`Unknown phase: ${phase}`); process.exit(2); }
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();
