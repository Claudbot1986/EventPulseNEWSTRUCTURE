/**
 * runD-ai-scrapingbee.ts — Tool D-AI (site-by-site AI extraction via ScrapingBee)
 *
 * AI: model fixed to MiniMax-M2.7 only (OpenAI-compatible API, MINIMAX_API_KEY).
 *
 * Purpose:
 * - Process each queue entry individually (no dedupe)
 * - Use ScrapingBee-rendered HTML + AI to suggest candidate event pages
 * - Extract events per candidate and route exactly one output entry per input entry
 *
 * Queue invariant:
 * - processed_input_count MUST equal appended_output_count (UI + man1 + man)
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { getSource } from '../tools/sourceRegistry';
import { renderPage } from './renderGate';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

interface CandidatePlan {
  candidates: string[];
  inputTokens: number;
  outputTokens: number;
  /** MiniMax M2.7 (or none if key missing / request failed) */
  provider: 'minimax' | 'none';
}

interface AiDResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  reason: string;
  renderedPages: number;
}

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runD-ai-scrapingbee-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const DEFAULT_INPUT_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const OUT_UI_FILE = path.resolve(RUNTIME_DIR, 'postD-UI.jsonl');
const OUT_MAN1_FILE = path.resolve(RUNTIME_DIR, 'postD-man1.jsonl');
const OUT_MAN_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const EXTRACTED_DIR = path.resolve(__dirname, '../../../03-Queue/03-extractedevents/D');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_BASE = (process.env.MINIMAX_API_BASE || 'https://api.minimax.io/v1').replace(/\/$/, '');
/** Fixed — do not override via env (project policy: M2.7 only). */
const MINIMAX_MODEL_ID = 'MiniMax-M2.7';

const DEFAULT_LIMIT = 50;
const DEFAULT_WORKERS = 4;
const DEFAULT_MAX_PAGES = 8;
const MIN_EVENTS_FOR_SUCCESS = 2;

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

function readQueue(file: string): QueueEntry[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  const out: QueueEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as QueueEntry);
    } catch {
      log(`[WARN] invalid JSONL row skipped in ${path.basename(file)}`);
    }
  }
  return out;
}

function writeQueue(file: string, entries: QueueEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(file, content ? content + '\n' : '', 'utf8');
}

function appendQueue(file: string, entries: QueueEntry[]): void {
  if (entries.length === 0) return;
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8');
    writeFileSync(file, existing + content, 'utf8');
  } else {
    writeFileSync(file, content, 'utf8');
  }
}

function writeExtractedEvents(sourceId: string, events: ParsedEvent[]) {
  mkdirSync(EXTRACTED_DIR, { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(path.join(EXTRACTED_DIR, `${sourceId}.jsonl`), lines, 'utf8');
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  const out: ParsedEvent[] = [];
  for (const e of events) {
    const key = `${e.title}|${e.date || ''}|${e.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** MiniMax M2.7 can wrap answers in thinking tags; strip before JSON parse. */
function stripMinimaxThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .trim();
}

function parseAiCandidateArray(raw: string, baseUrl: string): string[] {
  const cleaned = stripMinimaxThinkingBlocks(raw)
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = new Set<string>();
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    try {
      const u = new URL(s, baseUrl);
      out.add(`${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, '') || u.origin);
    } catch {
      continue;
    }
    if (out.size >= 12) break;
  }
  return Array.from(out);
}

function buildCandidateUserPrompt(sourceUrl: string, clippedHtml: string): string {
  return `Analyze this rendered website root HTML and propose event-listing candidate URLs.

Source URL: ${sourceUrl}

Rendered HTML (truncated):
${clippedHtml}

Requirements:
- Return ONLY a JSON array of URL strings.
- Include only same-site URLs likely to list many events.
- Prioritize links containing: evenemang, kalender, events, program, tickets.
- Max 10 URLs.
- If uncertain, return [].
`;
}

