#!/usr/bin/env -S npx tsx
/**
 * _backfill_event_images.ts — matchar events utan bild mot image_library
 *                            och skriver bästa bildens public_url till events.image_url.
 *
 * Policy (2026-10-12, användarbeslut D + räknare):
 *   - Bearbetar events där image_url är NULL eller pekar på raderade filer
 *   - M3 läser titel + description → sök-ord → matchar mot image_library.cluster_tags
 *   - Vid träff: skriver events.image_url, ökar image_library.times_used
 *   - Vid miss: lämnas image_url NULL (loggas som "no-match")
 *   - Rör INTE events.image_ai_generated (stämpeln finns redan i pixel-lagret)
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - --apply krävs för skarpa skrivningar
 *   - Snapshot av events.image_url sparas INNAN --apply
 *   - --limit N (default 50) begränsar blast radius vid test
 *   - Idempotent: events med icke-NULL image_url hoppas över
 *
 * Användning:
 *   npx tsx scripts/_backfill_event_images.ts --category=music               # dry-run
 *   npx tsx scripts/_backfill_event_images.ts --category=music --apply       # kör
 *   npx tsx scripts/_backfill_event_images.ts --category=music --limit=1 --apply
 *   npx tsx scripts/_backfill_event_images.ts                                # alla kategorier
 *   npx tsx scripts/_backfill_event_images.ts --all --apply
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { findImageForEvent } from '../BFL-generator/lib/match.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const M3_KEY = process.env.MINIMAX_API_KEY;
if (!M3_KEY) {
  console.error('Missing MINIMAX_API_KEY — match.ts behöver den för tag-generering');
  process.exit(2);
}

function argValue(name: string): string | null {
  // Hanterar både --foo=bar och --foo bar
  for (const a of process.argv.slice(2)) {
    if (a === name) {
      const i = process.argv.indexOf(a);
      return process.argv[i + 1] ?? null;
    }
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
  }
  return null;
}
const category = argValue('--category');
const limitStr = argValue('--limit');
const limit = limitStr ? parseInt(limitStr, 10) : 50;
const allFlag = process.argv.includes('--all');
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

if (!category && !allFlag) {
  console.error('Användning: --category=<slug> eller --all');
  process.exit(2);
}

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  raw_description: string | null;
  category_slug: string | null;
  image_url: string | null;
}

async function fetchCandidates(categoryFilter: string | null): Promise<EventRow[]> {
  const all: EventRow[] = [];
  let off = 0;
  while (true) {
    let q = db.from('events').select('id,title_sv,title_en,description_sv,description_en,raw_description,category_slug,image_url');
    if (categoryFilter) q = q.eq('category_slug', categoryFilter);
    const { data, error } = await q.range(off, off + 999);
    if (error) { console.error('Supabase fel:', error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...(data as EventRow[]));
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

function isBrokenUrl(imageUrl: unknown): boolean {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0) return true;
  // Efter raderingen pekar alla gamla URLs på raderade storage-filer
  return imageUrl.includes('/import-stamped/') ||
         imageUrl.includes('/events/') ||
         imageUrl.includes('/ai-quarantine/') ||
         imageUrl.includes('/ai-originals/') ||
         imageUrl.includes('/ai-generated/') ||
         imageUrl.includes('/ai-stamped/');
}

function buildDescription(row: EventRow): string {
  return [row.title_sv, row.title_en, row.description_sv, row.description_en, row.raw_description]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' — ');
}

async function snapshotEvents(categoryFilter: string | null): Promise<void> {
  console.log('[snapshot] hämtar events för backup…');
  const rows = await fetchCandidates(categoryFilter);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const path = `local_image_library/events_pre_backfill_${categoryFilter ?? 'all'}_${stamp}.json`;
  writeFileSync(path, JSON.stringify(rows, null, 2));
  console.log(`[snapshot] ${rows.length} rader → ${path}`);
}

interface BackfillResult {
  total: number;
  matches: number;
  noMatch: number;
  skipped: number;
  errors: number;
  byOverlap: Record<string, number>;
}

async function processOne(row: EventRow, dryRun: boolean): Promise<{ status: 'match' | 'no-match' | 'skipped' | 'error'; best?: { overlap: number; public_url: string; id: string }; err?: string }> {
  if (!isBrokenUrl(row.image_url)) return { status: 'skipped' };
  if (!row.category_slug) return { status: 'skipped' };

  const desc = buildDescription(row);
  if (desc.length === 0) return { status: 'no-match' };

  try {
    const m = await findImageForEvent({ event_id: row.id, category_slug: row.category_slug, raw_description: desc });
    if (!m.best) return { status: 'no-match' };

    const overlap = m.candidates[0]?.overlap ?? 0;

    if (!dryRun) {
      // 1) Skriv events.image_url
      const { error: upErr } = await db.from('events').update({ image_url: m.best.public_url }).eq('id', row.id);
      if (upErr) return { status: 'error', err: `events update: ${upErr.message}` };

      // 2) Öka times_used via UPDATE direkt (atomic SQL: SET times_used = times_used + 1)
      const { error: countErr } = await db
        .from('image_library')
        .update({ times_used: (m.best.times_used ?? 0) + 1 })
        .eq('id', m.best.id);
      if (countErr) {
        return { status: 'error', err: `times_used: ${countErr.message}` };
      }
    }
    return { status: 'match', best: { overlap, public_url: m.best.public_url, id: m.best.id } };
  } catch (err) {
    return { status: 'error', err: err instanceof Error ? err.message : 'okänt' };
  }
}

async function main(): Promise<void> {
  console.log(`[backfill] kategori=${category ?? 'alla'} läge=${isApply ? 'APPLY' : 'DRY-RUN'} limit=${limit}`);

  const rows = await fetchCandidates(category);
  const candidates = rows.filter(isBrokenUrl).slice(0, limit);
  console.log(`[backfill] events totalt: ${rows.length}, behöver bild: ${candidates.length} (kör på ${Math.min(limit, candidates.length)} st)`);

  if (candidates.length === 0) {
    console.log('[backfill] inget att göra.');
    return;
  }

  if (isApply) {
    await snapshotEvents(category);
  }

  const results: BackfillResult = { total: candidates.length, matches: 0, noMatch: 0, skipped: 0, errors: 0, byOverlap: {} };
  let cursor = 0;
  const CONCURRENCY = 5;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const idx = cursor++;
      const row = candidates[idx];
      const r = await processOne(row, isDryRun);
      if (r.status === 'match') {
        results.matches++;
        const o = String(r.best!.overlap);
        results.byOverlap[o] = (results.byOverlap[o] ?? 0) + 1;
        if (results.matches % 5 === 0 || cursor === candidates.length) {
          console.log(`  ${cursor}/${candidates.length} — match (overlap=${r.best!.overlap}) ${row.id} ${row.title_sv?.slice(0, 40) ?? ''}`);
        }
      } else if (r.status === 'no-match') {
        results.noMatch++;
      } else if (r.status === 'skipped') {
        results.skipped++;
      } else {
        results.errors++;
        console.error(`  ${cursor}/${candidates.length} ✗ ${row.id}: ${r.err}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n[backfill] KLART`);
  console.log(`  match:   ${results.matches}`);
  console.log(`  noMatch: ${results.noMatch}`);
  console.log(`  skip:    ${results.skipped}`);
  console.log(`  fel:     ${results.errors}`);
  console.log(`  fördelning overlap: ${JSON.stringify(results.byOverlap)}`);

  if (!isApply) {
    console.log('\n[backfill] DRY-RUN: inget skrivet. Kör med --apply för att verkställa.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
