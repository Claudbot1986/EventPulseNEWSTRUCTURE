#!/usr/bin/env node
// scripts/build-stockholm-tiles.mjs — laddar ner + stitchar OSM-tiles
// för Stockholm-bbox och sparar som asset för MapBaseLayer.
//
// Vad skriptet gör:
//   1. Räknar ut OSM tile-range (x/y) för given bbox vid given zoom-nivå.
//   2. Laddar ner varje tile parallellt från OSM tile.openstreetmap.org
//      (User-Agent sätts enligt OSM tile usage policy).
//   3. Stitchar ihop alla tiles till en bild.
//   4. Croppar till exakt bbox (i pixel-koordinater).
//   5. Resizar till target-dimensioner (canvas-storlek).
//   6. Sparar till assets/<output>.
//
// Mercator-projektion: OSM använder web Mercator (EPSG:3857). Bildens
// lat-axel är därmed icke-linjär (sträcks vid högre latituder). Vår
// mapProjection.projectToXY() i sandboxen använder samma formler →
// pin-positioner kommer att matcha gator pixel-noggrannt.
//
// Användning:
//   node scripts/build-stockholm-tiles.mjs                  # default z=11, 360×760
//   node scripts/build-stockholm-tiles.mjs --zoom 10         # mindre detalj
//   node scripts/build-stockholm-tiles.mjs --width 400 --height 850
//
// Konstanter (Stockholm bbox) lever i mapProjection.js — vi importerar
// dem härifrån så att det bara finns EN sanningskälla.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_ROOT = path.resolve(__dirname, '..');
const PROJECTION_PATH = path.join(SANDBOX_ROOT, 'components', 'mapProjection.js');

// Importera STOCKHOLM_BOUNDS från sandbox-modulen.
const projection = await import(`file://${PROJECTION_PATH}`);
const STOCKHOLM_BOUNDS = projection.STOCKHOLM_BOUNDS;
const STOCKHOLM_CENTER = projection.STOCKHOLM_CENTER;

// --- Args parsing -----------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    zoom: 11,
    width: 360,
    height: 760,
    output: 'stockholm-tiles.png',
    centerLat: STOCKHOLM_CENTER.lat,
    centerLng: STOCKHOLM_CENTER.lng,
    minLat: STOCKHOLM_BOUNDS.minLat,
    maxLat: STOCKHOLM_BOUNDS.maxLat,
    minLng: STOCKHOLM_BOUNDS.minLng,
    maxLng: STOCKHOLM_BOUNDS.maxLng,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--zoom') opts.zoom = Number(argv[++i]);
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--height') opts.height = Number(argv[++i]);
    else if (a === '--output') opts.output = String(argv[++i]);
    else if (a === '--center-lat') opts.centerLat = Number(argv[++i]);
    else if (a === '--center-lng') opts.centerLng = Number(argv[++i]);
    else if (a === '--minlat') opts.minLat = Number(argv[++i]);
    else if (a === '--maxlat') opts.maxLat = Number(argv[++i]);
    else if (a === '--minlng') opts.minLng = Number(argv[++i]);
    else if (a === '--maxlng') opts.maxLng = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      process.stderr.write(`Unknown arg: ${a}\n${usage()}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.zoom) || opts.zoom < 0 || opts.zoom > 19) {
    throw new Error(`zoom måste vara heltal 0..19, fick ${opts.zoom}`);
  }
  if (!Number.isFinite(opts.width) || opts.width <= 0 ||
      !Number.isFinite(opts.height) || opts.height <= 0) {
    throw new Error(`width/height måste vara positiva nummer`);
  }
  // Om användaren satte center men inte bounds, härled bounds från
  // center + zoom + pixel-storlek (samma formel som viewportFromCenter).
  const hasBounds = argv.includes('--minlat') || argv.includes('--maxlat')
                 || argv.includes('--minlng') || argv.includes('--maxlng');
  if (!hasBounds) {
    const degPerPixel = 360 / (256 * (1 << opts.zoom));
    const widthDeg = opts.width * degPerPixel;
    const heightDegMercator = opts.height * degPerPixel;
    const secLat = 1 / Math.max(0.01, Math.cos((opts.centerLat * Math.PI) / 180));
    const heightDeg = heightDegMercator / secLat;
    opts.minLng = opts.centerLng - widthDeg / 2;
    opts.maxLng = opts.centerLng + widthDeg / 2;
    opts.minLat = opts.centerLat - heightDeg / 2;
    opts.maxLat = opts.centerLat + heightDeg / 2;
  }
  return opts;
}

function usage() {
  return `build-stockholm-tiles.mjs — bygger Stockholm-tile-asset

  --zoom <N>          OSM zoom-nivå (default 11, range 0-19)
  --width <N>         slutgiltig asset-bredd i px (default 360)
  --height <N>        slutgiltig asset-höjd i px (default 760)
  --output <namn>     filnamn under assets/ (default stockholm-tiles.png)
  --center-lat <deg>  center.lat om bounds ej ges (default 59.3293)
  --center-lng <deg>  center.lng om bounds ej ges (default 18.0686)
  --minlat/--maxlat/--minlng/--maxlng <deg>  explicita bounds
                        (ellers auto-deriverade från center + zoom + size)

Exempel för 3 z-nivåer (Stockholm centrum-fokuserat):
  node scripts/build-stockholm-tiles.mjs --zoom 11 --output stockholm-tiles-z11.png
  node scripts/build-stockholm-tiles.mjs --zoom 13 --output stockholm-tiles-z13.png
  node scripts/build-stockholm-tiles.mjs --zoom 15 --output stockholm-tiles-z15.png
`;
}

// --- Mercator helpers (samma formler som mapProjection.js) -----------------

const TILE_SIZE = 256;

function lngToTileX(lng, zoom) {
  return ((lng + 180) / 360) * (1 << zoom);
}

function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << zoom);
}

function tileToLng(x, zoom) {
  return (x / (1 << zoom)) * 360 - 180;
}

function tileToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / (1 << zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// --- Tile-hämtning --------------------------------------------------------

const UA = 'EventPulseSandbox/0.1 (local-dev; kontakt: tomor@eventpulse.local)';

async function fetchTile(x, y, zoom) {
  const url = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`OSM HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { x, y, buf };
}

