/**
 * C-htmlGate Full Pipeline: C0 → C1 → C2 → extract
 * Runs all 4 stages and outputs JSONL per source.
 */
import { discoverEventCandidates } from './02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.js';
import { screenUrl } from './02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { evaluateHtmlGate } from './02-Ingestion/C-htmlGate/C2-htmlGate/C2-htmlGate.js';
import { extractFromHtml } from './02-Ingestion/F-eventExtraction/extractor.js';
import { fetchHtml } from './02-Ingestion/tools/fetchTools.js';

const SOURCES = [
  { sourceId: 'hallsberg',                    url: 'https://www.hallsberg.se' },
  { sourceId: 'ifk-uppsala',                  url: 'https://www.ifku.se' },
  { sourceId: 'karlskoga',                    url: 'https://www.karlskoga.se' },
  { sourceId: 'kumla',                        url: 'https://www.kumla.se' },
  { sourceId: 'kungliga-musikhogskolan',      url: 'https://www.kth.se' },
  { sourceId: 'lulea-tekniska-universitet',   url: 'https://www.ltu.se' },
  { sourceId: 'naturhistoriska-riksmuseet',   url: 'https://www.nrm.se' },
  { sourceId: 'polismuseet',                  url: 'https://www.polismuseet.se' },
  { sourceId: 'stockholm-jazz-festival-1',    url: 'https://www.stockholmjazzfestival.se' },
  { sourceId: 'liljevalchs-konsthall',        url: 'https://www.liljevalchs.se' },
];

async function pipeline(sourceId: string, url: string) {
  const out: any = {
    sourceId,
    url,
    c0_totalInternalLinks: 0,
    c0_candidatesFound: 0,
    c0_winnerUrl: null,
    c0_eventDensityScore: 0,
    c0_rootRejected: false,
    c0_failureMode: null,
    c1_categorization: null,
    c1_reason: null,
    c1_fetchable: false,
    c1_failureMode: null,
    c2_verdict: null,
    c2_score: 0,
    c2_reason: null,
    c2_failureMode: null,
    extract_events: 0,
    extract_rawCount: 0,
    extract_failureMode: null,
    pipeline_success: false,
  };

  // ── C0 ──────────────────────────────────────────────────────────────────
  try {
    const c0 = await discoverEventCandidates(url);
    out.c0_totalInternalLinks = c0.totalInternalLinks;
    out.c0_candidatesFound = c0.candidatesFound;
    out.c0_winnerUrl = c0.winner?.url ?? null;
    out.c0_eventDensityScore = c0.winner?.eventDensityScore ?? 0;
    out.c0_rootRejected = c0.rootRejected;
  } catch (e: any) {
    out.c0_failureMode = (e as Error).message;
  }

  // ── C1 ──────────────────────────────────────────────────────────────────
  try {
    const c1 = await screenUrl(url);
    out.c1_fetchable = c1.fetchable;
    out.c1_categorization = c1.categorization;
    out.c1_reason = c1.reason;
    if (!c1.fetchable) {
      out.c1_failureMode = c1.fetchError ?? 'unfetchable';
    }
  } catch (e: any) {
    out.c1_failureMode = (e as Error).message;
  }

  if (!out.c1_fetchable) {
    console.log(JSON.stringify(out));
    return;
  }

  // ── C2 ──────────────────────────────────────────────────────────────────
  try {
    // Use 'strong' as diagnosis since we don't have JSON-LD context here
    const c2 = await evaluateHtmlGate(url, 'strong', 2);
    out.c2_verdict = c2.verdict;
    out.c2_score = c2.score;
    out.c2_reason = c2.reason;
  } catch (e: any) {
    out.c2_failureMode = (e as Error).message;
  }

  // ── extract ─────────────────────────────────────────────────────────────
  try {
    const htmlResult = await fetchHtml(url, { timeout: 20000 });
    if (!htmlResult.success || !htmlResult.html) {
      out.extract_failureMode = 'fetch-failed';
      console.log(JSON.stringify(out));
      return;
    }
    const ext = extractFromHtml(htmlResult.html, sourceId, url);
    out.extract_events = ext.events.length;
    out.extract_rawCount = ext.rawCount;
  } catch (e: any) {
    out.extract_failureMode = (e as Error).message;
  }

  out.pipeline_success = true;
  console.log(JSON.stringify(out));
}

async function main() {
  for (const src of SOURCES) {
    await pipeline(src.sourceId, src.url);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
