// scripts/render-map-check.mjs — genererar verifierings-PNGs med
// stockholm-tiles-{z11,z13,z15}.png + projicerade pin-överlay. Möjliggör
// visuell verifiering av multi-zoom-funktionen + pan (asset:t är 3× större
// än viewport; en "pannad" vy syns genom att vi crop:ar ut en offset).
//
// Vad: läser samma visibleBoundsFromAsset() + projectViewport() som
// MapCanvas. För varje zoom-nivå: hämta asset + assetBounds, visa
// viewport antingen centrerad eller pannad, rita pin-cirklar via
// SVG-overlay.
// Output:
//   06-UI-sandbox/assets/map-canvas-check.png          (z11 centrerad)
//   06-UI-sandbox/assets/map-canvas-check-panned.png   (z11 pannad)
//   06-UI-sandbox/assets/map-canvas-check-z13.png     (z13 centrerad)
//   06-UI-sandbox/assets/map-canvas-check-z15.png     (z15 centrerad)

import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'url';
import {
  projectViewport,
  jitterFallback,
  pickZoomAsset,
  visibleBoundsFromAsset,
  panOffsetForCenter,
  STOCKHOLM_CENTER,
} from '../components/mapProjection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_ROOT = path.resolve(__dirname, '..');

const sampleEvents = [
  { id: 'kulturhuset',     title_sv: 'Kulturhuset',     lat: 59.3325, lng: 18.0644, category_slug: 'music' },
  { id: 'kungstradgarden',  title_sv: 'Kungsträdgården', lat: 59.3326, lng: 18.0717, category_slug: 'community' },
  { id: 'stadshuset',       title_sv: 'Stadshuset',      lat: 59.3275, lng: 18.0543, category_slug: 'classical' },
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

const ZOOM_TILES = {
  11: 'stockholm-tiles-z11.png',
  13: 'stockholm-tiles-z13.png',
  15: 'stockholm-tiles-z15.png',
};

async function render({ zoom, panOffset = { assetOffsetX: 0, assetOffsetY: 0 }, outFile }) {
  const tileFile = ZOOM_TILES[zoom];
  const tileImg = path.join(SANDBOX_ROOT, 'assets', tileFile);
  const out = path.join(SANDBOX_ROOT, 'assets', outFile);

  const asset = pickZoomAsset(zoom);
  const assetMeta = await sharp(tileImg).metadata();
  console.log(`z=${zoom}: asset=${tileFile} ${assetMeta.width}×${assetMeta.height}, viewport=${360}×${454}`);

  const viewportSize = { width: 360, height: 454 };
  const visibleBounds = visibleBoundsFromAsset(asset.assetBounds, asset.assetSize, viewportSize, panOffset);
  const viewport = { ...viewportSize, bounds: visibleBounds, zoom };

  // Build a "render" image: extract the visible viewport area from the
  // asset using sharp.extract (samma som ImageBackground med translate
  // + overflow:hidden).
  const initX = (asset.assetSize.width - viewportSize.width) / 2;
  const initY = (asset.assetSize.height - viewportSize.height) / 2;
  const cropLeft = Math.round(initX + panOffset.assetOffsetX);
  const cropTop = Math.round(initY + panOffset.assetOffsetY);
  const cropped = await sharp(tileImg)
    .extract({
      left: Math.max(0, cropLeft),
      top: Math.max(0, cropTop),
      width: viewportSize.width,
      height: viewportSize.height,
    })
    .png()
    .toBuffer();

  const svgPins = sampleEvents.map((e) => {
    const j = jitterFallback(e);
    const p = projectViewport(j.lat, j.lng, viewport);
    if (!p.visible) return '';
    const c = hexToRgb(PALETTE[e.category_slug] || '#F7F2EA');
    const r = zoom === 15 ? 8 : zoom === 13 ? 7 : 6;
    return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" fill="rgb(${c.r},${c.g},${c.b})" stroke="rgba(0,0,0,0.7)" stroke-width="1.5"/>`;
  }).filter(Boolean);

  const cx2 = viewportSize.width / 2, cy2 = viewportSize.height / 2;
  svgPins.push(`<line x1="${cx2 - 10}" y1="${cy2}" x2="${cx2 + 10}" y2="${cy2}" stroke="#FFB454" stroke-width="2"/>`);
  svgPins.push(`<line x1="${cx2}" y1="${cy2 - 10}" x2="${cx2}" y2="${cy2 + 10}" stroke="#FFB454" stroke-width="2"/>`);

  const svgOverlay = Buffer.from(`<svg width="${viewportSize.width}" height="${viewportSize.height}">${svgPins.join('')}</svg>`);
  const result = await sharp(cropped)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(out, result);
  const s = fs.statSync(out);
  console.log(`  → ${outFile} (${(s.size / 1024).toFixed(1)} KB)`);
  console.log(`  panOffset: ${JSON.stringify(panOffset)}`);
  console.log(`  visibleBounds: lat=[${visibleBounds.minLat.toFixed(3)}..${visibleBounds.maxLat.toFixed(3)}] lng=[${visibleBounds.minLng.toFixed(3)}..${visibleBounds.maxLng.toFixed(3)}]`);
  sampleEvents.forEach((e) => {
    const j = jitterFallback(e);
    const p = projectViewport(j.lat, j.lng, viewport);
    if (p.visible) {
      console.log(`    ${e.title_sv.padEnd(22)} → (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
    }
  });
}

async function main() {
  // Default: centrerad (panOffset 0,0)
  await render({ zoom: 11, outFile: 'map-canvas-check.png' });
  // Pannad: pan 200px öster (visar högra delen av asset:t)
  await render({
    zoom: 11,
    panOffset: { assetOffsetX: 200, assetOffsetY: 0 },
    outFile: 'map-canvas-check-panned.png',
  });
  // z=13 och z=15, centrerade
  await render({ zoom: 13, outFile: 'map-canvas-check-z13.png' });
  await render({ zoom: 15, outFile: 'map-canvas-check-z15.png' });
}

main().catch((err) => { console.error(err); process.exit(1); });