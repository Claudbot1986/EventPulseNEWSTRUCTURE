/**
 * t0201_category_backfill.ts — High-confidence deterministic backfill av
 * category_slug för events med NULL, baserade på raw_data.categories array.
 *
 * Källa-agnostisk mappning (Livespot-style payloads):
 *   - "teater"      → "theater"
 *   - "konsert"     → "music"
 *   - "musik"       → "music"
 *   - "humor"       → "standup"
 *   - "standup"     → "standup"
 *   - "workshop"    → "workshop"
 *   - "festival"    → "festival"
 *   - "utställning" → "art-exhibitions"
 *   - "film"        → "film"
 *   - "sport"       → "sport"
 *   - "barn", "barn-familj" → "community"
 *   - "övrigt", "ovrigt", null, okänd → NULL (lämnas NULL → UI fallback)
 *
 * Säkerhet:
 *   - Idempotent (UPDATE med .is('category_slug', null) säkerhetsvillkor).
 *   - Bara första kategorin i arrayen används (single-label).
 *   - OKÄND kategori → NULL (visas 'community' i UI via fallback).
 *
 * För events där mappningen inte ger en kategori (t.ex. "övrigt") och
 * raw_data saknas → kör _retag-batch-null.ts för AI-baserad kategorisering.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/t0201_category_backfill.ts [--dry-run]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RUNTIME_DIR = resolve(process.cwd(), 'runtime');
mkdirSync(RUNTIME_DIR, { recursive: true });

// Source-livespot-style mapping (deterministic, högsta confidence)
const CATEGORY_MAP: Record<string, string> = {
  // Teater
  'teater': 'theater',
  'theater': 'theater',
  'teatern': 'theater',
  'musikal': 'theater',
  'musical': 'theater',
  'opera': 'theater',
  // Musik
  'musik': 'music',
  'music': 'music',
  'konsert': 'music',
  'konserter': 'music',
  // Standup / humor
  'humor': 'standup',
  'standup': 'standup',
  'comedy': 'standup',
  'komedi': 'standup',
  // Utställning
  'utställning': 'art-exhibitions',
  'exhibition': 'art-exhibitions',
  'konst': 'art-exhibitions',
  // Film / screening
  'film': 'film',
  'bio': 'film',
  'screening': 'film',
  // Festival
  'festival': 'festival',
  'festivaler': 'festival',
  // Sport / idrott
  'sport': 'sport',
  'idrott': 'sport',
  // Workshop / kurs
  'workshop': 'workshop',
  'kurs': 'workshop',
  // Barn / familj → community
  'barn': 'community',
  'barn-familj': 'community',
  'family': 'community',
  // Övrigt / ovrigt / okänd → mappas INTE (lämnas NULL → UI 'community' fallback)
  // 'övrigt' och 'ovrigt' är INTE med — vi vill INTE fylla 'community' för dem
  // eftersom de kan vara vilken kategori som helst (förlorar information).
};

function mapCategorySlug(rawCategories: unknown): string | null {
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) return null;
  for (const raw of rawCategories) {
    if (typeof raw !== 'string') continue;
    const lower = raw.toLowerCase().trim();
    if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  }
  return null; // alla okända → NULL (UI visar 'community' via faktaraden)
}

async function fetchNullEventsWithRawData(): Promise<Array<{ id: string; raw_data: any }>> {
  const rows: any[] = [];
  let offset = 0;
  const PAGE = 500;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, raw_data')
      .eq('status', 'published')
      .is('category_slug', null)
      .not('raw_data', 'is', null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log('[cat-backfill] Starting (dry-run=' + dryRun + ')…');
  const startTs = Date.now();

  const events = await fetchNullEventsWithRawData();
  console.log(`[cat-backfill] ${events.length} events med category_slug IS NULL OCH raw_data finns`);

  let mappable = 0;
  let notMappable = 0;
  const perTarget: Record<string, number> = {};
  const updates: Array<{ id: string; category_slug: string }> = [];

  for (const ev of events) {
    const cats = ev.raw_data?.categories;
    const mapped = mapCategorySlug(cats);
    if (mapped) {
      mappable++;
      perTarget[mapped] = (perTarget[mapped] ?? 0) + 1;
      updates.push({ id: ev.id, category_slug: mapped });
    } else {
      notMappable++;
    }
  }

  console.log(`[cat-backfill] Mappable: ${mappable} (${(100 * mappable / events.length).toFixed(1)}%)`);
  console.log(`[cat-backfill] Not mappable (lämnas NULL): ${notMappable} (${(100 * notMappable / events.length).toFixed(1)}%)`);

  console.log('\n=== Fördelning per target-kategori ===');
  for (const [c, n] of Object.entries(perTarget).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }

  if (dryRun) {
    console.log(`\n[cat-backfill] DRY RUN — would update ${updates.length}, skip ${notMappable}`);
  } else if (updates.length > 0) {
    const CONCURRENCY = 20;
    const queue = [...updates];
    let updated = 0;
    let failed = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const u = queue.shift()!;
        const { error } = await supabase
          .from('events')
          .update({ category_slug: u.category_slug })
          .eq('id', u.id)
          .is('category_slug', null); // säkerhetsvillkor
        if (error) failed++;
        else updated++;
      }
    });
    await Promise.all(workers);
    console.log(`\n[cat-backfill] Apply: ${updated} uppdaterade, ${failed} misslyckade`);
  }

  const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(`\n[cat-backfill] klar på ${elapsedSec}s`);

  // Audit
  appendFileSync(
    resolve(RUNTIME_DIR, 'desc-coverage-t0201.jsonl'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'cat-backfill-mapping',
      dry_run: dryRun,
      total: events.length,
      mappable,
      not_mappable: notMappable,
      per_target: perTarget,
      elapsed_sec: elapsedSec,
    }) + '\n'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cat-backfill] FATAL:', err);
    process.exit(1);
  });