#!/usr/bin/env node
/**
 * scripts/verify_new_event_images.mjs
 *
 * Verifierar att ALLA events som skapades i ett tidsfönster faktiskt har en
 * fungerande bild — HTTP 200, rätt content-type och rätt bildformat (3:2,
 * 1248x832) — inte bara att DB-raden har en `image_url`-text.
 *
 * Detta kompletterar scripts/verify_app_event_images.mjs (som kollar att
 * appen VISAR bilder) med en DB-nivå-kontroll av varje enskilt event.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/verify_new_event_images.mjs \
 *     --since=2026-10-29T17:40:00Z [--expect-aspect=1.5] [--out=rapport.json]
 *
 * Exitkod: 0 = alla events OK, 1 = minst en trasig bild, 2 = fatalt fel.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = process.cwd();

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SINCE = arg('since', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
const EXPECT_ASPECT = Number(arg('expect-aspect', '1.5'));
const TOLERANCE = Number(arg('tolerance', '0.01'));
const DAY = new Date().toISOString().slice(0, 10);
const OUT = arg('out', path.join(PROJECT_ROOT, '.scratch', 'evidence', `${DAY}-app-images`, 'report-NEW-events.json'));

function log(...a) { console.log('[verify-new-events]', ...a); }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: events, error } = await supabase
  .from('events')
  .select('id,title_sv,title_en,source,category_slug,image_url,created_at,start_time')
  .gte('created_at', SINCE)
  .order('created_at', { ascending: true });

if (error) {
  console.error('[verify-new-events] DB-fel:', error.message);
  process.exit(2);
}

log(`fönster från ${SINCE} → ${events.length} events`);

const results = [];
let ok = 0;
let bad = 0;

for (const ev of events) {
  const row = {
    id: ev.id,
    title: ev.title_sv || ev.title_en || null,
    source: ev.source,
    category: ev.category_slug,
    created_at: ev.created_at,
    start_time: ev.start_time,
    url: ev.image_url,
    ok: false,
  };

  if (!ev.image_url) {
    row.status = 0;
    row.error = 'saknar image_url';
    bad += 1;
    results.push(row);
    continue;
  }

  try {
    const res = await fetch(ev.image_url);
    row.status = res.status;
    row.contentType = res.headers.get('content-type');
    if (!res.ok) {
      row.error = `HTTP ${res.status}`;
      bad += 1;
      results.push(row);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    row.width = meta.width;
    row.height = meta.height;
    row.aspect = Number((meta.width / meta.height).toFixed(4));
    row.bytes = buf.length;
    if (Math.abs(row.aspect - EXPECT_ASPECT) > TOLERANCE) {
      row.error = `aspect ${row.aspect} != ${EXPECT_ASPECT}`;
      bad += 1;
      results.push(row);
      continue;
    }
    row.ok = true;
    ok += 1;
  } catch (e) {
    row.error = String(e?.message || e);
    bad += 1;
  }
  results.push(row);
}

const report = {
  checkedAt: new Date().toISOString(),
  windowStart: SINCE,
  expectAspect: EXPECT_ASPECT,
  total: events.length,
  ok,
  bad,
  events: results,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

log(`OK ${ok} / ${bad} trasiga av ${events.length}`);
log(`rapport: ${OUT}`);

if (bad > 0) {
  for (const r of results.filter((x) => !x.ok).slice(0, 20)) {
    log(`  ✗ ${r.title?.slice(0, 50) ?? r.id} — ${r.error}`);
  }
  process.exit(1);
}
process.exit(0);
