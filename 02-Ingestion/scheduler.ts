/**
 * Source Scheduler — kör sources i prioritetsordning
 * 
 * SEKVENTIELL TESTLOGIK (A→B→C→D→E):
 *   1. A-JSONLD  → Testa alltid först (oavsett preferredPath)
 *   2. B-Network → Testa om A misslyckades
 *   3. C-HTML     → Testa om B misslyckades (med C1 screening)
 *   4. D-queue    → Om C1 säger render_candidate → skicka till D-queue (INTE kör render)
 *   5. E-Manual   → Om allt annat misslyckades → manuell fallback
 * 
 * VIKTIGT: D-renderGate körs INTE aktivt ännu. D betyder "identifierad som
 * render-behövande och skickad till kö för senare D-arbete".
 * 
 * Usage:
 *   npx tsx 02-Ingestion/scheduler.ts              # kör nästa i prioritetskön
 *   npx tsx 02-Ingestion/scheduler.ts --all        # kör alla (ignorerar kö)
 *   npx tsx 02-Ingestion/scheduler.ts --recheck     # recheck alla oavsett lastRun
 *   npx tsx 02-Ingestion/scheduler.ts --source <id> # kör en specifik source
 *   npx tsx 02-Ingestion/scheduler.ts --rebuild    # återuppbygga prioritetskön
 *   npx tsx 02-Ingestion/scheduler.ts --status     # visa status för alla sources
 *   npx tsx 02-Ingestion/scheduler.ts --pending    # visa pending_render_queue
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import {
  getAllSources,
  getSourceStatus,
  getAllStatuses,
  updateSourceStatus,
  addToPriorityQueue,
  getNextInQueue,
  removeFromQueue,
  rebuildPriorityQueue,
  getSource,
  recordTriageAttempt,
  type SourceTruth,
  type SourceStatus,
  type TriageAttempt,
} from './tools/sourceRegistry';
import { addPendingRender, getPendingRenders } from './tools/pendingRenderQueue';
import { screenUrl, determineTriageOutcome } from './C-htmlGate/C1-preHtmlGate/C1-preHtmlGate';
import type { TriageResult } from './C-htmlGate/C1-preHtmlGate/C1-preHtmlGate';
import { inspectUrl } from './B-networkGate/networkInspector';
import { evaluateNetworkGate } from './B-networkGate/A-networkGate';
import { extractFromApi } from './B-networkGate/networkEventExtractor';
// D-renderGate: renderPage FINNS men KÖRS INTE ännu.
// Denna import är kvar för framtida integration men är inaktiv just nu.

// ─── Routing Decision Types ────────────────────────────────────────────────────

export type PathType = 'api' | 'jsonld' | 'html' | 'network' | 'render' | 'unknown';
// D-renderGate är inte integrerad ännu.
export type ExecuteNow = 'execute_now' | 'park_pending_render' | 'skip_not_implemented' | 'execute_network' | 'queue_render_only';

// queue_render_only betyder: lägg endast i pending_render_queue
// D-renderGate KÖRS INTE — detta är endast en kö för framtida render-arbete

export interface RoutingDecision {
  path: PathType;
  execute: ExecuteNow;
  reason: string;
  routingSource: 'preferredPath' | 'runtime_status' | 'triage' | 'unknown';
}

/**
 * SEKVENTIELL TESTLOGIK: A → B → C → D-queue → E-Manual
 * 
 * VIKTIGT: D-queue betyder SKICKA TILL PENDING QUEUE, INTE KÖRA RENDER.
 * D-renderGate körs INTE aktivt ännu.
 * 
 * Steg:
 * 1. A-JSONLD  → Testa alltid först (oavsett preferredPath)
 * 2. B-Network → Testa om A misslyckades  
 * 3. C-HTML     → Testa om B misslyckades (med C1 screening)
 * 4. D-queue    → Om C1 säger render_candidate → skicka till D-queue
 * 5. E-Manual   → Om allt annat misslyckades → manuell fallback
 * 
 * OBS: preferredPath ANVÄNDS INTE för att gissa metod.
 * preferredPath används endast för att veta VILKEN METOD SOM REDAN BEKRÄFTATS.
 * Om preferredPath=jsonld → hoppa A och kör direkt jsonld (bekräftad metod).
 * Om preferredPath=html → hoppa A+B+C och kör direkt html (bekräftad metod).
 * Om preferredPath=unknown/low-confidence → kör sekventiell test A→B→C→D→E.
 */
