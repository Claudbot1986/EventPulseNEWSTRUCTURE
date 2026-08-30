/**
 * 08-Agent/scripts/scan_legacy_xmp.ts
 *
 * Hittar filer i ai-originals/ som redan bär EventPulse XMP-metadata,
 * dvs tidigare körningar av applyAiCompliance. Dessa är kandidater för
 * legacy pixel-stämpel (restamp-iterationer 2026-08-29 och tidigare).
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/scan_legacy_xmp.ts
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { parseXmp } from '../tools/ai_compliance';

const BUCKET = 'event-posters';
const PREFIX = 'ai-originals';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const all: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(PREFIX, {
      limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const e of data) if (e.id) all.push(e.name);
    if (data.length < 1000) break;
    offset += data.length;
  }
  console.log(`[scan-xmp] ${all.length} filer i ${PREFIX}/`);

  const withXmp: { name: string; creatorTool: string | null; generatedAt: string | null }[] = [];
  let done = 0;

  async function checkOne(name: string): Promise<void> {
    const srcUrl = `${url}/storage/v1/object/public/${BUCKET}/${PREFIX}/${name}`;
    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error(`${name}: fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const xmp = parseXmp(buf);
    if (xmp.found && xmp.hasAiGenerated) {
      withXmp.push({ name, creatorTool: xmp.creatorTool, generatedAt: xmp.generatedAt });
    }
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${all.length}`);
  }

  const queue = [...all];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const name = queue.shift();
      if (!name) return;
      try {
        await checkOne(name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${name}: ${msg}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  console.log('');
  console.log(`[scan-xmp] With EventPulse XMP: ${withXmp.length} av ${all.length}`);
  withXmp.sort((a, b) => (a.generatedAt ?? '').localeCompare(b.generatedAt ?? ''));
  for (const { name, creatorTool, generatedAt } of withXmp.slice(0, 50)) {
    console.log(`  ${(generatedAt ?? '').padEnd(28)} ${(creatorTool ?? '').padEnd(35)} ${name}`);
  }
  if (withXmp.length > 50) console.log(`  ... +${withXmp.length - 50} fler`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[scan-xmp] FATAL:', msg);
  process.exit(1);
});
