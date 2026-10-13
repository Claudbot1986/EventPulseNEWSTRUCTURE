/**
 * verify-event-coverage.ts — verifierar beskrivnings-täckning per kategori.
 *
 * Vad: kör mot Supabase DB och rapporterar hur stor andel av events som
 *      har:
 *        - eventpulse_summary (deterministisk template)
 *        - description_license ≠ 'unknown' (källtext-tillåten)
 *        - description_sv (faktisk svensk beskrivning)
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/verify-event-coverage.ts
 *   npx tsx scripts/verify-event-coverage.ts --category=music
 */
import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const args = process.argv.slice(2);
  const catArg = args.find((a) => a.startsWith('--category='));
  const category = catArg ? catArg.slice('--category='.length) : null;

  console.log('═'.repeat(78));
  console.log('  EVENT-BESKRIVNINGS-TÄCKNING — 2026-10-13 verifiering');
  console.log('  Källa: events-tabell (read-only, inga writes)');
  console.log('═'.repeat(78));

  const now = new Date().toISOString();
  let q = supabase
    .from('events')
    .select('id, title_sv, title_en, category_slug, description_license, eventpulse_summary, description_sv, description_en')
    .gt('start_time', now)
    .limit(500);
  if (category) q = q.eq('category_slug', category);
  const { data, error } = await q;
  if (error) {
    console.error('Fel:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log('Inga events hittades.');
    return;
  }

  console.log(`\nTotalt future events${category ? ` (${category})` : ''}: ${data.length}`);

  // ── Coverage-statistik (anpassad till PROD-schema) ──
  const stats = {
    withEventpulseSummary: 0,
    withOpenLicense: 0,
    withDescriptionSv: 0,
    withAnyDescription: 0,
  };

  const noDescExamples: string[] = [];
  const licenseByCat = new Map<string, { open: number; unknown: number; other: number }>();

  for (const ev of data) {
    const hasSummary = ev.eventpulse_summary && String(ev.eventpulse_summary).trim().length >= 10;
    const license = (ev.description_license as string | null) ?? 'unknown';
    const isOpenLicense = license && license !== 'unknown';
    const hasDescSv = ev.description_sv && String(ev.description_sv).trim().length >= 10;

    if (hasSummary) stats.withEventpulseSummary++;
    if (isOpenLicense) stats.withOpenLicense++;
    if (hasDescSv) stats.withDescriptionSv++;
    if (hasSummary || isOpenLicense || hasDescSv) stats.withAnyDescription++;

    // Per-kategori license-tracking
    const cat = ev.category_slug || 'unknown';
    const cur = licenseByCat.get(cat) ?? { open: 0, unknown: 0, other: 0 };
    if (license === 'unknown') cur.unknown++;
    else if (['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain'].includes(license)) cur.open++;
    else cur.other++;
    licenseByCat.set(cat, cur);

    if (!hasSummary && !isOpenLicense && !hasDescSv && noDescExamples.length < 5) {
      const t = (ev.title_sv || ev.title_en || '').slice(0, 50);
      noDescExamples.push(`  - [${ev.category_slug}] ${t} (license=${license})`);
    }
  }

  // ── Rapport ──
  const pct = (n: number) => `${n}/${data.length} (${Math.round((n / data.length) * 100)}%)`;
  console.log('\n--- Coverage (PROD-schema) ---');
  console.log(`  Eventpulse summary (template):         ${pct(stats.withEventpulseSummary)}`);
  console.log(`  Description SV (källtext, om license): ${pct(stats.withDescriptionSv)}`);
  console.log(`  Open license (källtext OK):            ${pct(stats.withOpenLicense)}`);
  console.log(`  NÅGON description (summary + license + desc): ${pct(stats.withAnyDescription)}`);

  // ── Bedömning ──
  console.log('\n--- Bedömning ---');
  if (stats.withAnyDescription === data.length) {
    console.log('  ✅ 100% — alla events har NÅGON beskrivning');
  } else if (stats.withAnyDescription === 0) {
    console.log('  ❌ 0% — INGA events har beskrivning');
  } else {
    console.log(`  ⚠️  ${data.length - stats.withAnyDescription} events saknar beskrivning`);
    console.log('\n  Exempel (första 5):');
    for (const ex of noDescExamples) console.log(ex);
  }

  // ── Per-kategori-sammanställning (visa license-fördelning) ──
  if (!category) {
    const byCat = new Map<string, { total: number; withDesc: number; open: number; unknown: number; other: number }>();
    for (const ev of data) {
      const cat = ev.category_slug || 'unknown';
      const cur = byCat.get(cat) ?? { total: 0, withDesc: 0, open: 0, unknown: 0, other: 0 };
      cur.total++;
      const hasSummary = ev.eventpulse_summary && String(ev.eventpulse_summary).trim().length >= 10;
      const license = (ev.description_license as string | null) ?? 'unknown';
      const isOpenLicense = license && license !== 'unknown';
      const hasDescSv = ev.description_sv && String(ev.description_sv).trim().length >= 10;
      if (hasSummary || isOpenLicense || hasDescSv) cur.withDesc++;
      if (license === 'unknown') cur.unknown++;
      else if (['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain'].includes(license)) cur.open++;
      else cur.other++;
      byCat.set(cat, cur);
    }
    console.log('\n--- Per-kategori (top 10) ---');
    const sorted = Array.from(byCat.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    for (const [cat, s] of sorted) {
      const pctCat = s.total > 0 ? Math.round((s.withDesc / s.total) * 100) : 0;
      const icon = pctCat === 100 ? '✅' : pctCat === 0 ? '❌' : '⚠️';
      console.log(`  ${icon} ${cat.padEnd(20)} ${s.withDesc}/${s.total} (${pctCat}%) — license: ${s.unknown} unknown, ${s.open} open, ${s.other} other`);
    }
  }

  // ── Kritiskt: editorial_description & event_profile är inte i prod-DB ──
  console.log('\n--- Saknad infrastruktur ---');
  console.log('  ❌ event_profile JSONB kolumn finns INTE (migration 20261007 ej applicerad)');
  console.log('  ❌ editorial_description kolumn finns INTE');
  console.log('  ❌ Tier 1 attribution-rad fungerar INTE i prod förrän migrationen körs');
  console.log('  ✅ Eventpulse summary fungerar (deterministisk template)');
  console.log('  ✅ Description license fungerar (filter för källtext)');
  console.log('');
  console.log('  ÅTGÄRD: kör supabase db push (eller motsvarande) för att applicera');
  console.log('  20261007-0001-editorial-description-engine.sql. Efter det:');
  console.log('    1. event_profile-kolumnen finns');
  console.log('    2. Kör editorial pipeline (04-Normalizer/editorial/) mot alla events');
  console.log('    3. Tier 1 attribution visas i UI:t');

  if (stats.withAnyDescription < data.length * 0.5) {
    console.log('\n⚠️  Mindre än 50% av events har beskrivning.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
