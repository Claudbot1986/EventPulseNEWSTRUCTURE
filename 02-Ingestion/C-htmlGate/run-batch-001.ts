/**
 * C-htmlGate Batch 001 Runner
 * Kör C0→C1→C2→extract på 5 sources:
 * - lulea-tekniska-universitet
 * - moderna-museet
 * - naturhistoriska-riksmuseet
 * - orebro-sk
 * - polismuseet
 * 
 * Output: 02-Ingestion/C-htmlGate/reports/batch-001/baseline-results.jsonl
 */

import { discoverEventCandidates, screenUrl, evaluateHtmlGate } from './index';
import { extractFromHtml } from '../F-eventExtraction/extractor';
import { fetchHtml } from '../tools/fetchTools';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';

const sources = [
  { id: 'lulea-tekniska-universitet', url: 'https://www.ltu.se' },
  { id: 'moderna-museet', url: 'https://www.modernamuseet.se' },
  { id: 'naturhistoriska-riksmuseet', url: 'https://www.nrm.se' },
  { id: 'orebro-sk', url: 'https://www.orebro.se' },
  { id: 'polismuseet', url: 'https://www.polismuseet.se' },
];

const results: any[] = [];

/**
 * Add a source to D-renderGate pending queue
 */
function moveToDQueue(sourceId: string, url: string, reason: string, evidence: string) {
  const dQueuePath = '../runtime/pending_render_queue.jsonl';
  const entry = {
    sourceId,
    url,
    reason,
    evidence,
    signal: 'js_rendered_c_batch',
    confidence: 0.9,
    attemptedPaths: ['html'],
    status: 'pending_render_gate',
    detectedAt: new Date().toISOString(),
  };
  appendFileSync(dQueuePath, JSON.stringify(entry) + '\n');
  console.log(`  → Moved to D-renderGate: ${reason}`);
}

/**
 * Update sources_status to mark source as D-pending
 */
function markAsDPending(sourceId: string) {
  const statusPath = '../runtime/sources_status.jsonl';
  if (!existsSync(statusPath)) return;
  
  const lines = require('fs').readFileSync(statusPath, 'utf8').split('\n').filter(Boolean);
  const updated = lines.map(line => {
    try {
      const entry = JSON.parse(line);
      if (entry.sourceId === sourceId) {
        entry.pendingNextTool = 'D-renderGate';
        entry.status = 'pending_render_gate';
        entry.routingReason = (entry.routingReason || '') + ' | moved_to_D_renderGate';
      }
      return JSON.stringify(entry);
    } catch {
      return line;
    }
  });
  require('fs').writeFileSync(statusPath, updated.join('\n') + '\n');
}

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
      verdict: c1.categorization,
      likelyJsRendered: c1.likelyJsRendered,
      hasMain: c1.hasMain,
      timeTagCount: c1.timeTagCount,
      dateCount: c1.dateCount,
      headingCount: c1.headingCount,
      listItemCount: c1.listItemCount,
      duration: Date.now() - c1Start,
    };
    console.log(`C1: likelyJsRendered=${c1.likelyJsRendered} hasMain=${c1.hasMain} verdict=${c1.categorization} (${Date.now() - c1Start}ms)`);
    
    // Check for JS-rendered page BEFORE C2/extract
    // If likelyJsRendered AND no events found in previous attempts, move to D
    const isJsRendered = c1.likelyJsRendered || (!c1.hasMain && c1.linkCount < 5);
    
    if (isJsRendered) {
      const evidence = `C1: likelyJsRendered=${c1.likelyJsRendered}, hasMain=${c1.hasMain}, linkCount=${c1.linkCount || 0}, timeTags=${c1.timeTagCount}`;
      result.movedToD = true;
      result.moveReason = 'JS-rendered: no main element and few links';
      result.dQueueTarget = 'pending_render_queue.jsonl';
      result.dEvidence = evidence;
      
      moveToDQueue(src.id, targetUrl, 'JS-rendered page detected in C-batch', evidence);
      markAsDPending(src.id);
      
      result.success = false;
      result.extract = { eventsFound: 0, reason: 'skipped_D_render_required' };
      console.log(`  → Moved to D: JS-rendered page (hasMain=${c1.hasMain}, links=${c1.linkCount || 0})`);
      return result;
    }
    
    // C2 Gate
    const c2Start = Date.now();
    const c2 = await evaluateHtmlGate(targetUrl, 'no-jsonld', 2);
    result.c2 = {
      verdict: c2.verdict,
      score: c2.score,
      reason: c2.reason,
      markersFound: c2.markersFound,
      markerCategories: c2.markerCategories,
      candidateQuality: c2.candidateQuality,
      duration: Date.now() - c2Start,
    };
    console.log(`C2: verdict=${c2.verdict} score=${c2.score} (${Date.now() - c2Start}ms)`);
    
    // Extract
    const extStart = Date.now();
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
    console.log(`Extract: ${eventsFound} events (${Date.now() - extStart}ms)${extractError ? ` [${extractError}]` : ''}`);
    
    result.success = eventsFound > 0;
    
  } catch(e: any) {
    result.error = e.message;
    result.success = false;
    console.log(`ERROR: ${e.message}`);
  }
  
  return result;
}

async function main() {
  console.log('Starting Batch 001 baseline run...');
  
  for (const src of sources) {
    const r = await runSource(src);
    results.push(r);
  }
  
  // Save results as proper JSONL (one JSON object per line)
  const reportDir = './reports/batch-001';
  mkdirSync(reportDir, { recursive: true });
  const jsonlLines = results.map(r => JSON.stringify(r)).join('\n');
  writeFileSync(`${reportDir}/baseline-results.jsonl`, jsonlLines);
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const eventsTotal = results.reduce((sum, r) => sum + (r.extract?.eventsFound || 0), 0);
  
  console.log('\n=== BATCH 001 BASELINE SUMMARY ===');
  console.log(`Success: ${successCount}/${sources.length}`);
  console.log(`Events total: ${eventsTotal}`);
  
  for (const r of results) {
    const events = r.extract?.eventsFound || 0;
    const c2verdict = r.c2?.verdict || 'ERROR';
    const c2score = r.c2?.score || 0;
    const c0cands = r.c0?.candidates || 0;
    console.log(`  ${r.sourceId}: ${events} events, C0=${c0cands}candidates, C2=${c2verdict}(${c2score})`);
  }
}

main().catch(console.error);
