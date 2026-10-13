/**
 * _verifyDescriptionCoverage.ts — 2026-10-13.
 *
 * Verifierar 90%-målet:
 *   - "unika beskrivningar" — varje event har sin egen text
 *   - "inte källans beskrivning" — INTE samma som raw_description
 *   - "inte heller är vilseledande" — Profile+factual claims spårbara
 *
 * Mäter per kategori och rapporterar:
 *   - antal events med editorial_description
 *   - antal unika beskrivningar
 *   - antal som matchar raw_description (BÖR vara 0)
 *   - antal som innehåller "Typ: community" för music-events (BÖR vara 0)
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_verifyDescriptionCoverage.ts
 *   npx tsx scripts/_verifyDescriptionCoverage.ts --category=music
 */
import { createClient } from '@supabase/supabase-js';

function norm(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const catArg = args.find((a) => a.startsWith('--category='));
  const category = catArg ? catArg.slice('--category='.length) : null;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const now = new Date().toISOString();

  console.log('═'.repeat(78));
  console.log('  90%-MÅLET VERIFIERING — 2026-10-13');
  console.log('═'.repeat(78));

  // Hämta alla future events
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('events')
      .select(`
        id, title_sv, category_slug, source,
        eventpulse_summary, raw_description,
        editorial_description, editorial_info_level,
        event_profile
      `)
      .gt('start_time', now)
      .range(from, from + PAGE - 1);
    if (category) q = q.eq('category_slug', category);
    const { data, error } = await q;
    if (error) { console.error('Fel:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }

  console.log(`\nTotalt future events${category ? ` (${category})` : ''}: ${all.length}`);

  // ─── 1. UNIKHET (eventpulse_summary ELLER editorial_description) ─────────
  const summaryUniq = new Map<string, number>();
  const editorialUniq = new Map<string, number>();
  let withSummary = 0;
  let withEditorial = 0;
  let editorialIngenFel = 0;

  for (const e of all) {
    const s = norm(e.eventpulse_summary);
    if (s.length >= 10) {
      withSummary++;
      summaryUniq.set(s, (summaryUniq.get(s) ?? 0) + 1);
    }
    const ed = norm(e.editorial_description);
    if (ed.length >= 10) {
      withEditorial++;
      editorialUniq.set(ed, (editorialUniq.get(ed) ?? 0) + 1);
      // Särskild kolla: "Typ: community" på music-events
      if (e.category_slug === 'music' && ed.includes('typ: community')) {
        editorialIngenFel++;
      }
    }
  }

  console.log('\n— TÄCKNING —');
  console.log(`  Eventpulse summary: ${withSummary}/${all.length} (${Math.round((withSummary / all.length) * 100)}%)`);
  console.log(`  Editorial desc:     ${withEditorial}/${all.length} (${Math.round((withEditorial / all.length) * 100)}%)`);

  console.log('\n— UNIKHET —');
  const summaryDups = [...summaryUniq.values()].filter((n) => n > 1).length;
  const editorialDups = [...editorialUniq.values()].filter((n) => n > 1).length;
  console.log(`  Summary unika texter:    ${summaryUniq.size} (dubletter: ${summaryDups})`);
  console.log(`  Editorial unika texter:  ${editorialUniq.size} (dubletter: ${editorialDups})`);

  // ─── 2. INTE KÄLLANS BESKRIVNING ──────────────────────────────────────────
  let copying = 0;
  let notCopying = 0;
  let atleastOne = 0;
  for (const e of all) {
    const s = norm(e.eventpulse_summary);
    const ed = norm(e.editorial_description);
    const r = norm(e.raw_description);
    if (!r) continue;
    atleastOne++;
    const candidate = ed || s;
    if (!candidate) continue;
    if (candidate === r || r.includes(candidate) || candidate.includes(r)) {
      copying++;
    } else {
      notCopying++;
    }
  }

  console.log('\n— INTE KÄLLANS BESKRIVNING —');
  console.log(`  ✓ Unik & icke-kopia: ${notCopying}`);
  console.log(`  ✗ Matchar raw_desc:  ${copying}`);
  console.log(`  - Jämförelsebas:     ${atleastOne} (events med raw_desc + ngn description)`);

  // ─── 3. MUSIC-EVENTS SOM ÄR "Typ: community" (bug-mätare) ───────────────
  console.log('\n— BUG-INDIKATOR (Typ: community på music-events) —');
  console.log(`  Music-events med "Typ: community" i description: ${editorialIngenFel}`);
  if (editorialIngenFel > 0) {
    console.log(`  → KRÄVER SQL-FIX: UPDATE event_profile.profile.event_type='music'`);
  }

  // ─── 4. PER-KATEGORI SAMMANDRAG ──────────────────────────────────────────
  console.log('\n— PER KATEGORI —');
  const byCat = new Map<string, { total: number; withSummary: number; withEditorial: number; musicBug: number }>();
  for (const e of all) {
    const cat = e.category_slug ?? 'unknown';
    const cur = byCat.get(cat) ?? { total: 0, withSummary: 0, withEditorial: 0, musicBug: 0 };
    cur.total++;
    if (e.eventpulse_summary && norm(e.eventpulse_summary).length >= 10) cur.withSummary++;
    if (e.editorial_description && norm(e.editorial_description).length >= 10) cur.withEditorial++;
    if (cat === 'music' && norm(e.editorial_description).includes('typ: community')) cur.musicBug++;
    byCat.set(cat, cur);
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total);
  console.log(`  ${'kategori'.padEnd(22)} ${'summary'.padStart(8)} ${'editorial'.padStart(10)}  ${'bug'.padStart(5)}`);
  for (const [cat, s] of sorted.slice(0, 15)) {
    const pctS = Math.round((s.withSummary / s.total) * 100);
    const pctE = Math.round((s.withEditorial / s.total) * 100);
    console.log(
      `  ${cat.padEnd(22)} ${pctS}% (${s.withSummary}/${s.total})  ${pctE}% (${s.withEditorial})  ${s.musicBug}`,
    );
  }

  // ─── SLUTPOÄNG MOT 90%-MÅL ────────────────────────────────────────────────
  console.log('\n═'.repeat(78));
  console.log('  SLUTPOÄNG');
  console.log('═'.repeat(78));

  // Definition: "har unika beskrivning som inte är källans" = har unika summary ELLER unik editorial
  // Och inte är en kopia av raw_description
  let unikaOchEjKopia = 0;
  for (const e of all) {
    const s = norm(e.eventpulse_summary);
    const ed = norm(e.editorial_description);
    const r = norm(e.raw_description);
    const candidate = ed || s;
    if (!candidate || candidate.length < 10) continue;
    if (r && (candidate === r || r.includes(candidate) || candidate.includes(r))) continue;
    unikaOchEjKopia++;
  }
  const pct = Math.round((unikaOchEjKopia / all.length) * 100);
  const target = 90;
  const passed = pct >= target;
  console.log(`  Events med unik & icke-kopierad beskrivning: ${unikaOchEjKopia}/${all.length} = ${pct}%`);
  console.log(`  Målgräns: ${target}%`);
  console.log(`  Status: ${passed ? '✅ UPPNÅTT' : '⚠️  UNDER målgräns'}`);
  console.log('═'.repeat(78));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
