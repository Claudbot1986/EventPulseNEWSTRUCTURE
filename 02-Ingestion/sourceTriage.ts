/**
 * Source Triage — Phase 1 Orchestrator
 *
 * Läser en batch av URLs, kör Phase 1 diagnostik på varje,
 * sätter diagnosis + next_path, sparar resultat,
 * och extraherar godkända kandidater för nästa steg.
 *
 * Network Gate (GotEvent Model) inkorporerat:
 * - no-jsonld / wrong-type sources körs genom evaluateNetworkGate
 * - Routing: JSON-LD → Network → HTML → Render → Blocked/Review
 * - GotEvent lesson: "network signals" ≠ "usable event data"
 * - Model status: prelim_1src (validerad mot en källa)
 *
 * Usage:
 *   npx tsx 02-Ingestion/sourceTriage.ts
 *   npx tsx 02-Ingestion/sourceTriage.ts --batch diagnostic-batch.txt
 *   npx tsx 02-Ingestion/sourceTriage.ts --batch diagnostic-batch.txt --out triage-run-1
 *   npx tsx 02-Ingestion/sourceTriage.ts --batch x.txt --phase 1  (sanity mode)
 *   npx tsx 02-Ingestion/sourceTriage.ts --batch x.txt --phase 2  (breadth mode, default)
 *   npx tsx 02-Ingestion/sourceTriage.ts --batch x.txt --phase 3  (smoke mode)
 */

import { diagnoseUrl, type DiagnosticResult } from '../01-Sources/diagnostics/jsonLdDiagnostic';
import { evaluateNetworkGate } from './B-JSON-feedGate/A-networkGate';
import { discoverEventCandidates, type FrontierDiscoveryResult } from './C-htmlGate/C0-htmlFrontierDiscovery';
import { screenUrl } from './C-htmlGate/C1-preHtmlGate/C1-preHtmlGate';
import { evaluateHtmlGate } from './C-htmlGate/C2-htmlGate/C2-htmlGate';
import { extractFromHtml } from './F-eventExtraction/extractor';
import { readFileSync, writeFileSync } from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

type NextPath = 'normalizer_candidate' | 'network' | 'html-heuristics' | 'manual-review';

interface TriageResult {
  url: string;
  timestamp: string;
  diagnosis: string;
  next_path: NextPath;
  events_extracted: number;
  found_types: string[];
  html_bytes: number | null;
  reason: string;
  approved: boolean;
  network_gate?: {
    modelStatus: 'prelim_1src';
    networkSignalsFound: boolean;
    openEventDataAccessible: boolean;
    phaseMode: number;
  };
}

// ─── Map diagnosis → next_path ──────────────────────────────────────────────

function computeNextPath(
  r: DiagnosticResult,
  networkGateResult?: { nextPath: string; openEventDataAccessible: boolean }
): NextPath {
  if (r.diagnosis === 'success') {
    return 'normalizer_candidate';
  }

  if (r.diagnosis === 'no-jsonld' || r.diagnosis === 'wrong-type') {
    if (networkGateResult?.nextPath === 'network' && networkGateResult.openEventDataAccessible) {
      return 'network';
    }
    return 'html-heuristics';
  }

  return 'manual-review';
}

// ─── HTML Discovery + Gate Chain ─────────────────────────────────────────────

interface HtmlDiscoveryResult {
  url: string;
  discovery: FrontierDiscoveryResult | null;
  preGateUrl: string;
  preGate: Awaited<ReturnType<typeof screenUrl>> | null;
  gateResult: Awaited<ReturnType<typeof evaluateHtmlGate>> | null;
  eventsExtracted: number;
  success: boolean;
  reason: string;
}

/**
 * Run C0 (Discovery) → C1 (Screen) → C2 (Gate) on a URL.
 * Uses discovered best candidate if available, falls back to root.
 */
