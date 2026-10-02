// scripts/preview-map.mjs — genererar HTML-preview som visar tiles-bilden
// + projicerade event-pin-positioner med samma projectViewport() som
// MapPinLayer. Möjliggör visuell verifiering utan simulator.
//
// Vad: läser projectViewport från samma modul som RN-lagret använder,
// ritar stockholm-tiles.png + N sample-pin-positioner i en HTML-sida.
// Korshår i mitten markerar Stockholm centrum.
// Användning:
//   node scripts/preview-map.mjs
// Öppna /tmp/map-canvas-preview.html i en browser.

import { projectViewport, jitterFallback, STOCKHOLM_VIEWPORT } from '../components/mapProjection.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_ROOT = path.resolve(__dirname, '..');

// Mock-data: riktiga koordinater för kända Stockholm-platser + 2
// fallback-events för jitter-verifiering.
const sampleEvents = [
  { id: 'kulturhuset',     title_sv: 'Kulturhuset',     lat: 59.3325, lng: 18.0644, category_slug: 'music' },
  { id: 'kungstradgarden',  title_sv: 'Kungsträdgården', lat: 59.3326, lng: 18.0717, category_slug: 'community' },
  { id: 'gota-kanal',       title_sv: 'Göta Kanal',      lat: 59.3250, lng: 18.0750, category_slug: 'exhibition' },
  { id: 'stadshuset',       title_sv: 'Stadshuset',      lat: 59.3275, lng: 18.0543, category_slug: 'classical' },
  { id: 'ostermalm',        title_sv: 'Östermalm',       lat: 59.3390, lng: 18.0790, category_slug: 'theater' },
  { id: 'sodermalm-1',      title_sv: 'Södermalm N',     lat: 59.3170, lng: 18.0630, category_slug: 'workshop' },
  { id: 'sodermalm-2',      title_sv: 'Södermalm S',     lat: 59.3100, lng: 18.0700, category_slug: 'dance' },
  { id: 'vasastan',         title_sv: 'Vasastan',        lat: 59.3450, lng: 18.0450, category_slug: 'sport' },
  { id: 'fallback-1',       title_sv: 'Fallback 1',      lat: 59.3293, lng: 18.0686, category_slug: 'music' },
  { id: 'fallback-2',       title_sv: 'Fallback 2',      lat: 59.3293, lng: 18.0686, category_slug: 'music' },
];

const projected = sampleEvents.map((e) => {
  const j = jitterFallback(e);
  const p = projectViewport(j.lat, j.lng, STOCKHOLM_VIEWPORT);
  return { ...e, x: p.x, y: p.y, visible: p.visible, jittered: j };
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>MapCanvas Preview</title>
<style>
  body { background: #000; color: #F7F2EA; font-family: -apple-system, sans-serif; margin: 20px; }
  h1 { color: #FFB454; font-size: 14px; letter-spacing: 1.6px; text-transform: uppercase; }
  .viewport { position: relative; width: 360px; height: 454px; background: #0A0A0A; border-radius: 8px; overflow: hidden; }
  .viewport img { width: 100%; height: 100%; display: block; }
  .pin { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; background: #FFB454; border: 1px solid rgba(0,0,0,0.6); width: 8px; height: 8px; }
  .pin[data-slug="music"] { background: #FFB454; }
  .pin[data-slug="community"] { background: #7DD3C0; }
  .pin[data-slug="exhibition"] { background: #A4C8DD; }
  .pin[data-slug="classical"] { background: #9CB8FF; }
  .pin[data-slug="theater"] { background: #F7C97A; }
  .pin[data-slug="workshop"] { background: #DDB79E; }
  .pin[data-slug="dance"] { background: #C8A4FF; }
  .pin[data-slug="sport"] { background: #FF9C7A; }
  .pin[data-fallback="true"] { border: 2px dashed #FFFFFF; }
  .label { position: absolute; transform: translate(-50%, -150%); font-size: 9px; color: #F7F2EA; background: rgba(0,0,0,0.7); padding: 2px 4px; border-radius: 3px; white-space: nowrap; pointer-events: none; }
  .crosshair { position: absolute; top: 50%; left: 50%; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 8px solid #FFB454; transform: translate(-50%, -50%); }
  .info { margin-top: 12px; color: #9AA3B5; font-size: 12px; max-width: 360px; }
  .coord { color: #FFB454; font-family: monospace; }
</style></head><body>
<h1>MapCanvas preview — Stockholm 360×454 @ zoom 11 (Mercator)</h1>
<div class="viewport">
  <img src="file://${SANDBOX_ROOT}/assets/stockholm-tiles.png" alt="Stockholm OSM tiles" />
  ${projected.map((e) => `
    <div class="pin" data-slug="${e.category_slug || ''}" data-fallback="${Math.abs(e.lat - 59.3293) < 1e-6}" style="left:${e.x}px;top:${e.y}px;" title="${e.title_sv} (${e.jittered.lat.toFixed(4)}, ${e.jittered.lng.toFixed(4)})"></div>
    <div class="label" style="left:${e.x}px;top:${e.y}px;">${e.title_sv}</div>`).join('')}
  <div class="crosshair"></div>
</div>
<div class="info">
  <div>Centermark (Sergels torg): viewport-center → <span class="coord">(180, 227)</span></div>
  <div>Asset: <span class="coord">stockholm-tiles.png</span> 360×454 (aspect 0.793, Mercator-korrekt)</div>
  <div>Pinnar projicerade via <span class="coord">projectViewport()</span> med samma projektion som MapPinLayer.</div>
  <div>Falback-events (lat=59.3293) får vit dashed ring + klient-side-jitter ±0.005°.</div>
</div>
</body></html>`;

const outPath = '/tmp/map-canvas-preview.html';
fs.writeFileSync(outPath, html);
console.log(`Preview sparad: ${outPath}`);
console.log(`Pin-positioner (viewport 360×454):`);
projected.forEach((e) => {
  const fallback = Math.abs(e.lat - 59.3293) < 1e-6;
  console.log(`  ${e.title_sv.padEnd(20)} (${e.lat.toFixed(4)}, ${e.lng.toFixed(4)})${fallback ? ' [fallback+jitter]' : ''} → (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`);
});