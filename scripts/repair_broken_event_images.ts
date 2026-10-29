#!/usr/bin/env -S npx tsx
/**
 * repair_broken_event_images.ts — peka om events som pekar på raderade
 * bilder till nya biblioteksbilder.
 *
 * VARFÖR (2026-10-29): efter storage-cleanup pekade 16 452 events på filer
 * som inte existerade. Mätt på framtida publicerade events: 12 714 av
 * 13 334 hade döda bild-URL:er, och 620 saknade image_url helt.
 *
 * VAD DETTA SCRIPT GÖR (och varför det inte är _backfill_event_images.ts):
 *
 *   _backfill_event_images.ts gör M3-matchning per event (cluster_tags mot
 *   eventbeskrivningen) — bättre variation, men ETT M3-ANROP PER EVENT.
 *   För 12 714 events vid concurrency 5 blir det ~2,8 timmar.
 *
 *   Det här scriptet väljer per KATEGORI med samma semantik som appens egen
 *   pickLibraryFallback (steg 3: kategori-match, minst använda först →
 *   rotation). Det är O(1) DB-anrop per biblioteksbild, inte per event, så
 *   hela reparationen tar någon minut.
 *
 *   Vill man ha den klokare matchningen kan _backfill_event_images.ts köras
 *   efteråt för en delmängd — men den skriver över library-bilden om den
 *   hittar en bättre matchning, och den matchar INTE på döda URL:er.
 *
 * SÄKERHET:
 *   - Default = --dry-run
 *   - --apply krävs för skarpa skrivningar
 *   - Snapshot av de ändrade raderna sparas INNAN --apply
 *   - Rör INTE events med image_url som pekar på en FIL SOM FINNS
 *   - Rör INTE events.image_ai_generated (stämpeln finns i pixel-lagret)
 *   - Uppdaterar times_used på biblioteksraderna (rotation)
 *
 * ANVÄNDNING:
 *   node --env-file=.env --import tsx scripts/repair_broken_event_images.ts
 *   node --env-file=.env --import tsx scripts/repair_broken_event_images.ts --apply
 *   node --env-file=.env --import tsx scripts/repair_broken_event_images.ts --scope=past --apply
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'event-posters';
const isApply = process.argv.includes('--apply');
const scope = process.argv.includes('--scope=past') ? 'past' : 'future';
const limitArg = process.argv.indexOf('--limit=');
const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

interface LibRow {
  id: string;
  storage_path: string;
  public_url: string;
  category_slug: string | null;
  times_used: number | null;
}

interface EventRow {
  id: string;
  category_slug: string | null;
  image_url: string | null;
}

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

/** Plocka ut bucket-relativ sökväg ur en public URL. */
function pathFromUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const marker = `/${BUCKET}/`;
  const i = imageUrl.indexOf(marker);
  if (i < 0) return null;
  return imageUrl.slice(i + marker.length).split('?')[0];
}

