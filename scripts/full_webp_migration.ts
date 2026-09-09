/**
 * scripts/full_webp_migration.ts
 *
 * Fas 3 av WebP-migreringen: komplett single-pass-skript som
 *   (a) genererar WebP för events som saknar det
 *   (b) uppdaterar events.image_url till .webp-URL
 *
 * Optimerat: använder Storage list() (1 paginerad anrop) istället för HEAD
 * per event. Förväntad körning: <10 min för 7000+ events.
 *
 * Säkerhet:
 *   - --dry-run som default
 *   - --apply för skarp körning
 *   - Hoppar automatiskt över events där .webp redan är kopplad
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
  console.warn('[full-mig] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[full-mig] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
  process.exit(1);
}

const PARALLEL = 10;
const DB_BATCH = 50;

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Hämta ALLA Storage-filenamn i import-stamped/ (paginerat)
  console.log('[full-mig] listar storage-filer...');
  const allStorageFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list('import-stamped', { limit: 1000, offset });
    if (!data || data.length === 0) break;
    allStorageFiles.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
    if (offset > 50000) break;
  }
  console.log(`[full-mig] Storage-filer totalt: ${allStorageFiles.length}`);

  const pngSet = new Set(allStorageFiles.filter(f => f.name.toLowerCase().endsWith('.png')).map(f => f.name));
  const webpSet = new Set(allStorageFiles.filter(f => f.name.toLowerCase().endsWith('.webp')).map(f => f.name));
  console.log(`[full-mig]   → PNG: ${pngSet.size}, WebP: ${webpSet.size}`);

  // 2. Hämta alla events vars image_url pekar på .png (paginerat)
  console.log('[full-mig] hämtar events...');
  const pngEvents: { id: string; image_url: string }[] = [];
  offset = 0;
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
  console.log(`[full-mig] events med .png-URL: ${pngEvents.length}`);

  // 3. Klassificera varje event
  type Ev = { id: string; base: string; needsGenerate: boolean; newUrl: string };
  const plan: Ev[] = [];

  for (const ev of pngEvents) {
    const m = ev.image_url.match(/import-stamped\/(.+)\.png(\?|$)/i);
    if (!m) continue;
    const base = m[1];
    const pngName = `${base}.png`;
    const webpName = `${base}.webp`;
    if (!pngSet.has(pngName)) continue; // PNG saknas i storage — hoppa (försiktighetsprincip)
    const needsGenerate = !webpSet.has(webpName);
    const newUrl = ev.image_url.replace(/\/[^/]+\.png(\?|$)/i, `/${webpName}$1`);
    plan.push({ id: ev.id, base, needsGenerate, newUrl });
  }

  const toGenerate = plan.filter(e => e.needsGenerate);
  const onlyUrlFix = plan.filter(e => !e.needsGenerate);
  console.log(`[full-mig] plan:`);
  console.log(`[full-mig]   → needs WebP-generering: ${toGenerate.length}`);
  console.log(`[full-mig]   → har redan WebP (URL-fix only): ${onlyUrlFix.length}`);

  if (!isApply) {
    console.log('[full-mig] dry-run — ingen data ändrad. Kör med --apply.');
    return;
  }

  // 4. Generera WebP för de som saknas (parallell)
  let genSuccess = 0;
  let genFailed = 0;

  console.log('[full-mig] genererar WebP...');

  // Process i batcher om PARALLEL
  for (let i = 0; i < toGenerate.length; i += PARALLEL) {
    const batch = toGenerate.slice(i, i + PARALLEL);

    await Promise.all(batch.map(async (e) => {
      const pngPath = `import-stamped/${e.base}.png`;
      const webpPath = `import-stamped/${e.base}.webp`;
      try {
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(pngPath);
        const dl = await fetch(pub.publicUrl);
        if (!dl.ok) { genFailed++; return; }
        const buf = Buffer.from(await dl.arrayBuffer());
        const webp = await sharp(buf).webp({ quality: 80, effort: 4 }).toBuffer();
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(webpPath, webp, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000',
        });
        if (error) genFailed++;
        else genSuccess++;
      } catch {
        genFailed++;
      }
    }));

    const done = Math.min(i + PARALLEL, toGenerate.length);
    if (done % 200 === 0 || done === toGenerate.length) {
      console.log(`[full-mig]   ${done}/${toGenerate.length} genererade (success=${genSuccess} failed=${genFailed})`);
    }
  }

  console.log(`[full-mig] WebP-generering klar: ${genSuccess} ok, ${genFailed} failed`);

  // 5. Uppdatera image_url för ALLA planerade events
  console.log('[full-mig] uppdaterar image_url...');
  let urlSuccess = 0;
  let urlFailed = 0;

  for (let i = 0; i < plan.length; i += DB_BATCH) {
    const batch = plan.slice(i, i + DB_BATCH);
    // Parallell UPDATE — en UPDATE per event (Supabase saknar multi-row UPDATE syntax)
    await Promise.all(batch.map(async (e) => {
      const { error } = await supabase
        .from('events')
        .update({ image_url: e.newUrl })
        .eq('id', e.id);
      if (error) urlFailed++;
      else urlSuccess++;
    }));

    const done = Math.min(i + DB_BATCH, plan.length);
    if (done % 500 === 0 || done === plan.length) {
      console.log(`[full-mig]   ${done}/${plan.length} URL-uppdateringar (success=${urlSuccess} failed=${urlFailed})`);
    }
  }

  console.log(`[full-mig] URL-uppdatering klar: ${urlSuccess} ok, ${urlFailed} failed`);
  console.log(`[full-mig] klart — nästa steg: npx tsx scripts/delete_png_masters.ts --apply`);
}

main().catch((err) => {
  console.error('[full-mig] fatal error:', err);
  process.exit(1);
});