function selectSourcePath(source: SourceTruth, status: SourceStatus): RoutingDecision {
  // ── OM METODEN REDAN ÄR BEKRÄFTAD (preferredPath satt och inte 'unknown'), kör den direkt ────
  // Detta är INTE gissning - det är att använda redan verifierad kunskap
  
  if (source.preferredPath === 'jsonld') {
    // JSON-LD har tidigare bekräftats för denna källa
    return {
      path: 'jsonld',
      execute: 'execute_now',
      reason: `preferredPath=jsonld (bekräftad)`,
      routingSource: 'preferredPath',
    };
  }
  
  if (source.preferredPath === 'network') {
    // Network har tidigare bekräftats för denna källa
    return {
      path: 'network',
      execute: 'execute_network',
      reason: `preferredPath=network (bekräftad)`,
      routingSource: 'preferredPath',
    };
  }
  
  if (source.preferredPath === 'html') {
    // HTML har tidigare bekräftats för denna källa
    return {
      path: 'html',
      execute: 'execute_now',
      reason: `preferredPath=html (bekräftad)`,
      routingSource: 'preferredPath',
    };
  }
  
  if (source.preferredPath === 'api') {
    return {
      path: 'api',
      execute: 'skip_not_implemented',
      reason: `preferredPath=api, API adapter ej implementerad ännu`,
      routingSource: 'preferredPath',
    };
  }
  
  // ── INTE BEKRÄFTAD: Kör sekventiell test A → B → C → D → E ───────────────
  // För sources med unknown/low-confidence preferredPath, testa metoderna i ordning
  
  return {
    path: 'unknown',
    execute: 'execute_now',
    reason: 'SEKVENTIELL TEST: A→B→C→D→E (preferredPath=unknown/low-confidence)',
    routingSource: 'unknown',
  };
}

