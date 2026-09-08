/**
 * scripts/regenerate_missing_webp.ts
 *
 * Genererar WebP för PNG-filer i import-stamped/ som saknar motsvarande
 * .webp-version. Används efter fix_image_url_to_webp.ts som visar hur
 * många events som fortfarande saknar WebP.
 *
 * Säkerhet:
 *   - --dry-run som default
 *   - --apply för skarp körning
 *   - Hoppar automatiskt över PNG som redan har en .webp-version
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
  console.warn('[regen-webp] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[regen-webp] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
  process.exit(1);
}

const BATCH = 50;

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Hämta alla events vars image_url pekar på .png (sidan kan vara enorm — paginerat)
  const pngEvents: { id: string; image_url: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('events')
      .select('id, image_url')
      .not('image_url', 'is', null)
      .like('image_url', '%.png%')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    pngEvents.push(...(data as { id: string; image_url: string }[]));
    if (data.length < 1000) break;
    offset += 1000;
    if (offset > 50000) break;
  }
  console.log(`[regen-webp] events vars image_url pekar på .png: ${pngEvents.length}`);

  if (pngEvents.length === 0) {
    console.log('[regen-webp] inget att regenerera');
    return;
  }

  // För varje event: kontrollera om .webp-versionen är på plats, annars generera
  type Plan = { id: string; pngBase: string };
  const toGenerate: Plan[] = [];

  for (const ev of pngEvents) {
    const m = ev.image_url.match(/import-stamped\/(.+)\.png(\?|$)/i);
    if (!m) continue;
    const base = m[1];
    const webpPath = `import-stamped/${base}.webp`;

    // Kolla om webp finns (HEAD 200)
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(webpPath);
    let hasWebp = false;
    try {
      const head = await fetch(pub.publicUrl, { method: 'HEAD' });
      hasWebp = head.status === 200;
    } catch { /* ignore */ }

    if (!hasWebp) toGenerate.push({ id: ev.id, pngBase: base });
  }

  console.log(`[regen-webp] events där .webp saknas (behöver genereras): ${toGenerate.length}`);
  console.log(`[regen-webp] events där .webp redan finns (hoppas över): ${pngEvents.length - toGenerate.length}`);

  if (!isApply) {
    console.log('[regen-webp] dry-run — ingen data ändrad. Kör med --apply för att generera.');
    return;
  }

  const missing = toGenerate.map(t => t.pngBase + '.png');

  let success = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);

    for (const name of batch) {
      const pngPath = `import-stamped/${name}`;
      const webpPath = `import-stamped/${name.replace(/\.png$/i, '.webp')}`;

      try {
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(pngPath);
        const dl = await fetch(pub.publicUrl);
        if (!dl.ok) {
          console.warn(`[regen-webp] fetch misslyckades för ${name}: ${dl.status}`);
          failed++;
          continue;
        }
        const buf = Buffer.from(await dl.arrayBuffer());
        const webp = await sharp(buf).webp({ quality: 80, effort: 4 }).toBuffer();
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(webpPath, webp, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000',
        });
        if (error) {
          console.warn(`[regen-webp] upload misslyckades för ${name}: ${error.message}`);
          failed++;
        } else {
          success++;
        }
      } catch (err) {
        console.warn(`[regen-webp] ${name} misslyckades: ${(err as Error).message}`);
        failed++;
      }
    }

    if ((i + BATCH) % 200 === 0 || i + BATCH >= missing.length) {
      console.log(`[regen-webp]   ${Math.min(i + BATCH, missing.length)}/${missing.length} klara`);
    }
  }

  console.log(`[regen-webp] klar: ${success} genererade, ${failed} misslyckades`);
}

main().catch((err) => {
  console.error('[regen-webp] fatal error:', err);
  process.exit(1);
});
