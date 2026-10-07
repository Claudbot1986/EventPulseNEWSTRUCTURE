#!/usr/bin/env node
/**
 * _query_event_image_buckets.mjs — read-only: hur ser image-status ut på future events?
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing creds'); process.exit(2); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const out = [];
let from = 0;
while (true) {
  const { data, error } = await db.from('events')
    .select('id, category_slug, image_url, image_ai_generated, image_generation_status')
    .eq('status', 'published')
    .gt('start_time', new Date().toISOString())
    .range(from, from + 1000 - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  out.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const buckets = {library_fallback: 0, ai_generated: 0, null_image: 0, other: 0};
const byCatBucket = {};
for (const e of out) {
  let bucket;
  if (e.image_generation_status === 'library_fallback') bucket = 'library_fallback';
  else if (e.image_ai_generated) bucket = 'ai_generated';
  else if (!e.image_url) bucket = 'null_image';
  else bucket = 'other';
  buckets[bucket]++;
  const cat = e.category_slug ?? '(null)';
  byCatBucket[cat] = byCatBucket[cat] || {library_fallback: 0, ai_generated: 0, null_image: 0, other: 0, total: 0};
  byCatBucket[cat][bucket]++;
  byCatBucket[cat].total++;
}

console.log('Total future events:', out.length);
console.log('Buckets:');
for (const [k, v] of Object.entries(buckets)) console.log('  ' + k.padEnd(20) + v);
console.log('');
console.log('=== Per kategori (top 20) ===');
console.log('cat'.padEnd(20), 'lb'.padStart(5), 'ai'.padStart(5), 'null'.padStart(5), 'other'.padStart(6), 'total'.padStart(7));
for (const [cat, b] of Object.entries(byCatBucket).sort((a,b) => b[1].total - a[1].total).slice(0, 20)) {
  console.log(cat.padEnd(20), String(b.library_fallback).padStart(5), String(b.ai_generated).padStart(5), String(b.null_image).padStart(5), String(b.other).padStart(6), String(b.total).padStart(7));
}
console.log('');
console.log('=== Per kategori där null_image > 0 (eller other > 0) ===');
for (const [cat, b] of Object.entries(byCatBucket).sort((a,b) => (b[1].null_image + b[1].other) - (a[1].null_image + a[1].other)).slice(0, 15)) {
  if (b.null_image + b.other > 0)
    console.log(cat.padEnd(20), 'lb=' + b.library_fallback, 'ai=' + b.ai_generated, 'null=' + b.null_image, 'other=' + b.other);
}