async function runSource(source: SourceTruth, options: { recheck?: boolean } = {}): Promise<void> {
  // ── Hämta runtime status ───────────────────────────────────────────────────
  const status = getSourceStatus(source.id);
  
  // ── ROUTING BESLUT: Tidigt och tydligt ────────────────────────────────────
  const decision = selectSourcePath(source, status);
  
  console.log(`\n═══════════════════════════════════════`);
  console.log(`Kör: ${source.name} (${source.id})`);
  console.log(`URL: ${source.url}`);
  console.log(`═══════════════════════════════════════`);
  console.log(`[ROUTING] path=${decision.path} execute=${decision.execute}`);
  console.log(`[ROUTING] reason=${decision.reason}`);
  console.log(`[ROUTING] source=${decision.routingSource}`);
  
  // ── Hantera icke-exekverbara cases ───────────────────────────────────────
  if (decision.execute === 'skip_not_implemented') {
    console.log(`\n⏭️  SKIP: ${decision.reason}`);

    // Välj rätt pending-status baserat på path
    let pendingStatus = 'error';
    let pendingTool: 'api_adapter' | 'network_inspection' = 'network_inspection';
    if (decision.path === 'api') {
      pendingStatus = 'pending_api_adapter';
      pendingTool = 'api_adapter';
    } else if (decision.path === 'network') {
      pendingStatus = 'pending_network_adapter';
    }

    updateSourceStatus(source.id, {
      success: false,
      eventsFound: 0,
      error: `${pendingStatus}: ${decision.reason}`,
      pathUsed: decision.path as any,
      lastRoutingReason: decision.reason,
      lastRoutingSource: decision.routingSource,
      pendingNextTool: pendingTool,
    });
    return;
  }

  if (decision.execute === 'park_pending_render') {
    console.log(`\n⏸️  PARK: ${decision.reason}`);
    addPendingRender({
      url: source.url,
      sourceName: source.id,
      reason: decision.reason,
      signal: 'routing_decision',
      confidence: 1.0,
      attemptedPaths: [decision.path],
    });
    updateSourceStatus(source.id, {
      success: false,
      eventsFound: 0,
      error: `pending_render_gate: ${decision.reason}`,
      pathUsed: decision.path as any,
      lastRoutingReason: decision.reason,
      lastRoutingSource: decision.routingSource,
      pendingNextTool: 'D-renderGate',
    });
    return;
  }
  
  // ── Execute now: jsonld, html, unknown(triage), eller network ───────────────
  const { fetchHtml } = await import('./tools/fetchTools');
  const { extractFromJsonLd, extractFromHtml, toRawEventInput } = await import('./F-eventExtraction/extractor');

  // Fetch HTML for all paths (needed for HTML fallback in network path too)
  const fetchResult = await fetchHtml(source.url, { timeout: 20000 });

  let eventsFound = 0;
  let pathUsed: 'jsonld' | 'html' | 'network' | 'render' = decision.path as any;

  // ── NETWORK PATH EXECUTION ──────────────────────────────────────────────────
  if (decision.execute === 'execute_network') {
    if (!fetchResult.success || !fetchResult.html) {
      updateSourceStatus(source.id, {
        success: false,
        eventsFound: 0,
        pathUsed: 'network',
        error: `Fetch failed: ${fetchResult.error}`,
        lastRoutingReason: `network_inspection: fetch failed`,
        lastRoutingSource: 'preferredPath',
        pendingNextTool: 'network_inspection',
      });
      return;
    }

    console.log(`🌐 Network: Running inspectUrl on ${source.url}`);
    const inspectorResult = await inspectUrl(source.url);
    const verdict = inspectorResult.verdict;
    console.log(`   Verdict: ${verdict} (${inspectorResult.summary.likely} likely, ${inspectorResult.summary.possible} possible, ${inspectorResult.summary.noise} noise)`);

    // Evaluate with breadth mode (2) - require usable endpoint
    const gateResult = await evaluateNetworkGate(source.url, 'no-jsonld', 2, inspectorResult);
    console.log(`   Gate: ${gateResult.nextPath} | ${gateResult.reason}`);

    if (gateResult.nextPath === 'network') {
      // API is accessible - look for usable endpoint
      const likely = inspectorResult.candidates.filter(c => c.label === 'likely_event_api' && c.statusCode === 200);
      if (likely.length > 0) {
        const top = likely[0];
        console.log(`   Using: ${top.url} (${top.statusCode})`);
        console.log(`   Keys found: [${top.keysFound?.slice(0, 8).join(', ')}]`);
        if (top.promotion) {
          console.log(`   Promotion: cleaner=${top.promotion.cleaner}, complete=${top.promotion.moreComplete}, stable=${top.promotion.moreStable}`);
        }
        
        // Extract events from API
        const apiResult = await extractFromApi(top.url, source.id, { timeout: 15000 });
        eventsFound = apiResult.events.length;
        console.log(`   API extraction: ${eventsFound} events (${apiResult.rawCount} raw, ${apiResult.parseErrors.length} parse errors)`);
        
        if (eventsFound > 0) {
          // Queue the extracted events
          // Note: networkEventExtractor returns Tixly-format (startTime, endTime, imageUrl, etc.)
          // queueEvents expects RawEventInput - we map between them
          const { queueEvents } = await import('./tools/fetchTools');
          const rawEvents = apiResult.events.map(e => ({
            // Required RawEventInput fields
            source: source.id,  // CRITICAL: was missing, caused source_id=null in DB
            source_id: (e as any).id || `${source.id}-${Math.random().toString(36).slice(2)}`,
            title: (e as any).title || 'Untitled',
            description: (e as any).description || '',
            start_time: (e as any).startTime ? new Date((e as any).startTime).toISOString() : new Date().toISOString(),
            end_time: (e as any).endTime ? new Date((e as any).endTime).toISOString() : null,
            url: (e as any).url || '',
            image_url: (e as any).imageUrl || '',
            venue_name: (e as any).venue || '',
            venue_address: '',
            lat: null,
            lng: null,
            categories: [(e as any).category || 'unknown'],
            is_free: false,
            price_min_sek: (e as any).price?.min ?? null,
            price_max_sek: (e as any).price?.max ?? null,
            ticket_url: (e as any).url || null,
            detected_language: 'sv' as const,
            raw_payload: e as Record<string, unknown>,  // CRITICAL: was missing, required field
            // Legacy fields for backwards compatibility
            organizer_name: (e as any).organizer || '',
            price: (e as any).price ? `${(e as any).price.min || 0}-${(e as any).price.max || 0}` : null,
            status: (e as any).status || 'available',
            event_url: (e as any).url || '',
            start_date: (e as any).startTime ? new Date((e as any).startTime).toISOString().split('T')[0] : '',
            end_date: (e as any).endTime ? new Date((e as any).endTime).toISOString().split('T')[0] : '',
          }));
          const { queued } = await queueEvents(source.id, rawEvents as any);
          console.log(`   Queued: ${queued}/${eventsFound}`);
        }
        
        updateSourceStatus(source.id, {
          success: eventsFound > 0,
          eventsFound,
          pathUsed: 'network',
          lastRoutingReason: `network_inspection: ${verdict}, extracted ${eventsFound} events from ${top.url}`,
          lastRoutingSource: 'preferredPath',
          pendingNextTool: eventsFound > 0 ? null : 'network_inspection',
        });
      } else {
        console.log(`   No likely_event_api with 200 status found`);
        updateSourceStatus(source.id, {
          success: false,
          eventsFound: 0,
          pathUsed: 'network',
          lastRoutingReason: `network_inspection: ${verdict} but no accessible endpoint`,
          lastRoutingSource: 'preferredPath',
          pendingNextTool: 'network_inspection',
        });
      }
    } else {
      // Gate says HTML - fall back to HTML extraction
      console.log(`   Gate: falling back to HTML`);
      const htmlResult = extractFromHtml(fetchResult.html, source.id, source.url);
      eventsFound = htmlResult.events.length;
      pathUsed = 'html';
      console.log(`   HTML fallback: ${eventsFound} events`);
      updateSourceStatus(source.id, {
        success: eventsFound > 0,
        eventsFound,
        pathUsed: 'html',
        lastRoutingReason: `network_inspection: ${verdict} → HTML fallback`,
        lastRoutingSource: 'preferredPath',
        error: eventsFound === 0 ? 'network_blocked_html_fallback_zero_events' : undefined,
        pendingNextTool: eventsFound === 0 ? 'network_inspection' : 'preferredPath_recheck',
      });
    }
    return;
  }
  // ── END NETWORK PATH ──────────────────────────────────────────────────────

  // ── D-QUEUE: SKICKA TILL PENDING QUEUE, KÖR INTE RENDER ÄNNU ─────────────
  // D-renderGate är INTE integrerad. Vi skickar endast till pending_render_queue.
  if (decision.execute === 'queue_render_only') {
    console.log(`⏸️  D-queue: Skickar ${source.id} till D-pending-queue (D-renderGate körs EJ ännu)`);
    
    // SKICKA TILL PENDING QUEUE - kör INTE render
    addPendingRender({
      url: source.url,
      sourceName: source.id,
      reason: `preferredPath=render, D-renderGate ännu inte aktiv`,
      signal: 'path_not_implemented',
      confidence: 1.0,
      attemptedPaths: ['render'],
    });
    
    updateSourceStatus(source.id, {
      success: false,
      eventsFound: 0,
      pathUsed: 'render',
      error: `pending_render_gate: D-renderGate körs ej ännu`,
      lastRoutingReason: `preferredPath=render, parkad för framtida D-arbete`,
      lastRoutingSource: 'preferredPath',
      pendingNextTool: 'D-renderGate',
    });
    return;
  }
  // ── END D-QUEUE ───────────────────────────────────────────────────────────

  if (!fetchResult.success || !fetchResult.html) {
    updateSourceStatus(source.id, {
      success: false,
      eventsFound: 0,
      error: `Fetch failed: ${fetchResult.error}`,
    });
    return;
  }
  
  if (decision.path === 'jsonld') {
    // Endast JSON-LD, inget fallback
    // Men om 0 events, markera som needs_review (inte silent fail)
    const jsonLdResult = extractFromJsonLd(fetchResult.html, source.id, source.url);
    console.log(`JSON-LD: ${jsonLdResult.events.length} events`);
    eventsFound = jsonLdResult.events.length;
    pathUsed = 'jsonld';

    if (eventsFound === 0) {
      // JSON-LD med 0 events behöver granskas - inte silent fail
      updateSourceStatus(source.id, {
        success: false,
        eventsFound: 0,
        pathUsed: 'jsonld',
        error: `needs_review: JSON-LD extraction returned 0 events despite preferredPath=jsonld`,
        lastRoutingReason: decision.reason,
        pendingNextTool: 'preferredPath_recheck',
      });
      console.log(`⚠️  JSON-LD returned 0 events - source marked needs_review`);
      return;
    }

    // Queue the extracted events
    const { queueEvents } = await import('./tools/fetchTools');
    const rawEvents = jsonLdResult.events.map(e => {
      const raw = toRawEventInput(e);
      return {
        ...raw,
        source_id: source.id,
        source_url: source.url,
        detected_language: 'sv' as const,
        raw_payload: e as Record<string, unknown>,
      };
    });
    const { queued } = await queueEvents(source.id, rawEvents as any);
    console.log(`   Queued: ${queued}/${eventsFound}`);

  } else if (decision.path === 'html') {
    // HTML extraction med etablerad preferredPath=html
    const htmlResult = extractFromHtml(fetchResult.html, source.id, source.url);
    console.log(`HTML: ${htmlResult.events.length} events`);
    eventsFound = htmlResult.events.length;
    pathUsed = 'html';

  } else if (decision.path === 'unknown') {
    // Triage via C1-preHtmlGate: screening INNAN full extraction
    // C1 avgör vilket path som är lämpligt
    const currentTriageAttempts = status.triageAttempts || 0;
    const newTriageAttempts = currentTriageAttempts + 1;

    // Kör C1 screening (billig fetch + DOM-analys)
    console.log(`🔍 C1: Screening ${source.id}...`);
    const preGateResult = await screenUrl(source.url);
    const triageOutcome = determineTriageOutcome(preGateResult);
    console.log(`   C1 result: ${triageOutcome} (${preGateResult.categorization}) - ${preGateResult.reason}`);

    // Baserat på C1:s triage-utfall
    if (triageOutcome === 'render_candidate') {
      // Sida är sannolikt JS-renderad - parkera för D-renderGate
      addPendingRender({
        url: source.url,
        sourceName: source.id,
        reason: `C1: ${preGateResult.reason}`,
        signal: 'c1_triage',
        confidence: 0.8,
        attemptedPaths: ['html'], // HTML misslyckades enligt C1
      });
      updateSourceStatus(source.id, {
        success: false,
        eventsFound: 0,
        error: `pending_render_gate: C1 detected JS-rendering`,
        pathUsed: 'html',
        lastRoutingReason: decision.reason,
        lastRoutingSource: 'triage',
        pendingNextTool: 'D-renderGate',
        triageAttempts: newTriageAttempts,
        triageResult: triageOutcome,
        triageRecommendedPath: 'render',
        triageReason: preGateResult.reason,
      });
      console.log(`⏸️  C1: render_candidate → parked for D-renderGate`);

      // --- V1 Learning: Record triage ---
      const renderLearning = recordTriageAttempt(source.id, {
        timestamp: new Date().toISOString(),
        outcome: triageOutcome,
        recommendedPath: 'render',
        triageReason: preGateResult.reason,
      });
      console.log(`   Learning: confidence=${renderLearning.newConfidence.toFixed(2)} | candidate=${renderLearning.candidateForPromotion}`);
      if (renderLearning.candidateForPromotion) {
        console.log(`   📈 PROMOTION CANDIDATE: ${renderLearning.promotionSuggestion}`);
      }
      return;

    } else if (triageOutcome === 'manual_review') {
      // C1 kan inte avgöra - kräv manuell granskning
      updateSourceStatus(source.id, {
        success: false,
        eventsFound: 0,
        error: `manual_review: C1 could not determine path`,
        pathUsed: 'html',
        lastRoutingReason: decision.reason,
        lastRoutingSource: 'triage',
        pendingNextTool: 'html_extraction_review',
        triageAttempts: newTriageAttempts,
        triageResult: triageOutcome,
        triageRecommendedPath: 'manual_review',
        triageReason: preGateResult.reason,
      });
      console.log(`⚠️  C1: manual_review → needs human decision`);

      // --- V1 Learning: Record triage ---
      const manualLearning = recordTriageAttempt(source.id, {
        timestamp: new Date().toISOString(),
        outcome: triageOutcome,
        recommendedPath: 'manual_review',
        triageReason: preGateResult.reason,
      });
      console.log(`   Learning: confidence=${manualLearning.newConfidence.toFixed(2)} | candidate=${manualLearning.candidateForPromotion}`);
      return;

    } else if (triageOutcome === 'still_unknown') {
      // Kan inte hämta sidan - försök igen senare
      updateSourceStatus(source.id, {
        success: false,
        eventsFound: 0,
        error: `still_unknown: C1 could not fetch page`,
        pathUsed: 'html',
        lastRoutingReason: decision.reason,
        lastRoutingSource: 'triage',
        pendingNextTool: 'c1_gate',
        triageAttempts: newTriageAttempts,
        triageResult: triageOutcome,
        triageRecommendedPath: 'manual_review',
        triageReason: preGateResult.fetchError || 'unknown',
      });
      console.log(`⚠️  C1: still_unknown → will retry`);

      // --- V1 Learning: Record triage ---
      const unknownLearning = recordTriageAttempt(source.id, {
        timestamp: new Date().toISOString(),
        outcome: triageOutcome,
        recommendedPath: 'manual_review',
        triageReason: preGateResult.fetchError || 'unknown',
      });
      console.log(`   Learning: confidence=${unknownLearning.newConfidence.toFixed(2)} | candidate=${unknownLearning.candidateForPromotion}`);
      return;

    } else {
      // html_candidate - C1 indikerar att HTML-extraction kan fungera
      console.log(`🔍 C1: html_candidate → proceeding with HTML extraction`);

      const htmlResult = extractFromHtml(fetchResult.html, source.id, source.url);
      console.log(`HTML (triage): ${htmlResult.events.length} events`);
      eventsFound = htmlResult.events.length;
      pathUsed = 'html';

      if (eventsFound === 0) {
        // HTML-extraction gav inga events trots C1:s godkännande
        updateSourceStatus(source.id, {
          success: false,
          eventsFound: 0,
          pathUsed: 'html',
          error: `triage_required: C1 said html_candidate but extraction returned 0 events`,
          lastRoutingReason: decision.reason,
          lastRoutingSource: 'triage',
          pendingNextTool: 'html_extraction_review',
          triageAttempts: newTriageAttempts,
          triageResult: triageOutcome,
          triageRecommendedPath: 'html',
          triageReason: preGateResult.reason,
        });
        console.log(`⚠️  Triage #${newTriageAttempts} failed despite C1 html_candidate`);

        // --- V1 Learning: Record triage med eventsFound=0 ---
        const failLearning = recordTriageAttempt(source.id, {
          timestamp: new Date().toISOString(),
          outcome: triageOutcome,
          recommendedPath: 'html',
          eventsFound: 0,
          extractionSuccess: false,
          triageReason: preGateResult.reason,
        });
        console.log(`   Learning: confidence=${failLearning.newConfidence.toFixed(2)} | candidate=${failLearning.candidateForPromotion}`);
      } else {
        // Triage lyckades - men path är fortfarande inte bekräftad
        updateSourceStatus(source.id, {
          success: true,
          eventsFound,
          pathUsed: 'html',
          lastRoutingReason: `triage_success: C1 html_candidate + ${eventsFound} events extracted`,
          lastRoutingSource: 'triage',
          pendingNextTool: 'preferredPath_recheck',
          triageAttempts: newTriageAttempts,
          triageResult: triageOutcome,
          triageRecommendedPath: 'html',
          triageReason: preGateResult.reason,
        });
        console.log(`✓ Triage successful (${eventsFound} events) but source needs preferredPath update`);

        // --- V1 Learning: Record triage med framgång ---
        const successLearning = recordTriageAttempt(source.id, {
          timestamp: new Date().toISOString(),
          outcome: triageOutcome,
          recommendedPath: 'html',
          eventsFound,
          extractionSuccess: true,
          triageReason: preGateResult.reason,
        });
        console.log(`   Learning: confidence=${successLearning.newConfidence.toFixed(2)} | candidate=${successLearning.candidateForPromotion}`);
        if (successLearning.candidateForPromotion) {
          console.log(`   📈 PROMOTION CANDIDATE: ${successLearning.promotionSuggestion}`);
        }
      }
      return;
    }
  }

  const success = eventsFound > 0;
  console.log(`\nResultat: ${success ? '✓ SUCCESS' : '✗ FAIL'} | ${eventsFound} events | path: ${pathUsed}`);

  updateSourceStatus(source.id, {
    success,
    eventsFound,
    pathUsed,
    lastRoutingReason: decision.reason,
    lastRoutingSource: decision.routingSource,
    error: success ? undefined : 'no_events_extracted',
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('═══ SOURCE SCHEDULER ═══');
  
  if (args.includes('--rebuild')) {
    rebuildPriorityQueue();
    return;
  }
  
  if (args.includes('--status')) {
    const sources = getAllSources();
    const statuses = getAllStatuses();
    console.log(`\nSources: ${sources.length} | Statuses: ${statuses.length}\n`);
    
    for (const source of sources) {
      const status = statuses.find(s => s.sourceId === source.id) || {
        sourceId: source.id,
        status: 'never_run' as const,
        lastRun: null,
        lastSuccess: null,
        consecutiveFailures: 0,
        lastEventsFound: 0,
        attempts: 0,
      };
      const lastRun = status.lastRun ? new Date(status.lastRun).toLocaleString('sv-SE') : 'aldrig';
      console.log(`${source.id.padEnd(20)} | ${status.status.padEnd(20)} | events: ${status.lastEventsFound.toString().padStart(3)} | lastRun: ${lastRun} | attempts: ${status.attempts}`);
    }
    return;
  }
  
  if (args.includes('--pending')) {
    const pending = getPendingRenders();
    console.log(`\nPending Render Queue: ${pending.length} källor\n`);
    for (const p of pending) {
      console.log(`  ${p.sourceName} | ${p.signal} | ${p.reason.substring(0, 60)}`);
    }
    return;
  }

  // ── RUN SINGLE SOURCE: --source <sourceId> ─────────────────────────────────
  const sourceIndex = args.findIndex(a => a === '--source');
  if (sourceIndex !== -1 && args[sourceIndex + 1]) {
    const targetSourceId = args[sourceIndex + 1];
    const source = getSource(targetSourceId);
    if (!source) {
      console.log(`Source '${targetSourceId}' hittades inte i sources/.`);
      return;
    }
    console.log(`Kör source: ${source.id} (${source.url})\n`);
    await runSource(source, { recheck: true });
    process.exit(0);
  }

  // ── BATCH TRIAGE: Kör C1 på alla triage_required/unknown/never_run ─────────
  if (args.includes('--triage-batch')) {
    const sources = getAllSources();
    const statuses = getAllStatuses();
    const statusMap = new Map(statuses.map(s => [s.sourceId, s]));

    // Filtrera: triage_required, unknown, eller aldrig körda
    const triageCandidates = sources.filter(s => {
      const st = statusMap.get(s.id);
      return !st || st.status === 'triage_required' || st.status === 'never_run';
    });

    console.log(`\n═══ BATCH TRIAGE ═══`);
    console.log(`Sources att triage: ${triageCandidates.length}\n`);

    const stats = { html: 0, render: 0, manual: 0, unknown: 0, errors: 0, skipped: 0 };

    for (const source of triageCandidates) {
      process.stdout.write(`${source.id.padEnd(25)} ... `);

      try {
        const preGateResult = await screenUrl(source.url);

        // Säkerställ att source finns i statusfilen
        if (!statusMap.has(source.id)) {
          // Skapa en dummy-status så recordTriageAttempt fungerar
          updateSourceStatus(source.id, {
            success: false,
            eventsFound: 0,
          });
          statusMap.set(source.id, { sourceId: source.id } as any);
        }

        if (!preGateResult.fetchable) {
          console.log(`still_unknown (${preGateResult.fetchError?.substring(0, 25)})`);
          recordTriageAttempt(source.id, {
            timestamp: new Date().toISOString(),
            outcome: 'still_unknown',
            recommendedPath: 'manual_review',
            triageReason: preGateResult.fetchError || 'fetch_failed',
          });
          updateSourceStatus(source.id, {
            success: false,
            eventsFound: 0,
            triageResult: 'still_unknown',
            triageReason: preGateResult.fetchError || 'fetch_failed',
            triageRecommendedPath: 'manual_review',
          });
          stats.unknown++;
        } else if (preGateResult.likelyJsRendered) {
          console.log(`render_candidate`);
          recordTriageAttempt(source.id, {
            timestamp: new Date().toISOString(),
            outcome: 'render_candidate',
            recommendedPath: 'render',
            triageReason: preGateResult.reason,
          });
          updateSourceStatus(source.id, {
            success: false,
            eventsFound: 0,
            triageResult: 'render_candidate',
            triageReason: preGateResult.reason,
            triageRecommendedPath: 'render',
            pendingNextTool: 'D-renderGate',
          });
          addPendingRender({
            url: source.url,
            sourceName: source.name,
            signal: 'js_rendered_c1',
            reason: `C1: ${preGateResult.reason}`,
            confidence: 0.5,
            attemptedPaths: ['html'],
          });
          stats.render++;
        } else if (preGateResult.categorization === 'strong' || preGateResult.categorization === 'medium') {
          console.log(`html_candidate (${preGateResult.categorization})`);
          recordTriageAttempt(source.id, {
            timestamp: new Date().toISOString(),
            outcome: 'html_candidate',
            recommendedPath: 'html',
            triageReason: preGateResult.reason,
          });
          updateSourceStatus(source.id, {
            success: true,
            eventsFound: 0,
            triageResult: 'html_candidate',
            triageReason: preGateResult.reason,
            triageRecommendedPath: 'html',
            pendingNextTool: 'html_extraction_review',
          });
          stats.html++;
        } else {
          console.log(`manual_review (${preGateResult.categorization})`);
          recordTriageAttempt(source.id, {
            timestamp: new Date().toISOString(),
            outcome: 'manual_review',
            recommendedPath: 'manual_review',
            triageReason: preGateResult.reason,
          });
          updateSourceStatus(source.id, {
            success: false,
            eventsFound: 0,
            triageResult: 'manual_review',
            triageReason: preGateResult.reason,
            triageRecommendedPath: 'manual_review',
          });
          stats.manual++;
        }
      } catch (e) {
        console.log(`ERROR: ${e.message.substring(0, 40)}`);
        stats.errors++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n═══ BATCH TRIAGE KLAR ═══`);
    console.log(`html_candidate:  ${stats.html}`);
    console.log(`render_candidate: ${stats.render}`);
    console.log(`manual_review:   ${stats.manual}`);
    console.log(`still_unknown:   ${stats.unknown}`);
    console.log(`errors:         ${stats.errors}`);
    return;
  }
  
  if (args.includes('--all') || args.includes('--recheck')) {
    const sources = getAllSources();
    console.log(`Kör alla ${sources.length} sources...`);
    
    for (const source of sources) {
      await runSource(source, { recheck: true });
      // Lite paus mellan körningar
      await new Promise(r => setTimeout(r, 500));
    }
    return;
  }
  
  // Normal mode: kör nästa i prioritetskön
  const next = getNextInQueue();
  
  if (!next) {
    console.log('Prioritetskön är tom. Kör --rebuild för att återuppbygga.');
    rebuildPriorityQueue();
    return;
  }
  
  console.log(`Nästa i kö: ${next.sourceId} (priority=${next.priority}, reason=${next.reason})`);
  
  const source = getSource(next.sourceId);
  if (!source) {
    console.log(`Source ${next.sourceId} hittades inte i sources/. Ta bort från kö.`);
    removeFromQueue(next.sourceId);
    return;
  }
  
  await runSource(source);
  removeFromQueue(next.sourceId);
  
  // Exit cleanly after processing (fixes scheduler hang-bug)
  // BullMQ workers continue in background, but main process should exit
  process.exit(0);
}

main().catch(console.error);
