/**
 * C-htmlGate Batch 010 Runner
 * Kör C0→C1→C2→extract på 10 C-kandidater från batch-state.jsonl
 * 
 * Batch 010: 10 html_candidate som aldrig batchats
 * - hallsberg, ifk-uppsala, karlskoga, kumla
 * - kungliga-musikhogskolan, lulea-tekniska-universitet
 * - moderna-museet, naturhistoriska-riksmuseet, orebro-sk, polismuseet
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const sources = [
  { id: 'hallsberg', url: 'https://www.hallsberg.se' },
  { id: 'ifk-uppsala', url: 'https://www.ifkuppsala.se' },
  { id: 'karlskoga', url: 'https://www.karlskoga.se' },
  { id: 'kumla', url: 'https://www.kumla.se' },
  { id: 'kungliga-musikhogskolan', url: 'https://www.musikhogskolan.se' },
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
  console.log('Starting Batch 010 baseline run...');
  
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
  
  console.log('\n=== BATCH 010 BASELINE SUMMARY ===');
  console.log(`Success: ${successCount}/10`);
  console.log(`Events total: ${eventsTotal}`);
  
  for (const r of results) {
    const events = r.extract?.eventsFound || 0;
    const c2verdict = r.c2?.verdict || 'ERROR';
    const c2score = r.c2?.score || 0;
    const c0cands = r.c0?.candidates || 0;
    console.log(`  ${r.sourceId}: ${events} events, C0=${c0cands}candidates, C2=${c2verdict}(${c2score})`);
  }
  
  // Write batch-state update
  const batchStatePath = './reports/batch-state.jsonl';
  const batchState = JSON.parse(readFileSync(batchStatePath, 'utf-8'));
  batchState.preRunResults = {
    successCount,
    failCount: 10 - successCount,
    eventsTotal,
  };
  batchState.status = 'testing';
  writeFileSync(batchStatePath, JSON.stringify(batchState, null, 2));
  console.log(`\nBatch state updated: status=testing, preRunResults saved`);
}

main().catch(console.error);
