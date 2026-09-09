/**
 * scripts/migrate_png_to_webp.ts
 *
 * Engångs-migrering: laddar ner befintliga PNG-bilder från Supabase Storage,
 * konverterar till WebP q80, laddar upp, uppdaterar image_url.
 *
 * Körs en gång för att migrera de 9 GB bilder som redan finns. Efter detta
 * pekar alla events på WebP-URL:er och framtida bilder genereras automatiskt
 * som WebP via 08-Agent/services/imageGen.ts.
 *
 * Säkerhet:
 *   - --dry-run som default (visar antal, ändrar inget)
 *   - --apply för skarp körning
 *   - BATCH=100 för att inte överbelasta minne
 *   - Hoppar över events där image_url redan slutar på .webp
 *   - Raderar ALDRIG original-PNG (behålls som backup)
 *
 * Miljövariabler (läses från ../.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STORAGE_BUCKET (default: 'event-posters')
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ── Env loading ─────────────────────────────────────────────────────────────
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
  console.warn('[migrate] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[migrate] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(1);
}

const BATCH_SIZE = 100;

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  console.log('[migrate] bucket:', STORAGE_BUCKET);

  // 1. Hämta alla events med PNG-bild
  const { data: events, error } = await supabase
    .from('events')
    .select('id, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%.png%')
    .order('id');

  if (error) {
    console.error('[migrate] fetch misslyckades:', error.message);
    process.exit(1);
  }

  console.log(`[migrate] hittade ${events?.length ?? 0} events med PNG-bild`);

  if (!events || events.length === 0) {
    console.log('[migrate] inget att migrera');
    return;
  }

  if (!isApply) {
    console.log('[migrate] dry-run — visar bara antal. Kör med --apply för att migrera.');
    console.log(`[migrate] uppskattad tidsåtgång: ${Math.ceil(events.length / 30)} min`);
    return;
  }

  let success = 0;
  let skipped = 0;
  let failed = 0;

  // 2. Process i batcher
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    console.log(`[migrate] batch ${i / BATCH_SIZE + 1}/${Math.ceil(events.length / BATCH_SIZE)} (${batch.length} events)`);

    for (const ev of batch) {
      try {
        // Hämta PNG från Storage
        // image_url-format: {SUPABASE_URL}/storage/v1/object/public/event-posters/import-stamped/{storagePath}.png
        const urlObj = new URL(ev.image_url);
        const pathParts = urlObj.pathname.split(`/object/public/${STORAGE_BUCKET}/`);
        if (pathParts.length !== 2) {
          console.warn(`[migrate] kan inte parsa URL för ${ev.id}: ${ev.image_url}`);
          skipped++;
          continue;
        }
        const pngPath = pathParts[1]; // t.ex. import-stamped/abc123.png

        // Hämta PNG
        const dl = await fetch(ev.image_url);
        if (!dl.ok) {
          console.warn(`[migrate] fetch misslyckades för ${ev.id}: ${dl.status}`);
          skipped++;
          continue;
        }
        const pngBuffer = Buffer.from(await dl.arrayBuffer());

        // Konvertera till WebP
        const webpBuffer = await sharp(pngBuffer).webp({ quality: 80, effort: 4 }).toBuffer();
        const webpPath = pngPath.replace(/\.png$/i, '.webp');

        // Ladda upp WebP
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(webpPath, webpBuffer, {
            contentType: 'image/webp',
            upsert: true,
            cacheControl: '31536000',
          });

        if (upErr) {
          console.warn(`[migrate] upload misslyckades för ${ev.id}: ${upErr.message}`);
          failed++;
          continue;
        }

        // Uppdatera image_url
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(webpPath);
        if (!pub?.publicUrl) {
          console.warn(`[migrate] ingen publicUrl för ${ev.id}`);
          failed++;
          continue;
        }

        const { error: updErr } = await supabase
          .from('events')
          .update({ image_url: pub.publicUrl })
          .eq('id', ev.id);

        if (updErr) {
          console.warn(`[migrate] db update misslyckades för ${ev.id}: ${updErr.message}`);
          failed++;
          continue;
        }

        success++;
        if (success % 50 === 0) {
          console.log(`[migrate]   ${success}/${events.length} klara`);
        }
      } catch (err) {
        console.error(`[migrate] event ${ev.id} misslyckades:`, (err as Error).message);
        failed++;
      }
    }
  }

  console.log(`[migrate] klar: ${success} migrerade, ${skipped} hoppade över, ${failed} misslyckades`);
}

main().catch((err) => {
  console.error('[migrate] fatal error:', err);
  process.exit(1);
});
