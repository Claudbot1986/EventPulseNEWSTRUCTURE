#!/usr/bin/env tsx
/**
 * scripts/word_index_sync.ts — synka ordformer till image_library.
 *
 * Varför: ingestion väljer ordbild genom att slå upp TITELNS ord i
 * `image_library` (category_slug='word'). För att "Julen är här" ska hitta
 * jul-bilden måste raden för nyckeln "jul" lista ALLA ordformer som pekar på
 * den: jul, julen, julens …
 *
 * Ordformerna kommer från ord-inventeringen — samma facit som generatorn,
 * gaten och tilldelningen använder. Inget gissas.
 *
 *   cluster_tags = ordformerna (t.ex. ["jul", "julen"])
 *   tags[0]      = bildnyckeln (t.ex. "jul")
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_index_sync.ts --dry-run
 *   node --env-file=.env --import tsx scripts/word_index_sync.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { buildWordIndex } from './lib/word-image-match.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_CSV = path.join(
  PROJECT_ROOT, 'docs', 'audit', 'data', 'huvudattraktioner-2026-10-31-ord-inventering.csv',
);

const IS_DRY = process.argv.includes('--dry-run');

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}
const SB_URL = env('SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL/SERVICE_ROLE_KEY saknas'); process.exit(2); }
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

if (!existsSync(INVENTORY_CSV)) {
  console.error(`Ord-inventeringen saknas: ${INVENTORY_CSV}`);
  process.exit(2);
}

const invRows = parseCsv(readFileSync(INVENTORY_CSV, 'utf8'));
const wordIndex = buildWordIndex(invRows.map((r) => ({ ord: r.ord ?? '', stam: r.stam ?? '' })));

// Nyckel → ordformer.
const formsForKey = new Map<string, Set<string>>();
for (const [ord, key] of wordIndex) {
  const set = formsForKey.get(key) ?? new Set<string>();
  set.add(ord);
  formsForKey.set(key, set);
}
// OBS: nyckeln läggs INTE in automatiskt. Ordformerna är de ord som
// FAKTISKT finns i ordlistan — samma facit som generatorn, gaten och
// tilldelningen använder. Om nyckeln "dag" bara finns via formen "dagen"
// ska token "dag" INTE matcha: "dag" finns inte i ordlistan.

// Ordraderna i biblioteket.
const { data: rows, error } = await db
  .from('image_library')
  .select('id, storage_path, tags, cluster_tags')
  .eq('category_slug', 'word');
if (error) { console.error(error.message); process.exit(1); }
console.log(`[sync] ordrader i biblioteket: ${rows?.length ?? 0}`);

let changed = 0, unchanged = 0, noForms = 0;
const updates: { id: string; cluster_tags: string[]; tags: string[] }[] = [];

for (const row of rows ?? []) {
  const key = (row.tags?.[0] ?? '').trim().toLowerCase();
  if (!key) { noForms++; continue; }
  const forms = [...(formsForKey.get(key) ?? new Set<string>())].sort();
  if (!forms.length) { noForms++; continue; }

  const current = [...(row.cluster_tags ?? [])].map((t) => t.trim().toLowerCase()).sort();
  const same = current.length === forms.length && current.every((t, i) => t === forms[i]);
  if (same) { unchanged++; continue; }

  changed++;
  updates.push({ id: row.id, cluster_tags: forms, tags: [key, ...(row.tags ?? []).slice(1)] });
}

console.log(`[sync] ändrade: ${changed}, oförändrade: ${unchanged}, utan nyckel/former: ${noForms}`);

if (IS_DRY) {
  for (const u of updates.slice(0, 10)) {
    console.log(`  [dry] ${u.tags[0]} → ${u.cluster_tags.length} ordformer (${u.cluster_tags.slice(0, 6).join(', ')}${u.cluster_tags.length > 6 ? ', …' : ''})`);
  }
  process.exit(0);
}

let written = 0;
for (const u of updates) {
  const { error: upErr } = await db
    .from('image_library')
    .update({ cluster_tags: u.cluster_tags, tags: u.tags })
    .eq('id', u.id);
  if (upErr) console.log(`  [fel] ${u.tags[0]}: ${upErr.message}`);
  else written++;
}
console.log(`[sync] uppdaterade rader: ${written}`);
