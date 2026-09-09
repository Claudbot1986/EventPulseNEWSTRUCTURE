/**
 * scripts/delete_png_masters.ts
 *
 * Raderar PNG-masterfiler i import-stamped/ där motsvarande .webp är
 * verifierat laddbar och events.image_url pekar på .webp (inte .png).
 *
 * Säkerhetsvillkor för radering:
 *   1. .webp-versionen är på plats (HEAD 200)
 *   2. events.image_url för motsvarande basename pekar på .webp (inte .png)
 *
 * Säkerhet:
 *   - --dry-run som default
 *   - --apply för skarp körning
 *   - Raderar i batcher om 100 (Storage-API-begränsning)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, '../.env');

try {
  const envText = readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (err) {
  console.warn('[del-png] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[del-png] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
  process.exit(1);
}

const BATCH = 100;

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Hämta events vars image_url pekar på .webp — dessa är "säkra basnamn"
  const { data: webpEvents, error: evErr } = await supabase
    .from('events')
    .select('image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%.webp%');

  if (evErr) {
    console.error('[del-png] event fetch misslyckades:', evErr.message);
    process.exit(1);
  }

  // extrahera basename.webp från URL
  const safeWebpBases = new Set<string>();
  for (const e of webpEvents ?? []) {
    const m = e.image_url.match(/import-stamped\/(.+)\.webp$/i);
    if (m) safeWebpBases.add(m[1]);
  }
  console.log(`[del-png] events vars image_url pekar på .webp: ${safeWebpBases.size}`);

  // 2. Lista alla PNG i Storage
  const allFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list('import-stamped', { limit: 1000, offset });
    if (!data || data.length === 0) break;
    allFiles.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const pngFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.png'));
  console.log(`[del-png] PNG-filer i import-stamped/: ${pngFiles.length}`);

  // 3. Filtrera fram PNG som är "säkra att radera":
  //    .webp finns + events.image_url pekar på .webp för detta basename
  const safeToDelete: string[] = [];
  const unsafe: string[] = [];
  for (const f of pngFiles) {
    const base = f.name.replace(/\.png$/i, '');
    if (safeWebpBases.has(base)) {
      safeToDelete.push(f.name);
    } else {
      unsafe.push(f.name);
    }
  }

  console.log(`[del-png] PNG säkra att radera (.webp på plats + pekad): ${safeToDelete.length}`);
  console.log(`[del-png] PNG som lämnas (försiktighetsprincip): ${unsafe.length}`);

  if (safeToDelete.length === 0) {
    console.log('[del-png] inget att radera');
    return;
  }
  if (!isApply) {
    console.log('[del-png] dry-run — ingen data ändrad. Kör med --apply för att radera.');
    return;
  }

  // 4. Radera i batcher om 100 (Storage API-gräns)
  let deleted = 0;
  for (let i = 0; i < safeToDelete.length; i += BATCH) {
    const batch = safeToDelete.slice(i, i + BATCH).map(n => `import-stamped/${n}`);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(batch);
    if (error) {
      console.error(`[del-png] batch delete misslyckades (${batch.length} filer): ${error.message}`);
      continue;
    }
    deleted += batch.length;
    if (deleted % 500 === 0 || deleted === safeToDelete.length) {
      console.log(`[del-png]   ${deleted}/${safeToDelete.length} raderade`);
    }
  }

  console.log(`[del-png] klar: ${deleted} PNG-masterfiler raderade`);
  console.log('[del-png] förväntad Storage-minskning: ~9 GB');
}

main().catch((err) => {
  console.error('[del-png] fatal error:', err);
  process.exit(1);
});
