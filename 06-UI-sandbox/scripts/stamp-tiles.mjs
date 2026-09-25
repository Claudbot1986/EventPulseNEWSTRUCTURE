// stamp-tiles.mjs — lokal stämpling av BFL-genererade originals.
//
// INTE prod-pipeline. Använders ENBART i 06-UI-sandbox för att ge sandboxen
// samma visuella "AI-genererad"-stämpel som prod-bilderna har efter
// build_ai_stamped.ts. Stämpeln är identisk med den i
// 08-Agent/tools/ai_compliance.ts (samma SVG, samma sharp.compose).
//
// Indata: 5 st BFL/FLUX-genererade JPGs från tmp/explore-tiles/.
// Utdata: 5 st stämplade PNGs i ./assets/ som ersätter de ostämplade JPGs.
//
// Kör: node scripts/stamp-tiles.mjs

import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SANDBOX_ASSETS = path.join(PROJECT_ROOT, '06-UI-sandbox', 'assets');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'tmp', 'explore-tiles');

// Exakt samma SVG som 08-Agent/tools/ai_compliance.ts (rad 56–78).
// Visar "● AI-genererad" i nedre-vänstra hörnet (top=740 på 1024-bild).
const AI_STAMP_SVG = `<svg width="202" height="48" viewBox="0 0 202 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
      <feOffset dx="0" dy="1" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.55"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="2" y="2" width="199" height="44" rx="22" ry="22"
        fill="rgba(15,15,18,0.20)"
        stroke="rgba(255,180,84,0.45)" stroke-width="1.5"/>
  <circle cx="26" cy="24" r="6" fill="#FFB454" fill-opacity="0.60"/>
  <text x="44" y="31" font-family="Arial, sans-serif" font-size="18"
        font-weight="bold" fill="#FFFFFF" fill-opacity="0.60"
        letter-spacing="0.5"
        filter="url(#textShadow)">AI-genererad</text>
</svg>`;

const STAMP_BUFFER = Buffer.from(AI_STAMP_SVG);

// 5 FLUX-genererade originals från runtime/ai-image-smoketest/images/.
// Alla är 1024×1024 och lever i repot. Tidigare pekade vi på
// tmp/explore-tiles/ men den mappen finns inte längre — vi tar bara
// från smoketest-biblioteket. sharp läser PNG direkt; output är alltid
// PNG (samma som prod).
//
// AI-stämpeln ("● AI-genererad", vänster nedre hörn) är identisk med
// prod-pipelinen — se AI_STAMP_SVG ovan.
const RUNTIME_IMAGES = path.join(
  PROJECT_ROOT,
  'runtime',
  'ai-image-smoketest',
  'images',
);
const SOURCES = [
  { name: '7e174647-8158-4738-8119-07c5ab211a4e.png', out: 'tile-1.png' },
  { name: '85b205fc-4fbb-400a-9cc4-e1f0d1d6fb38.png', out: 'tile-2.png' },
  { name: '9065cd62-6bc6-471a-9efa-4f183f79a251.png', out: 'tile-3.png' },
  { name: '9771ed54-80b0-4d16-89b5-ebc8c31d2976.png', out: 'tile-4.png' },
  { name: '2d556c45-a573-4f8e-9a7d-b4289d98cb99.png', out: 'tile-5.png' },
].map((s) => ({ ...s, dir: RUNTIME_IMAGES }));

async function stampOne(source) {
  const srcPath = path.join(source.dir, source.name);
  const destPath = path.join(SANDBOX_ASSETS, source.out);

  const buf = await fs.readFile(srcPath);

  // Placera stämpel i nedre-vänstra hörnet (left=24, top=740) — samma
  // safe-zone som ai_compliance.ts väljer för 1024×1024-bilder.
  // sharp läser både JPG och PNG och konverterar till PNG-utdata.
  const stamped = await sharp(buf)
    .resize(1024, 1024, { fit: 'cover' })
    .composite([
      {
        input: STAMP_BUFFER,
        left: 24,
        top: 740,
      },
    ])
    .png()
    .toBuffer();

  await fs.writeFile(destPath, stamped);
  const tag = `${source.dir.split('/').slice(-2).join('/')}/${source.name}`;
  console.log(`  ${tag} → ${source.out} (${(stamped.length / 1024).toFixed(0)} kB)`);
}

(async () => {
  console.log('Stämplar 5 BFL-originals med "● AI-genererad" (samma SVG som prod)...');
  for (const source of SOURCES) {
    await stampOne(source);
  }
  console.log(`Klart. 5 stämplade PNGs i ${SANDBOX_ASSETS}/`);
})();