// --- Pipeline -------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);
  const { zoom, width, height, output: outName, minLat, maxLat, minLng, maxLng } = opts;

  console.log(`[build-stockholm-tiles] zoom=${zoom} output=${width}×${height} → ${outName}`);
  console.log(`[build-stockholm-tiles] bounds: lat=[${minLat}..${maxLat}] lng=[${minLng}..${maxLng}]`);

  // 1. Räkna ut tile-range.
  const xMinFloat = lngToTileX(minLng, zoom);
  const xMaxFloat = lngToTileX(maxLng, zoom);
  const yMinFloat = latToTileY(maxLat, zoom); // OBS: y ökar nedåt
  const yMaxFloat = latToTileY(minLat, zoom);
  const x0 = Math.floor(xMinFloat);
  const x1 = Math.floor(xMaxFloat);
  const y0 = Math.floor(yMinFloat);
  const y1 = Math.floor(yMaxFloat);
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  console.log(`[build-stockholm-tiles] tile range: x=[${x0}..${x1}] y=[${y0}..${y1}] → ${cols}×${rows} = ${cols * rows} tiles`);

  // 2. Ladda ner alla tiles parallellt.
  const tasks = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tasks.push(fetchTile(x, y, zoom));
    }
  }
  const tiles = await Promise.all(tasks);
  console.log(`[build-stockholm-tiles] hämtade ${tiles.length} tiles`);

  // 3. Bygg en composite-bild med alla tiles i rätt ordning.
  //    sharp.composite med tiles i grid.
  const composite = [];
  for (const t of tiles) {
    composite.push({
      input: t.buf,
      left: (t.x - x0) * TILE_SIZE,
      top: (t.y - y0) * TILE_SIZE,
    });
  }
  const stitchedRaw = await sharp({
    create: {
      width: cols * TILE_SIZE,
      height: rows * TILE_SIZE,
      channels: 4,
      background: { r: 240, g: 238, b: 232, alpha: 1 }, // OSM:s canvas-färg
    },
  })
    .composite(composite)
    .png()
    .toBuffer();
  console.log(`[build-stockholm-tiles] stitched: ${cols * TILE_SIZE}×${rows * TILE_SIZE}px`);

  // 4. Croppa till exakt Stockholm-bbox i pixel-koordinater.
  //    pixel-x = (lngToTileX(lng, zoom) - x0) * TILE_SIZE
  //    pixel-y = (latToTileY(lat, zoom) - y0) * TILE_SIZE  (y ökar nedåt)
  const cropLeft = Math.round((xMinFloat - x0) * TILE_SIZE);
  const cropTop = Math.round((yMinFloat - y0) * TILE_SIZE);
  const cropWidth = Math.round((xMaxFloat - xMinFloat) * TILE_SIZE);
  const cropHeight = Math.round((yMaxFloat - yMinFloat) * TILE_SIZE);
  console.log(`[build-stockholm-tiles] crop: left=${cropLeft} top=${cropTop} ${cropWidth}×${cropHeight}px`);

  const cropped = await sharp(stitchedRaw)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();
  console.log(`[build-stockholm-tiles] cropped: ${cropWidth}×${cropHeight}px`);

  // 5. Resiza till target canvas-dimensioner (preserve aspect = cover-strategi).
  //    Stockholm bbox-aspect = lngRange / mercatorLatRange.
  //    För att undvika distortion använder vi `cover` så bilden fyller canvas
  //    och beskär överflöd jämnt. canvas-aspect ≈ bbox-aspect vid val av
  //    --width/--height, så cover = fit i praktiken.
  const resized = await sharp(cropped)
    .resize(width, height, {
      fit: 'cover',
      position: 'centre',
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // 6. Spara.
  const outPath = path.join(SANDBOX_ROOT, 'assets', outName);
  fs.writeFileSync(outPath, resized);
  const stat = fs.statSync(outPath);
  console.log(`[build-stockholm-tiles] sparad: ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`[build-stockholm-tiles] KLART. zoom ${zoom}: lng=${minLng}-${maxLng}, lat=${minLat}-${maxLat}.`);
}

main().catch((err) => {
  console.error('[build-stockholm-tiles] FEL:', err.message);
  process.exit(1);
});