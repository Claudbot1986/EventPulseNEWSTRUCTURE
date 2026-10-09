#!/usr/bin/env -S npx tsx
/**
 * _check_image_quota.ts — kontrollera 1/30-bildkvoten per kategori.
 *
 * Bakgrund (2026-10-08): Användaren vill att ingestion-flödet automatiskt
 * ska upptäcka bild-brist per kategori och generera nya BFL-bilder för
 * att täcka kvoten.
 *
 * Kvot-regel (från tidigare round5-beslut):
 *   target_per_cat = ceil(events_count / 30)
 *   need = max(0, target_per_cat − library_count)
 *
 * Användning:
 *   npx tsx scripts/_check_image_quota.ts                      # rapport
 *   npx tsx scripts/_check_image_quota.ts --only theatre-drama # en kategori
 *   npx tsx scripts/_check_image_quota.ts --emit-plan          # skriv planfil
 *                                                              # som round5 kan köra
 *
 * Output:
 *   - stdout: tabell över brist
 *   - om --emit-plan: tmp_image_corpus/_image_quota_plan_<datum>.json
 *     med items (category, need, source: '_check_image_quota')
 *
 * Säkerhet:
 *   - Default = läs-läge (inga filer skrivs)
 *   - --emit-plan skriver bara en plan-JSON, genererar inga BFL-bilder
 *   - För att KÖRA generering: användaren måste manuellt köra
 *     _generate_bfl_round5_images.mjs med planen (aldrig automatiskt)
 */
import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_PER_30 = 30;
const MIN_IMAGES_FOR_SMALL = 20;  // användarbeslut 2026-10-08: < 50 events ⇒ minst 20 bilder
const SMALL_THRESHOLD = 50;        // under detta ⇒ min-regeln, över ⇒ 1/30
const PLANS_DIR = join(process.cwd(), 'tmp_image_corpus');

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const emitPlan = process.argv.includes('--emit-plan');

interface CategoryQuota {
  category: string;
  events: number;
  library: number;
  target: number;
  need: number;
  eventsPerImage: number | null;   // events / library (null om library=0)
  exceedsQuota: boolean;           // events > 30 * library (dvs > 1 bild per 30)
}

async function countEventsByCategory(): Promise<Map<string, number>> {
  // Hämta endast category_slug för att hålla payload liten.
  // Supabase default limit är 1000 — paginera i 1000-raders-bitar.
  const counts = new Map<string, number>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .from('events')
      .select('category_slug')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('events query:', error.message); process.exit(2); }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const c = (r as { category_slug: string | null }).category_slug;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return counts;
}

async function countLibraryByCategory(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .from('image_library')
      .select('category_slug')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('image_library query:', error.message); process.exit(2); }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const c = (r as { category_slug: string | null }).category_slug;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return counts;
}

async function main(): Promise<void> {
  console.log(`[quota-check] mode=${emitPlan ? 'EMIT-PLAN' : 'REPORT'} only=${only ?? 'alla'}`);
  console.log('');

  const [events, library] = await Promise.all([
    countEventsByCategory(),
    countLibraryByCategory(),
  ]);

  // Bygg per-kategori-rader
  const allCats = new Set<string>([...events.keys(), ...library.keys()]);
  const rows: CategoryQuota[] = [];
  for (const cat of allCats) {
    if (only && cat !== only) continue;
    const ev = events.get(cat) ?? 0;
    const lib = library.get(cat) ?? 0;
    // Kvot-regel (användarbeslut 2026-10-08):
    //   events < 50 ⇒ target = MIN_IMAGES_FOR_SMALL (20)
    //   events ≥ 50 ⇒ target = ceil(events / 30)
    const target = ev < SMALL_THRESHOLD
      ? MIN_IMAGES_FOR_SMALL
      : Math.ceil(ev / TARGET_PER_30);
    const need = Math.max(0, target - lib);
    const eventsPerImage = lib > 0 ? Math.round((ev / lib) * 10) / 10 : null;
    // Överstiger kvot om ev/lib > 30 (för ≥50 events) eller ev > 0 med lib < 20 (för <50)
    const exceedsQuota = lib === 0
      ? ev > 0
      : ev < SMALL_THRESHOLD
        ? lib < MIN_IMAGES_FOR_SMALL
        : ev > lib * TARGET_PER_30;
    rows.push({ category: cat, events: ev, library: lib, target, need, eventsPerImage, exceedsQuota });
  }

  // Sortera efter need desc
  rows.sort((a, b) => b.need - a.need || b.events - a.events);

  // Tabell
  console.log(`[quota-check] ${rows.length} kategorier`);
  console.log('');
  console.log('  ' + 'kategori'.padEnd(20) + 'events'.padStart(8) + 'library'.padStart(9) + 'target'.padStart(8) + 'need'.padStart(6) + 'ev/img'.padStart(8) + '  status');
  console.log('  ' + '─'.repeat(78));
  for (const r of rows) {
    const flag = r.exceedsQuota ? '! ' : '  ';
    const evPerImg = r.eventsPerImage === null ? '  —  ' : String(r.eventsPerImage).padStart(6);
    const status = r.exceedsQuota
      ? `MER ÄN 30 EV/BILD — saknar ${r.need}`
      : r.library === 0 && r.events === 0 ? 'tom (inga events, inga bilder)'
      : r.library === 0 ? 'ingen bild (0 bilder)'
      : 'OK';
    console.log(`  ${flag}${r.category.padEnd(18)} ${String(r.events).padStart(8)} ${String(r.library).padStart(8)} ${String(r.target).padStart(7)} ${String(r.need).padStart(5)} ${evPerImg}  ${status}`);
  }
  console.log('');

  const needRows = rows.filter((r) => r.need > 0);
  const totalNeed = needRows.reduce((s, r) => s + r.need, 0);
  console.log(`[quota-check] ${needRows.length} kategorier med behov (totalt ${totalNeed} nya bilder).`);

  if (needRows.length === 0) {
    console.log('[quota-check] alla kategorier uppfyller 1/30-kvoten. Avbryter.');
    process.exit(0);
  }

  if (!emitPlan) {
    console.log('');
    console.log('Kör med --emit-plan för att skriva en plan-JSON som kan användas med round5.');
    process.exit(0);
  }

  // Skriv plan-JSON
  const today = new Date().toISOString().slice(0, 10);
  const planPath = join(PLANS_DIR, `_image_quota_plan_${today}.json`);
  mkdirSync(PLANS_DIR, { recursive: true });
  const plan = {
    generated_at: new Date().toISOString(),
    source: '_check_image_quota',
    target_per_30: TARGET_PER_30,
    items: needRows.map((r) => ({
      category: r.category,
      need: r.need,
      events: r.events,
      library: r.library,
      target: r.target,
    })),
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log('');
  console.log(`[quota-check] plan skriven till ${planPath}`);
  console.log('');
  console.log('NÄSTA STEG (manuellt, ingen auto-BFL):');
  console.log('  1. Granska plan-JSON');
  console.log('  2. npx tsx scripts/_generate_bfl_round5.mjs --apply   # bygger items');
  console.log('  3. npx tsx scripts/_generate_bfl_round5_images.mjs --apply   # kör BFL (kräver godkännande)');
  console.log('  4. npx tsx scripts/_stamp_bulk.ts --only <cat> --apply   # stämplar per kategori');
  console.log('');
  console.log('ELLER för EN kategori:');
  console.log('  1. npx tsx scripts/_generate_bfl_round5.mjs --only ' + needRows[0].category + ' --apply');
  console.log('  2. npx tsx scripts/_generate_bfl_round5_images.mjs --only ' + needRows[0].category + ' --apply');
}

main().catch((err) => { console.error('[quota-check] FATAL:', err); process.exit(99); });