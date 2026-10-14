#!/usr/bin/env tsx
/**
 * bin/bfl-stamp-test.ts
 *
 * Genererar 1024×576 vita och svarta testbilder med stämpel.
 * Standard: 240×64 SE-pill, 82% opacity, 24px inset (legacy bfl2/3/4).
 * --variant=small : 180×48, 50% opacity, 18px inset (användarens val 2026-10-12).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const W = 1024;
const H = 576;

const args = process.argv.slice(2);
const variant = args.find(a => a.startsWith('--variant='))?.slice('--variant='.length) ?? 'legacy';

const STAMPS = {
  legacy: {
    width: 240,
    height: 64,
    inset: 24,
    opacity: 0.82,
    fontSize: 22,
    dotR: 8,
    text: 'AI-generated',
  },
  small: {
    width: 180,
    height: 48,
    inset: 18,
    opacity: 0.50,
    fontSize: 16,
    dotR: 6,
    text: 'AI-generated',
  },
} as const;

const stamp = STAMPS[variant as 'legacy' | 'small'];
if (!stamp) {
  console.error(`Okänd variant: ${variant}. Använd --variant=legacy eller --variant=small.`);
  process.exit(2);
}

const STAMP_SVG = `<svg width="${stamp.width}" height="${stamp.height}" viewBox="0 0 ${stamp.width} ${stamp.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="${stamp.width - 4}" height="${stamp.height - 4}" rx="${Math.floor(stamp.height / 2)}" ry="${Math.floor(stamp.height / 2)}"
        fill="rgba(15,15,18,${stamp.opacity})"
        stroke="rgba(255,180,84,0.65)" stroke-width="1.5"/>
  <circle cx="${26}" cy="${stamp.height / 2}" r="${stamp.dotR}" fill="#FFB454"/>
  <text x="${26 + stamp.dotR + 10}" y="${stamp.height / 2 + stamp.fontSize / 3}" font-family="Arial, sans-serif" font-size="${stamp.fontSize}"
        font-weight="bold" fill="#FFFFFF" letter-spacing="0.5">${stamp.text}</text>
</svg>`;

async function stampAt(background: 'white' | 'black'): Promise<void> {
  const bg = background === 'white' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 1 };
  const left = W - stamp.width - stamp.inset;
  const top = H - stamp.height - stamp.inset;

  const stamped = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: bg,
    },
  })
    .composite([{ input: Buffer.from(STAMP_SVG), left, top }])
    .png()
    .toBuffer();

  const outDir = `/Users/claudgashi/EventPulse/local_image_library_stamped/_test_stamp`;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${background}_1024x576_${variant}_stamped.png`);
  writeFileSync(outPath, stamped);
  console.log(`✓ ${outPath}  (${stamped.length} bytes, variant=${variant})`);
}

async function main(): Promise<void> {
  await stampAt('white');
  await stampAt('black');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