async function main() {
  console.log(`[repair] läge: ${isApply ? 'APPLY' : 'DRY-RUN'} · scope=${scope}`);

  const bucket = await listBucket();
  console.log(`[repair] bucketen har ${bucket.size} objekt`);

  // ── Bibliotek: bara rader vars fil FAKTISKT finns ──────────────────────
  const { data: libRows, error: libErr } = await db
    .from('image_library')
    .select('id, storage_path, public_url, category_slug, times_used');
  if (libErr) { console.error('image_library select error:', libErr.message); process.exit(1); }

  const usable: LibRow[] = [];
  for (const r of (libRows ?? []) as LibRow[]) {
    const rel = pathFromUrl(r.storage_path) ?? r.storage_path.replace(/^\//, '');
    if (bucket.has(rel)) usable.push(r);
  }
  console.log(`[repair] image_library: ${libRows?.length ?? 0} rader, ${usable.length} pekar på en existerande fil`);

  if (usable.length === 0) {
    console.error('[repair] INGA användbara biblioteksbilder — kör uppladdningen först.');
    process.exit(1);
  }

  // Gruppera per kategori, minst använda först (rotation, som pickLibraryFallback).
  const byCat = new Map<string, LibRow[]>();
  for (const r of usable) {
    const cat = r.category_slug ?? '(null)';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  for (const list of byCat.values()) {
    list.sort((a, b) => (a.times_used ?? 0) - (b.times_used ?? 0));
  }
  console.log(`[repair] kategorier med bilder: ${byCat.size}`);

  // ── Events som behöver repareras ──────────────────────────────────────
  const candidates: EventRow[] = [];
  let off = 0;
  for (;;) {
    let q = db.from('events').select('id, category_slug, image_url');
    if (scope === 'future') {
      q = q.eq('status', 'published').gt('start_time', new Date().toISOString());
    }
    const { data, error } = await q.range(off, off + 999);
    if (error) { console.error('events select error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data as EventRow[]) {
      const rel = pathFromUrl(r.image_url);
      const broken = !r.image_url || !rel || !bucket.has(rel);
      if (broken) candidates.push(r);
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  const toFix = candidates.slice(0, limit);
  console.log(`[repair] events med trasig bild-URL: ${candidates.length} (kör på ${toFix.length})`);

  if (toFix.length === 0) {
    console.log('[repair] inget att reparera.');
    return;
  }

  // ── Tilldelning per kategori (round-robin, minst använda först) ───────
  const pointers = new Map<string, number>();
  const assignments = new Map<string, { lib: LibRow; eventIds: string[] }>();
  let noCategory = 0, noLibrary = 0;

  for (const ev of toFix) {
    const cat = ev.category_slug ?? '(null)';
    const pool = byCat.get(cat);
    if (!pool || pool.length === 0) { noLibrary++; continue; }
    let p = pointers.get(cat) ?? 0;
    const lib = pool[p % pool.length];
    pointers.set(cat, p + 1);
    if (!assignments.has(lib.id)) assignments.set(lib.id, { lib, eventIds: [] });
    assignments.get(lib.id)!.eventIds.push(ev.id);
  }

  console.log(`[repair] tilldelade ${assignments.size} biblioteksbilder`);
  console.log(`[repair] hoppade över: ${noLibrary} (ingen biblioteksbild i kategorin), ${noCategory} (saknar kategori)`);

  // ── Snapshot ───────────────────────────────────────────────────────────
  const snapDir = 'local_image_library';
  mkdirSync(snapDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const snapPath = `${snapDir}/events_pre_repair_${scope}_${stamp}.json`;
  writeFileSync(snapPath, JSON.stringify(toFix, null, 2));
  console.log(`[repair] snapshot ${toFix.length} rader → ${snapPath}`);

  if (!isApply) {
    console.log('\n[repair] exempel (första 5):');
    for (const [libId, a] of [...assignments.entries()].slice(0, 5)) {
      console.log(`   ${a.eventIds.length} events → ${a.lib.storage_path}`);
    }
    console.log('\n[repair] DRY-RUN. Kör med --apply för att skriva.');
    return;
  }

  // ── Skriv: en UPDATE per biblioteksbild (grupperade events) ───────────
  let updated = 0;
  let errCount = 0;
  const errs: string[] = [];
  for (const [, a] of assignments) {
    const publicUrl = a.lib.public_url
      || `${process.env.SUPABASE_STORAGE_URL}/${a.lib.storage_path}`;
    const { error } = await db
      .from('events')
      .update({
        image_url: publicUrl,
        image_license: 'library-fallback',
        image_attribution: `Library-bibliotek (${a.lib.category_slug ?? 'okategori'})`,
        image_generation_status: 'library_fallback',
        image_generation_error: null,
        image_generation_attempts: 0,
      })
      .in('id', a.eventIds);
    if (error) {
      errCount++;
      if (errs.length < 5) errs.push(`${a.lib.storage_path}: ${error.message}`);
    } else {
      updated += a.eventIds.length;
    }
  }
  console.log(`[repair] uppdaterade ${updated} events (${errCount} fel)`);
  if (errs.length) for (const e of errs) console.log('   ', e);

  // ── times_used på biblioteksraderna (behåll rotationen aktuell) ───────
  for (const [, a] of assignments) {
    await db.from('image_library')
      .update({ times_used: (a.lib.times_used ?? 0) + a.eventIds.length })
      .eq('id', a.lib.id);
  }
  console.log(`[repair] times_used uppdaterat för ${assignments.size} biblioteksrader`);

  // ── Verifiering ───────────────────────────────────────────────────────
  const bucket2 = await listBucket();
  let stillBroken = 0;
  let off2 = 0;
  for (;;) {
    let q = db.from('events').select('image_url');
    if (scope === 'future') {
      q = q.eq('status', 'published').gt('start_time', new Date().toISOString());
    }
    const { data } = await q.range(off2, off2 + 999);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ image_url: string | null }>) {
      const rel = pathFromUrl(r.image_url);
      if (!r.image_url || !rel || !bucket2.has(rel)) stillBroken++;
    }
    if (data.length < 1000) break;
    off2 += 1000;
  }
  console.log(`[repair] events kvar med trasig bild-URL: ${stillBroken}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
