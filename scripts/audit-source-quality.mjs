#!/usr/bin/env node
/**
 * audit-source-quality — mät kvaliteten på det som REDAN finns i grafen.
 *
 * Raderar ingenting. Producerar en lista över källor vars rader mest ser ut
 * som artiklar, så att radering kan bli ett eget, medvetet beslut.
 *
 * Bakgrund (2026-11-01): P3D promote:ar kandidater på beviset "det persisterats
 * events". Det är sant för en blogg också. Mätt på de 154 rader som
 * discovery-källorna lade in: 6 domäner visade samma mönster, 18 % hade plats
 * (mot 87 % för övriga källor) och 0 % hade beskrivning.
 *
 * Signalen kommer från DETALJSIDANS egna deklaration (JSON-LD `Article` /
 * `NewsArticle`), inte från gissningar om rubriken. Mätning: titelmönstren
 * fångar 4 av 8 artikelrubriker i kollaborationse, sidans deklaration fångar
 * alla — och sidans "ingen Event-typ" bevisar inte artikel (mät på
 * royaldjurgarden, ett riktigt evenemang utan JSON-LD).
 *
 * Användning:
 *   npx tsx scripts/audit-source-quality.mjs              # titlar + DB-statistik
 *   npx tsx scripts/audit-source-quality.mjs --deep       # hämtar detaljsidorna
 *   npx tsx scripts/audit-source-quality.mjs --json
 *   npx tsx scripts/audit-source-quality.mjs --source kollaborationse,thatsupse
 *
 * `npx tsx` krävs — skriptet importerar .ts-moduler direkt.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// `quiet: true` döljer dotenv-bannern. Utan det hamnar bannern på stdout
// FÖRE JSON:en, och `--json > fil` ger en fil som inte går att parsa.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false, quiet: true });

const { createClient } = await import('@supabase/supabase-js');
const { assessLikeness, classifyTitleShape } = await import(
  path.join(PROJECT_ROOT, '07-Discovery/src/sourceTesting/eventLikeness.ts')
);
const { probeRowPages } = await import(
  path.join(PROJECT_ROOT, '07-Discovery/src/sourceTesting/pageProbe.ts')
);

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const deep = args.includes('--deep');
const onlyIdx = args.indexOf('--source');
const onlySources = onlyIdx !== -1 && args[onlyIdx + 1]
  ? args[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const probeLimitIdx = args.indexOf('--probe-limit');
const probeLimit = probeLimitIdx !== -1 && args[probeLimitIdx + 1] ? Number(args[probeLimitIdx + 1]) : 3;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EXTRACTED = path.join(PROJECT_ROOT, '03-Queue', '03-extractedevents');

/** Källor som discovery har promote:at — de är de som kan ha skräp. */
async function promotedSourceIds() {
  const { data, error } = await sb
    .from('source_candidate_test_decisions')
    .select('promoted_source_id')
    .eq('decision', 'promote')
    .not('promoted_source_id', 'is', null);
  if (error) {
    console.error('[audit-source-quality] kunde inte läsa besluten:', error.message);
    return [];
  }
  return [...new Set((data ?? []).map((d) => d.promoted_source_id).filter(Boolean))];
}

/**
 * Raderna ur den senaste extraktionen — de har med sig sin egen URL.
 *
 * 2026-11-01 — `sourceUrl` föll tidigare bort här. Utan den kunde inte
 * `probeRowPages` skilja en DETALJRAD (url ≠ sourceUrl) från en LISTNINGSRAD
 * (url === sourceUrl), så `--deep` hämtade listningssidan — som för
 * musikaliskase.se bär JSON-LD-typen `article` och felaktigt kan få en källa
 * med 30 riktiga evenemang att se ut som skräp.
 */
