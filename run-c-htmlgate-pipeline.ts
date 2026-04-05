/**
 * C-htmlGate Pipeline Runner
 * Runs C1(screenUrl) → C2(evaluateHtmlGate) → extractFromHtml on all 10 sources
 */
import { screenUrl } from './02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate';
import { evaluateHtmlGate } from './02-Ingestion/C-htmlGate/C2-htmlGate/C2-htmlGate';
import { extractFromHtml } from './02-Ingestion/F-eventExtraction/extractor';

// Sources to test
const sources = [
  { sourceId: 'hallsberg', url: 'https://www.hallsberg.se' },
  { sourceId: 'ifk-uppsala', url: 'https://www.ifkuppsala.se' },
  { sourceId: 'karlskoga', url: 'https://www.karlskoga.se' },
  { sourceId: 'kumla', url: 'https://www.kumla.se' },
  { sourceId: 'kungliga-musikhogskolan', url: 'https://www.kmh.se' },
  { sourceId: 'lulea-tekniska-universitet', url: 'https://www.ltu.se' },
  { sourceId: 'naturhistoriska-riksmuseet', url: 'https://www.nrm.se' },
  { sourceId: 'polismuseet', url: 'https://www.polismuseet.se' },
  { sourceId: 'stockholm-jazz-festival-1', url: 'https://www.stockholmjazz.com' },
  { sourceId: 'liljevalchs-konsthall', url: 'https://www.liljevalchs.se' },
];

async function runPipeline(sourceId: string, url: string) {
  const result: any = {
    sourceId,
    url,
    c1_categorization: null,
    c1_reason: null,
    c2_verdict: null,
    c2_score: null,
    c2_reason: null,
    extract_events: 0,
    extract_rawCount: 0,
    success: false,
    error: null,
  };

  try {
    // C1: screenUrl
    const c1 = await screenUrl(url);
    result.c1_categorization = c1.categorization;
    result.c1_reason = c1.reason;

    if (!c1.fetchable || !c1.htmlBytes) {
      result.error = `C1 fetchable=false: ${c1.reason}`;
      return result;
    }

    // C2: evaluateHtmlGate - use diagnosis from C1 categorization
    const diagnosis = c1.categorization;
    const c2 = await evaluateHtmlGate(url, diagnosis, 1);
    result.c2_verdict = c2.verdict;
    result.c2_score = c2.score;
    result.c2_reason = c2.reason;

    // Extract: need HTML - fetch it again since C1/C2 may not return it
    const { fetchHtml } = await import('./02-Ingestion/tools/fetchTools');
    const htmlResult = await fetchHtml(url, { timeout: 20000 });
    if (!htmlResult.success || !htmlResult.html) {
      result.error = `Failed to fetch HTML for extraction`;
      return result;
    }

    const extract = extractFromHtml(htmlResult.html, sourceId, url);
    result.extract_events = extract.events.length;
    result.extract_rawCount = extract.rawCount;

    result.success = true;
  } catch (e) {
    result.error = (e as Error).message;
  }

  return result;
}

async function main() {
  console.error('Starting C-htmlGate pipeline on 10 sources...');
  
  for (const src of sources) {
    console.error(`\nProcessing ${src.sourceId} (${src.url})...`);
    const result = await runPipeline(src.sourceId, src.url);
    console.log(JSON.stringify(result));
  }
  
  console.error('\nDone.');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});