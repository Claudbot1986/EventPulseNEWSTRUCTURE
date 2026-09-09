/**
 * scripts/fix_image_url_to_webp.ts
 *
 * Fas 2 av WebP-migreringen: uppdaterar events.image_url för events som
 * redan har en .webp-version i Storage men där image_url fortfarande pekar
 * på .png. Detta hände eftersom migrate_png_to_webp.ts rapporterade
 * framgång även när DB-UPDATE tyst misslyckades.
 *
 * Säkerhet:
 *   - --dry-run som default (visar antal, ändrar inget)
 *   - --apply för skarp körning
 *   - Uppdaterar ENDAST events där .webp-versionen är verifierat laddbar (HTTP 200)
 *
 * Efter detta kör:
 *   npx tsx scripts/delete_png_masters.ts --apply  # frigör ~9 GB i Storage
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
  console.warn('[fix-url] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[fix-url] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(1);
}

const BATCH_SIZE = 50;

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  console.log('[fix-url] bucket:', STORAGE_BUCKET);

  // Hämta alla events vars image_url slutar på .png
  const { data: pngEvents, error } = await supabase
    .from('events')
    .select('id, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%.png%')
    .order('id');

  if (error) {
    console.error('[fix-url] fetch misslyckades:', error.message);
    process.exit(1);
  }

  console.log(`[fix-url] events vars image_url pekar på .png: ${pngEvents?.length ?? 0}`);

  if (!pngEvents || pngEvents.length === 0) {
    console.log('[fix-url] inget att fixa — alla events pekar redan på .webp eller saknar bild');
    return;
  }

  // Steg 1: verifiera att motsvarande .webp finns och är laddbar
  type ToFix = { id: string; oldUrl: string; newUrl: string };
  const toFix: ToFix[] = [];

  for (const ev of pngEvents) {
    const m = ev.image_url.match(/import-stamped\/(.+)\.png$/i);
    if (!m) continue;
    const base = m[1];
    const webpPath = `import-stamped/${base}.webp`;
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(webpPath);
    if (!pub?.publicUrl) continue;

    // HEAD-förfrågan — bara kontrollera att filen finns (status 200)
    try {
      const head = await fetch(pub.publicUrl, { method: 'HEAD' });
      if (head.status === 200) {
        toFix.push({ id: ev.id, oldUrl: ev.image_url, newUrl: pub.publicUrl });
      }
    } catch {
      /* skippa events där webp inte är laddbar */
    }
  }

  console.log(`[fix-url] events där .webp-versionen är verifierat laddbar: ${toFix.length}`);
  console.log(`[fix-url] events som lämnas ensamma (ingen .webp): ${(pngEvents.length ?? 0) - toFix.length}`);

  if (!isApply) {
    console.log('[fix-url] dry-run — ingen data ändrad. Kör med --apply för att uppdatera image_url.');
    return;
  }

  // Steg 2: uppdatera image_url i DB, i batcher om 50
  let success = 0;
  let failed = 0;

  for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
    const batch = toFix.slice(i, i + BATCH_SIZE);
    // Supabase stödjer inte multi-row UPDATE — gör en UPDATE per event i batchen
    for (const ev of batch) {
      const { error: updErr } = await supabase
        .from('events')
        .update({ image_url: ev.newUrl })
        .eq('id', ev.id);
      if (updErr) {
        console.warn(`[fix-url] update misslyckades för ${ev.id}: ${updErr.message}`);
        failed++;
      } else {
        success++;
      }
    }
    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= toFix.length) {
      console.log(`[fix-url]   ${Math.min(i + BATCH_SIZE, toFix.length)}/${toFix.length} uppdaterade`);
    }
  }

  console.log(`[fix-url] klar: ${success} uppdaterade, ${failed} misslyckades`);
  console.log(`[fix-url] nästa steg: npx tsx scripts/delete_png_masters.ts --apply`);
}

main().catch((err) => {
  console.error('[fix-url] fatal error:', err);
  process.exit(1);
});
