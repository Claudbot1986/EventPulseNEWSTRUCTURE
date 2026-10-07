#!/usr/bin/env node
/**
 * _retry_failed_downloads.mjs — ladda ner library-bilder som misslyckades
 * första gången. Listar ut vilka som inte finns lokalt och försöker igen.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const root = join(process.cwd(), 'local_image_library');

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

const rows = await fetchAllRows('image_library', 'id,storage_path,public_url,category_slug,venue_pattern,tags,source_event_id,times_used,rating,approved_by,added_at');

const BUCKET = 'event-posters';
let retries = 0, ok = 0, skip = 0;

for (const r of rows) {
  const cat = r.category_slug ?? '_unsorted';
  const dir = join(root, cat);
  const hash = r.id.split('-')[0];
  const slug = cat.replace(/[^a-z0-9-]/gi, '_').slice(0, 40);
  const imgName = `img_${slug}_${hash}.bin`;
  const metaName = `img_${slug}_${hash}.json`;
  const imgPath = join(dir, imgName);
  const metaPath = join(dir, metaName);

  // Kontrollera att filen finns OCH inte är tom
  if (existsSync(imgPath) && statSync(imgPath).size > 1000 && existsSync(metaPath)) {
    skip++;
    continue;
  }

  let storagePath = r.storage_path;
  if (storagePath.startsWith(`${BUCKET}/`)) storagePath = storagePath.slice(BUCKET.length + 1);

  retries++;
  try {
    const { data, error } = await db.storage.from(BUCKET).download(storagePath);
    if (error) throw error;
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length < 100) throw new Error('downloaded buffer too small');
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
  } catch (err) {
    console.error(`  ✗ ${storagePath}: ${err.message}`);
  }
}

console.log(`Klart: ${ok} åternedladdade, ${skip} redan OK, ${retries - ok} kvar fel.`);

// Slutrapport
let totalFiles = 0, totalBytes = 0;
const dirs = readdirSync(root).filter((d) => !d.startsWith('.'));
for (const d of dirs) {
  const p = join(root, d);
  if (!statSync(p).isDirectory()) continue;
  const files = readdirSync(p).filter((f) => f.endsWith('.bin'));
  for (const f of files) {
    const fp = join(p, f);
    totalFiles++;
    totalBytes += statSync(fp).size;
  }
  console.log(`  ${d.padEnd(20)} ${files.length} bilder`);
}
console.log(`Totalt: ${totalFiles} bilder, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);