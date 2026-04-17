/**
 * Rerouting Tool: Skicka JS-renderade sources till postTestC-D
 * 
 * Identifierar sources i postB-preC som sannolikt behöver browser rendering.
 * Kriterier:
 * 1. AppRegistry.registerInitialState() i HTML (SiteVision/Next.js)
 * 2. Fetch timeout (kan tyda på JS-blocking)
 * 3. Många stora <script> blocks men få event-signaler
 * 
 * Usage:
 *   npx tsx reroute-js-rendered.ts [--dry-run] [--force]
 */

import { readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchHtml } from '../tools/fetchTools.js';

const THIS_DIR = dirname(fileURLToPath(import.meta.url)); // C-htmlGate/
const PROJECT_ROOT = join(THIS_DIR, '..', '..');           // NEWSTRUCTURE/

const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const PREC_QUEUE = join(RUNTIME_DIR, 'postB-preC-queue.jsonl');
const QUEUE_D = join(RUNTIME_DIR, 'postTestC-D.jsonl');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

interface QueueEntry {
  sourceId: string;
  url: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
  winningStage?: string | null;
  outcomeType?: string | null;
  routeSuggestion?: string | null;
  roundNumber?: number | null;
  roundsParticipated?: number;
}

interface SourceStatus {
  sourceId: string;
  status: string;
  lastPathUsed: string | null;
  lastEventsFound: number;
  consecutiveFailures: number;
  triageResult: string | null;
}

// Quick probe to detect JS-rendered pattern
async function probeJsRendered(
  url: string,
  timeoutMs = 8000
): Promise<{ isJsRendered: boolean; reason: string }> {
  try {
    const result = await fetchHtml(url, { timeout: timeoutMs });

    if (!result.success || !result.html) {
      return { isJsRendered: false, reason: 'fetch_failed' };
    }

    const html = result.html;

    // Check for Next.js __NEXT_DATA__
    if (html.includes('__NEXT_DATA__') || html.includes('id="__NEXT_DATA__"')) {
      return { isJsRendered: true, reason: 'Next.js_detected' };
    }

    // Check for React hydration markers
    if (html.includes('data-reactroot') || html.includes('data-react-hydration')) {
      return { isJsRendered: true, reason: 'React_hydration' };
    }

    // Check for AppRegistry (SiteVision/Next.js) — most common Swedish JS pattern
    const appRegCount = (html.match(/AppRegistry\.registerInitialState/g) || []).length;
    if (appRegCount >= 2) {
      // Multiple AppRegistry calls = likely SiteVision with event data
      return { isJsRendered: true, reason: `AppRegistry_x${appRegCount}` };
    }
    if (appRegCount === 1) {
      // Single AppRegistry — check if it's cookie banner or event data
      const idx = html.indexOf('AppRegistry.registerInitialState');
      const after = html.slice(idx, idx + 500);
      if (after.includes('"events"') || after.includes("'events'")) {
        return { isJsRendered: true, reason: 'AppRegistry_with_events' };
      }
      // Cookie banner only — check for other JS patterns
      const largeScripts = (html.match(/<script[^>]*>[\s\S]{8000,}<\/script>/gi) || []).length;
      if (largeScripts >= 3) {
        return { isJsRendered: true, reason: `AppRegistry_cookie_large_scripts_x${largeScripts}` };
      }
    }

    // Check: many large script blocks but no event JSON in HTML
    const largeScripts = (html.match(/<script[^>]*>[\s\S]{8000,}<\/script>/gi) || []).length;
    const hasJsonEvents = html.includes('"events"') && html.includes('startDate');
    if (largeScripts >= 5 && !hasJsonEvents) {
      return { isJsRendered: true, reason: `Many_large_scripts_x${largeScripts}_no_events` };
    }

    return { isJsRendered: false, reason: 'normal_html' };

  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      return { isJsRendered: false, reason: 'fetch_failed_non_js' };
    }
    return { isJsRendered: false, reason: 'probe_error' };
  }
}

