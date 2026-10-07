#!/usr/bin/env node
/**
 * _remove_inappropriate_library.mjs — tar bort 15 handske+kniv-bilder från
 * image_library + Supabase Storage. Säkerhetsmodell:
 *   - --dry-run (default): listar plan
 *   - --apply: kör skarpt — tar bort DB-rad + Storage-objekt
 *   - Idempotent (404 i Storage hanteras tyst, ingen DB-rad → noop)
 *
 * Användning:
 *   node scripts/_remove_inappropriate_library.mjs          # dry-run
 *   node scripts/_remove_inappropriate_library.mjs --apply # skarpt
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE creds'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const isApply = process.argv.includes('--apply');

// Auktoritativ lista fryst 2026-10-07 från första vision-review-körning.
// Senare körningar ger varierande resultat pga vision-modellens stokastik.
const review = JSON.parse(readFileSync(resolve('tmp_image_corpus/_knife_glove_review_FROZEN.json'), 'utf8'));
const paths = review.both || [];

console.log(`[remove-inappropriate] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
console.log(`[remove-inappropriate] ${paths.length} bilder att ta bort`);

const STORAGE_BUCKET = 'event-posters';

let dbRemoved = 0;
let storageRemoved = 0;
let errors2 = 0;

for (const relPath of paths) {
  // relPath innehåller "cat/file.webp" — men DB lagrar storage_path som
  // "event-posters/import-stamped/file.webp" (kategorin är en separat kolumn,
  // INTE del av pathen). Vi tar bara filnamnet för DB-sökningen, och hela
  // relPath för Storage-borttagning.
  const fname = relPath.split('/').pop();
  const storagePath = `${STORAGE_BUCKET}/import-stamped/${fname}`;
  // 1. Hitta DB-rad via storage_path
  const { data: rows, error: fetchErr } = await db
    .from('image_library')
    .select('id, storage_path, category_slug')
    .eq('storage_path', storagePath);

  if (fetchErr) {
    console.error(`  ✗ ${relPath}: ${fetchErr.message}`);
    errors2++;
    continue;
  }
  if (!rows || rows.length === 0) {
    if (isApply) {
      // redan borta — noop, men försök storage ändå
    } else {
      console.log(`  skip ${relPath}: ingen DB-rad`);
    }
  } else {
    for (const row of rows) {
      console.log(`  ${isApply ? 'REMOVE' : 'plan'}: ${row.category_slug}/${row.storage_path} (id=${row.id})`);
      if (isApply) {
        const { error: delErr } = await db
          .from('image_library')
          .delete()
          .eq('id', row.id);
        if (delErr) {
          console.error(`  ✗ DB delete ${row.id}: ${delErr.message}`);
          errors2++;
          continue;
        }
        dbRemoved++;
      }
    }
  }

  // 2. Ta bort Storage-objektet (Storage-key = import-stamped/<fname>)
  if (isApply) {
    const { error: stErr } = await db.storage
      .from(STORAGE_BUCKET)
      .remove([`import-stamped/${fname}`]);
    if (stErr && stErr.message !== 'The resource was not found') {
      console.error(`  ✗ storage import-stamped/${fname}: ${stErr.message}`);
      errors2++;
    } else {
      storageRemoved++;
    }
  }
}

// Summering
console.log('');
console.log(`[remove-inappropriate] ${isApply ? 'DONE' : 'PLAN'}`);
console.log(`  DB-rader borttagna:    ${dbRemoved}`);
console.log(`  Storage-objekt borttagna: ${storageRemoved}`);
console.log(`  fel:                     ${errors2}`);

if (!isApply) {
  console.log('');
  console.log('Kör med --apply för att verkställa.');
}