async function askMinimaxForCandidates(sourceUrl: string, prompt: string): Promise<CandidatePlan> {
  if (!MINIMAX_API_KEY) {
    return { candidates: [], inputTokens: 0, outputTokens: 0, provider: 'none' };
  }
  try {
    const response = await fetch(`${MINIMAX_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL_ID,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      return { candidates: [], inputTokens: 0, outputTokens: 0, provider: 'none' };
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    const candidates = parseAiCandidateArray(raw, sourceUrl);
    const inTok = data.usage?.prompt_tokens ?? 0;
    const outTok = data.usage?.completion_tokens ?? 0;
    return {
      candidates,
      inputTokens: inTok,
      outputTokens: outTok,
      provider: 'minimax' as const,
    };
  } catch {
    return { candidates: [], inputTokens: 0, outputTokens: 0, provider: 'none' };
  }
}

async function askAiForCandidates(sourceUrl: string, rootHtml: string): Promise<CandidatePlan> {
  const clipped = rootHtml.slice(0, 16000);
  const prompt = buildCandidateUserPrompt(sourceUrl, clipped);
  return askMinimaxForCandidates(sourceUrl, prompt);
}

function fallbackCandidates(sourceUrl: string): string[] {
  const base = new URL(sourceUrl);
  const hints = ['/evenemang', '/kalender', '/events', '/program', '/whatson', '/happening', '/biljetter'];
  return hints.map(h => new URL(h, `${base.origin}/`).toString().replace(/\/+$/, ''));
}

async function processSource(entry: QueueEntry, maxPages: number): Promise<AiDResult> {
  const source = getSource(entry.sourceId);
  if (!source) {
    return { sourceId: entry.sourceId, success: false, eventsFound: 0, reason: 'source not found', renderedPages: 0 };
  }

  const first = await renderPage(source.url, { timeout: 45000 });
  if (!first.success || !first.html) {
    return {
      sourceId: entry.sourceId,
      success: false,
      eventsFound: 0,
      reason: first.error || 'root render failed',
      renderedPages: 1,
    };
  }

  const ai = await askAiForCandidates(source.url, first.html);
  const candidates = [source.url, ...ai.candidates, ...fallbackCandidates(source.url)];
  const targetUrls = Array.from(new Set(candidates)).slice(0, maxPages);

  const allEvents: ParsedEvent[] = [];
  let renderedPages = 0;
  for (const url of targetUrls) {
    // eslint-disable-next-line no-await-in-loop
    const rr = url === source.url ? first : await renderPage(url, { timeout: 45000 });
    renderedPages += 1;
    if (!rr.success || !rr.html) continue;
    const ext = extractFromHtml(rr.html, entry.sourceId, url);
    allEvents.push(...ext.events);
    const uniqueNow = dedupeEvents(allEvents);
    if (uniqueNow.length >= MIN_EVENTS_FOR_SUCCESS) {
      writeExtractedEvents(entry.sourceId, uniqueNow);
      return {
        sourceId: entry.sourceId,
        success: true,
        eventsFound: uniqueNow.length,
        reason: `ai+scb success; pages=${renderedPages}; ai=${ai.provider}; aiCandidates=${ai.candidates.length}; tokens=${ai.inputTokens}/${ai.outputTokens}`,
        renderedPages,
      };
    }
  }

  const unique = dedupeEvents(allEvents);
  if (unique.length >= MIN_EVENTS_FOR_SUCCESS) {
    writeExtractedEvents(entry.sourceId, unique);
    return {
      sourceId: entry.sourceId,
      success: true,
      eventsFound: unique.length,
      reason: `ai+scb success (late); pages=${renderedPages}; ai=${ai.provider}; aiCandidates=${ai.candidates.length}`,
      renderedPages,
    };
  }

  return {
    sourceId: entry.sourceId,
    success: false,
    eventsFound: unique.length,
    reason: unique.length === 1 ? 'only one event found (ai+scb)' : 'no events found after ai+scb',
    renderedPages,
  };
}

async function runParallel<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function loop() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, loop));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const inputFileName = args.find(a => a.startsWith('--input='))?.split('=')[1];
  const inputFile = path.resolve(RUNTIME_DIR, inputFileName || path.basename(DEFAULT_INPUT_FILE));
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULT_LIMIT), 10);
  const workers = parseInt(args.find(a => a.startsWith('--workers='))?.split('=')[1] || String(DEFAULT_WORKERS), 10);
  const maxPages = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] || String(DEFAULT_MAX_PAGES), 10);

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  const allEntries = readQueue(inputFile);
  const batch = allEntries.slice(0, limit);
  const remaining = allEntries.slice(limit);

  log('═══════════════════════════════════════════════════════════════════');
  log(`Tool D-AI — ${MINIMAX_MODEL_ID} + ScrapingBee site-by-site`);
  if (!MINIMAX_API_KEY) {
    log('[WARN] MINIMAX_API_KEY missing — AI candidate suggestions will be empty.');
  }
  log(`Input: ${path.basename(inputFile)} | Workers: ${workers} | Limit: ${limit} | MaxPages: ${maxPages} | Dry: ${dry}`);
  log(`Entries: ${allEntries.length} total | ${batch.length} this run`);
  log('Invariant: processed input count must equal output routed count');
  log('═══════════════════════════════════════════════════════════════════');

  if (batch.length === 0) {
    log('Input queue is empty, nothing to do.');
    return;
  }

  if (dry) {
    for (const e of batch) log(`[DRY] ${e.sourceId}`);
    return;
  }

  const results = await runParallel(
    batch,
    (entry) => processSource(entry, maxPages),
    workers
  );

  const toUi: QueueEntry[] = [];
  const toMan1: QueueEntry[] = [];
  const toMan: QueueEntry[] = [];

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    const res = results[i];
    if (res.success && res.eventsFound >= MIN_EVENTS_FOR_SUCCESS) {
      toUi.push({
        sourceId: entry.sourceId,
        queueName: 'postD-UI',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolD-ai: ${res.eventsFound} events found`,
        workerNotes: `renderedPages=${res.renderedPages}; ${res.reason}`,
      });
      log(`[OK] ${entry.sourceId} -> postD-UI (${res.eventsFound} events)`);
    } else if (res.eventsFound === 1 || (res.reason || '').includes('only one event')) {
      toMan1.push({
        sourceId: entry.sourceId,
        queueName: 'postD-man1',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: 'toolD-ai: one event extracted',
        workerNotes: `eventsFound=1; renderedPages=${res.renderedPages}; ${res.reason}`,
      });
      log(`[MAN1] ${entry.sourceId} -> postD-man1 (1 event)`);
    } else {
      toMan.push({
        sourceId: entry.sourceId,
        queueName: 'postD-man',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolD-ai: ${res.reason}`,
        workerNotes: `eventsFound=${res.eventsFound}; renderedPages=${res.renderedPages}`,
      });
      log(`[FAIL] ${entry.sourceId} -> postD-man (${res.reason})`);
    }
  }

  const processedCount = batch.length;
  const routedCount = toUi.length + toMan1.length + toMan.length;
  if (processedCount !== routedCount) {
    throw new Error(`Queue invariant violated: processed=${processedCount} routed=${routedCount}`);
  }

  writeQueue(inputFile, remaining);
  appendQueue(OUT_UI_FILE, toUi);
  appendQueue(OUT_MAN1_FILE, toMan1);
  appendQueue(OUT_MAN_FILE, toMan);

  log('═══════════════════════════════════════════════════════════════════');
  log(`SUMMARY postD-UI: ${toUi.length} | postD-man1: ${toMan1.length} | postD-man: ${toMan.length} | remaining in input: ${remaining.length}`);
  log(`INVARIANT OK: processed=${processedCount}, routed=${routedCount}`);
  log('═══════════════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