async function runHtmlDiscovery(rootUrl: string, diagnosis: string, phaseMode: 1 | 2 | 3): Promise<HtmlDiscoveryResult> {
  // Step 1: C0 - Discover internal event candidates
  let discovery: FrontierDiscoveryResult | null = null;
  let targetUrl = rootUrl;

  try {
    discovery = await discoverEventCandidates(rootUrl);
    if (discovery?.winner) {
      targetUrl = discovery.winner.url;
      console.log(`       [C0] discovered → ${discovery.winner.href} (density=${discovery.winner.eventDensityScore})`);
    } else {
      console.log(`       [C0] no better candidate found, using root`);
    }
  } catch (err) {
    console.log(`       [C0] discovery failed: ${err}`);
  }

  // Step 2: C1 - Quick screen of target URL
  let preGate = null;
  try {
    preGate = await screenUrl(targetUrl);
  } catch (err) {
    console.log(`       [C1] screen failed: ${err}`);
  }

  // Step 3: C2 - Weighted gate evaluation
  let gateResult = null;
  try {
    gateResult = await evaluateHtmlGate(targetUrl, diagnosis, phaseMode);
  } catch (err) {
    console.log(`       [C2] gate failed: ${err}`);
  }

  // Step 4: Extract events if gate approved
  let eventsExtracted = 0;
  let success = false;
  let reason = '';

  if (gateResult?.verdict === 'promising') {
    // Extract events from the discovered page
    const { fetchHtml } = await import('./tools/fetchTools');
    const fetchResult = await fetchHtml(targetUrl, { timeout: 15000 });
    if (fetchResult.success && fetchResult.html) {
      const extractResult = extractFromHtml(fetchResult.html, 'html-discovery', targetUrl);
      eventsExtracted = extractResult.events.length;
      success = eventsExtracted > 0;
      reason = success
        ? `extracted ${eventsExtracted} events from ${targetUrl}`
        : `gate=promising but 0 events from ${targetUrl}`;
    }
  } else if (gateResult?.verdict === 'weak') {
    reason = `gate=weak for ${targetUrl}`;
  } else if (gateResult?.verdict === 'blocked') {
    reason = `gate=blocked for ${targetUrl}`;
  } else {
    reason = gateResult ? `gate=${gateResult.verdict} for ${targetUrl}` : `gate skipped for ${targetUrl}`;
  }

  return {
    url: targetUrl,
    discovery,
    preGateUrl: targetUrl,
    preGate,
    gateResult,
    eventsExtracted,
    success,
    reason,
  };
}

// ─── Triage a single URL ────────────────────────────────────────────────────

async function triageUrl(url: string, phaseMode: 1 | 2 | 3 = 2): Promise<TriageResult> {
  const r = await diagnoseUrl(url);

  let networkGateResult;
  if (r.diagnosis === 'no-jsonld' || r.diagnosis === 'wrong-type') {
    networkGateResult = await evaluateNetworkGate(url, r.diagnosis, phaseMode);
  }

  const next_path = computeNextPath(r, networkGateResult);

  // Run HTML discovery chain for no-jsonld / wrong-type sources
  // Compare HTML discovery result with network path to choose best
  let events_extracted = r.extractorResult.eventsExtracted;
  let html_discovery: HtmlDiscoveryResult | null = null;

  if (r.diagnosis === 'no-jsonld' || r.diagnosis === 'wrong-type') {
    try {
      html_discovery = await runHtmlDiscovery(url, r.diagnosis, phaseMode);
      if (html_discovery.success) {
        events_extracted = html_discovery.eventsExtracted;
      }
    } catch (err) {
      console.log(`       [html-discovery] error: ${err}`);
    }
  }

  return {
    url,
    timestamp: new Date().toISOString(),
    diagnosis: r.diagnosis,
    next_path,
    events_extracted,
    found_types: r.foundTypes,
    html_bytes: r.htmlSize ?? null,
    reason: html_discovery?.reason ?? r.reason,
    approved: next_path === 'normalizer_candidate' || (next_path === 'html-heuristics' && html_discovery?.success),
    network_gate: networkGateResult ? {
      modelStatus: networkGateResult.modelStatus,
      networkSignalsFound: networkGateResult.networkSignalsFound,
      openEventDataAccessible: networkGateResult.openEventDataAccessible,
      phaseMode: networkGateResult.phaseMode,
    } : undefined,
  };
}

// ─── Run batch ─────────────────────────────────────────────────────────────

