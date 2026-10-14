#!/usr/bin/env -S npx tsx
/**
 * _rebackfill_orphan_events.ts — intelligent re-backfill av events
 * som pekar på orphan-storage-paths (filer som inte finns i
 * local_image_library_stamped/).
 *
 * Använder 08-Agent/utils/imageLibrary.ts:pickLibraryFallback —
 * samma pipeline som normalizern kör, med alla dess steg A-fixar
 * (filtrerar bort tomma cluster_tags, kategori+venue alias-stöd).
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, skriver inte till events)
 *   - --apply: UPDATE events SET image_url, image_library_id, image_generation_status
 *   - Loggar varje ändring till JSON
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 *   - 4 parallella workers
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

const CSV_PATH = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14', 'orphan-events.csv');
const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const LOG_FILE = join(OUT_DIR, 'rebackfill-log.json');

const isApply = process.argv.includes('--apply');

interface OrphanEvent {
  id: string;
  title_sv: string;
  category_slug: string | null;
  image_url: string;
}

function loadCsv(): OrphanEvent[] {
  const raw = readFileSync(CSV_PATH, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const out: OrphanEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Parsa enkel CSV: id,"title",category,"url"
    const m = lines[i].match(/^([^,]+),"((?:[^"]|"")*)",([^,]*),"((?:[^"]|"")*)"$/);
    if (!m) continue;
    out.push({
      id: m[1],
      title_sv: m[2].replace(/""/g, '"'),
      category_slug: m[3] || null,
      image_url: m[4].replace(/""/g, '"'),
    });
  }
  return out;
}

interface RebackfillResult {
  event_id: string;
  title: string;
  category: string | null;
  old_url: string;
  new_url: string | null;
  new_library_id: string | null;
  match_type: string | null;
  ok: boolean;
  err?: string;
}

async function rebackfillOne(ev: OrphanEvent): Promise<RebackfillResult> {
  try {
    // Hämta venue_id från events-tabellen (pickLibraryFallback behöver det för steg 1)
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

    if (!libMatch.url || !libMatch.library_id) {
      return {
        event_id: ev.id,
        title: ev.title_sv.slice(0, 60),
        category: ev.category_slug,
        old_url: ev.image_url,
        new_url: null,
        new_library_id: null,
        match_type: null,
        ok: false,
        err: 'pickLibraryFallback returnerade null — biblioteket har inget passande',
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
          event_id: ev.id,
          title: ev.title_sv.slice(0, 60),
          category: ev.category_slug,
          old_url: ev.image_url,
          new_url: libMatch.url,
          new_library_id: libMatch.library_id,
          match_type: libMatch.match_type,
          ok: false,
          err: `update: ${upErr.message}`,
        };
      }
    }

    return {
      event_id: ev.id,
      title: ev.title_sv.slice(0, 60),
      category: ev.category_slug,
      old_url: ev.image_url,
      new_url: libMatch.url,
      new_library_id: libMatch.library_id,
      match_type: libMatch.match_type,
      ok: true,
    };
  } catch (e) {
    return {
      event_id: ev.id,
      title: ev.title_sv.slice(0, 60),
      category: ev.category_slug,
      old_url: ev.image_url,
      new_url: null,
      new_library_id: null,
      match_type: null,
      ok: false,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  console.log(`[rebackfill] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[rebackfill] csv: ${CSV_PATH}`);

  if (!existsSync(CSV_PATH)) {
    console.error(`[rebackfill] CSV saknas: ${CSV_PATH} — kör _find_orphan_pointers.ts --apply först`);
    process.exit(2);
  }

  const events = loadCsv();
  console.log(`[rebackfill] ${events.length} events att bearbeta`);

  // Fördelning per kategori
  const byCat: Record<string, number> = {};
  for (const e of events) byCat[e.category_slug || '(null)'] = (byCat[e.category_slug || '(null)'] || 0) + 1;
  console.log('[rebackfill] per kategori:');
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  const results: RebackfillResult[] = [];
  const t0 = Date.now();
  let cursor = 0;
  const CONC = 4;
  async function worker() {
    while (cursor < events.length) {
      const i = cursor++;
      const r = await rebackfillOne(events[i]);
      results.push(r);
      if ((i + 1) % 50 === 0 || cursor === events.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`\r  ${i + 1}/${events.length} (${elapsed}s)         `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const ok = results.filter((r) => r.ok).length;
  const err = results.filter((r) => !r.ok).length;
  const noMatch = results.filter((r) => !r.ok && r.new_url === null).length;

  console.log(`\n[rebackfill] KLART på ${elapsed}s`);
  console.log(`  ok:               ${ok}`);
  console.log(`  fel:              ${err}`);
  console.log(`  varav no-match:   ${noMatch} (library har inget för kategorin)`);

  // Fördelning per match_type
  const byMatch: Record<string, number> = {};
  for (const r of results.filter((r) => r.ok)) {
    byMatch[r.match_type || '?'] = (byMatch[r.match_type || '?'] || 0) + 1;
  }
  console.log('  match_type-fördelning:', byMatch);

  if (err > 0) {
    console.log('[rebackfill] exempel fel:');
    for (const r of results.filter((r) => !r.ok).slice(0, 5)) {
      console.log(`  ${r.event_id} | ${r.category} | ${r.title} | ${r.err}`);
    }
  }

  if (!isApply) {
    console.log(`\n[rebackfill] DRY-RUN. Kör med --apply för att uppdatera events.image_url.`);
    if (ok > 0) {
      console.log('[rebackfill] exempel 3 första OK:');
      for (const r of results.filter((r) => r.ok).slice(0, 3)) {
        console.log(`  ${r.event_id} | ${r.match_type} | ${r.old_url.split('/').pop()} → ${r.new_url!.split('/').pop()}`);
      }
    }
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: events.length,
    ok,
    err,
    no_match: noMatch,
    by_match_type: byMatch,
    results,
  }, null, 2), 'utf-8');
  console.log(`[rebackfill] log: ${LOG_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
