#!/usr/bin/env node
/**
 * _retag_round5_entries.mjs — uppdatera taggar på redan-uppladdade
 * round5-bilder som fått fel tagg-set (TAGS_ROUND2 istället för TAGS_ROUND5).
 *
 * Matchar storage_path som börjar med bfl5_*.webp, bfl5b_*.webp, etc.
 * Sätter tags till ['bfl', 'flux-pro-1.1', 'stamped-2026-10-07', 'round5-1per30'].
 *
 * Säkerhetsmodell:
 *   - default = dry-run (visar antal som WOULD update)
 *   - --apply kör uppdateringen
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE creds'); process.exit(2); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const isApply = process.argv.includes('--apply');
const NEW_TAGS = ['bfl', 'flux-pro-1.1', 'stamped-2026-10-07', 'round5-1per30'];

// Hämta alla rader med storage_path som börjar med bfl5
const { data: rows, error } = await db
  .from('image_library')
  .select('id, storage_path, tags')
  .like('storage_path', 'event-posters/import-stamped/bfl5%');

if (error) { console.error('fetch:', error.message); process.exit(1); }

const wrongTags = (rows ?? []).filter((r) => {
  const t = r.tags ?? [];
  return !t.includes('round5-1per30');
});

console.log(`[retag-round5] ${rows?.length ?? 0} round5-rader i image_library`);
console.log(`[retag-round5] ${wrongTags.length} har fel tagg (round5-1per30 saknas)`);
console.log(`[retag-round5] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

if (wrongTags.length === 0) {
  console.log('[retag-round5] inget att göra.');
  process.exit(0);
}

if (!isApply) {
  console.log('Kör med --apply för att uppdatera.');
  process.exit(0);
}

let updated = 0;
for (const row of wrongTags) {
  const { error: upErr } = await db
    .from('image_library')
    .update({ tags: NEW_TAGS })
    .eq('id', row.id);
  if (upErr) {
    console.error(`  ✗ ${row.storage_path}: ${upErr.message}`);
  } else {
    updated++;
    if (updated % 20 === 0) console.log(`  ${updated}/${wrongTags.length} uppdaterade`);
  }
}

console.log(`[retag-round5] klart — ${updated} uppdaterade.`);