async function runBatch(urls: string[], batchId: string, phaseMode: 1 | 2 | 3): Promise<TriageResult[]> {
  const results: TriageResult[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url || url.startsWith('#')) continue;

    process.stdout.write(`[${i + 1}/${urls.length}] ${url} ... `);
    try {
      const r = await triageUrl(url, phaseMode);
      results.push(r);
      const icon = r.approved ? '✅' : r.diagnosis === 'no-jsonld' ? '📭' : r.diagnosis === 'wrong-type' ? '🏷️' : r.diagnosis === 'fetch-failed' ? '❌' : '⚠️';
      const ngInfo = r.network_gate ? ` [${r.network_gate.networkSignalsFound ? 'signals' : 'no-signals'}, ${r.network_gate.openEventDataAccessible ? 'open' : 'blocked'}]` : '';
      console.log(`${icon} ${r.diagnosis} → ${r.next_path}${ngInfo}`);
      if (r.network_gate && r.next_path !== 'normalizer_candidate') {
        console.log(`       ↳ network-gate: ${r.reason.substring(0, 80)}`);
      }
    } catch (err) {
      console.log(`❌ error: ${err}`);
      results.push({
        url,
        timestamp: new Date().toISOString(),
        diagnosis: 'fetch-failed',
        next_path: 'manual-review',
        events_extracted: 0,
        found_types: [],
        html_bytes: null,
        reason: String(err),
        approved: false,
      });
    }
  }

  return results;
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(results: TriageResult[], batchId: string) {
  const counts: Record<string, number> = {};
  const nextCounts: Record<string, number> = {};
  const networkSignals = { found: 0, open: 0, blocked: 0 };

  for (const r of results) {
    counts[r.diagnosis] = (counts[r.diagnosis] ?? 0) + 1;
    nextCounts[r.next_path] = (nextCounts[r.next_path] ?? 0) + 1;
    if (r.network_gate) {
      networkSignals.found++;
      if (r.network_gate.openEventDataAccessible) networkSignals.open++;
      else networkSignals.blocked++;
    }
  }

  console.log('\n═══ PHASE 1 TRIAGE SUMMARY ═══');
  console.log(`Batch: ${batchId}`);
  console.log(`Total: ${results.length}`);
  console.log('\n─── Diagnosis ───');
  for (const [k, v] of Object.entries(counts)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }
  console.log('\n─── Next path ───');
  for (const [k, v] of Object.entries(nextCounts)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }
  if (networkSignals.found > 0) {
    console.log('\n─── Network Gate (GotEvent Model, prelim_1src) ───');
    console.log(`  signals found: ${networkSignals.found} (of which open: ${networkSignals.open}, blocked: ${networkSignals.blocked})`);
  }

  const approved = results.filter(r => r.approved);
  console.log(`\n─── Approved for next step: ${approved.length} ───`);
  if (approved.length > 0) {
    for (const a of approved) {
      console.log(`  ✅ ${a.url} (${a.events_extracted} events)`);
    }
  } else {
    console.log('  (inga godkända i denna batch)');
  }
}

// ─── Save results ───────────────────────────────────────────────────────────

function saveResults(results: TriageResult[], batchId: string) {
  const ts = new Date().toISOString().slice(0, 10);
  const prefix = `phase1-triage-${batchId}-${ts}`;

  const logFile = `${prefix}.jsonl`;
  writeFileSync(logFile, results.map(r => JSON.stringify(r)).join('\n'));
  console.log(`\n💾 Full log: ${logFile}`);

  const approved = results.filter(r => r.approved);
  const approvedFile = `phase1-approved-${batchId}-${ts}.jsonl`;
  writeFileSync(approvedFile, approved.map(r => JSON.stringify(r)).join('\n'));
  console.log(`💾 Approved: ${approvedFile}`);

  const summaryFile = `${prefix}-summary.json`;
  const counts: Record<string, number> = {};
  const nextCountsSummary: Record<string, number> = {};
  let networkGateStats: { signalsFound: number; openAccessible: number; blocked: number } | null = null;
  for (const r of results) {
    counts[r.diagnosis] = (counts[r.diagnosis] ?? 0) + 1;
    nextCountsSummary[r.next_path] = (nextCountsSummary[r.next_path] ?? 0) + 1;
    if (r.network_gate) {
      if (!networkGateStats) networkGateStats = { signalsFound: 0, openAccessible: 0, blocked: 0 };
      networkGateStats.signalsFound++;
      if (r.network_gate.openEventDataAccessible) networkGateStats.openAccessible++;
      else networkGateStats.blocked++;
    }
  }
  writeFileSync(summaryFile, JSON.stringify({
    batchId,
    timestamp: new Date().toISOString(),
    total: results.length,
    diagnosis_counts: counts,
    next_path_counts: nextCountsSummary,
    approved_count: approved.length,
    approved_urls: approved.map(a => a.url),
    network_gate: networkGateStats ? {
      model: 'prelim_1src',
      ...networkGateStats,
    } : null,
  }, null, 2));
  console.log(`💾 Summary: ${summaryFile}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let batchFile = 'diagnostic-batch.txt';
  let batchId = 'batch-v1';
  let phaseMode: 1 | 2 | 3 = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      batchFile = args[i + 1];
      batchId = batchFile.replace('.txt', '').replace('diagnostic-', '').replace(/\//g, '_');
      i++;
    } else if (args[i] === '--phase' && args[i + 1]) {
      const p = parseInt(args[i + 1], 10);
      if (p === 1 || p === 2 || p === 3) {
        phaseMode = p as 1 | 2 | 3;
      }
      i++;
    }
  }

  const phaseLabel = phaseMode === 1 ? 'sanity' : phaseMode === 2 ? 'breadth' : 'smoke';
  console.log(`═══ SOURCE TRIAGE — Phase 1 ═══`);
  console.log(`Batch file: ${batchFile}`);
  console.log(`Phase mode: ${phaseLabel} (${phaseMode})`);
  console.log(`Network Gate: GotEvent Model (prelim_1src)\n`);

  const urlContent = readFileSync(batchFile, 'utf-8');
  const urls = urlContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  console.log(`URLs to triage: ${urls.length}\n`);

  const results = await runBatch(urls, batchId, phaseMode);
  printSummary(results, batchId);
  saveResults(results, batchId);
}

main().catch(console.error);
