/**
 * runC-ai-deep-discovery-minimax.ts — AI-assisted deep discovery via Minimax API
 *
 * Reads sources from postB-preC-queue.jsonl (--limit N).
 * Uses Minimax abab6-chat model — no Anthropic dependency.
 *
 * For each source:
 *   1. Fetch the root HTML
 *   2. Ask Minimax to identify all event-related subpage URL patterns
 *   3. Test each AI-suggested URL for events
 *   4. Route: events found → postTestC-UI, JS-rendered → postTestC-D, nothing → stays in postB-preC
 *   5. Write detailed JSON report + summary
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-ai-deep-discovery-minimax.ts --limit 10 --workers 12
 */

import { fetchHtml } from '../../tools/fetchTools';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const REPORTS_DIR = join(__dirname, 'reports', 'ai-discovery');

// CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '10', 10) : 10;
const workersIdx = args.indexOf('--workers');
const WORKERS = workersIdx >= 0 ? parseInt(args[workersIdx + 1] ?? '12', 10) : 12;
const reportNameIdx = args.indexOf('--report-name');
const REPORT_NAME = reportNameIdx >= 0 ? args[reportNameIdx + 1] : new Date().toISOString().replace(/[:.]/g, '-');

// Minimax API
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';

// Queue paths
const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  D: join(RUNTIME_DIR, 'postTestC-D.jsonl'),
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// ── Types ──────────────────────────────────────────────────────────────────────

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
  workers: number;
  model: string;
  totalProcessed: number;
  outcomes: Record<string, number>;
  sources: SourceDiscoveryResult[];
  newPatternsFound: string[];
  routedToUi: string[];
  routedToD: string[];
  remainingInPrec: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function askMinimaxForEventPaths(sourceUrl: string, htmlContent: string): Promise<{ paths: string[]; promptTokens: number; responseTokens: number }> {
  if (!MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY not configured in .env');
  }

  const truncatedHtml = htmlContent.slice(0, 12000);

  const prompt = `You are analyzing a Swedish website to find event listing pages.

Root URL: ${sourceUrl}
HTML content (truncated):
${truncatedHtml}

Task: Identify ALL possible event-related subpage URL patterns on this domain.
Look for:
- Navigation links mentioning: evenemang, kalender, program, konserter, biljetter, matcher, aktiviteter, arrangemang
- Footer links to event archives, past events, ticket pages
- Any URL patterns that likely contain event listings (e.g., /evenemang, /kalender, /events, /program, /biljetter)

Return a JSON array of URL paths (absolute URLs or paths starting with /), maximum 10 suggestions.
Example: ["/evenemang", "/kalender", "/program/konserter", "https://example.se/biljetter"]

Only return paths that actually exist on this domain (based on the HTML you can see).
If you cannot find any event-related paths, return an empty array: []

Return ONLY the JSON array, no explanation, no markdown formatting.`;

  let promptTokens = 0;
  let responseTokens = 0;

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'abab6-chat',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Minimax API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    promptTokens = data.usage?.input_tokens ?? 0;
    responseTokens = data.usage?.output_tokens ?? 0;

    const text: string = data.choices?.[0]?.message?.content ?? '[]';
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const paths = JSON.parse(cleaned) as string[];

    return { paths: paths.filter(Boolean), promptTokens, responseTokens };
  } catch (err) {
    console.error(`[MINIMAX] API call failed: ${err}`);
    return { paths: [], promptTokens, responseTokens };
  }
}

