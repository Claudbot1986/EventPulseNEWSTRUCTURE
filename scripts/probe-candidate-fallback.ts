/**
 * probe-candidate-fallback.ts — mät om C0:s NÄSTA kandidat ger events när
 * vinnaren faller.
 *
 * Bakgrund: C-htmlGate väljer EN kandidat (c0.winner) och ger upp om C1/C2
 * underkänner den. C0 returnerar dock hela den rankade listan
 * (topCandidates). Frågan: hur många källor som står fast i dag hade gett
 * events om vi prövat nästa kandidat?
 *
 * Detta är ett MÄTSCRIPT — det ändrar ingen produktionskod. Det kör samma
 * kodvägar som gaten (C0 discovery → C1 screen → universal-extractor).
 *
 * Användning:
 *   npx tsx scripts/probe-candidate-fallback.ts --sources a,b,c
 *   npx tsx scripts/probe-candidate-fallback.ts --sources a,b,c --max-candidates 4
 */

import { discoverEventCandidates } from '../02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.js';
import { screenUrl } from '../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { extractFromHtml } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';
import { getSource } from '../02-Ingestion/tools/sourceRegistry.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--sources');
const sources = idx >= 0 ? (args[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
const maxIdx = args.indexOf('--max-candidates');
const MAX_CANDIDATES = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 3;

if (sources.length === 0) {
  console.error('Ange --sources a,b,c');
  process.exit(2);
}

for (const sourceId of sources) {
  const source = getSource(sourceId);
  if (!source) {
    console.log(`\n### ${sourceId}: HITTADES INTE i registret`);
    continue;
  }
  console.log(`\n### ${sourceId} — ${source.url}`);

  const c0 = await discoverEventCandidates(source.url, undefined, sourceId);
  const candidates = c0.topCandidates || [];
  console.log(`C0: ${c0.candidatesFound} kandidater, vinnare=${c0.winner?.url || 'ingen'}`);
  console.log(`    vinnareReason: ${c0.winnerReason}`);

  const ordered = [c0.winner, ...candidates.filter((c) => c.url !== c0.winner?.url)]
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, MAX_CANDIDATES);

  for (let i = 0; i < ordered.length; i++) {
    const cand = ordered[i];
    const c1 = await screenUrl(cand.url);
    const isWinner = cand.url === c0.winner?.url;
    let events = 0;
    let methods = '';
    try {
      const res = extractFromHtml((c1 as any).html || '', sourceId, cand.url);
      events = res.eventsFound;
      methods = (res.methodsUsed || []).join(',');
    } catch (e) {
      methods = `fel: ${(e as Error).message.slice(0, 60)}`;
    }
    console.log(
      `  [${i}]${isWinner ? ' VINNARE' : ' alternativ'} ${cand.url}\n` +
        `      density=${cand.eventDensityScore} c1=${(c1 as any).categorization} likelyJs=${(c1 as any).likelyJsRendered} ` +
        `events=${events} methods=[${methods}]`,
    );
  }
}
