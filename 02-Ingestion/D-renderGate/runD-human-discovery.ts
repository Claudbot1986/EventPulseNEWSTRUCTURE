/**
 * runD-human-discovery.ts — Tool D-HUMAN
 *
 * Goal:
 * - Mimic manual browsing better than static candidate discovery.
 * - Use MiniMax M2.7 to choose which internal links to follow at each hop.
 * - Keep strict queue invariant: processed input rows === routed output rows.
 *
 * Queue policy:
 * - events >= 2 => postD-UI
 * - events == 1 => postD-man1
 * - events == 0 / fail => postD-man
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

interface HumanDResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  reason: string;
  renderedPages: number;
}

interface LinkCandidate {
  url: string;
  text: string;
}

const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runD-human-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const INPUT_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const OUT_UI_FILE = path.resolve(RUNTIME_DIR, 'postD-UI.jsonl');
const OUT_MAN1_FILE = path.resolve(RUNTIME_DIR, 'postD-man1.jsonl');
const OUT_MAN_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const EXTRACTED_DIR = path.resolve(__dirname, '../../../03-Queue/03-extractedevents/D');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_API_BASE = (process.env.MINIMAX_API_BASE || 'https://api.minimax.io/v1').replace(/\/$/, '');
const MINIMAX_MODEL_ID = 'MiniMax-M2.7';

const DEFAULT_LIMIT = 20;
const DEFAULT_WORKERS = 2;
const DEFAULT_MAX_PAGES = 14;
const DEFAULT_MAX_DEPTH = 3;
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

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function sameSite(hostA: string, hostB: string): boolean {
  const a = normalizeHost(hostA);
  const b = normalizeHost(hostB);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function isAssetLike(url: URL): boolean {
  return /\.(css|js|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|map|pdf|xml|txt|zip)$/i.test(url.pathname);
}

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
}

function discoverAnchors(html: string, currentUrl: string, maxAnchors = 120): LinkCandidate[] {
  const base = new URL(currentUrl);
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = new Map<string, LinkCandidate>();

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] || '').trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    let u: URL;
    try {
      u = new URL(href, currentUrl);
    } catch {
      continue;
    }
    if (!sameSite(u.host, base.host)) continue;
    if (isAssetLike(u)) continue;
    if (u.pathname.includes('/_next/static') || u.pathname.includes('/sitevision/system-resource')) continue;

    const key = `${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, '') || u.origin;
    const rawText = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const text = rawText.slice(0, 120);

    if (!out.has(key)) out.set(key, { url: key, text });
    if (out.size >= maxAnchors) break;
  }
  return Array.from(out.values());
}

function heuristicRank(candidates: LinkCandidate[], take = 8): string[] {
  const hint = /(evenemang|kalender|events?|program|whatson|happening|biljett|ticket|forestallning|föreställning)/i;
  return candidates
    .map(c => {
      let score = 0;
      const combined = `${c.url} ${c.text}`;
      if (hint.test(combined)) score += 10;
      if (/nyhet|news|blog|press/.test(combined.toLowerCase())) score -= 4;
      score += Math.max(0, Math.min(3, c.text.length / 40));
      return { url: c.url, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map(x => x.url);
}

async function rankLinksWithMinimax(sourceUrl: string, pageUrl: string, candidates: LinkCandidate[], take = 8): Promise<string[]> {
  if (!MINIMAX_API_KEY || candidates.length === 0) return heuristicRank(candidates, take);

  const shortlist = candidates.slice(0, 80).map((c, i) => `${i + 1}. ${c.url} | text="${c.text}"`).join('\n');
  const prompt = `You are selecting event-listing links for a crawler.
Source site: ${sourceUrl}
Current page: ${pageUrl}

Candidates:
${shortlist}

Task:
- Return ONLY a JSON array of chosen URL strings.
- Pick links most likely to contain many event items.
- Prefer event calendar/listing pages over articles.
- Max ${take} urls.
- If none, return []`;

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
    if (!response.ok) return heuristicRank(candidates, take);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = stripThinking(data.choices?.[0]?.message?.content || '[]');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return heuristicRank(candidates, take);
    }
    if (!Array.isArray(parsed)) return heuristicRank(candidates, take);
    const chosen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== 'string') continue;
      chosen.add(v.trim());
      if (chosen.size >= take) break;
    }
    return chosen.size > 0 ? Array.from(chosen) : heuristicRank(candidates, take);
  } catch {
    return heuristicRank(candidates, take);
  }
}

function fallbackSeeds(sourceUrl: string): string[] {
  const base = new URL(sourceUrl);
  const hints = ['/evenemang', '/kalender', '/events', '/program', '/forestallningar/kalender', '/list/#vstype=schema%3AEvent'];
  return hints.map(h => new URL(h, `${base.origin}/`).toString().replace(/\/+$/, ''));
}

async function processSource(entry: QueueEntry, maxPages: number, maxDepth: number): Promise<HumanDResult> {
  const source = getSource(entry.sourceId);
  if (!source) return { sourceId: entry.sourceId, success: false, eventsFound: 0, reason: 'source not found', renderedPages: 0 };

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: source.url, depth: 0 }];
  for (const seed of fallbackSeeds(source.url)) queue.push({ url: seed, depth: 1 });

  const allEvents: ParsedEvent[] = [];
  let renderedPages = 0;

  while (queue.length > 0 && renderedPages < maxPages) {
    const current = queue.shift()!;
    const normalized = current.url.replace(/\/+$/, '');
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    // eslint-disable-next-line no-await-in-loop
    const rr = await renderPage(current.url, { timeout: 45000 });
    renderedPages += 1;
    if (!rr.success || !rr.html) continue;

    const ext = extractFromHtml(rr.html, entry.sourceId, current.url);
    allEvents.push(...ext.events);
    const unique = dedupeEvents(allEvents);
    if (unique.length >= MIN_EVENTS_FOR_SUCCESS) {
      writeExtractedEvents(entry.sourceId, unique);
      return {
        sourceId: entry.sourceId,
        success: true,
        eventsFound: unique.length,
        reason: `human-discovery success at depth=${current.depth}; renderedPages=${renderedPages}`,
        renderedPages,
      };
    }

    if (current.depth >= maxDepth) continue;

    const anchors = discoverAnchors(rr.html, current.url, 120);
    // eslint-disable-next-line no-await-in-loop
    const ranked = await rankLinksWithMinimax(source.url, current.url, anchors, 8);
    for (const nextUrl of ranked) {
      if (queue.length + renderedPages >= maxPages * 2) break;
      if (!visited.has(nextUrl.replace(/\/+$/, ''))) {
        queue.push({ url: nextUrl, depth: current.depth + 1 });
      }
    }
  }

  const unique = dedupeEvents(allEvents);
  return {
    sourceId: entry.sourceId,
    success: false,
    eventsFound: unique.length,
    reason: unique.length === 1 ? 'only one event found (human-discovery)' : 'no events found after human-discovery',
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
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULT_LIMIT), 10);
  const workers = parseInt(args.find(a => a.startsWith('--workers='))?.split('=')[1] || String(DEFAULT_WORKERS), 10);
  const maxPages = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] || String(DEFAULT_MAX_PAGES), 10);
  const maxDepth = parseInt(args.find(a => a.startsWith('--max-depth='))?.split('=')[1] || String(DEFAULT_MAX_DEPTH), 10);

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  const allEntries = readQueue(INPUT_FILE);
  const batch = allEntries.slice(0, limit);
  const remaining = allEntries.slice(limit);

  log('═══════════════════════════════════════════════════════════════════');
  log(`Tool D-HUMAN — ${MINIMAX_MODEL_ID} + ScrapingBee multi-hop`);
  if (!MINIMAX_API_KEY) log('[WARN] MINIMAX_API_KEY missing — fallback to heuristic link ranking only.');
  log(`Input: postD-man | Workers: ${workers} | Limit: ${limit} | MaxPages: ${maxPages} | MaxDepth: ${maxDepth} | Dry: ${dry}`);
  log(`Entries: ${allEntries.length} total | ${batch.length} this run`);
  log('Invariant: processed input count must equal output routed count');
  log('═══════════════════════════════════════════════════════════════════');

  if (batch.length === 0) {
    log('postD-man is empty, nothing to do.');
    return;
  }

  if (dry) {
    for (const e of batch) log(`[DRY] ${e.sourceId}`);
    return;
  }

  const results = await runParallel(
    batch,
    (entry) => processSource(entry, maxPages, maxDepth),
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
        queueReason: `toolD-human: ${res.eventsFound} events found`,
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
        queueReason: 'toolD-human: one event extracted',
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
        queueReason: `toolD-human: ${res.reason}`,
        workerNotes: `eventsFound=${res.eventsFound}; renderedPages=${res.renderedPages}`,
      });
      log(`[FAIL] ${entry.sourceId} -> postD-man (${res.reason})`);
    }
  }

  const processed = batch.length;
  const routed = toUi.length + toMan1.length + toMan.length;
  if (processed !== routed) {
    throw new Error(`Queue invariant violated: processed=${processed}, routed=${routed}`);
  }

  writeQueue(INPUT_FILE, remaining);
  appendQueue(OUT_UI_FILE, toUi);
  appendQueue(OUT_MAN1_FILE, toMan1);
  appendQueue(OUT_MAN_FILE, toMan);

  log('═══════════════════════════════════════════════════════════════════');
  log(`SUMMARY postD-UI: ${toUi.length} | postD-man1: ${toMan1.length} | postD-man: ${toMan.length} | postD-man remaining: ${remaining.length}`);
  log(`INVARIANT OK: processed=${processed}, routed=${routed}`);
  log('═══════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

