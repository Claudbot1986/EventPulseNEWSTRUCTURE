#!/usr/bin/env node
/**
 * _query_image_license.mjs — read-only: hur ser image_license ut i praktiken?
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

const events = await fetchAllRows(
  'events',
  'image_url,image_ai_generated,image_license,image_attribution,image_source_url'
);

const totalWithUrl  = events.filter((e) => e.image_url).length;
const totalAi       = events.filter((e) => e.image_ai_generated).length;
const totalLicAny   = events.filter((e) => e.image_license).length;

const byLic = new Map();
for (const e of events) {
  const k = e.image_license ?? '(NULL)';
  byLic.set(k, (byLic.get(k) ?? 0) + 1);
}

console.log(`Totalt events:                ${events.length}`);
console.log(`  med image_url:              ${totalWithUrl}`);
console.log(`  image_ai_generated=true:    ${totalAi}`);
console.log(`  image_license IS NOT NULL:  ${totalLicAny}`);
console.log('');
console.log('image_license — värden i DB:');
for (const [k, v] of [...byLic.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${v}`);
}

console.log('');
console.log('--- Stickprov: 8 events där image_license INTE är null ---');
const sample = events.filter((e) => e.image_license).slice(0, 8);
for (const e of sample) {
  console.log(JSON.stringify({
    url: e.image_url?.slice(0, 80),
    ai: e.image_ai_generated,
    lic: e.image_license,
    attr: e.image_attribution?.slice(0, 60),
    src: e.image_source_url?.slice(0, 60),
  }));
}

console.log('');
console.log('--- Stickprov: 5 events där image_url finns men image_license är NULL ---');
const sampleNoLic = events.filter((e) => e.image_url && !e.image_license).slice(0, 5);
for (const e of sampleNoLic) {
  console.log(JSON.stringify({
    url: e.image_url?.slice(0, 80),
    ai: e.image_ai_generated,
    lic: e.image_license,
    attr: e.image_attribution?.slice(0, 60),
    src: e.image_source_url?.slice(0, 60),
  }));
}