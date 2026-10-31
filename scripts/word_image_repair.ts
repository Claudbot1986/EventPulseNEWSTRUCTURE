#!/usr/bin/env tsx
/**
 * scripts/word_image_repair.ts — reparera events som pekar på en karantänbild.
 *
 * Bakgrund: `word_image_cleanup.ts` kan flytta en bild till karantän efter att
 * den redan tilldelats till event. De eventen skulle då visa en bild som
 * underkänts av gaten. Det här skriptet hittar dem och sätter tillbaka en
 * generisk biblioteksbild (samma typ som `nullDefaultImage` /
 * `genericFallbackImage` i `08-Agent/utils/imageLibrary.ts`).
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_image_repair.ts --dry-run
 *   node --env-file=.env --import tsx scripts/word_image_repair.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storageFileName } from './lib/word-image-match.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const QUAR_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2_word_quarantine');

const IS_DRY = process.argv.includes('--dry-run');

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}
const SB_URL = env('SUPABASE_URL') ?? env('EXPO_PUBLIC_SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL/SERVICE_ROLE_KEY saknas'); process.exit(2); }
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

/** Bilder som FORTFARande ligger i biblioteket → deras lagringsnamn. */
const liveNames = new Set<string>();
for (const f of existsSync(WORD_DIR) ? readdirSync(WORD_DIR).filter((x) => x.endsWith('.webp')) : []) {
  liveNames.add(storageFileName(f.split('__')[0]));
}

/** Bilder i karantän → deras lagringsnamn (de som INTE längre finns i biblioteket). */
const quarNames = new Set<string>();
for (const f of existsSync(QUAR_DIR) ? readdirSync(QUAR_DIR).filter((x) => x.endsWith('.webp')) : []) {
  const name = storageFileName(f.split('__')[0]);
  if (!liveNames.has(name)) quarNames.add(name);
}
console.log(`[repair] karantänbilder som inte längre finns i biblioteket: ${quarNames.size}`);

if (!quarNames.size) { console.log('[repair] inget att reparera'); process.exit(0); }

// Generiska biblioteksbilder (samma pool som appens fallback).
const { data: pool } = await db
  .from('image_library')
  .select('id, public_url, storage_path, times_used')
  .in('category_slug', ['community', 'culture'])
  .not('cluster_tags', 'is', null)
  .not('cluster_tags', 'eq', '{}')
  .order('times_used', { ascending: true })
  .limit(50);
if (!pool?.length) { console.error('[repair] inga generiska bilder i biblioteket — kan inte reparera'); process.exit(2); }
console.log(`[repair] generiska bilder tillgängliga: ${pool.length}`);

// Events som pekar på en karantänbild.
type Ev = { id: string; title_sv: string | null; title_en: string | null; image_url: string | null };
const broken: Ev[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('events')
    .select('id, title_sv, title_en, image_url')
    .like('image_url', '%/import-stamped/word/%')
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || !data.length) break;
  for (const row of data as Ev[]) {
    const name = (row.image_url ?? '').split('/').pop() ?? '';
    if (quarNames.has(name)) broken.push(row);
  }
  if (data.length < 1000) break;
}
console.log(`[repair] events som pekar på en karantänbild: ${broken.length}`);

let fixed = 0;
for (let i = 0; i < broken.length; i++) {
  const ev = broken[i];
  const pick = pool[i % pool.length];
  if (IS_DRY) {
    console.log(`  [dry] ${(ev.title_sv || ev.title_en || '').slice(0, 50)} → ${pick.public_url}`);
    continue;
  }
  const { error } = await db.from('events').update({
    image_url: pick.public_url,
    image_ai_generated: false,
    image_generation_status: 'library_fallback',
    image_license: 'library-fallback',
    image_model: null,
    image_prompt: null,
    image_generated_at: null,
  }).eq('id', ev.id);
  if (error) { console.log(`  [fel] ${ev.id}: ${error.message}`); continue; }
  fixed++;
}
console.log(`\n[repair] ${IS_DRY ? 'dry-run — ' : ''}reparerade event: ${fixed}`);
