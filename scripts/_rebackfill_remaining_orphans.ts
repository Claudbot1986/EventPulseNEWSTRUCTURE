#!/usr/bin/env -S npx tsx
/**
 * _rebackfill_remaining_orphans.ts — re-backfill sista 13 events
 * som pekade på bilder UTANFÖR local_image_library_stamped/.
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Säkerhetsbroms: vägrar returnera orphan-storage-paths
 *   - Säkerhetsbroms: vägrar returnera samma bild igen om den är utanför stamped
 *   - Idempotent
 */

import 'dotenv/config';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
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
const LOG_FILE = join(OUT_DIR, 'rebackfill-final-13-log.json');

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

interface Result {
  event_id: string;
  title: string;
  category: string | null;
  old_url: string;
  new_url: string | null;
  match_type: string | null;
  ok: boolean;
  err?: string;
}

async function rebackfillOne(ev: { id: string; title_sv: string | null; category_slug: string | null }): Promise<Result> {
  try {
    const { data: evRow } = await db
      .from('events')
      .select('venue_id,image_url')
      .eq('id', ev.id)
      .maybeSingle();
    const venueId = evRow?.venue_id ?? null;

    const libMatch = await pickLibraryFallback({
      category_slug: ev.category_slug,
      venue_id: venueId,
    });

    // Säkerhetsbroms: vägra orphan
    if (libMatch.url) {
      const m = libMatch.url.match(/import-stamped\/([^/?#]+)/);
      if (m && !localFiles.has(m[1])) {
        return {
          event_id: ev.id, title: (ev.title_sv || '').slice(0, 60), category: ev.category_slug,
          old_url: evRow?.image_url || '', new_url: null, match_type: null,
          ok: false, err: `orphan-refused: ${m[1]}`,
        };
      }
    }

    if (!libMatch.url) {
      return {
        event_id: ev.id, title: (ev.title_sv || '').slice(0, 60), category: ev.category_slug,
        old_url: evRow?.image_url || '', new_url: null, match_type: null,
        ok: false, err: 'pickLibraryFallback returnerade null',
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
          event_id: ev.id, title: (ev.title_sv || '').slice(0, 60), category: ev.category_slug,
          old_url: evRow?.image_url || '', new_url: libMatch.url, match_type: libMatch.match_type,
          ok: false, err: `update: ${upErr.message}`,
        };
      }
    }

    return {
      event_id: ev.id, title: (ev.title_sv || '').slice(0, 60), category: ev.category_slug,
      old_url: evRow?.image_url || '', new_url: libMatch.url, match_type: libMatch.match_type, ok: true,
    };
  } catch (e) {
    return {
      event_id: ev.id, title: (ev.title_sv || '').slice(0, 60), category: ev.category_slug,
      old_url: '', new_url: null, match_type: null,
      ok: false, err: e instanceof Error ? e.message : String(e),
    };
  }
}

const localFiles = listLocalStamped();

async function main() {
  console.log(`[rebackfill-final] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[rebackfill-final] local: ${localFiles.size} filer`);

  console.log('[rebackfill-final] letar events pekandes utanför stamped...');
  const PAGE = 1000;
  const matching: Array<{ id: string; title_sv: string | null; category_slug: string | null; image_url: string | null }> = [];
  let off = 0;
  while (true) {
    const { data, error } = await db
      .from('events')
      .select('id,title_sv,category_slug,image_url')
      .range(off, off + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const e of data) {
      if (!e.image_url) continue;
      const m = e.image_url.match(/import-stamped\/([^/?#]+)/);
      if (m && !localFiles.has(m[1])) {
        matching.push(e);
      }
    }
    if (data.length < PAGE) break;
    off += PAGE;
  }
  console.log(`[rebackfill-final] events pekandes utanför stamped: ${matching.length}`);

  if (matching.length === 0) {
    console.log('[rebackfill-final] inget att göra.');
    return;
  }

  for (const e of matching) {
    console.log(`  ${e.id} | ${e.category_slug} | ${e.image_url?.split('/').pop()} | ${(e.title_sv || '').slice(0, 50)}`);
  }

  // Bearbeta
  const results: Result[] = [];
  const t0 = Date.now();
  let cursor = 0;
  const CONC = 4;
  async function worker() {
    while (cursor < matching.length) {
      const i = cursor++;
      const r = await rebackfillOne(matching[i]);
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const ok = results.filter((r) => r.ok).length;
  const err = results.filter((r) => !r.ok).length;
  console.log(`\n[rebackfill-final] KLART på ${elapsed}s`);
  console.log(`  ok:  ${ok}`);
  console.log(`  fel: ${err}`);
  if (err > 0) {
    console.log('[rebackfill-final] exempel fel:');
    for (const r of results.filter((r) => !r.ok).slice(0, 5)) {
      console.log(`  ${r.event_id} | ${r.category} | ${r.title} | ${r.err}`);
    }
  }

  if (!isApply) {
    if (ok > 0) {
      console.log('[rebackfill-final] exempel 3 första OK:');
      for (const r of results.filter((r) => r.ok).slice(0, 3)) {
        console.log(`  ${r.event_id} | ${r.match_type} | ${r.old_url.split('/').pop()} → ${r.new_url!.split('/').pop()}`);
      }
    }
    console.log('\n[rebackfill-final] DRY-RUN. Kör med --apply för att uppdatera.');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: matching.length,
    ok,
    err,
    results,
  }, null, 2), 'utf-8');
  console.log(`[rebackfill-final] log: ${LOG_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
