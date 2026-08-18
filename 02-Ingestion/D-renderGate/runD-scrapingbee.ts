/**
 * runD-scrapingbee.ts — Tool D (JS render gate)
 *
 * Input:  runtime/postTestC-D.jsonl
 * Output:
 * - runtime/postD-UI.jsonl (success, events >= 2)
 * - runtime/postD-man1.jsonl (exactly 1 event)
 * - runtime/postD-man.jsonl (0 events / hard fail)
 *
 * Policy:
 * - events >= 2 => postD-UI
 * - events == 1 => postD-man1
 * - events == 0 or render/extraction fail => postD-man
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getSource } from '../tools/sourceRegistry';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';
import { renderPage } from './renderGate';

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
  workerNotes?: string;
}

interface DResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  reason: string;
  renderedPages: number;
}

const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : path.resolve(__dirname, '../..');
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runD-scrapingbee-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const INPUT_FILE = path.resolve(RUNTIME_DIR, 'postTestC-D.jsonl');
const OUT_UI_FILE = path.resolve(RUNTIME_DIR, 'postD-UI.jsonl');
const OUT_MAN1_FILE = path.resolve(RUNTIME_DIR, 'postD-man1.jsonl');
const OUT_MAN_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const EXTRACTED_DIR = path.resolve(DATA_ROOT, '03-Queue/03-extractedevents/D');

const DEFAULT_LIMIT = 50;
const DEFAULT_WORKERS = 2;
const DEFAULT_MAX_PAGES = 8;
const MIN_EVENTS_FOR_SUCCESS = 2;
const SOURCE_TIMEOUT_MS = 120000;
const EVENT_PATH_HINTS = [
  '/evenemang',
  '/kalender',
  '/events',
  '/event',
  '/program',
  '/happenings',
  '/whatson',
  '/visit',
];

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
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

function writeQueue(file: string, entries: QueueEntry[]): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(file, content, 'utf8');
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
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

function normalizedHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function sameSiteHost(hostA: string, hostB: string): boolean {
  const a = normalizedHost(hostA);
  const b = normalizedHost(hostB);
  if (a === b) return true;
  // Pragmatic same-site allowance without extra deps.
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function isAssetLikePath(pathname: string): boolean {
  return /\.(css|js|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|map|pdf|xml|txt|zip)$/i.test(pathname);
}

function scoreCandidate(url: URL, anchorText: string): number {
  const urlText = `${url.pathname} ${url.search}`.toLowerCase();
  const text = anchorText.toLowerCase();
  let score = 0;
  if (/evenemang|kalender|events?|program|what'?s\s*on|happening/.test(urlText)) score += 8;
  if (/evenemang|kalender|events?|program|what'?s\s*on|happening/.test(text)) score += 7;
  if (/biljett|ticket|booking|bokning/.test(urlText + ' ' + text)) score += 2;
  if (/nyhet|news|blog|article/.test(urlText + ' ' + text)) score -= 4;
  if (url.pathname.split('/').filter(Boolean).length <= 1) score -= 2;
  return score;
}

function discoverCandidateLinks(html: string, baseUrl: string, maxPages: number): string[] {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const scored = new Map<string, number>();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    let u: URL;
    try {
      u = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!sameSiteHost(u.host, base.host)) return;
    if (isAssetLikePath(u.pathname)) return;
    if (u.pathname.includes('/_next/static') || u.pathname.includes('/sitevision/system-resource')) return;
    const key = `${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, '') || u.origin;
    const score = scoreCandidate(u, $(el).text().trim());
    if (score <= 0) return;
    const prev = scored.get(key) ?? Number.NEGATIVE_INFINITY;
    if (score > prev) scored.set(key, score);
  });

  const ranked = Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, Math.max(0, maxPages - 1));

  return ranked;
}

function fallbackEventPaths(baseUrl: string, maxPages: number): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  for (const p of EVENT_PATH_HINTS) {
    const u = new URL(p, `${base.origin}/`).toString().replace(/\/+$/, '');
    out.push(u);
    if (out.length >= Math.max(0, maxPages - 1)) break;
  }
  return out;
}

function discoverScriptEmbeddedCandidateLinks(html: string, baseUrl: string, maxLinks: number): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  const rx = /https?:\/\/[^\s"'<>]+|\/[a-z0-9\-_/]+/gi;
  const hintRx = /(event|events|evenemang|kalender|program|whatson|happening|visit)/i;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const raw = m[0];
    if (!hintRx.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (!sameSiteHost(u.host, base.host)) continue;
    if (isAssetLikePath(u.pathname)) continue;
    if (u.pathname.includes('/_next/static') || u.pathname.includes('/sitevision/system-resource')) continue;
    const clean = `${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, '') || u.origin;
    out.add(clean);
    if (out.size >= maxLinks) break;
  }
  return Array.from(out);
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

function timeoutResult(sourceId: string): DResult {
  return {
    sourceId,
    success: false,
    eventsFound: 0,
    reason: `source-timeout>${SOURCE_TIMEOUT_MS}ms`,
    renderedPages: 0,
  };
}

async function processSource(entry: QueueEntry, maxPages: number): Promise<DResult> {
  const source = getSource(entry.sourceId);
  if (!source) {
    return { sourceId: entry.sourceId, success: false, eventsFound: 0, reason: 'source not found', renderedPages: 0 };
  }

  const targetUrls: string[] = [source.url];
  let first = await renderPage(source.url, { timeout: 30000 });
  if (!first.success && (first.error || '').toLowerCase().includes('timeout')) {
    first = await renderPage(source.url, { timeout: 45000 });
  }
  if (!first.success || !first.html) {
    return {
      sourceId: entry.sourceId,
      success: false,
      eventsFound: 0,
      reason: first.error || 'render failed',
      renderedPages: 1,
    };
  }

  const candidates = discoverCandidateLinks(first.html, source.url, maxPages);
  for (const c of candidates) {
    if (targetUrls.length >= maxPages) break;
    if (!targetUrls.includes(c)) targetUrls.push(c);
  }

  // Secondary discovery pass: parse script-embedded URLs for event-like paths.
  if (targetUrls.length < Math.min(4, maxPages)) {
    const scripted = discoverScriptEmbeddedCandidateLinks(first.html, source.url, maxPages);
    for (const c of scripted) {
      if (targetUrls.length >= maxPages) break;
      if (!targetUrls.includes(c)) targetUrls.push(c);
    }
  }

  // Discovery fallback when anchor-based candidate discovery is weak.
  if (targetUrls.length < Math.min(4, maxPages)) {
    const fallback = fallbackEventPaths(source.url, maxPages);
    for (const c of fallback) {
      if (targetUrls.length >= maxPages) break;
      if (!targetUrls.includes(c)) targetUrls.push(c);
    }
  }

  const allEvents: ParsedEvent[] = [];
  let renderedPages = 1;

  // Reuse already rendered first page to avoid duplicate render.
  {
    const extracted = extractFromHtml(first.html, entry.sourceId, source.url).events || [];
    for (const e of extracted) allEvents.push(e);
    const current = dedupeEvents(allEvents);
    if (current.length >= MIN_EVENTS_FOR_SUCCESS) {
      writeExtractedEvents(entry.sourceId, current);
      return {
        sourceId: entry.sourceId,
        success: true,
        eventsFound: current.length,
        reason: `events found via JS render (${renderedPages} pages)`,
        renderedPages,
      };
    }
  }

  for (const url of targetUrls.slice(1)) {
    let rr = await renderPage(url, { timeout: 30000 });
    if (!rr.success && (rr.error || '').toLowerCase().includes('timeout')) {
      rr = await renderPage(url, { timeout: 45000 });
    }
    renderedPages += 1;
    if (!rr.success || !rr.html) continue;
    const extracted = extractFromHtml(rr.html, entry.sourceId, url).events || [];
    for (const e of extracted) allEvents.push(e);
    const current = dedupeEvents(allEvents);
    if (current.length >= MIN_EVENTS_FOR_SUCCESS) {
      writeExtractedEvents(entry.sourceId, current);
      return {
        sourceId: entry.sourceId,
        success: true,
        eventsFound: current.length,
        reason: `events found via JS render (${renderedPages} pages)`,
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
      reason: `events found via JS render (${renderedPages} pages)`,
      renderedPages,
    };
  }

  return {
    sourceId: entry.sourceId,
    success: false,
    eventsFound: unique.length,
    reason: unique.length === 1 ? 'only one event found' : 'no events found after JS rendering',
    renderedPages,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULT_LIMIT), 10);
  const workers = parseInt(args.find(a => a.startsWith('--workers='))?.split('=')[1] || String(DEFAULT_WORKERS), 10);
  const maxPages = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] || String(DEFAULT_MAX_PAGES), 10);

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  const allEntries = readQueue(INPUT_FILE);
  const seen = new Set<string>();
  const unique = allEntries.filter(e => (seen.has(e.sourceId) ? false : (seen.add(e.sourceId), true)));
  const batch = unique.slice(0, limit);
  const remaining = unique.slice(limit);

  log('═══════════════════════════════════════════════════════════════════');
  log('Tool D — JS Render Gate');
  log(`Workers: ${workers} | Limit: ${limit} | MaxPages: ${maxPages} | Dry: ${dry}`);
  log(`Input postTestC-D: ${allEntries.length} total | ${unique.length} unique | ${batch.length} this run`);
  log('═══════════════════════════════════════════════════════════════════');

  if (batch.length === 0) {
    log('postTestC-D is empty, nothing to do.');
    return;
  }

  if (dry) {
    for (const e of batch) log(`[DRY] ${e.sourceId}`);
    return;
  }

  const results = await runParallel(
    batch,
    (entry) => Promise.race<DResult>([
      processSource(entry, maxPages),
      new Promise<DResult>(resolve => setTimeout(() => resolve(timeoutResult(entry.sourceId)), SOURCE_TIMEOUT_MS)),
    ]),
    workers
  );
  const toUi: QueueEntry[] = [];
  const toMan1: QueueEntry[] = [];
  const toMan: QueueEntry[] = [];

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    const res = results[i];
    if (res.success) {
      toUi.push({
        sourceId: entry.sourceId,
        queueName: 'postD-UI',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolD: ${res.eventsFound} events found`,
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
        queueReason: `toolD: one event extracted (route to man1)`,
        workerNotes: `eventsFound=${res.eventsFound}; renderedPages=${res.renderedPages}; ${res.reason}`,
      });
      log(`[MAN1] ${entry.sourceId} -> postD-man1 (1 event)`);
    } else {
      toMan.push({
        sourceId: entry.sourceId,
        queueName: 'postD-man',
        queuedAt: new Date().toISOString(),
        priority: entry.priority,
        attempt: entry.attempt + 1,
        queueReason: `toolD: ${res.reason}`,
        workerNotes: `eventsFound=${res.eventsFound}; renderedPages=${res.renderedPages}`,
      });
      log(`[FAIL] ${entry.sourceId} -> postD-man (${res.reason})`);
    }
  }

  writeQueue(INPUT_FILE, remaining);
  appendQueue(OUT_UI_FILE, toUi);
  appendQueue(OUT_MAN1_FILE, toMan1);
  appendQueue(OUT_MAN_FILE, toMan);

  log('═══════════════════════════════════════════════════════════════════');
  log(`SUMMARY postD-UI: ${toUi.length} | postD-man1: ${toMan1.length} | postD-man: ${toMan.length} | postTestC-D remaining: ${remaining.length}`);
  log('═══════════════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
