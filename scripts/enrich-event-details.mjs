#!/usr/bin/env node
/**
 * enrich-event-details — berika extraherade event med information från
 * EVENEMANGSSIDAN, inte bara biljettkortet.
 *
 * Användarens iakttagelse (2026-11-01): "info om eventet kan även ligga
 * utanför självaste biljettkortet på en hemsida. … ibland kanske vi hittar
 * bara biljettkortet (där oftast mindre info finns)".
 *
 * Mätt på de 154 rader discovery-källorna lade in: 18 % hade plats, 0 % hade
 * beskrivning. Mätt på 353 extraherade rader: 84 % pekar på en detaljsida vi
 * redan känner till, 50 % saknar samtidigt plats — och detaljsidan bär
 * beskrivningen (se 02-Ingestion/tools/detailEnrichment.ts för beviset).
 *
 * Det här steget:
 *   1. läser de extraherade eventfilerna,
 *   2. för varje rad som pekar på en detaljsida och saknar uppgifter →
 *      hämtar sidan,
 *   3. fyller BARA saknade fält (beskrivning, plats, bild, starttid),
 *   4. sparar tillbaka — och skriver aldrig över ett värde som redan finns.
 *
 * Det hittar INGA på uppgifter. Varje fält kommer från sidans eget innehåll.
 *
 * Användning:
 *   npx tsx scripts/enrich-event-details.mjs --dry-run
 *   npx tsx scripts/enrich-event-details.mjs --per-source 25 --global 300
 *
 * `npx tsx` krävs — skriptet importerar .ts-moduler direkt.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const { enrichExtractedRows } = await import(
  path.join(PROJECT_ROOT, '02-Ingestion/tools/detailEnrichment.ts')
);

const args = process.argv.slice(2);
const num = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const perSourceLimit = num('--per-source', 25);
const globalLimit = num('--global', 300);

console.log('═══ enrich-event-details ═══');
console.log(`   ${new Date().toISOString()}`);
console.log(
  `   per källa: ${perSourceLimit} · globalt: ${globalLimit}${dryRun ? ' · DRY-RUN (skriver inte)' : ''}`,
);

const result = await enrichExtractedRows({
  projectRoot: PROJECT_ROOT,
  perSourceLimit,
  globalLimit,
  dryRun,
  verbose,
});

console.log('');
console.log(`  filer genomskummade : ${result.filesScanned}`);
console.log(`  rader granskade    : ${result.rowsScanned}`);
console.log(`  rader hämtade      : ${result.rowsFetched}`);
console.log(`  rader berikade     : ${result.rowsEnriched}`);
console.log(`  rader hoppade över : ${result.rowsSkipped}`);
console.log(`  hämtningar misslyckade: ${result.rowsFailed}`);
console.log('');
console.log(`  fält ifyllda: ${JSON.stringify(result.fieldsFilled)}`);
console.log(`  sidor som deklarerar artikel : ${result.pagesDeclaredArticle}`);
console.log(`  sidor som deklarerar evenemang: ${result.pagesDeclaredEvent}`);

if (result.samples.length > 0) {
  console.log('');
  console.log('  exempel:');
  for (const s of result.samples.slice(0, 8)) {
    console.log(`    · ${s.sourceId}: "${s.title.slice(0, 48)}" → ${s.filled.join(', ')}`);
  }
}

console.log('');
console.log(dryRun ? '  DRY-RUN klar — inga filer skrivna' : '  klar');
