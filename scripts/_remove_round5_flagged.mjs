#!/usr/bin/env node
/**
 * _remove_round5_flagged.mjs — tar bort de flaggade bilderna från
 * tmp_image_corpus/_minor_safety_review.json.
 *
 * Tar bort lokalt (PNG + WebP + JSON) för de 60 bilder som flaggats av
 * review-minor-safety. Idempotent (404 hanteras tyst).
 *
 * Säkerhetsmodell:
 *   - default = dry-run (visar plan)
 *   - --apply kör
 *
 *   node scripts/_remove_round5_flagged.mjs           # dry-run
 *   node scripts/_remove_round5_flagged.mjs --apply   # kör
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const isApply = process.argv.includes('--apply');
const reviewPath = join(process.cwd(), 'tmp_image_corpus/_minor_safety_review.json');
const lib = join(process.cwd(), 'local_image_library');

if (!existsSync(reviewPath)) { console.error(`Missing ${reviewPath}`); process.exit(2); }

const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
const flagged = (review.flagged || []).map((p) => {
  // Format: cat/file.webp
  const [cat, filename] = p.split('/');
  const base = filename.replace(/\.webp$/, '');
  return { cat, filename, base, paths: {
    png: join(lib, cat, `${base}.png`),
    webp: join(lib, cat, `${base}.webp`),
    json: join(lib, cat, `${base}.json`),
  }};
});

console.log(`[remove-flagged] ${flagged.length} bilder att ta bort (${isApply ? 'APPLY' : 'DRY-RUN'})`);

let removed = 0;
for (const f of flagged) {
  const local = [f.paths.png, f.paths.webp, f.paths.json].filter(existsSync);
  console.log(`  ${isApply ? 'REMOVE' : 'plan'}: ${f.cat}/${f.filename} (${local.length} filer)`);
  if (isApply) {
    for (const p of local) {
      try {
        unlinkSync(p);
        removed++;
      } catch (e) {
        console.error(`    ✗ ${p}: ${e.message}`);
      }
    }
  }
}

console.log('');
console.log(`[remove-flagged] ${isApply ? 'tog bort ' + removed + ' filer' : 'dry-run klar'}`);