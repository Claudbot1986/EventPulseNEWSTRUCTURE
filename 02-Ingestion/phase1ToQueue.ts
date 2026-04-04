/**
 * Phase 1 → Queue Bridge
 *
 * Tar godkända Phase 1-kandidater (next_path = normalizer_candidate)
 * och kör dem genom: fetchHtml → extractFromJsonLd → toRawEventInput → rawEventsQueue
 *
 * Detta är den saknade bron mellan Phase 1 triage och produktionsflödet.
 *
 * Usage:
 *   npx tsx 02-Ingestion/phase1ToQueue.ts --batch golden-batch.txt
 *   npx tsx 02-Ingestion/phase1ToQueue.ts --url "https://www.eventbrite.se/d/sweden--stockholm/events/"
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { fetchHtml } from './tools/fetchTools';
import { screenUrl } from './C-htmlGate/C1-preHtmlGate/C1-preHtmlGate';
import { extractFromJsonLd, extractFromHtml, toRawEventInput } from './F-eventExtraction/extractor';
import { addPendingRender } from './tools/pendingRenderQueue';
import { rawEventsQueue } from '../03-Queue/queue';
import { readFileSync } from 'fs';
import type { RawEventInput } from '@eventpulse/shared';

interface QueuedResult {
  url: string;
  source: string;
  events_extracted: number;
  events_queued: number;
  queued_ids: string[];
  errors: string[];
  status: 'success' | 'partial' | 'fail' | 'pending_render_gate';
}

// ─── Fetch + Extract + Queue for a single URL ────────────────────────────────

async function phase1CandidateToQueue(url: string, sourceName: string): Promise<QueuedResult> {
  const result: QueuedResult = {
    url,
    source: sourceName,
    events_extracted: 0,
    events_queued: 0,
    queued_ids: [],
    errors: [],
    status: 'fail',
  };

  // Step 1: Fetch HTML
  console.log(`[phase1→queue] Fetching: ${url}`);
  const fetchResult = await fetchHtml(url, { timeout: 20000 });

  if (!fetchResult.success || !fetchResult.html) {
    result.errors.push(`Fetch failed: HTTP ${fetchResult.statusCode ?? 'unknown'} ${fetchResult.error ?? ''}`);
    return result;
  }

  // Step 1b: Run C1 pre-HTML gate to detect JS-rendered pages
  const attemptedPaths: string[] = [];
  try {
    const c1Result = await screenUrl(url);
    // JS-rendered: main exists but is nearly empty (content loaded via JS)
    const mainText = c1Result.hasMain ? '' : ''; // we already have the info
    if (c1Result.likelyJsRendered || (c1Result.hasMain && c1Result.htmlBytes && c1Result.htmlBytes > 50000 && c1Result.dateCount === 0 && c1Result.timeTagCount === 0)) {
      console.log(`[phase1→queue] C1 flagged as likely JS-rendered: ${c1Result.reason}`);
      addPendingRender({
        url,
        sourceName,
        reason: `C1: ${c1Result.reason} (categorization=${c1Result.categorization})`,
        signal: 'js_rendered_c1',
        confidence: c1Result.categorization === 'noise' ? 0.9 : 0.7,
        htmlBytes: c1Result.htmlBytes,
        attemptedPaths: ['screen'],
      });
      result.status = 'pending_render_gate';
      result.errors.push('JS-rendered page: added to pending_render_queue for D-renderGate');
      return result;
    }
  } catch (c1Error) {
    // C1 screening failed, continue with normal flow
    console.log(`[phase1→queue] C1 screening skipped: ${c1Error instanceof Error ? c1Error.message : 'unknown'}`);
  }

  // Step 2: Extract events — try JSON-LD first, fall back to HTML heuristics
  let extractResult = extractFromJsonLd(fetchResult.html, sourceName, url);
  attemptedPaths.push('jsonld');

  // Known calendar subpaths for sources where events live on a subpage
  const calendarSubpaths = [
    '/program-och-biljetter/kalender/',
    '/kalender/',
    '/events/',
    '/program/',
    '/program/events/',
  ];

  function tryCalendarSubpath(subpath: string): boolean {
    const newUrl = url.replace(/\/$/, '') + subpath;
    console.log(`[phase1→queue] Trying calendar subpath: ${newUrl}`);
    const subResult = fetchHtml(newUrl, { timeout: 20000 });
    return subResult as unknown as boolean;
  }

  if (extractResult.events.length === 0) {
    // Fallback: try HTML extraction on current page
    const htmlResult = extractFromHtml(fetchResult.html, sourceName, url);
    if (htmlResult.events.length > 0) {
      console.log(`[phase1→queue] JSON-LD: 0 events, HTML on main page: ${htmlResult.events.length} events`);
      extractResult = htmlResult;
    } else {
      // Try known calendar subpaths
      for (const subpath of calendarSubpaths) {
        const newUrl = url.replace(/\/$/, '') + subpath;
        const subFetch = await fetchHtml(newUrl, { timeout: 20000 });
        if (subFetch.success && subFetch.html) {
          const subHtmlResult = extractFromHtml(subFetch.html, sourceName, newUrl);
          if (subHtmlResult.events.length > 0) {
            console.log(`[phase1→queue] Calendar subpath "${subpath}" found ${subHtmlResult.events.length} events`);
            extractResult = subHtmlResult;
            break;
          }
        }
      }
    }
  }

  // Step 4: C3 AI extraction - final fallback before giving up
  if (extractResult.events.length === 0) {
    console.log('[phase1→queue] Trying C3 AI extraction...');
    try {
      const { evaluateAiExtract } = await import('./C-htmlGate/C3-aiExtractGate/C3-aiExtractGate');
      const c3Result = await evaluateAiExtract(url, fetchResult.html);

      if (c3Result.events.length > 0) {
        console.log(`[phase1→queue] C3 found ${c3Result.events.length} events via AI`);
        // Convert C3 events to extractResult format
        extractResult.events = c3Result.events.map(e => ({
          title: e.title,
          date: e.date || '',
          time: e.time || undefined,
          venue: e.venue || sourceName,
          url: e.url || url,
          source: sourceName,
          sourceUrl: e.url || url,
          category: 'event' as const,
          confidence: {
            score: e.confidence.overall,
            hasTitle: true,
            hasDate: !!e.date,
            hasVenue: !!e.venue,
            hasUrl: !!e.url,
            hasDescription: false,
            hasTicketInfo: !!e.ticketUrl,
            signals: ['c3-ai-extraction'],
          },
        }));
      } else if (c3Result.fallbackToRender) {
        console.log('[phase1→queue] C3 flagged fallbackToRender: adding to pending_render_queue');
        addPendingRender({
          url,
          sourceName,
          reason: `C3: ${c3Result.reasoning.substring(0, 150)}`,
          signal: 'js_rendered_c3',
          confidence: 0.8,
          htmlBytes: fetchResult.html ? Buffer.byteLength(fetchResult.html, 'utf8') : undefined,
          attemptedPaths,
        });
        result.status = 'pending_render_gate';
        result.errors.push('C3: JS-rendered page: added to pending_render_queue for D-renderGate');
        return result;
      } else {
        result.errors.push(`C3 AI: ${c3Result.reasoning.substring(0, 100)}`);
      }
    } catch (c3Error) {
      result.errors.push(`C3 error: ${c3Error instanceof Error ? c3Error.message : 'unknown'}`);
    }
  }

  result.events_extracted = extractResult.events.length;

  if (extractResult.events.length === 0) {
    result.errors.push(`No events extracted (${extractResult.parseErrors.length} parse errors)`);
    return result;
  }

  // Step 3: Convert and queue each event
  console.log(`[phase1→queue] Queuing ${extractResult.events.length} events from ${url}`);
  for (const event of extractResult.events) {
    try {
      const raw = toRawEventInput(event);
      // Override source_id if needed — use listing page as source identifier
      const safeJobId = `${sourceName}-${raw.source_id}`.replace(/:/g, '-');

      await rawEventsQueue.add('process-raw-event', raw, {
        jobId: safeJobId,
      });

      result.queued_ids.push(raw.source_id ?? safeJobId);
      result.events_queued++;
    } catch (err) {
      result.errors.push(`Queue error for "${event.title}": ${err}`);
    }
  }

  result.status = result.events_queued === result.events_extracted ? 'success' : 'partial';
  return result;
}

// ─── Derive source name from URL ─────────────────────────────────────────────

function sourceNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    // Known source mapping
    if (host.includes('eventbrite')) return 'eventbrite';
    if (host.includes('ticketmaster')) return 'ticketmaster';
    if (host.includes('billetto')) return 'billetto';
    if (host.includes('kulturhuset')) return 'kulturhuset';
    if (host.includes('scandinavium')) return 'scandinavium';
    return host.replace(/\.[a-z]{2,}$/, '').substring(0, 30);
  } catch {
    return 'unknown';
  }
}

// ─── Run against approved candidates file ────────────────────────────────────

async function runFromApproved(approvedFile: string): Promise<QueuedResult[]> {
  const fs = await import('fs');
  const lines = fs.readFileSync(approvedFile, 'utf-8').split('\n').filter(l => l.trim());
  const results: QueuedResult[] = [];

  console.log(`═══ PHASE 1 → QUEUE BRIDGE ═══`);
  console.log(`Approved file: ${approvedFile}`);
  console.log(`Candidates: ${lines.length}\n`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let entry: { url: string };
    try {
      entry = JSON.parse(line);
    } catch {
      console.log(`[${i + 1}/${lines.length}] ❌ Invalid JSON: ${line.substring(0, 50)}`);
      continue;
    }

    const sourceName = sourceNameFromUrl(entry.url);
    process.stdout.write(`[${i + 1}/${lines.length}] ${entry.url} ... `);

    const r = await phase1CandidateToQueue(entry.url, sourceName);
    results.push(r);

    const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚠️' : '❌';
    console.log(`${icon} extracted=${r.events_extracted}, queued=${r.events_queued}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) console.log(`    ↳ ${e}`);
    }
  }

  return results;
}

// ─── Run against single URL ──────────────────────────────────────────────────

async function runSingleUrl(url: string): Promise<QueuedResult[]> {
  const sourceName = sourceNameFromUrl(url);
  console.log(`═══ PHASE 1 → QUEUE BRIDGE ═══`);
  console.log(`URL: ${url}`);
  console.log(`Source: ${sourceName}\n`);

  const r = await phase1CandidateToQueue(url, sourceName);

  const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚠️' : '❌';
  console.log(`\n${icon} extracted=${r.events_extracted}, queued=${r.events_queued}`);

  return [r];
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(results: QueuedResult[]) {
  const totalExtracted = results.reduce((s, r) => s + r.events_extracted, 0);
  const totalQueued = results.reduce((s, r) => s + r.events_queued, 0);
  const success = results.filter(r => r.status === 'success').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const fail = results.filter(r => r.status === 'fail').length;

  console.log('\n═══ SUMMARY ═══');
  console.log(`  Sources processed: ${results.length}`);
  console.log(`  ✅ success:  ${success}`);
  console.log(`  ⚠️  partial: ${partial}`);
  console.log(`  ❌ fail:    ${fail}`);
  console.log(`  Total extracted: ${totalExtracted}`);
  console.log(`  Total queued:    ${totalQueued}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/phase1ToQueue.ts --batch phase1-approved-*.jsonl');
    console.log('  npx tsx 02-Ingestion/phase1ToQueue.ts --url "https://..."');
    process.exit(1);
  }

  let results: QueuedResult[] = [];

  if (args[0] === '--batch' && args[1]) {
    results = await runFromApproved(args[1]);
  } else if (args[0] === '--url' && args[1]) {
    results = await runSingleUrl(args[1]);
  } else {
    // Assume first arg is a URL
    results = await runSingleUrl(args[0]);
  }

  printSummary(results);
}

main().catch(console.error);
