// scripts/render-map-check.mjs — genererar en PNG med stockholm-tiles.png
// + projicerade pin-overlay så vi visuellt kan verifiera att prickar
// hamnar på rätt gator.
//
// Vad: läser samma projectViewport() som MapPinLayer, ritar fyllda
// cirklar på canvas via sharp's composite-lager.
// Output: 06-UI-sandbox/assets/map-canvas-check.png

import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'url';
import { projectViewport, jitterFallback, STOCKHOLM_VIEWPORT } from '../components/mapProjection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_ROOT = path.resolve(__dirname, '..');

const sampleEvents = [
  // Stockholm city (central)
  { id: 'kulturhuset',     title_sv: 'Kulturhuset',     lat: 59.3325, lng: 18.0644, category_slug: 'music' },
  { id: 'kungstradgarden',  title_sv: 'Kungsträdgården', lat: 59.3326, lng: 18.0717, category_slug: 'community' },
  { id: 'stadshuset',       title_sv: 'Stadshuset',      lat: 59.3275, lng: 18.0543, category_slug: 'classical' },
  // Spridda över Storstockholm för visuell verifiering av projektionen
  { id: 'ostermalm',       title_sv: 'Östermalm',       lat: 59.3390, lng: 18.0790, category_slug: 'theater' },
  { id: 'sodermalm-1',     title_sv: 'Södermalm N',     lat: 59.3170, lng: 18.0630, category_slug: 'workshop' },
  { id: 'sodermalm-2',     title_sv: 'Södermalm S',     lat: 59.3100, lng: 18.0700, category_slug: 'dance' },
  { id: 'vasastan',        title_sv: 'Vasastan',        lat: 59.3450, lng: 18.0450, category_slug: 'sport' },
  { id: 'gota-kanal',      title_sv: 'Göta Kanal',      lat: 59.3250, lng: 18.0750, category_slug: 'exhibition' },
  { id: 'solna',           title_sv: 'Solna',           lat: 59.3600, lng: 18.0000, category_slug: 'music' },
  { id: 'bromma',          title_sv: 'Bromma',          lat: 59.3550, lng: 17.9300, category_slug: 'sport' },
  { id: 'taby',            title_sv: 'Täby',            lat: 59.4400, lng: 18.0700, category_slug: 'family' },
  { id: 'lidingo',         title_sv: 'Lidingö',         lat: 59.3700, lng: 18.1500, category_slug: 'workshop' },
  { id: 'nacka',           title_sv: 'Nacka',           lat: 59.3100, lng: 18.1600, category_slug: 'community' },
  { id: 'huddinge',        title_sv: 'Huddinge',        lat: 59.2400, lng: 17.9800, category_slug: 'dance' },
  { id: 'tyreso',          title_sv: 'Tyresö',          lat: 59.2500, lng: 18.2300, category_slug: 'family' },
  { id: 'ekero',           title_sv: 'Ekerö',           lat: 59.2900, lng: 17.8000, category_slug: 'exhibition' },
];

const PALETTE = {
  music: '#FFB454',
  'musical-theatre': '#F4A6A6',
  classical: '#9CB8FF',
  theater: '#F7C97A',
  community: '#7DD3C0',
  comedy: '#F4A6A6',
  sport: '#FF9C7A',
  family: '#A4DD80',
  dance: '#C8A4FF',
  exhibition: '#A4C8DD',
  workshop: '#DDB79E',
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 180, b: 84 };
}

async function main() {
  const tileImg = path.join(SANDBOX_ROOT, 'assets', 'stockholm-tiles.png');
  const out = path.join(SANDBOX_ROOT, 'assets', 'map-canvas-check.png');

  const meta = await sharp(tileImg).metadata();
  const W = meta.width, H = meta.height;
  console.log(`tile-image: ${W}×${H}`);

  // Skapa pin-mask via SVG-overlay.
  const pins = sampleEvents.map((e) => {
    const j = jitterFallback(e);
    const p = projectViewport(j.lat, j.lng, { ...STOCKHOLM_VIEWPORT, width: W, height: H });
    const c = hexToRgb(PALETTE[e.category_slug] || '#F7F2EA');
    const r = 6;
    return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" fill="rgb(${c.r},${c.g},${c.b})" stroke="rgba(0,0,0,0.7)" stroke-width="1.5"/>`;
  });

  // Korshår i mitten.
  const cx = W / 2, cy = H / 2;
  pins.push(`<line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="#FFB454" stroke-width="2"/>`);
  pins.push(`<line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="#FFB454" stroke-width="2"/>`);

  const svgOverlay = Buffer.from(`<svg width="${W}" height="${H}">${pins.join('')}</svg>`);

  const result = await sharp(tileImg)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(out, result);
  const s = fs.statSync(out);
  console.log(`Sparad: ${out} (${(s.size / 1024).toFixed(1)} KB)`);
  console.log(`Pin-positioner:`);
  sampleEvents.forEach((e) => {
    const j = jitterFallback(e);
    const p = projectViewport(j.lat, j.lng, { ...STOCKHOLM_VIEWPORT, width: W, height: H });
    console.log(`  ${e.title_sv.padEnd(22)} → (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });