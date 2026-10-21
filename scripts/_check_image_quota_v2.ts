/**
 * scripts/_check_image_quota_v2.ts
 *
 * Parallell quota-check till _check_image_quota.ts (orörd).
 * Använder den NYA kvotformeln (användarbeslut 2026-10-18):
 *   target(cat) = 20 + max(0, ceil((events - 600) / 30))
 *
 *   Alltid minst 20/cat, sedan 1/30 events över 600-baseline.
 *
 *   events 12 (kids):    target=20
 *   events 100 (medium): target=20 (tidigare: ceil(100/30)=4)
 *   events 600:          target=20
 *   events 700:          target=21  (tidigare: 24)
 *   events 4523 (music): target=151 (tidigare: 151)
 *
 * CLI:
 *   tsx scripts/_check_image_quota_v2.ts              # rapport
 *   tsx scripts/_check_image_quota_v2.ts --emit-plan  # skriv plan-JSON
 *   tsx scripts/_check_image_quota_v2.ts --only=music # bara en kategori
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// === NY FORMEL (användarens val 2026-10-18) ===============================
const PHASE_1_QUOTA = 20;
const PHASE_2_RATE = 30;
const PHASE_2_MIN_EVENTS = 600;

function computeTarget(events: number): { phase1: number; phase2: number; total: number } {
  const phase1 = PHASE_1_QUOTA;
  const phase2 = Math.max(0, Math.ceil((events - PHASE_2_MIN_EVENTS) / PHASE_2_RATE));
  return { phase1, phase2, total: phase1 + phase2 };
}

const PLANS_DIR = join(process.cwd(), 'tmp_image_corpus');
const PAGE = 1000;

async function countEventsByCategory(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!SUPABASE_URL || !SUPABASE_KEY) return out;
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events?select=category_slug&offset=${offset}&limit=${PAGE}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) break;
    const rows = (await res.json()) as Array<{ category_slug: string | null }>;
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (r.category_slug) out.set(r.category_slug, (out.get(r.category_slug) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function countLibraryByCategory(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!SUPABASE_URL || !SUPABASE_KEY) return out;
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/image_library?select=category_slug&offset=${offset}&limit=${PAGE}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) break;
    const rows = (await res.json()) as Array<{ category_slug: string | null }>;
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (r.category_slug) out.set(r.category_slug, (out.get(r.category_slug) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

interface CategoryRow {
  category: string;
  events: number;
  library: number;
  phase1: number;
  phase2: number;
  target: number;
  need: number;
  eventsPerImage: number | null;
  exceedsQuota: boolean;
}

function exceedsQuota(events: number, lib: number, target: number): boolean {
  if (lib === 0) return events > 0;
  return events > lib * PHASE_2_RATE;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const emitPlan = args.includes('--emit-plan');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length) : null;

  console.log(`[quota-check-v2] mode=${emitPlan ? 'EMIT-PLAN' : 'REPORT'} only=${only ?? 'alla'}`);
  console.log(`[quota-check-v2] formel: target = ${PHASE_1_QUOTA} + max(0, ceil((events - ${PHASE_2_MIN_EVENTS}) / ${PHASE_2_RATE}))`);
  console.log('');

  const [events, library] = await Promise.all([
    countEventsByCategory(),
    countLibraryByCategory(),
  ]);

  const allCats = new Set<string>([...events.keys(), ...library.keys()]);
  const rows: CategoryRow[] = [];
  for (const cat of allCats) {
    if (only && cat !== only) continue;
    const ev = events.get(cat) ?? 0;
    const lib = library.get(cat) ?? 0;
    const t = computeTarget(ev);
    const need = Math.max(0, t.total - lib);
    const eventsPerImage = lib > 0 ? Math.round((ev / lib) * 10) / 10 : null;
    rows.push({
      category: cat,
      events: ev,
      library: lib,
      phase1: t.phase1,
      phase2: t.phase2,
      target: t.total,
      need,
      eventsPerImage,
      exceedsQuota: exceedsQuota(ev, lib, t.total),
    });
  }
  rows.sort((a, b) => b.need - a.need || b.events - a.events);

  console.log(`[quota-check-v2] ${rows.length} kategorier`);
  console.log('');
  console.log('  ' + 'kategori'.padEnd(20) +
    'events'.padStart(8) + 'library'.padStart(9) +
    'p1'.padStart(5) + 'p2'.padStart(5) +
    'target'.padStart(8) + 'need'.padStart(6) + 'ev/img'.padStart(8) + '  status');
  console.log('  ' + '─'.repeat(86));
  for (const r of rows) {
    const flag = r.exceedsQuota ? '! ' : '  ';
    const evPerImg = r.eventsPerImage === null ? '  —  ' : String(r.eventsPerImage).padStart(6);
    const status = r.exceedsQuota
      ? `MER ÄN 30 EV/BILD — saknar ${r.need}`
      : r.library === 0 && r.events === 0 ? 'tom'
      : r.library === 0 ? 'ingen bild'
      : 'OK';
    console.log(`  ${flag}${r.category.padEnd(18)} ${String(r.events).padStart(8)} ${String(r.library).padStart(8)} ${String(r.phase1).padStart(4)} ${String(r.phase2).padStart(4)} ${String(r.target).padStart(7)} ${String(r.need).padStart(5)} ${evPerImg}  ${status}`);
  }
  console.log('');

  const needRows = rows.filter((r) => r.need > 0);
  const totalNeed = needRows.reduce((s, r) => s + r.need, 0);
  console.log(`[quota-check-v2] ${needRows.length} kategorier med behov (totalt ${totalNeed} nya bilder).`);

  if (needRows.length === 0) {
    console.log('[quota-check-v2] alla kategorier uppfyller kvoten. Avbryter.');
    process.exit(0);
  }

  if (!emitPlan) {
    console.log('');
    console.log('Kör med --emit-plan för att skriva en plan-JSON.');
    process.exit(0);
  }

  // Skriv plan-JSON
  const today = new Date().toISOString().slice(0, 10);
  const planPath = join(PLANS_DIR, `_image_quota_plan_v2_${today}.json`);
  mkdirSync(PLANS_DIR, { recursive: true });
  const plan = {
    generated_at: new Date().toISOString(),
    source: '_check_image_quota_v2',
    formula: `${PHASE_1_QUOTA} + max(0, ceil((events - ${PHASE_2_MIN_EVENTS}) / ${PHASE_2_RATE}))`,
    phase_1_quota: PHASE_1_QUOTA,
    phase_2_rate: PHASE_2_RATE,
    phase_2_min_events: PHASE_2_MIN_EVENTS,
    items: needRows.map((r) => ({
      category: r.category,
      need: r.need,
      events: r.events,
      library: r.library,
      target: r.target,
      phase1: r.phase1,
      phase2: r.phase2,
    })),
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`[quota-check-v2] plan skriven: ${planPath}`);
}

main().catch((err) => {
  console.error('[quota-check-v2] FATAL:', err);
  process.exit(1);
});