/**
 * C-htmlGate Batch 001 Baseline Runner
 * Kör C0→C1→C2→extract på 5 sources och sparar till batch-001.
 * 
 * Sources: hallsberg, ifk-uppsala, karlskoga, kumla, kungliga-musikhogskolan
 */

import { discoverEventCandidates } from './C0-htmlFrontierDiscovery/index.js';
import { screenUrl, evaluateHtmlGate } from './index.js';
import { extractFromHtml } from '../F-eventExtraction/extractor.js';
import { writeFileSync, mkdirSync } from 'fs';

const sources = [
  { id: 'hallsberg', url: 'https://www.hallsberg.se' },
  { id: 'ifk-uppsala', url: 'https://www.ifkuppsala.se' },
  { id: 'karlskoga', url: 'https://www.karlskoga.se' },
  { id: 'kumla', url: 'https://www.kumla.se' },
  { id: 'kungliga-musikhogskolan', url: 'https://www.kmh.se' },
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
      candidates: c0?.topCandidates?.length || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
    };
    console.log(`C0: ${c0?.topCandidates?.length || 0} candidates, winner=${c0?.winner?.url || 'none'}`);
    
    const targetUrl = c0?.winner?.url || src.url;
    
    // C1 Screen
    const c1Start = Date.now();
    const c1 = await screenUrl(targetUrl);
    result.c1 = {
      triageResult: c1.triageResult,
      likelyJsRendered: c1.likelyJsRendered,
      timeTagCount: c1.timeTagCount,
      dateCount: c1.dateCount,
      duration: Date.now() - c1Start,
    };
    console.log(`C1: likelyJsRendered=${c1.likelyJsRendered} triageResult=${c1.triageResult} (${Date.now() - c1Start}ms)`);
    
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
    const ext = await extractFromHtml(targetUrl, src.id, src.url);
    result.extract = {
      eventsFound: ext.events.length,
      duration: Date.now() - extStart,
    };
    console.log(`Extract: ${ext.events.length} events (${Date.now() - extStart}ms)`);
    
    result.success = ext.events.length > 0;
    
  } catch(e: any) {
    result.error = e.message;
    result.success = false;
    console.log(`ERROR: ${e.message}`);
  }
  
  return result;
}

async function main() {
  console.log('Starting Batch 001 baseline run (5 sources)...');
  
  for (const src of sources) {
    const r = await runSource(src);
    results.push(r);
  }
  
  // Save results to batch-001
  const reportDir = './reports/batch-001';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/baseline-results.jsonl`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${reportDir}/baseline-results.jsonl`);
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const eventsTotal = results.reduce((sum, r) => sum + (r.extract?.eventsFound || 0), 0);
  
  console.log('\n=== BATCH 001 BASELINE SUMMARY ===');
  console.log(`Success: ${successCount}/5`);
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
      c1Result: r.c1?.triageResult || 'error',
      c2Score: r.c2?.score || 0,
      extractionSuccess: r.success || false,
    })),
    successCount,
    failCount: 5 - successCount,
    eventsTotal,
  };
  
  console.log('\n=== JSON OUTPUT ===');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