function loadSourcesStatus(): Map<string, SourceStatus> {
  const map = new Map<string, SourceStatus>();
  try {
    const raw = readFileSync(join(RUNTIME_DIR, 'sources_status.jsonl'), 'utf8').trim();
    if (!raw) return map;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const s = JSON.parse(line) as SourceStatus;
        map.set(s.sourceId, s);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map;
}

async function main() {
  console.log('='.repeat(60));
  console.log('JS-RENDERED REROUTING TOOL');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  // Load postB-preC
  let raw = '';
  try {
    raw = readFileSync(PREC_QUEUE, 'utf8').trim();
  } catch {
    console.log('postB-preC queue empty or missing');
    return;
  }

  const entries: QueueEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as QueueEntry);
    } catch { /* skip */ }
  }

  console.log(`Sources in postB-preC: ${entries.length}\n`);

  const statusMap = loadSourcesStatus();
  const rerouted: { entry: QueueEntry; reason: string }[] = [];
  const kept: { entry: QueueEntry; reason: string }[] = [];

  // Probe each source
  for (const entry of entries) {
    const status = statusMap.get(entry.sourceId);

    // Skip if already has events found (don't reroute success)
    if (status && status.lastEventsFound > 0) {
      kept.push({ entry, reason: 'already_has_events' });
      console.log(`[KEEP]  ${entry.sourceId}: already_has_events`);
      continue;
    }

    // Skip if already routed to D (unless FORCE)
    if (!FORCE && status && status.lastPathUsed === 'D-renderGate') {
      kept.push({ entry, reason: 'already_routed_to_D' });
      console.log(`[KEEP]  ${entry.sourceId}: already_routed_to_D`);
      continue;
    }

    process.stdout.write(`Probing ${entry.sourceId} (${entry.url})... `);
    const result = await probeJsRendered(entry.url);

    if (result.isJsRendered) {
      console.log(`JS-RENDERED [${result.reason}]`);
      rerouted.push({ entry, reason: result.reason });
    } else {
      console.log(`normal [${result.reason}]`);
      kept.push({ entry, reason: result.reason });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`JS-rendered (→ postTestC-D): ${rerouted.length}`);
  console.log(`Normal HTML (stay in postB-preC): ${kept.length}`);

  if (rerouted.length > 0) {
    console.log('\nJS-rendered sources:');
    for (const { entry, reason } of rerouted) {
      console.log(`  ${entry.sourceId}: ${reason}`);
    }
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written');
    console.log('Re-run without --dry-run to apply routing');
  } else {
    applyRerouting(rerouted, kept);
  }
}

function applyRerouting(
  rerouted: { entry: QueueEntry; reason: string }[],
  kept: { entry: QueueEntry; reason: string }[]
) {
  if (rerouted.length === 0) {
    console.log('\nNo sources to reroute.');
    return;
  }

  // Write rerouted to postTestC-D
  let dCount = 0;
  for (const { entry, reason } of rerouted) {
    const queueEntry = {
      ...entry,
      queueName: 'postTestC-D',
      queuedAt: new Date().toISOString(),
      queueReason: `rerouted_js_rendered: ${reason}`,
      workerNotes: `js-rendered:${reason}`,
      winningStage: 'reroute-tool',
      outcomeType: null,
      routeSuggestion: 'D',
      roundNumber: null,
      roundsParticipated: 0,
    };
    appendFileSync(QUEUE_D, JSON.stringify(queueEntry) + '\n');
    dCount++;
  }

  // Update postB-preC to only keep normal HTML sources
  const remaining = kept.map(k => k.entry);
  if (remaining.length > 0) {
    writeFileSync(PREC_QUEUE, remaining.map(e => JSON.stringify(e)).join('\n') + '\n');
  } else {
    writeFileSync(PREC_QUEUE, '');
  }

  console.log(`\nWrote ${dCount} sources to postTestC-D`);
  console.log(`postB-preC now has ${remaining.length} sources`);
}

main().catch(e => { console.error(e); process.exit(1); });
