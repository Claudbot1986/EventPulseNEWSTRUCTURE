/**
 * Prune: ta bort image_library-rader som pekar på filer som INTE finns i
 * storage-bucketen.
 *
 * Varför (2026-10-29): de 422 gamla raderna pekar på filer från det gamla
 * 16:9-biblioteket, som inte längre finns. Efter att den nya 3:2-biblioteket
 * laddats upp är de raderna DÖDA — men de rankas FÖRE de nya raderna i
 * pickLibraryFallback:
 *
 *   .order('rating', { ascending: false, nullsFirst: false })
 *
 * Gamla rader har rating 3, nya har rating NULL → de nya sorteras sist.
 * Utan pruning skulle appen välja de döda raderna och visa trasiga bilder —
 * precis det vi försöker laga.
 *
 * Kör: node --env-file=.env --import tsx scripts/prune_dangling_library_rows.ts
 *      (--apply för att skriva, annars dry-run)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';

const BUCKET = 'event-posters';
const isApply = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Alla objekt i bucketen, som sökvägar relative till bucketen. */
async function listBucket(): Promise<Set<string>> {
  const all = new Set<string>();
  async function walk(prefix: string): Promise<void> {
    let off = 0;
    for (;;) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset: off });
      if (error) { console.error('list error:', prefix, error.message); return; }
      if (!data || data.length === 0) break;
      for (const f of data) {
        if (f.id) all.add(prefix ? `${prefix}/${f.name}` : f.name);
        else await walk(prefix ? `${prefix}/${f.name}` : f.name);
      }
      if (data.length < 1000) break;
      off += 1000;
    }
  }
  await walk('');
  return all;
}

async function main() {
  console.log(`[prune] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

  const bucket = await listBucket();
  console.log(`[prune] bucketen har ${bucket.size} objekt`);

  const { data: rows, error } = await db.from('image_library').select('id, storage_path, category_slug, times_used');
  if (error) { console.error('select error:', error.message); process.exit(1); }
  console.log(`[prune] image_library har ${rows?.length ?? 0} rader`);

  const dangling = (rows ?? []).filter((r) => {
    const p = (r as any).storage_path as string;
    // storage_path = "<bucket>/<path>"
    const rel = p.startsWith(`${BUCKET}/`) ? p.slice(BUCKET.length + 1) : p.replace(/^\//, '');
    return !bucket.has(rel);
  });

  console.log(`[prune] rader som pekar på en saknad fil: ${dangling.length}`);
  const byCat: Record<string, number> = {};
  for (const r of dangling) {
    const c = (r as any).category_slug ?? '(null)';
    byCat[c] = (byCat[c] ?? 0) + 1;
  }
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`   ${c.padEnd(20)} ${n}`);
  }

  if (dangling.length === 0) {
    console.log('[prune] inget att ta bort.');
    return;
  }
  if (!isApply) {
    console.log('[prune] DRY-RUN. Kör med --apply för att ta bort raderna.');
    return;
  }

  // Snapshot innan radering — raderna innehåller times_used-historik som
  // inte går att återskapa.
  const snapDir = 'local_image_library';
  mkdirSync(snapDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const snapPath = `${snapDir}/image_library_pre_prune_${stamp}.json`;
  writeFileSync(snapPath, JSON.stringify(dangling, null, 2));
  console.log(`[prune] snapshot ${dangling.length} rader → ${snapPath}`);

  const ids = dangling.map((r) => (r as any).id as string);
  const { error: delErr } = await db.from('image_library').delete().in('id', ids);
  if (delErr) { console.error('[prune] delete error:', delErr.message); process.exit(1); }

  const { count } = await db.from('image_library').select('*', { count: 'exact', head: true });
  console.log(`[prune] borttaget ${ids.length} rader. image_library har nu ${count} rader.`);

  // Verifiera att ingen rad kvar pekar på en saknad fil.
  const { data: after } = await db.from('image_library').select('storage_path');
  const stillDangling = (after ?? []).filter((r) => {
    const p = (r as any).storage_path as string;
    const rel = p.startsWith(`${BUCKET}/`) ? p.slice(BUCKET.length + 1) : p.replace(/^\//, '');
    return !bucket.has(rel);
  });
  console.log(`[prune] kvarvarande döda rader: ${stillDangling.length}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
