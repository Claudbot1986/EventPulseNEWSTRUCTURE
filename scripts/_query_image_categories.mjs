#!/usr/bin/env node
/**
 * _query_image_categories.mjs — read-only fråga mot Supabase.
 *
 * Två vyer:
 *  A) Events per category_slug, med image-kanal uppdelad i
 *     ai / licensed / scrape / none. Bara framtida, published events.
 *  B) image_library-fyllnad per category_slug.
 *
 *  node scripts/_query_image_categories.mjs
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(2); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function fetchAllRows(table, select, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

console.log('Hämtar events + image_library från Supabase…');

const [events, library] = await Promise.all([
  fetchAllRows('events', 'category_slug,image_url,image_ai_generated,image_license,start_time,status'),
  fetchAllRows('image_library', 'category_slug'),
]);

const now = Date.now();
const future = events.filter((e) =>
  e.status === 'published' && new Date(e.start_time).getTime() >= now
);

// Klassificera image-kanal
function channel(e) {
  if (!e.image_url) return 'none';
  if (e.image_ai_generated) return 'ai';
  if (e.image_license && e.image_license !== 'unknown') return 'licensed';
  return 'scrape'; // image_url utan license/ai — gamla scrape-originaler
}

const buckets = new Map();
for (const e of future) {
  const k = e.category_slug ?? '(null)';
  let b = buckets.get(k);
  if (!b) { b = { ai: 0, licensed: 0, scrape: 0, none: 0 }; buckets.set(k, b); }
  b[channel(e)]++;
}

const libMap = new Map();
for (const r of library) {
  const k = r.category_slug ?? '(null)';
  libMap.set(k, (libMap.get(k) ?? 0) + 1);
}

const rows = [...buckets.keys()]
  .sort((a, b) => (buckets.get(b).ai + buckets.get(b).licensed + buckets.get(b).scrape + buckets.get(b).none) -
                  (buckets.get(a).ai + buckets.get(a).licensed + buckets.get(a).scrape + buckets.get(a).none));

const pad = (s, w) => s.padEnd(w);
const num = (n) => String(n).padStart(6);

const totalAi      = rows.reduce((s, k) => s + buckets.get(k).ai, 0);
const totalLicensed = rows.reduce((s, k) => s + buckets.get(k).licensed, 0);
const totalScrape  = rows.reduce((s, k) => s + buckets.get(k).scrape, 0);
const totalNone    = rows.reduce((s, k) => s + buckets.get(k).none, 0);

console.log('');
console.log(`Framtida published events: ${future.length}  |  image_library-rader: ${library.length}`);
console.log('');
console.log('  Bildkanal: ai = AI-genererad | licensed = license satt (cc/press) | scrape = image_url utan license');
console.log('             none = ingen image_url');
console.log('');
console.log(`${pad('category_slug', 20)} ${num('total')} ${num('ai')} ${num('lic.')} ${num('scrape')} ${num('none')} ${num('library')}`);
console.log('-'.repeat(74));
for (const k of rows) {
  const b = buckets.get(k);
  console.log(
    `${pad(k, 20)} ${num(b.ai + b.licensed + b.scrape + b.none)}` +
    ` ${num(b.ai)} ${num(b.licensed)} ${num(b.scrape)} ${num(b.none)}` +
    ` ${num(libMap.get(k) ?? 0)}`
  );
}
console.log('-'.repeat(74));
console.log(
  `${pad('TOTALT', 20)} ${num(future.length)} ${num(totalAi)} ${num(totalLicensed)} ${num(totalScrape)} ${num(totalNone)} ${num(library.length)}`
);