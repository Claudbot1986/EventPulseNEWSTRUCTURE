/**
 * runC-ai-deep-discovery.ts — AI-assisted deep discovery for stubborn sources
 *
 * Reads sources from postB-preC-queue.jsonl (--limit N).
 * For each source:
 *   1. Fetch the root HTML
 *   2. Ask Anthropic Haiku to identify all event-related subpage URL patterns
 *   3. Test each AI-suggested URL for events
 *   4. Route: events found → postTestC-UI, JS-rendered → postTestC-D, nothing → stays in postB-preC
 *   5. Write detailed JSON report per source + summary
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-ai-deep-discovery.ts --limit 10
 *   npx tsx 02-Ingestion/C-htmlGate/runC-ai-deep-discovery.ts --limit 10 --report-name my-run
 */

import { fetchHtml } from '../../tools/fetchTools';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const REPORTS_DIR = join(__dirname, 'reports', 'ai-discovery');
const LOGS_DIR = join(RUNTIME_DIR, 'logs');
const RUN_LOG = join(LOGS_DIR, `runC-ai-deep-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

// CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '10', 10) : 10;
const reportNameIdx = args.indexOf('--report-name');
const REPORT_NAME = reportNameIdx >= 0 ? args[reportNameIdx + 1] : new Date().toISOString().replace(/[:.]/g, '-');

// Queue paths
const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  D: join(RUNTIME_DIR, 'postTestC-D.jsonl'),
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// Anthropic API
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface QueueEntry {
  sourceId: string;
  url: string;
  queueReason?: string;
  routingReason?: string;
  queueName?: string;
  queuedAt?: string;
  priority?: number;
  attempt?: number;
  workerNotes?: string;
  winningStage?: string;
  outcomeType?: string;
  routeSuggestion?: string;
  roundNumber?: number;
  roundsParticipated?: number;
}

interface AiSuggestedPath {
  path: string;
  fullUrl: string;
  reason: string;
  eventsFound: number;
  method: string;
  jsRendered: boolean;
  status: 'success' | 'js-rendered' | 'no-events' | 'fetch-error';
  error?: string;
}

interface SourceDiscoveryResult {
  sourceId: string;
  sourceUrl: string;
  htmlFetched: boolean;
  aiPromptTokens: number;
  aiResponseTokens: number;
  aiSuggestedPaths: AiSuggestedPath[];
  testedPaths: string[];
  outcome: 'success' | 'js-rendered' | 'unfetchable' | 'no-suggestions' | 'no-events';
  eventsFound: number;
  bestUrl: string | null;
  patternsDiscovered: string[];
  error?: string;
}

interface RunReport {
  runId: string;
  timestamp: string;
  limit: number;
  totalProcessed: number;
  outcomes: Record<string, number>;
  sources: SourceDiscoveryResult[];
  newPatternsFound: string[];
  routedToUi: string[];
  routedToD: string[];
  remainingInPrec: string[];
}

/**
 * Load N sources from postB-preC queue.
 */
function loadSourcesFromPrec(limit: number): QueueEntry[] {
  try {
    const content = readFileSync(QUEUES.PREC, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(0, limit).map(line => {
      try { return JSON.parse(line) as QueueEntry; }
      catch { return null; }
    }).filter(Boolean) as QueueEntry[];
  } catch {
    return [];
  }
}

/**
 * Write back remaining sources (not processed) to postB-preC.
 */
function saveRemainingSources(sources: QueueEntry[]): void {
  if (sources.length === 0) {
    writeFileSync(QUEUES.PREC, '');
    return;
  }
  const lines = sources.map(s => JSON.stringify(s)).join('\n') + '\n';
  writeFileSync(QUEUES.PREC, lines);
}

/**
 * Call Anthropic Haiku API to get event subpage suggestions.
 */
async function askAiForEventPaths(sourceUrl: string, htmlContent: string): Promise<{ paths: string[]; promptTokens: number; responseTokens: number }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured in .env');
  }

  const truncatedHtml = htmlContent.slice(0, 12000); // Limit context size

  const prompt = `You are analyzing a Swedish website to find event listing pages.

Root URL: ${sourceUrl}
HTML content (truncated):
${truncatedHtml}

Task: Identify ALL possible event-related subpage URL patterns on this domain.
Look for:
- Navigation links mentioning: evenemang, kalender, program, konserter, biljetter, matcher, aktiviteter, arrangemang
- Footer links to event archives, past events, ticket pages
- Any URL patterns that likely contain event listings (e.g., /evenemang, /kalender, /events, /program, /biljetter)

Return a JSON array of URL paths (absolute URLs or just paths starting with /), maximum 10 suggestions.
Example: ["/evenemang", "/kalender", "/program/konserter", "https://example.se/biljetter"]

Only return paths that actually exist on this domain (based on the HTML you can see).
If you cannot find any event-related paths, return an empty array: []

Return ONLY the JSON array, no explanation, no markdown formatting.`;

  let promptTokens = 0;
  let responseTokens = 0;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    promptTokens = data.usage?.input_tokens ?? 0;
    responseTokens = data.usage?.output_tokens ?? 0;

    const text = data.content?.[0]?.text ?? '[]';
    // Strip markdown code blocks if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const paths = JSON.parse(cleaned) as string[];

    return { paths: paths.filter(Boolean), promptTokens, responseTokens };
  } catch (err) {
    console.error(`[AI] API call failed: ${err}`);
    return { paths: [], promptTokens, responseTokens };
  }
}

/**
 * Test a URL for events — fetch HTML and run universal extractor.
 */
async function testUrlForEvents(baseUrl: string, url: string): Promise<AiSuggestedPath> {
  const fullUrl = url.startsWith('http') ? url : `${baseUrl.replace(/\/$/, '')}${url}`;

  try {
    const htmlResult = await fetchHtml(fullUrl, { timeout: 15000 });

    if (!htmlResult.success || !htmlResult.html) {
      return {
        path: url,
        fullUrl,
        reason: 'fetch-error',
        eventsFound: 0,
        method: 'none',
        jsRendered: false,
        status: 'fetch-error',
        error: htmlResult.error ?? 'unknown',
      };
    }

    const ext = extractFromHtml(htmlResult.html, '', fullUrl);

    if (ext.events.length > 0) {
      return {
        path: url,
        fullUrl,
        reason: 'events-found',
        eventsFound: ext.events.length,
        method: ext.methodsUsed.join(', '),
        jsRendered: false,
        status: 'success',
      };
    }

    // Check for JS-render signals (very short HTML with many script tags)
    const scriptCount = (htmlResult.html.match(/<script/g) ?? []).length;
    const textLength = htmlResult.html.replace(/<[^>]+>/g, '').length;
    const jsRendered = scriptCount > 10 && textLength < 5000;

    if (jsRendered) {
      return {
        path: url,
        fullUrl,
        reason: 'likely-js-rendered',
        eventsFound: 0,
        method: 'none',
        jsRendered: true,
        status: 'js-rendered',
      };
    }

    return {
      path: url,
      fullUrl,
      reason: 'no-events',
      eventsFound: 0,
      method: ext.methodsUsed.join(', '),
      jsRendered: false,
      status: 'no-events',
    };
  } catch (err: any) {
    return {
      path: url,
      fullUrl,
      reason: 'fetch-error',
      eventsFound: 0,
      method: 'none',
      jsRendered: false,
      status: 'fetch-error',
      error: err.message,
    };
  }
}

/**
 * Extract URL patterns (path segments) from tested URLs for C0 incorporation.
 */
function extractPatterns(suggestedPaths: AiSuggestedPath[]): string[] {
  const patterns = new Set<string>();
  for (const sp of suggestedPaths) {
    try {
      const u = new URL(sp.fullUrl);
      const segments = u.pathname.split('/').filter(Boolean);
      // Extract meaningful segments (length > 3, no pure numbers)
      for (const seg of segments) {
        if (seg.length > 3 && !/^\d+$/.test(seg) && !['sv', 'en', 'page', 'id'].includes(seg)) {
          patterns.add(`/${seg}`);
        }
      }
    } catch {
      // skip
    }
  }
  return Array.from(patterns);
}

/**
 * Route a source result to appropriate queue.
 */
function routeSource(result: SourceDiscoveryResult): void {
  const queueEntry = {
    sourceId: result.sourceId,
    queueName: '',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: `ai-discovery: ${result.outcome} (${result.eventsFound} events)`,
    workerNotes: `ai-discovery best-url: ${result.bestUrl ?? 'none'}`,
    winningStage: 'C-AI',
    outcomeType: result.outcome === 'success' ? 'extract_success' : 'fail',
    routeSuggestion: 'AI',
    roundNumber: 1,
    roundsParticipated: 1,
  };

  if (result.outcome === 'success') {
    appendFileSync(QUEUES.UI, JSON.stringify({ ...queueEntry, queueName: 'postTestC-UI' }) + '\n');
  } else if (result.outcome === 'js-rendered') {
    appendFileSync(QUEUES.D, JSON.stringify({ ...queueEntry, queueName: 'postTestC-D' }) + '\n');
  } else {
    // Put back in postB-preC for regular processing
    appendFileSync(QUEUES.PREC, JSON.stringify({
      sourceId: result.sourceId,
      url: result.sourceUrl,
      queueName: 'postB-preC',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: `ai-discovery: ${result.outcome}`,
    }) + '\n');
  }
}

/**
 * Main discovery run for a single source.
 */
async function discoverForSource(entry: QueueEntry): Promise<SourceDiscoveryResult> {
  console.log(`\n=== ${entry.sourceId} ===`);

  const result: SourceDiscoveryResult = {
    sourceId: entry.sourceId,
    sourceUrl: entry.url,
    htmlFetched: false,
    aiPromptTokens: 0,
    aiResponseTokens: 0,
    aiSuggestedPaths: [],
    testedPaths: [],
    outcome: 'unfetchable',
    eventsFound: 0,
    bestUrl: null,
    patternsDiscovered: [],
  };

  // 1. Fetch root HTML
  console.log(`[Fetch] ${entry.url}`);
  const htmlResult = await fetchHtml(entry.url, { timeout: 20000 });

  if (!htmlResult.success || !htmlResult.html) {
    result.outcome = 'unfetchable';
    result.error = htmlResult.error ?? 'fetch failed';
    return result;
  }

  result.htmlFetched = true;
  console.log(`[OK] HTML fetched (${Buffer.byteLength(htmlResult.html, 'utf8')} bytes)`);

  // 2. Ask AI for event path suggestions
  console.log(`[AI] Asking for event path suggestions...`);
  const { paths: aiPaths, promptTokens, responseTokens } = await askAiForEventPaths(entry.url, htmlResult.html);
  result.aiPromptTokens = promptTokens;
  result.aiResponseTokens = responseTokens;
  console.log(`[AI] Got ${aiPaths.length} suggestions (prompt=${promptTokens}, resp=${responseTokens})`);

  if (aiPaths.length === 0) {
    result.outcome = 'no-suggestions';
    return result;
  }

  // 3. Test each AI-suggested URL
  const tested: AiSuggestedPath[] = [];
  let bestEvents = 0;
  let bestUrl: string | null = null;
  let hasJsRendered = false;

  for (const path of aiPaths.slice(0, 8)) { // cap at 8 per source
    console.log(`[Test] ${path}`);
    const testedResult = await testUrlForEvents(entry.url, path);
    tested.push(testedResult);
    result.testedPaths.push(testedResult.fullUrl);

    if (testedResult.status === 'success' && testedResult.eventsFound > bestEvents) {
      bestEvents = testedResult.eventsFound;
      bestUrl = testedResult.fullUrl;
    }
    if (testedResult.status === 'js-rendered') {
      hasJsRendered = true;
    }
  }

  result.aiSuggestedPaths = tested;
  result.eventsFound = bestEvents;
  result.bestUrl = bestUrl;
  result.patternsDiscovered = extractPatterns(tested);

  // 4. Determine outcome
  if (bestEvents > 0) {
    result.outcome = 'success';
    console.log(`[Result] SUCCESS — ${bestEvents} events at ${bestUrl}`);
  } else if (hasJsRendered) {
    result.outcome = 'js-rendered';
    console.log(`[Result] JS-RENDERED — no events found on any path`);
  } else {
    result.outcome = 'no-events';
    console.log(`[Result] NO-EVENTS — ${tested.length} paths tested, 0 events`);
  }

  return result;
}

/**
 * Main entry point.
 */
async function main() {
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  log('DYNAMIC AI DEEP DISCOVERY — runC-ai-deep-discovery');
  log(`Limit: ${LIMIT} sources`);
  log(`Report: ${REPORT_NAME}`);

  if (!ANTHROPIC_API_KEY) {
    log('ERROR: ANTHROPIC_API_KEY not set in .env — cannot call AI');
    process.exit(1);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });

  // Load sources
  const sources = loadSourcesFromPrec(LIMIT);
  log(`Loaded ${sources.length} sources from postB-preC`);

  if (sources.length === 0) {
    console.log('No sources in postB-preC queue — nothing to do.');
    process.exit(0);
  }

  const report: RunReport = {
    runId: REPORT_NAME,
    timestamp: new Date().toISOString(),
    limit: LIMIT,
    totalProcessed: sources.length,
    outcomes: {},
    sources: [],
    newPatternsFound: [],
    routedToUi: [],
    routedToD: [],
    remainingInPrec: [],
  };

  for (const source of sources) {
    const result = await discoverForSource(source);
    report.sources.push(result);

    // Tally outcomes
    report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;

    // Collect patterns
    for (const pat of result.patternsDiscovered) {
      if (!report.newPatternsFound.includes(pat)) {
        report.newPatternsFound.push(pat);
      }
    }

    // Route to appropriate queue
    routeSource(result);

    if (result.outcome === 'success') {
      report.routedToUi.push(result.sourceId);
    } else if (result.outcome === 'js-rendered') {
      report.routedToD.push(result.sourceId);
    } else {
      report.remainingInPrec.push(result.sourceId);
    }
  }

  // Write report
  const reportPath = join(REPORTS_DIR, `run-${REPORT_NAME}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // Summary
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`Sources processed: ${report.totalProcessed}`);
  for (const [outcome, count] of Object.entries(report.outcomes)) {
    console.log(`  ${outcome}: ${count}`);
  }
  console.log(`→ postTestC-UI: ${report.routedToUi.length}`);
  console.log(`→ postTestC-D: ${report.routedToD.length}`);
  console.log(`→ postB-preC (remaining): ${report.remainingInPrec.length}`);
  if (report.newPatternsFound.length > 0) {
    console.log(`New patterns found: ${report.newPatternsFound.length}`);
    for (const p of report.newPatternsFound.slice(0, 10)) {
      console.log(`  ${p}`);
    }
  }
  console.log(`\nFull report: ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
