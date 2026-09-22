#!/usr/bin/env node
// bake-explore-tile.mjs — bake an approved tile photo into
// 06-UI/assets/exploreTiles/tiles.data.js as a data-URL entry.
//
// Downscale/compress FIRST with sips (macOS), e.g.:
//   cp tmp/explore-tiles/tile-src-live-01.jpg tmp/explore-tiles/live-tile.jpg
//   sips -Z 576 --setProperty formatOptions 75 tmp/explore-tiles/live-tile.jpg
//
// Then:
//   node tools/bake-explore-tile.mjs --key=LIVE --file=tmp/explore-tiles/live-tile.jpg
//
// Rewrites tiles.data.js preserving all existing keys and adds (or replaces)
// the given key. Exploratory/dev-only. NOT bundled into the Expo client
// (tiles.data.js itself IS, via require in HomeScreen.js).

import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(PROJECT_ROOT, '06-UI', 'assets', 'exploreTiles', 'tiles.data.js');
const MAX_BYTES = 300 * 1024; // keep the Metro bundle lean per tile

function arg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

(async () => {
  const key = arg('key');
  const file = arg('file');
  if (!key || !file) {
    console.error('Usage: node tools/bake-explore-tile.mjs --key=LIVE --file=tmp/explore-tiles/live-tile.jpg');
    process.exit(2);
  }
  if (!/^[A-Z0-9_]+$/.test(key)) {
    console.error(`Invalid key "${key}" — use UPPER_SNAKE_CASE.`);
    process.exit(2);
  }

  const abs = path.resolve(PROJECT_ROOT, file);
  const buf = await fs.readFile(abs);
  if (buf.length > MAX_BYTES) {
    console.error(`STOP: ${file} is ${(buf.length / 1024).toFixed(0)} kB (> ${MAX_BYTES / 1024} kB).`);
    console.error('Downscale/compress first, e.g.:');
    console.error('  sips -Z 576 --setProperty formatOptions 75 <file>');
    process.exit(2);
  }

  const content = await fs.readFile(DATA_FILE, 'utf8');
  const data = {};
  // Matches both `KEY: "..."` (hand-written) and `"KEY": "..."` (JSON.stringify) —
  // the `"?` and `"?` make the key quotes optional so a previous JSON.stringify
  // rewrite doesn't silently drop entries.
  const keyRegex = /"?([A-Z_]+)"?:\s*"(data:image\/[a-z]+;base64,[^"]+)"/g;
  let match;
  while ((match = keyRegex.exec(content)) !== null) {
    data[match[1]] = match[2];
  }
  data[key] = `data:image/jpeg;base64,${buf.toString('base64')}`;

  await fs.writeFile(DATA_FILE, `module.exports = ${JSON.stringify(data, null, 2)};\n`);
  const summary = Object.entries(data).map(([k, v]) => `${k}=${(Buffer.byteLength(v) / 1024).toFixed(0)}kB`).join(' ');
  console.log(`Baked ${key} into tiles.data.js. Entries: ${summary}`);
})();