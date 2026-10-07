#!/usr/bin/env node
/**
 * _query_image_format.mjs — read-only: vilka filformat pekar events_public.image_url på?
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing Supabase creds'); process.exit(2); }

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

const events = await fetchAllRows('events_public', 'image_url,image_ai_generated,image_license');

const fmtCount = new Map();
const samplePerFmt = new Map();
const otherExamples = [];

function fmtOf(url) {
  if (!url) return '(NULL)';
  // strip query string & hash
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  const m = clean.match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : '(no-ext)';
}

for (const e of events) {
  const f = fmtOf(e.image_url);
  fmtCount.set(f, (fmtCount.get(f) ?? 0) + 1);
  if (!samplePerFmt.has(f)) samplePerFmt.set(f, e.image_url);
}

const aiUrls = events.filter((e) => e.image_ai_generated && e.image_url);
const aiFmtCount = new Map();
for (const e of aiUrls) {
  const f = fmtOf(e.image_url);
  aiFmtCount.set(f, (aiFmtCount.get(f) ?? 0) + 1);
}

console.log(`Totalt events_public-rader: ${events.length}`);
console.log(`  med image_url:              ${events.filter((e) => e.image_url).length}`);
console.log(`  image_ai_generated=true:    ${aiUrls.length}`);
console.log('');
console.log('Filformat (efter URL-ändelse):');
for (const [k, v] of [...fmtCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}
console.log('');
console.log('Filformat BARA för AI-genererade events:');
for (const [k, v] of [...aiFmtCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}
console.log('');
console.log('Exempel-URL per format:');
for (const [k, v] of [...samplePerFmt.entries()].slice(0, 10)) {
  console.log(`  ${k.padEnd(8)} → ${v?.slice(0, 110)}`);
}