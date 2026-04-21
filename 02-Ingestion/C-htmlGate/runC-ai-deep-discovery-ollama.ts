/**
 * runC-ai-deep-discovery-ollama.ts — AI-assisted deep discovery via Ollama (local Qwen)
 *
 * Reads sources from postB-preC-queue.jsonl (--limit N).
 * Uses Ollama Qwen (localhost:11434) instead of Anthropic — no rate limits, fully local.
 *
 * For each source:
 *   1. Fetch the root HTML
 *   2. Ask Ollama Qwen to identify all event-related subpage URL patterns
 *   3. Test each AI-suggested URL for events
 *   4. Route: events found → postTestC-UI, JS-rendered → postTestC-D, nothing → stays in postB-preC
 *   5. Write detailed JSON report + summary
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-ai-deep-discovery-ollama.ts --limit 10 --workers 12
 *   npx tsx 02-Ingestion/C-htmlGate/runC-ai-deep-discovery-ollama.ts --limit 20 --workers 12 --model qwen2.5:7b
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
const modelIdx = args.indexOf('--model');
const OLLAMA_MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'qwen2.5:7b';
const reportNameIdx = args.indexOf('--report-name');
const REPORT_NAME = reportNameIdx >= 0 ? args[reportNameIdx + 1] : new Date().toISOString().replace(/[:.]/g, '-');

// Ollama
const OLLAMA_URL = 'http://localhost:11434/api/generate';

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

async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json() as any;
    const hasQwen = (data.models ?? []).some((m: any) => m.name?.includes('qwen'));
    if (!hasQwen) {
      console.warn('[OLLAMA] WARNING: No Qwen model found. Available models:');
      for (const m of (data.models ?? [])) console.warn(`  - ${m.name}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function askOllamaForEventPaths(sourceUrl: string, htmlContent: string): Promise<{ paths: string[]; promptTokens: number; responseTokens: number }> {
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
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as any;
    // Ollama doesn't give token counts — estimate
    promptTokens = Math.ceil(prompt.length / 4);
    responseTokens = Math.ceil((data.response?.length ?? 0) / 4);

    const text: string = data.response ?? '[]';
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const paths = JSON.parse(cleaned) as string[];

    return { paths: paths.filter(Boolean), promptTokens, responseTokens };
  } catch (err) {
    console.error(`[OLLAMA] API call failed: ${err}`);
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

    // Quick check for events: count date mentions + event keywords
    const text = htmlResult.html.replace(/<[^>]+>/g, ' ');
    const dateMentions = (text.match(/\d{4}-\d{2}-\d{2}/g) ?? []).length
      + (text.match(/\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/gi) ?? []).length;
    const eventKeywords = ['evenemang', 'konsert', 'biljett', 'match', 'festival', 'kalender', 'program']
      .filter(k => text.toLowerCase().includes(k)).length;
    const eventsFound = dateMentions + eventKeywords;

    if (eventsFound > 0) {
      return {
        path: url, fullUrl, reason: 'events-found',
        eventsFound, method: 'ollama-quick-check', jsRendered: false, status: 'success',
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
    queueReason: `ollama-discovery: ${result.outcome} (${result.eventsFound} events)`,
    workerNotes: `ollama-discovery best-url: ${result.bestUrl ?? 'none'}`,
    winningStage: 'C-AI-OLLAMA',
    outcomeType: result.outcome === 'success' ? 'extract_success' : 'fail',
    routeSuggestion: 'OLLAMA',
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
      queueReason: `ollama-discovery: ${result.outcome}`,
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

  // 1. Fetch root HTML
  const htmlResult = await fetchHtml(entry.url, { timeout: 20000 });
  if (!htmlResult.success || !htmlResult.html) {
    result.outcome = 'unfetchable';
    result.error = htmlResult.error ?? 'fetch failed';
    return result;
  }

  result.htmlFetched = true;

  // 2. Ask Ollama for event path suggestions
  const { paths: aiPaths, promptTokens, responseTokens } = await askOllamaForEventPaths(entry.url, htmlResult.html);
  result.aiPromptTokens = promptTokens;
  result.aiResponseTokens = responseTokens;

  if (aiPaths.length === 0) {
    result.outcome = 'no-suggestions';
    return result;
  }

  // 3. Test each AI-suggested URL (sequentially per source, but sources run in parallel)
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
    console.log(`[OLLAMA-POOL] Done ${results.length}/${sources.length}`);
  }

  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('OLLAMA AI DEEP DISCOVERY — runC-ai-deep-discovery-ollama');
  console.log('============================================================');
  console.log(`Limit: ${LIMIT} sources | Workers: ${WORKERS} | Model: ${OLLAMA_MODEL}`);

  const ollamaUp = await checkOllamaHealth();
  if (!ollamaUp) {
    console.error('ERROR: Ollama is not running at localhost:11434 or has no Qwen model.');
    console.error('Start Ollama with: ollama serve');
    console.error('Pull Qwen with:     ollama pull qwen2.5:7b');
    process.exit(1);
  }
  console.log('[OLLAMA] Connected — local Qwen is ready\n');

  mkdirSync(REPORTS_DIR, { recursive: true });

  const sources = loadSourcesFromPrec(LIMIT);
  console.log(`Loaded ${sources.length} sources from postB-preC\n`);

  if (sources.length === 0) {
    console.log('No sources in postB-preC queue — nothing to do.');
    process.exit(0);
  }

  const report: RunReport = {
    runId: REPORT_NAME,
    timestamp: new Date().toISOString(),
    limit: LIMIT,
    workers: WORKERS,
    model: OLLAMA_MODEL,
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

  const reportPath = join(REPORTS_DIR, `run-ollama-${REPORT_NAME}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

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