function readExtractedRows(sourceId) {
  const rows = [];
  for (const dir of ['', 'A', 'B', 'C', 'D']) {
    const file = path.join(EXTRACTED, dir, `${sourceId}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        rows.push({
          title: String(row.title ?? ''),
          url: String(row.url ?? ''),
          sourceUrl: String(row.sourceUrl ?? ''),
        });
      } catch {
        /* trasig rad */
      }
    }
  }
  return rows;
}

async function main() {
  const promoted = onlySources ?? (await promotedSourceIds());
  if (promoted.length === 0) {
    console.log('[audit-source-quality] inga promote:ade källor hittades');
    return;
  }

  const { data, error } = await sb
    .from('events_public')
    .select('source,title_sv,title_en,venue_full_name,description_sv,description_en,image_url')
    .in('source', promoted)
    .limit(20000);
  if (error) {
    console.error('[audit-source-quality] kunde inte läsa events_public:', error.message);
    process.exit(1);
  }

  const dbRows = data ?? [];
  const bySource = new Map();
  for (const row of dbRows) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source).push(row);
  }

  const report = [];
  for (const sourceId of promoted) {
    const sourceRows = bySource.get(sourceId) ?? [];
    if (sourceRows.length === 0) continue;

    const extracted = readExtractedRows(sourceId);
    const dbTitles = sourceRows.map((r) => r.title_sv || r.title_en || '');
    const articleTitles = dbTitles.filter((t) => classifyTitleShape(t) === 'article');

    // Signal: sidornas egna deklarationer (djup) eller titlarna (billigt).
    //
    // 2026-11-01 — `--deep` föll TYGST tillbaka på titlar för källor utan
    // extraherade rader, utan att säga det. Nu redovisas vilken signal som
    // faktiskt användes, så att "djup" i utskriften inte kan luras.
    let assessment;
    let probed = 0;
    let pagesRead = 0;
    let signal = 'titlar';
    if (deep && extracted.length > 0) {
      const signals = await probeRowPages(extracted, { limit: probeLimit });
      probed = signals.length;
      // En signal med jsonLdTypes kommer från en faktiskt läst sida; en
      // bas-signal betyder nätverksfel eller hoppad rad.
      pagesRead = signals.filter((s) => s.jsonLdTypes !== undefined).length;
      if (pagesRead > 0) {
        assessment = assessLikeness(signals);
        signal = 'sidor';
      } else {
        // Inga sidor lästes → fall tillbaka på rubrikerna. Annars skulle
        // källor vars rader pekar på listningssidan förlora sin signal
        // helt (kollaboration.se → "okänt" i djupt läge).
        assessment = assessLikeness(dbTitles.map((title) => ({ title })));
        signal = 'titlar (inga sidor lästes)';
      }
    } else {
      assessment = assessLikeness(dbTitles.map((title) => ({ title })));
      if (deep) signal = 'titlar (inga extraherade rader)';
    }

    report.push({
      sourceId,
      rows: sourceRows.length,
      verdict: assessment.verdict,
      signal,
      probedPages: probed,
      pagesRead,
      articleTitles,
      withVenue: sourceRows.filter((r) => !!r.venue_full_name).length,
      withDescription: sourceRows.filter((r) => !!(r.description_sv || r.description_en)).length,
      genericImage: sourceRows.filter((r) => /\/og-image\.(jpg|jpeg|png|webp)$/i.test(String(r.image_url ?? ''))).length,
      reasons: assessment.reasons,
    });
  }

  const rank = (v) => (v === 'article' ? 0 : v === 'unknown' ? 1 : 2);
  report.sort((a, b) => rank(a.verdict) - rank(b.verdict) || b.rows - a.rows);

  const polluted = report.filter((r) => r.verdict === 'article');
  const totalRows = report.reduce((s, r) => s + r.rows, 0);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: deep ? 'deep' : 'titles',
          sourcesAudited: report.length,
          totalRows,
          pollutedSources: polluted.length,
          report,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('═══ audit-source-quality ═══');
  console.log(`   ${new Date().toISOString()}`);
  const deepSources = report.filter((r) => r.signal === 'sidor').length;
  console.log(
    `   läge: ${deep ? `djup — ${deepSources}/${report.length} källor bedömdes på sidor` : 'titlar (billigt)'} — kör med --deep för pålitlig signal`,
  );
  console.log('');
  console.log(`  källor granskade : ${report.length}`);
  console.log(`  rader totalt     : ${totalRows}`);
  console.log(`  källor med artikel-liknande rader: ${polluted.length}`);
  console.log('');
  for (const r of report) {
    const flag = r.verdict === 'article' ? '  ✗ ARTIKEL' : r.verdict === 'event' ? '  ✓ event  ' : '  ? okänt  ';
    console.log(
      `${flag} ${r.sourceId.padEnd(26)} rader ${String(r.rows).padStart(4)} · plats ${String(r.withVenue).padStart(4)} · beskrivning ${String(r.withDescription).padStart(4)} · sidor ${r.pagesRead}/${r.probedPages} · ${r.signal}`,
    );
    if (r.verdict === 'article') {
      for (const t of r.articleTitles.slice(0, 4)) console.log(`        · "${t.slice(0, 78)}"`);
      for (const reason of r.reasons.slice(0, 3)) console.log(`        skäl: ${reason}`);
    }
  }
  console.log('');
  console.log('  Ingen data raderad. Radering är ett eget beslut.');
}

await main();
