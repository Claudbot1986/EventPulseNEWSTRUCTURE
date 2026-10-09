#!/usr/bin/env -S npx tsx
/**
 * _restamp_bulk.ts — uppdatera events.image_url från gammal URL
 * (import-stamped/<name>.webp) till ny URL
 * (import-stamped/<name>.stamped.webp).
 *
 * Bakgrund: stämplings-pipelinen bytte från in-place (.webp) till separat
 * katalog med suffix `.stamped.webp`. DB måste peka om alla events som
 * pekade på de gamla URL:erna till de nya.
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, uppdaterar inte)
 *   - --apply för skarp körning
 *   - Per-event fel loggas och hoppas över
 *
 * Användning:
 *   npx tsx scripts/_restamp_bulk.ts --dry-run
 *   npx tsx scripts/_restamp_bulk.ts --apply
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STAMPED_LIB = join(process.cwd(), 'local_image_library_stamped');

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

interface RestampCandidate {
  id: string;
  oldUrl: string;
  newUrl: string | null;     // null om ingen motsvarighet hittades
  newFilename: string;       // för log
  reason: 'has-stamped' | 'missing-stamped';
}

async function main(): Promise<void> {
  console.log(`[restamp-bulk] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[restamp-bulk] STAMPED_LIB (verifiering): ${STAMPED_LIB}`);
  console.log('');

  // 1. Hämta alla events med image_url som pekar på gammal URL
  //    (inte redan .stamped.webp).
  const { data, error } = await db
    .from('events')
    .select('id, image_url')
    .like('image_url', '%/import-stamped/%')
    .not('image_url', 'like', '%.stamped.webp');

  if (error) {
    console.error('[restamp-bulk] query error:', error.message);
    process.exit(2);
  }
  if (!data || data.length === 0) {
    console.log('[restamp-bulk] inga events behöver uppdateras.');
    process.exit(0);
  }
  console.log(`[restamp-bulk] hittade ${data.length} events med gammal image_url.`);

  // 2. Bygg kandidat-lista
  const candidates: RestampCandidate[] = [];
  let missingCount = 0;
  for (const row of data) {
    const oldUrl = row.image_url as string;
    const filename = oldUrl.split('/').pop() ?? '';
    const baseName = filename.replace(/\.webp$/i, '');
    const newFilename = `${baseName}.stamped.webp`;

    // Verifiera att motsvarande fil faktiskt finns i STAMPED_LIB
    // Vi gör bara en grov kontroll: leta i hela STAMPED_LIB efter filnamnet.
    let found = false;
    if (existsSync(STAMPED_LIB)) {
      const { readdirSync } = await import('node:fs');
      for (const cat of readdirSync(STAMPED_LIB)) {
        const candidate = join(STAMPED_LIB, cat, newFilename);
        if (existsSync(candidate)) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      missingCount++;
      candidates.push({ id: row.id, oldUrl, newUrl: null, newFilename, reason: 'missing-stamped' });
      continue;
    }

    const newUrl = oldUrl.replace(/\/import-stamped\/[^/]+\.webp$/i, `/import-stamped/${newFilename}`);
    candidates.push({ id: row.id, oldUrl, newUrl, newFilename, reason: 'has-stamped' });
  }

  const updateable = candidates.filter(c => c.newUrl !== null);
  console.log(`  uppdateringsbara:  ${updateable.length}`);
  console.log(`  saknar stämplad:   ${missingCount}`);
  console.log('');

  if (updateable.length === 0) {
    console.log('[restamp-bulk] inga events har motsvarande stämplad fil — kör _stamp_bulk.ts först.');
    process.exit(0);
  }

  if (isDryRun) {
    console.log('[restamp-bulk] DRY-RUN: inga DB-ändringar. Första 10 kandidater:');
    for (const c of updateable.slice(0, 10)) {
      console.log(`  ${c.id}`);
      console.log(`    gammal: ${c.oldUrl}`);
      console.log(`    ny:     ${c.newUrl}`);
    }
    if (updateable.length > 10) console.log(`  ...och ${updateable.length - 10} till.`);
    console.log('');
    console.log('Kör med --apply för att uppdatera.');
    process.exit(0);
  }

  // 3. Skarp körning: UPDATE per event (sekventiellt för tydlighet)
  let ok = 0, fail = 0;
  const t0 = Date.now();
  for (const c of updateable) {
    const upd = await db.from('events').update({
      image_url: c.newUrl,
      image_attribution: 'AI-generated (EU AI Act Art. 50) — re-stämplad 2026-10-08',
      image_ai_generated: true,
      image_generation_status: 'completed',
      image_generated_at: new Date().toISOString(),
    }).eq('id', c.id);

    if (upd.error) {
      fail++;
      console.error(`  ✗ ${c.id}: ${upd.error.message}`);
    } else {
      ok++;
      if (ok % 50 === 0) console.log(`  ${ok}/${updateable.length} uppdaterade`);
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`[restamp-bulk] DONE in ${elapsed}s`);
  console.log(`  uppdaterade:  ${ok}`);
  console.log(`  misslyckade:  ${fail}`);
  console.log(`  ej matchade:  ${missingCount} events pekade på URL utan stämplad fil`);

  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error('[restamp-bulk] FATAL:', err); process.exit(99); });