async function testUrlForEvents(baseUrl: string, url: string): Promise<AiSuggestedPath> {
  const fullUrl = url.startsWith('http') ? url : `${baseUrl.replace(/\/$/, '')}${url}`;

  try {
    const htmlResult = await fetchHtml(fullUrl, { timeout: 15000 });

    if (!htmlResult.success || !htmlResult.html) {
      return {
        path: url, fullUrl, reason: 'fetch-error',
        eventsFound: 0, method: 'none', jsRendered: false,
        status: 'fetch-error', error: htmlResult.error ?? 'unknown',
      };
    }

    const text = htmlResult.html.replace(/<[^>]+>/g, ' ');
    const dateMentions = (text.match(/\d{4}-\d{2}-\d{2}/g) ?? []).length
      + (text.match(/\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/gi) ?? []).length;
    const eventKeywords = ['evenemang', 'konsert', 'biljett', 'match', 'festival', 'kalender', 'program']
      .filter(k => text.toLowerCase().includes(k)).length;
    const eventsFound = dateMentions + eventKeywords;

    if (eventsFound > 0) {
      return {
        path: url, fullUrl, reason: 'events-found',
        eventsFound, method: 'minimax-quick-check', jsRendered: false, status: 'success',
      };
    }

    const scriptCount = (htmlResult.html.match(/<script/g) ?? []).length;
    const textLength = htmlResult.html.replace(/<[^>]+>/g, '').length;
    const jsRendered = scriptCount > 10 && textLength < 5000;

    return {
      path: url, fullUrl,
      reason: jsRendered ? 'likely-js-rendered' : 'no-events',
      eventsFound: 0, method: 'none', jsRendered,
      status: jsRendered ? 'js-rendered' : 'no-events',
    };
  } catch (err: any) {
    return {
      path: url, fullUrl, reason: 'fetch-error',
      eventsFound: 0, method: 'none', jsRendered: false,
      status: 'fetch-error', error: err.message,
    };
  }
}

function extractPatterns(suggestedPaths: AiSuggestedPath[]): string[] {
  const patterns = new Set<string>();
  for (const sp of suggestedPaths) {
    try {
      const u = new URL(sp.fullUrl);
      const segments = u.pathname.split('/').filter(Boolean);
      for (const seg of segments) {
        if (seg.length > 3 && !/^\d+$/.test(seg) && !['sv', 'en', 'page', 'id'].includes(seg)) {
          patterns.add(`/${seg}`);
        }
      }
    } catch { /* skip */ }
  }
  return Array.from(patterns);
}

function routeSource(result: SourceDiscoveryResult): void {
  const queueEntry = {
    sourceId: result.sourceId,
    queueName: '',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: `minimax-discovery: ${result.outcome} (${result.eventsFound} events)`,
    workerNotes: `minimax-discovery best-url: ${result.bestUrl ?? 'none'}`,
    winningStage: 'C-AI-MINIMAX',
    outcomeType: result.outcome === 'success' ? 'extract_success' : 'fail',
    routeSuggestion: 'MINIMAX',
    roundNumber: 1,
    roundsParticipated: 1,
  };

  if (result.outcome === 'success') {
    appendFileSync(QUEUES.UI, JSON.stringify({ ...queueEntry, queueName: 'postTestC-UI' }) + '\n');
  } else if (result.outcome === 'js-rendered') {
    appendFileSync(QUEUES.D, JSON.stringify({ ...queueEntry, queueName: 'postTestC-D' }) + '\n');
  } else {
    appendFileSync(QUEUES.PREC, JSON.stringify({
      sourceId: result.sourceId,
      url: result.sourceUrl,
      queueName: 'postB-preC',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: `minimax-discovery: ${result.outcome}`,
    }) + '\n');
  }
}

// ── Parallel worker pool ────────────────────────────────────────────────────────

