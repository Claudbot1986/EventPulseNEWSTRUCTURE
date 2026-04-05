/**
 * C-htmlGate Batch 002 Runner
 * Kör C0→C1→C2→extract på alla 10 sources i Batch 2
 */

import { discoverEventCandidates } from './C0-htmlFrontierDiscovery';
import { screenUrl } from './C1-preHtmlGate/C1-preHtmlGate';
import { evaluateHtmlGate } from './C2-htmlGate/C2-htmlGate';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { writeFileSync, mkdirSync } from 'fs';

const sources = [
  { id: 'friidrottsf-rbundet', url: 'https://www.friidrott.se' },
  { id: 'malmo-opera', url: 'https://www.malmöopera.se' },
  { id: 'allt-om-mat', url: 'https://www.alltommat.se' },
  { id: 'arbetsam', url: 'https://www.arbetam.se' },
  { id: 'artipelag', url: 'https://www.artipelag.se' },
  { id: 'a6', url: 'https://www.centeraj6.se' },
  { id: 'abb-arena', url: 'https://www.abb-arena.se' },
  { id: 'af', url: 'https://www.af.lu.se' },
  { id: 'avicii-arena-sport', url: 'https://www.aviciiarena.se' },
  { id: 'avicii-arena', url: 'https://aviciiarena.se' },
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
    console.log(`C1: likelyJsRendered=${c1.likelyJsRendered} verdict=${c1.verdict} (${c1Start}ms)`);
    
    // C2 Gate
    const c2Start = Date.now();
    const c2 = await evaluateHtmlGate(targetUrl, 'no-jsonld', 2);
    result.c2 = {
      verdict: c2.verdict,
      score: c2.score,
      reason: c2.reason,
      duration: Date.now() - c2Start,
    };
    console.log(`C2: verdict=${c2.verdict} score=${c2.score} (${c2Start}ms)`);
    
    // Extract
    const extStart = Date.now();
    const ext = await extractFromHtml(targetUrl, src.id, src.url);
    result.extract = {
      eventsFound: ext.events.length,
      duration: Date.now() - extStart,
    };
    console.log(`Extract: ${ext.events.length} events (${extStart}ms)`);
    
    result.success = ext.events.length > 0;
    
  } catch(e) {
    result.error = e.message;
    result.success = false;
    console.log(`ERROR: ${e.message}`);
  }
  
  return result;
}

async function main() {
  console.log('Starting Batch 002 baseline run...');
  
  for (const src of sources) {
    const r = await runSource(src);
    results.push(r);
  }
  
  // Save results
  const reportDir = './reports/batch-002';
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/batch-002-baseline-results.jsonl`, JSON.stringify(results, null, 2));
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const eventsTotal = results.reduce((sum, r) => sum + (r.extract?.eventsFound || 0), 0);
  
  console.log('\n=== BATCH 002 BASELINE SUMMARY ===');
  console.log(`Success: ${successCount}/10`);
  console.log(`Events total: ${eventsTotal}`);
  
  for (const r of results) {
    const events = r.extract?.eventsFound || 0;
    const c2verdict = r.c2?.verdict || 'ERROR';
    const c2score = r.c2?.score || 0;
    console.log(`  ${r.sourceId}: ${events} events, C2=${c2verdict}(${c2score})`);
  }
}

main().catch(console.error);
