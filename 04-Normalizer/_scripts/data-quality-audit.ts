/**
 * data-quality-audit.ts — auditera nuläget för Steg 3.6 (data quality).
 *
 * Mäter (utan att skriva till DB):
 *   1. Test-events (titlar som innehåller "Test"/"TEST"/"test event" eller
 *      har uppenbart test-stub-markörer).
 *   2. Events utan description_sv OCH utan description_en.
 *   3. Events där title_sv == title_en (misstänkt placeholder/original-brist).
 *   4. Topp 15 mest duplicerade titlar (förstorsta titelgrupperna).
 *   5. Per kategori: antal events utan description (hjälper oss prioritera
 *      community-städ vs andra kategorier).
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/data-quality-audit.ts
 *
 * Output: text-tabeller till stderr (errors-as-data, kraschar aldrig).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const TEST_MARKERS = [
  /^test\b/i,
  /^test event/i,
  /^placeholder/i,
  /\btest event\b/i,
  /\bsample event\b/i,
  /^lorem ipsum/i,
];

const isTestLike = (title: string | null): boolean => {
  if (!title) return false;
  return TEST_MARKERS.some((re) => re.test(title.trim()));
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[data-quality-audit] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
    process.exit(1);
  }
  const c = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Test-events ───────────────────────────────────────────────────────
  // Paginerad hämtning — Supabase default-limit är 1000 rader.
  const PAGE = 1000;
  const allRows: Array<{ id: string; source: string; title_sv: string | null; title_en: string | null; category_slug: string | null; description_sv: string | null; description_en: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await c
      .from('events')
      .select('id, source, title_sv, title_en, category_slug, description_sv, description_en')
      .eq('status', 'published')
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[data-quality-audit] FATAL: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as typeof allRows));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const rows = allRows;
  const testEvents = rows.filter((r) => isTestLike(r.title_sv) || isTestLike(r.title_en));

  console.error('═══════════════════════════════════════════════════════════');
  console.error('  DATA-QUALITY AUDIT — STEG 3.6');
  console.error('═══════════════════════════════════════════════════════════');
  console.error(`Total published events:          ${rows.length}`);
  console.error('');
  console.error(`Misstänkta test-events:           ${testEvents.length}`);
  if (testEvents.length > 0) {
    for (const e of testEvents.slice(0, 20)) {
      console.error(`  [${e.source}] ${e.title_sv ?? e.title_en ?? '(no title)'}`);
    }
    if (testEvents.length > 20) console.error(`  ... och ${testEvents.length - 20} till`);
  }

  // ── 2. Tomma beskrivningar ──────────────────────────────────────────────
  const { count: total } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  const { count: noSv } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('description_sv', null);
  const { count: noEn } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('description_en', null);
  const { count: bothEmpty } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('description_sv', null)
    .is('description_en', null);
  const { count: svEmpty } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('description_sv', '');
  const { count: enEmpty } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('description_en', '');

  console.error('');
  console.error('TOMMA BESKRIVNINGAR:');
  console.error(`  description_sv IS NULL:        ${noSv}`);
  console.error(`  description_en IS NULL:        ${noEn}`);
  console.error(`  description_sv = '':           ${svEmpty}`);
  console.error(`  description_en = '':           ${enEmpty}`);
  console.error(`  BÅDA null/empty:               ${bothEmpty}`);
  console.error(`  Minst ena språket saknas:      ${((noSv ?? 0) + (noEn ?? 0) - (bothEmpty ?? 0))}`);
  console.error(`  Total:                          ${total}`);

  // ── 3. Samma titel på båda språken ──────────────────────────────────────
  const sameTitle = rows.filter(
    (r) => r.title_sv && r.title_en && r.title_sv.trim() === r.title_en.trim() && r.title_sv.length > 3,
  );

  console.error('');
  console.error(`Events där title_sv == title_en:  ${sameTitle.length}`);
  if (sameTitle.length > 0) {
    const bySource = new Map<string, number>();
    for (const r of sameTitle) {
      bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
    }
    const top = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [s, n] of top) console.error(`  ${String(n).padStart(4)} — ${s}`);
  }

  // ── 4. Top duplicerade titlar ──────────────────────────────────────────
  const titleCount = new Map<string, number>();
  for (const r of rows) {
    const t = (r.title_sv ?? r.title_en ?? '').trim();
    if (t.length === 0) continue;
    titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
  }
  const topDupes = Array.from(titleCount.entries())
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.error('');
  console.error('TOP 15 TITLAR MEDS ≥5 FÖREKOMSTER (per kategori, ej dedupade):');
  for (const [t, n] of topDupes) {
    const truncated = t.length > 65 ? t.slice(0, 62) + '...' : t;
    console.error(`  ${String(n).padStart(4)}× ${truncated}`);
  }

  // ── 5. Tomma beskrivningar per kategori ────────────────────────────────
  // Använd allRows (redan paginerad) istället för en ny query.
  const catEmpty = new Map<string, { total: number; empty: number }>();
  for (const r of rows) {
    const slug = r.category_slug ?? '(none)';
    const cur = catEmpty.get(slug) ?? { total: 0, empty: 0 };
    cur.total++;
    const hasDesc =
      (r.description_sv && r.description_sv.length > 0) ||
      (r.description_en && r.description_en.length > 0);
    if (!hasDesc) cur.empty++;
    catEmpty.set(slug, cur);
  }

  console.error('');
  console.error('TOMMA BESKRIVNINGAR PER KATEGORI:');
  const sortedCats = Array.from(catEmpty.entries())
    .filter(([, s]) => s.empty > 0)
    .sort((a, b) => b[1].empty - a[1].empty);
  for (const [slug, s] of sortedCats) {
    const pct = ((s.empty / s.total) * 100).toFixed(0);
    console.error(`  ${slug.padEnd(20)} ${String(s.empty).padStart(4)} / ${String(s.total).padStart(4)}  (${pct}%)`);
  }

  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[data-quality-audit] FATAL: ${msg}`);
  process.exit(1);
});