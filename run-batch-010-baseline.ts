/**
 * C-htmlGate Batch 10 Baseline Runner
 * Kör C0→C1→C2→extract på 10 sources och rapporterar baseline-resultat.
 * 
 * Sources: hallsberg, ifk-uppsala, karlskoga, kumla, kungliga-musikhogskolan,
 *          lulea-tekniska-universitet, moderna-museet, naturhistoriska-riksmuseet,
 *          orebro-sk, polismuseet
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './02-Ingestion/C-htmlGate/index.js';
import { extractFromHtml } from './02-Ingestion/F-eventExtraction/index.js';
import { fetchHtml } from './02-Ingestion/tools/fetchTools.js';
import { writeFileSync, mkdirSync } from 'fs';

const sources = [
  { id: 'hallsberg', url: 'https://www.hallsberg.se' },
  { id: 'ifk-uppsala', url: 'https://www.ifkuppsala.se' },
  { id: 'karlskoga', url: 'https://www.karlskoga.se' },
  { id: 'kumla', url: 'https://www.kumla.se' },
  { id: 'kungliga-musikhogskolan', url: 'https://www.kmh.se' },
  { id: 'lulea-tekniska-universitet', url: 'https://www.ltu.se' },
  { id: 'moderna-museet', url: 'https://www.modernamuseet.se' },
  { id: 'naturhistoriska-riksmuseet', url: 'https://www.nrm.se' },
  { id: 'orebro-sk', url: 'https://www.orebro.se' },
  { id: 'polismuseet', url: 'https://www.polismuseet.se' },
];

const results: any[] = [];

async function runSource(src: { id: string; url: string }) {
  console.log(`\n=== ${src.id} ===`);
  const result: any = { sourceId: src.id, url: src.url };
  
  try {
    // C0 Discovery
    const c0Start = Date.now();
    const c0 = await discoverEventCandidates(src.url);
    result.c0 = {
      candidates: c0?.candidates?.length || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
    };
    console.log(`C0: ${c0?.candidates?.length || 0} candidates, winner=${c0?.winner?.url || 'none'}`);
    
    const targetUrl = c0?.winner?.url || src.url;
    
    // C1 Screen
    const c1Start = Date.now();
    const c1 = await screenUrl(targetUrl);
    result.c1 = {
      verdict: c1.verdict,
      likelyJsRendered: c1.likelyJsRendered,
      timeTagCount: c1.timeTagCount,
      dateCount: c1.dateCount,
      duration: Date.now() - c1Start,
    };
    console.log(`C1: likelyJsRendered=${c1.likelyJsRendered} verdict=${c1.verdict} (${Date.now() - c1Start}ms)`);
    
    // C2 Gate
    const c2Start = Date.now();
    const c2 = await evaluateHtmlGate(targetUrl, 'no-jsonld', 2);
    result.c2 = {
      verdict: c2.verdict,
      score: c2.score,
      reason: c2.reason,
      duration: Date.now() - c2Start,
    };
    console.log(`C2: verdict=${c2.verdict} score=${c2.score} (${Date.now() - c2Start}ms)`);
    
    // Extract
    const extStart = Date.now();
    // Fetch HTML first, then extract from actual HTML content
    const htmlResult = await fetchHtml(targetUrl);
    let eventsFound = 0;
    let extractError = null;
    if (htmlResult.success && htmlResult.html) {
      const ext = extractFromHtml(htmlResult.html, src.id, src.url);
      eventsFound = ext.events.length;
    } else {
      extractError = htmlResult.error || 'fetch failed';
    }
    result.extract = {
      eventsFound,
      fetchError: extractError,
      duration: Date.now() - extStart,
    };
    console.log(`Extract: ${eventsFound} events (${Date.now() - extStart}ms)${extractError ? ` [fetch error: ${extractError}]` : ''}`);
    
    result.success = eventsFound > 0;
    
  } catch(e: any) {
    result.error = e.message;
    result.success = false;
    console.log(`ERROR: ${e.message}`);
  }
  
  return result;
}

async function main() {
  console.log('Starting Batch 10 baseline run...');
  
  for (const src of sources) {
    const r = await runSource(src);
    results.push(r);
  }
  
  // Save results
  const reportDir = './reports/batch-010';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/batch-010-baseline-results.jsonl`, JSON.stringify(results, null, 2));
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const eventsTotal = results.reduce((sum, r) => sum + (r.extract?.eventsFound || 0), 0);
  
  console.log('\n=== BATCH 10 BASELINE SUMMARY ===');
  console.log(`Success: ${successCount}/10`);
  console.log(`Events total: ${eventsTotal}`);
  
  for (const r of results) {
    const events = r.extract?.eventsFound || 0;
    const c2verdict = r.c2?.verdict || 'ERROR';
    const c2score = r.c2?.score || 0;
    const c0cands = r.c0?.candidates || 0;
    console.log(`  ${r.sourceId}: ${events} events, C0=${c0cands}candidates, C2=${c2verdict}(${c2score})`);
  }
  
  // Output final JSON for parent agent
  const output = {
    sourceResults: results.map(r => ({
      source: r.sourceId,
      eventsFound: r.extract?.eventsFound || 0,
      c0Candidates: r.c0?.candidates || 0,
      c1Result: r.c1?.verdict || 'error',
      c2Score: r.c2?.score || 0,
      extractionSuccess: r.success || false,
    })),
    successCount,
    failCount: 10 - successCount,
    eventsTotal,
  };
  
  console.log('\n=== JSON OUTPUT ===');
  console.log(JSON.stringify(output, null, 2));
  
  writeFileSync(`${reportDir}/batch-010-summary.json`, JSON.stringify(output, null, 2));
}

main().catch(console.error);