#!/usr/bin/env node
/**
 * _build_local_image_library.mjs
 *
 * Bygger lokal bildkatalog:
 *   local_image_library/
 *     <category_slug>/
 *       img_<slug>_<hash>.png      (själva bilden)
 *       img_<slug>_<hash>.json    (metadata: source_event_id, category_slug, times_used, prompt, etc.)
 *     _unsorted/                  (gamla bilder utan category_slug)
 *
 *   - Hämtar de 674 befintliga biblioteks-bilderna från Supabase (storage + library-tabellen)
 *   - Skapar undermapp för varje unik category_slug
 *   - images without category_slug → _unsorted/
 *
 *   node scripts/_build_local_image_library.mjs [--dry-run]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const dryRun = process.argv.includes('--dry-run');

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const root = join(process.cwd(), 'local_image_library');
mkdirSync(root, { recursive: true });

async function fetchAllRows(table, select, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

console.log('Hämtar image_library-rader…');
const rows = await fetchAllRows('image_library', 'id,storage_path,public_url,category_slug,venue_pattern,tags,source_event_id,times_used,rating,approved_by,added_at');
console.log(`Hittade ${rows.length} biblioteks-rader.`);

// Räkna per kategori
const byCat = new Map();
for (const r of rows) {
  const k = r.category_slug ?? '_unsorted';
  byCat.set(k, (byCat.get(k) ?? 0) + 1);
}
console.log('Fördelning:');
for (const [k, v] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}

// Skapa undermappar
const cats = [...new Set(rows.map((r) => r.category_slug ?? '_unsorted'))];
for (const c of cats) mkdirSync(join(root, c), { recursive: true });
console.log(`\nSkapade ${cats.length} undermappar under ${root}`);

// Ladda ner bilder
let ok = 0, errs = 0, skipped = 0;
const BUCKET = 'event-posters';
for (const r of rows) {
  const cat = r.category_slug ?? '_unsorted';
  const dir = join(root, cat);
  const hash = r.id.split('-')[0]; // kort prefix för filnamn
  const slug = cat.replace(/[^a-z0-9-]/gi, '_').slice(0, 40);
  const imgName = `img_${slug}_${hash}.bin`;
  const metaName = `img_${slug}_${hash}.json`;
  const imgPath = join(dir, imgName);
  const metaPath = join(dir, metaName);

  // Skippa om redan nedladdad
  if (existsSync(imgPath) && existsSync(metaPath)) { skipped++; continue; }

  if (dryRun) { skipped++; continue; }

  // Hämta bilden från storage_path
  // storage_path = "event-posters/ai-generated/abc.jpg" eller liknande
  let storagePath = r.storage_path;
  if (storagePath.startsWith(`${BUCKET}/`)) storagePath = storagePath.slice(BUCKET.length + 1);

  try {
    const { data, error } = await db.storage.from(BUCKET).download(storagePath);
    if (error) throw error;
    const buf = Buffer.from(await data.arrayBuffer());
    writeFileSync(imgPath, buf);

    writeFileSync(metaPath, JSON.stringify({
      library_id: r.id,
      category_slug: r.category_slug,
      venue_pattern: r.venue_pattern,
      tags: r.tags,
      source_event_id: r.source_event_id,
      times_used: r.times_used,
      rating: r.rating,
      approved_by: r.approved_by,
      added_at: r.added_at,
      public_url: r.public_url,
      local_path: imgPath.replace(process.cwd() + '/', ''),
    }, null, 2));
    ok++;
    if (ok % 50 === 0) console.log(`  ${ok}/${rows.length} nedladdade…`);
  } catch (err) {
    errs++;
    console.error(`  ✗ ${storagePath}: ${err.message}`);
  }
}
console.log(`\nKlart: ${ok} nedladdade, ${skipped} redan lokala, ${errs} fel.`);
console.log(`Mapp: ${root}`);