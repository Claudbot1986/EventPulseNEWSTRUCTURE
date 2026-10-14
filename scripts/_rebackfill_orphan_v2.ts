#!/usr/bin/env -S npx tsx
/**
 * _rebackfill_orphan_v2.ts — andra omgången av re-backfill.
 *
 * Efter att 1 796 orphan-library-rader inaktiverats måste vi re-backfilla
 * events som pekade på dem (eftersom pickLibraryFallback nu returnerar
 * andra bilder, men events.image_url pekar fortfarande på den gamla
 * orphan-storage-pathen).
 *
 * Hittar events där image_url slutar på orphan-namn, kör pickLibraryFallback
 * (som nu är säker från orphans eftersom de är __disabled__), uppdaterar.
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 *   - Idempotent: events som redan pekar på icke-orphan lämnas orörda
 */

import 'dotenv/config';
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { pickLibraryFallback } from '../08-Agent/utils/imageLibrary.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STAMPED_DIR = join(process.cwd(), 'local_image_library_stamped');
const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const LOG_FILE = join(OUT_DIR, 'rebackfill-v2-log.json');

const isApply = process.argv.includes('--apply');

function listLocalStamped(): Set<string> {
  const out = new Set<string>();
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) {
        if (name.startsWith('_quarantine') || name === '_test_stamp') continue;
        walk(p);
      } else if (name.endsWith('.webp')) {
        out.add(name.replace(/\.stamped\.webp$/, '.webp'));
      }
    }
  }
  walk(STAMPED_DIR);
  return out;
}

interface RebackfillResult {
  event_id: string;
  title: string;
  category: string | null;
  old_url: string;
  new_url: string | null;
  match_type: string | null;
  ok: boolean;
  err?: string;
}