async function runWorker(entry: QueueEntry): Promise<SourceDiscoveryResult> {
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

  const htmlResult = await fetchHtml(entry.url, { timeout: 20000 });
  if (!htmlResult.success || !htmlResult.html) {
    result.outcome = 'unfetchable';
    result.error = htmlResult.error ?? 'fetch failed';
    return result;
  }

  result.htmlFetched = true;

  const { paths: aiPaths, promptTokens, responseTokens } = await askMinimaxForEventPaths(entry.url, htmlResult.html);
  result.aiPromptTokens = promptTokens;
  result.aiResponseTokens = responseTokens;

  if (aiPaths.length === 0) {
    result.outcome = 'no-suggestions';
    return result;
  }

  const tested: AiSuggestedPath[] = [];
  let bestEvents = 0;
  let bestUrl: string | null = null;
  let hasJsRendered = false;

  for (const path of aiPaths.slice(0, 8)) {
    const testedResult = await testUrlForEvents(entry.url, path);
    tested.push(testedResult);
    result.testedPaths.push(testedResult.fullUrl);

    if (testedResult.status === 'success' && testedResult.eventsFound > bestEvents) {
      bestEvents = testedResult.eventsFound;
      bestUrl = testedResult.fullUrl;
    }
    if (testedResult.status === 'js-rendered') hasJsRendered = true;
  }

  result.aiSuggestedPaths = tested;
  result.eventsFound = bestEvents;
  result.bestUrl = bestUrl;
  result.patternsDiscovered = extractPatterns(tested);

  if (bestEvents > 0) {
    result.outcome = 'success';
  } else if (hasJsRendered) {
    result.outcome = 'js-rendered';
  } else {
    result.outcome = 'no-events';
  }

  return result;
}

async function runPool(sources: QueueEntry[], workers: number): Promise<SourceDiscoveryResult[]> {
  const results: SourceDiscoveryResult[] = [];
  const queue = [...sources];

  while (queue.length > 0) {
    const batch = queue.splice(0, workers);
    const batchResults = await Promise.all(batch.map(s => runWorker(s)));
    results.push(...batchResults);
    console.log(`[MINIMAX-POOL] Done ${results.length}/${sources.length}`);
  }

  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('MINIMAX AI DEEP DISCOVERY — runC-ai-deep-discovery-minimax');
  console.log('============================================================');
  console.log(`Limit: ${LIMIT} sources | Workers: ${WORKERS} | Model: abab6-chat`);

  if (!MINIMAX_API_KEY) {
    console.error('ERROR: MINIMAX_API_KEY not set in .env');
    console.error('Add to .env: MINIMAX_API_KEY=your_key_here');
    process.exit(1);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });

  const sources = loadSourcesFromPrec(LIMIT);
  console.log(`\nLoaded ${sources.length} sources from postB-preC\n`);

  if (sources.length === 0) {
    console.log('No sources in postB-preC queue — nothing to do.');
    process.exit(0);
  }

  const report: RunReport = {
    runId: REPORT_NAME,
    timestamp: new Date().toISOString(),
    limit: LIMIT,
    workers: WORKERS,
    model: 'abab6-chat',
    totalProcessed: sources.length,
    outcomes: {},
    sources: [],
    newPatternsFound: [],
    routedToUi: [],
    routedToD: [],
    remainingInPrec: [],
  };

  const results = await runPool(sources, WORKERS);

  for (const result of results) {
    report.sources.push(result);
    report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;

    for (const pat of result.patternsDiscovered) {
      if (!report.newPatternsFound.includes(pat)) {
        report.newPatternsFound.push(pat);
      }
    }

    routeSource(result);

    if (result.outcome === 'success') {
      report.routedToUi.push(result.sourceId);
    } else if (result.outcome === 'js-rendered') {
      report.routedToD.push(result.sourceId);
    } else {
      report.remainingInPrec.push(result.sourceId);
    }

    const icon = result.outcome === 'success' ? '✅' : result.outcome === 'js-rendered' ? '🖥️' : '❌';
    console.log(`${icon} ${result.sourceId}: ${result.outcome} — ${result.eventsFound} events`);
  }

  const reportPath = join(REPORTS_DIR, `run-minimax-${REPORT_NAME}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

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
    for (const p of report.newPatternsFound.slice(0, 10)) console.log(`  ${p}`);
  }
  console.log(`\nFull report: ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
