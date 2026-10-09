#!/usr/bin/env node
/**
 * _backfill_inventory.mjs — hitta alla dubbelstämplade events och gruppera per URL.
 *
 * Skriver: tmp_image_corpus/_backfill_plan_2026-10-08.json
 *   [{
 *     old_url, old_storage_path, event_count, category_slug,
 *     sample_titles, sample_event_ids
 *   }, ...]
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SUPABASE_BASE = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';

// Hämta alla events med PNG-URL
const urlMap = new Map();
let offset = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await db
    .from('events')
    .select('id, title_sv, image_url, category_slug, start_time, source')
    .ilike('image_url', '%.png')
    .range(offset, offset + PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const r of data) {
    if (!r.image_url) continue;
    if (!urlMap.has(r.image_url)) {
      urlMap.set(r.image_url, []);
    }
    urlMap.get(r.image_url).push(r);
  }
  if (data.length < PAGE) break;
  offset += PAGE;
}

console.log(`Hittade ${urlMap.size} unika PNG-URL:er bland ${[...urlMap.values()].reduce((s, e) => s + e.length, 0)} events`);

// Bygg plan
const plan = [];
for (const [url, events] of urlMap.entries()) {
  // Extrahera storage_path från URL
  // Format: https://<host>/storage/v1/object/public/event-posters/import-stamped/<name>.png
  const m = url.match(/\/storage\/v1\/object\/public\/(.+)$/);
  const storagePath = m ? m[1] : url;

  // Hitta vanligaste kategorin
  const catCount = {};
  for (const e of events) {
    const c = e.category_slug || 'unknown';
    catCount[c] = (catCount[c] || 0) + 1;
  }
  const category = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0];

  // Slumpa 3 sample-titlar
  const shuffled = [...events].sort(() => Math.random() - 0.5);
  const sampleTitles = shuffled.slice(0, 3).map(e => e.title_sv || '(no title)');
  const sampleIds = shuffled.slice(0, 3).map(e => e.id);

  plan.push({
    old_url: url,
    old_storage_path: storagePath,
    event_count: events.length,
    category_slug: category,
    sample_titles: sampleTitles,
    sample_event_ids: sampleIds,
  });
}

// Sortera efter event_count DESC (vanligaste först)
plan.sort((a, b) => b.event_count - a.event_count);

const outPath = join(process.cwd(), 'tmp_image_corpus/_backfill_plan_2026-10-08.json');
writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  total_unique_urls: plan.length,
  total_events: plan.reduce((s, e) => s + e.event_count, 0),
  items: plan,
}, null, 2));

console.log(`\nPlan skriven till ${outPath}`);
console.log(`\nTopp 10 mest använda URLs:`);
for (const e of plan.slice(0, 10)) {
  console.log(`  ${String(e.event_count).padStart(4)} events | ${e.category_slug.padEnd(20)} | ${e.old_storage_path.split('/').pop()}`);
}
console.log(`\nFördelning per kategori:`);
const byCat = {};
for (const e of plan) byCat[e.category_slug] = (byCat[e.category_slug] || 0) + 1;
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(25)} ${n} URLs`);
}