async function rebackfillOne(ev: { id: string; title_sv: string; category_slug: string | null; image_url: string }): Promise<RebackfillResult> {
  try {
    const { data: evRow } = await db
      .from('events')
      .select('venue_id')
      .eq('id', ev.id)
      .maybeSingle();
    const venueId = evRow?.venue_id ?? null;

    const libMatch = await pickLibraryFallback({
      category_slug: ev.category_slug,
      venue_id: venueId,
    });

    // Säkerhetsbroms: vägra att returnera URL som är orphan
    if (libMatch.url) {
      const m = libMatch.url.match(/import-stamped\/([^/?#]+)/);
      if (m && localFiles && !localFiles.has(m[1])) {
        return {
          event_id: ev.id,
          title: ev.title_sv.slice(0, 60),
          category: ev.category_slug,
          old_url: ev.image_url,
          new_url: null,
          match_type: null,
          ok: false,
          err: `pickLibraryFallback returnerade fortfarande en orphan: ${m[1]}`,
        };
      }
    }

    if (!libMatch.url || !libMatch.library_id) {
      return {
        event_id: ev.id,
        title: ev.title_sv.slice(0, 60),
        category: ev.category_slug,
        old_url: ev.image_url,
        new_url: null,
        match_type: null,
        ok: false,
        err: 'pickLibraryFallback returnerade null',
      };
    }

    if (isApply) {
      const { error: upErr } = await db
        .from('events')
        .update({
          image_url: libMatch.url,
          image_generation_status: 'library_fallback',
          image_ai_generated: false,
        })
        .eq('id', ev.id);
      if (upErr) {
        return {
          event_id: ev.id, title: ev.title_sv.slice(0, 60), category: ev.category_slug,
          old_url: ev.image_url, new_url: libMatch.url, match_type: libMatch.match_type,
          ok: false, err: `update: ${upErr.message}`,
        };
      }
    }

    return {
      event_id: ev.id, title: ev.title_sv.slice(0, 60), category: ev.category_slug,
      old_url: ev.image_url, new_url: libMatch.url, match_type: libMatch.match_type, ok: true,
    };
  } catch (e) {
    return {
      event_id: ev.id, title: ev.title_sv.slice(0, 60), category: ev.category_slug,
      old_url: ev.image_url, new_url: null, match_type: null,
      ok: false, err: e instanceof Error ? e.message : String(e),
    };
  }
}

let localFiles: Set<string> | null = null;

async function main() {
  console.log(`[rebackfill-v2] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

  localFiles = listLocalStamped();
  console.log(`[rebackfill-v2] local: ${localFiles.size} filer`);

  // Bygg orphan-set
  console.log('[rebackfill-v2] läser storage-listan...');
  const storage = new Set<string>();
  let off = 0;
  while (true) {
    const { data, error } = await db.storage.from('event-posters').list('import-stamped', { limit: 1000, offset: off });
    if (error) { console.error('storage list error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const f of data) storage.add(f.name);
    if (data.length < 1000) break;
    off += 1000;
  }
  const orphans = [...storage].filter((n) => !localFiles!.has(n));
  console.log(`[rebackfill-v2] orphans: ${orphans.length}`);

  // Hitta events med orphan-pointers
  console.log('[rebackfill-v2] letar events med orphan-pointers...');
  const BATCH = 200;
  const matching: Array<{ id: string; title_sv: string | null; image_url: string; category_slug: string | null }> = [];
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH);
    const ors = batch.map((n) => `image_url.ilike.%${n.replace(/'/g, "''")}`).join(',');
    const { data, error } = await db
      .from('events')
      .select('id,title_sv,image_url,category_slug')
      .or(ors)
      .limit(5000);
    if (error) { console.error(`batch ${i} error:`, error.message); continue; }
    if (data) matching.push(...data);
  }

  const seen = new Set<string>();
  const unique = matching.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  console.log(`[rebackfill-v2] events med orphan-pointers: ${unique.length}`);

  if (unique.length === 0) {
    console.log('[rebackfill-v2] inga events pekar på orphans — gate PASSED.');
    return;
  }

  // Bearbeta
  const results: RebackfillResult[] = [];
  const t0 = Date.now();
  let cursor = 0;
  const CONC = 4;
  async function worker() {
    while (cursor < unique.length) {
      const i = cursor++;
      const r = await rebackfillOne({
        id: unique[i].id,
        title_sv: unique[i].title_sv || '',
        category_slug: unique[i].category_slug,
        image_url: unique[i].image_url,
      });
      results.push(r);
      if ((i + 1) % 50 === 0 || cursor === unique.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`\r  ${i + 1}/${unique.length} (${elapsed}s)         `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const ok = results.filter((r) => r.ok).length;
  const err = results.filter((r) => !r.ok).length;
  console.log(`\n[rebackfill-v2] KLART på ${elapsed}s`);
  console.log(`  ok:  ${ok}`);
  console.log(`  fel: ${err}`);
  if (err > 0) {
    console.log('[rebackfill-v2] exempel fel:');
    for (const r of results.filter((r) => !r.ok).slice(0, 5)) {
      console.log(`  ${r.event_id} | ${r.category} | ${r.title} | ${r.err}`);
    }
  }

  const byMatch: Record<string, number> = {};
  for (const r of results.filter((r) => r.ok)) byMatch[r.match_type || '?'] = (byMatch[r.match_type || '?'] || 0) + 1;
  console.log('  match_type-fördelning:', byMatch);

  if (!isApply) {
    if (ok > 0) {
      console.log('[rebackfill-v2] exempel 3 första OK:');
      for (const r of results.filter((r) => r.ok).slice(0, 3)) {
        console.log(`  ${r.event_id} | ${r.match_type} | ${r.old_url.split('/').pop()} → ${r.new_url!.split('/').pop()}`);
      }
    }
    console.log('\n[rebackfill-v2] DRY-RUN. Kör med --apply för att uppdatera.');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: unique.length,
    ok,
    err,
    by_match_type: byMatch,
    results,
  }, null, 2), 'utf-8');
  console.log(`[rebackfill-v2] log: ${LOG_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
