#!/usr/bin/env node
// =============================================================================
// generate-icons.mjs — render 06-UI/assets/icon.svg into the PNGs that
// Expo / EAS / web expect.
//
// Why this exists:
//   - Expo `icon` requires a 1024×1024 PNG (no alpha) for store builds.
//   - `adaptiveIcon.foregroundImage` wants a 1024×1024 PNG with transparency.
//   - The web splash / favicon wants smaller sizes.
// We render the SVG at each size using @resvg/resvg-js (no native deps,
// pure WASM via Rust core). No Photoshop, no headless browser.
//
// Usage:
//   node 06-UI/scripts/generate-icons.mjs
//
// Inputs:  06-UI/assets/icon.svg
// Outputs: 06-UI/assets/{icon,adaptive-icon,favicon,splash}.png
// =============================================================================

import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, '..', 'assets');

if (!existsSync(ASSETS)) {
  mkdirSync(ASSETS, { recursive: true });
}

const SVG_PATH = resolve(ASSETS, 'icon.svg');
const svgText = readFileSync(SVG_PATH, 'utf8');

// Targets: Expo expects specific sizes & backgrounds.
//   - icon.png         1024×1024 opaque (App Store + Play Store icon)
//   - adaptive-icon    1024×1024 transparent (Android adaptive foreground)
//   - favicon          48×48 opaque (web)
//   - splash           1242×1242 opaque (web splash, big enough for 3x downscale)
const TARGETS = [
  { name: 'icon.png',         size: 1024, background: true,  label: 'iOS/Android app icon' },
  { name: 'adaptive-icon.png', size: 1024, background: false, label: 'Android adaptive foreground' },
  { name: 'favicon.png',      size: 48,   background: true,  label: 'Web favicon' },
  { name: 'splash.png',       size: 1242, background: true,  label: 'Web splash' },
];

let failed = 0;

for (const t of TARGETS) {
  try {
    const resvg = new Resvg(svgText, {
      fitTo: { mode: 'width', value: t.size },
      background: t.background ? '#0F172A' : undefined,
      // Keep the rounded corners from the SVG itself; background is solid dark.
      font: { loadSystemFonts: true },
    });
    const png = resvg.render().asPng();
    const outPath = resolve(ASSETS, t.name);
    writeFileSync(outPath, png);
    console.log(`  [ok] ${t.name.padEnd(20)} ${png.byteLength.toString().padStart(8)} bytes  (${t.label})`);
  } catch (err) {
    failed++;
    console.error(`  [fail] ${t.name}: ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} icon(s) failed.`);
  process.exit(1);
}

console.log('\nAll icons generated in 06-UI/assets/.');
