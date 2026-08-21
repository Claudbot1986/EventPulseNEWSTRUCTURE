/**
 * runA-extract.ts — EventPulse A-spår (fetch + JSON-LD extract)
 *
 * Läser källor från preUI-queue.jsonl, fetchar HTML, extraherar JSON-LD events,
 * och skriver events till 03-Queue/03-extractedevents/{sourceId}.jsonl
 *
 * Flöde: preUI → runA-extract → extractedevents/ → importToEventPulse → Supabase
 *
 * Usage:
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-extract.ts              # alla preUI
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-extract.ts --limit N   # N källor
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-extract.ts --dry       # visa utan att köra
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

import { getAllSources, getSourceStatus, updateSourceStatus } from '../tools/sourceRegistry';
import { fetchHtml } from '../tools/fetchTools';
import { extractFromJsonLd } from '../F-eventExtraction/extractor';
import * as cheerio from 'cheerio';
import type { ParsedEvent } from '../F-eventExtraction/schema';
import { renderPage, needsRendering } from '../D-renderGate/renderGate';

// ── Paths ────────────────────────────────────────────────────────────────────

const RUNTIME_DIR    = path.resolve(__dirname, '../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `runA-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const PREUI_Q       = path.join(RUNTIME_DIR, 'preUI-queue.jsonl');
const EXTRACTED_DIR  = path.resolve(__dirname, '../../03-Queue/03-extractedevents');
const ADAPTERS_DIR   = path.join(RUNTIME_DIR, 'adapters');

// ── D-AI adapter loader ─────────────────────────────────────────────────────────

interface DaiAdapter {
  sourceId: string;
  seedUrl: string;
  candidateUrls: string[];
  selectors: {
    eventContainer?: string;
    title?: string;
    date?: string;
    venue?: string;
    description?: string;
    link?: string;
  };
  rateLimitMs: number;
  aiConfidence: number;
  validationPassed: boolean;
  validationNotes?: string;
}

function loadDaiAdapter(sourceId: string): DaiAdapter | null {
  const adapterPath = path.join(ADAPTERS_DIR, `${sourceId}.json`);
  if (!fs.existsSync(adapterPath)) return null;
  try {
    const raw = fs.readFileSync(adapterPath, 'utf-8');
    return JSON.parse(raw) as DaiAdapter;
  } catch {
    return null;
  }
}

// ── Swedish date parser (T0041) ────────────────────────────────────────────────
// Handles formats observed on konstkalendern etc:
//   "torsdag 21 maj"                          → 2026-05-21
//   "torsdag 21 maj–söndag 27 sep"            → start 2026-05-21, end 2026-09-27
//   "5 sep kl. 13-17"                         → 2026-09-05
//   "21 maj–söndag 27 sep"                    → start 2026-05-21, end 2026-09-27
//   "2026-05-27" (ISO)                        → 2026-05-27
// Falls back to ISO regex if Swedish format fails.

const SWEDISH_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, september: 9, sept: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

interface ParsedDateRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD (same as start if no range)
}

function parseSwedishDate(text: string, now: Date = new Date()): ParsedDateRange | null {
  if (!text) return null;
  const currentYear = now.getFullYear();

  // Try ISO first
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return { start: text.match(/(\d{4})-(\d{2})-(\d{2})/)![0], end: text.match(/(\d{4})-(\d{2})-(\d{2})/)![0] };

  // Swedish: extract (day, monthName) pairs in order
  // \d{1,2}\s+(month)
  const tokens: { day: number; month: number }[] = [];
  const re = /(\d{1,2})\s+([a-zåäöé]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase();
    const month = SWEDISH_MONTHS[monthName];
    if (month) tokens.push({ day, month });
  }
  if (tokens.length === 0) return null;

  const toIso = (day: number, month: number, year: number): string =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const startTok = tokens[0];
  let startYear = currentYear;
  // If start date is in the past, roll to next year
  const startDate = new Date(startYear, startTok.month - 1, startTok.day);
  if (startDate < now) startYear = currentYear + 1;
  const start = toIso(startTok.day, startTok.month, startYear);

  if (tokens.length === 1) return { start, end: start };

  // Range
  const endTok = tokens[1];
  let endYear = startYear;
  if (endTok.month < startTok.month) endYear = startYear + 1;  // crosses Dec→Jan
  const end = toIso(endTok.day, endTok.month, endYear);
  return { start, end };
}

// ── Extract using D-AI adapter selectors ───────────────────────────────────────

function extractWithDaiAdapter(html: string, adapter: DaiAdapter): ParsedEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const containerSelector = adapter.selectors.eventContainer;
  if (!containerSelector) return events;

  $(containerSelector).each((_: any, el: any) => {
    const $el = $(el);

    // Title
    const titleSel = adapter.selectors.title;
    const title = titleSel ? $el.find(titleSel).first().text().trim() : $el.find('h2, h3, a').first().text().trim();
    if (!title || title.length < 3) return;

    // T0043: tiqets-stockholm category card filter — "24 experiences", "8 experiences" etc.
    if (adapter.sourceId === 'tiqets-stockholm' && /^\d+ experiences$/i.test(title)) return;

    // Date — try Swedish date parser first, fall back to ISO (T0041)
    const dateSel = adapter.selectors.date;
    const dateText = dateSel ? $el.find(dateSel).first().text().trim() : '';
    const parsedRange = parseSwedishDate(dateText);
    const date = parsedRange ? parsedRange.start : '';
    const dateEnd = parsedRange ? parsedRange.end : '';

    // Venue
    const venueSel = adapter.selectors.venue;
    const venue = venueSel ? $el.find(venueSel).first().text().trim() : '';

    // Link
    const linkSel = adapter.selectors.link;
    const linkEl = linkSel ? $el.find(linkSel).first() : $el.find('a').first();
    const linkHref = linkEl.attr('href') || '';

    // Dedupe
    const key = `${title}|${date}|${linkHref}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    events.push({
      title,
      date,
      venue: venue || adapter.sourceId,
      url: linkHref.startsWith('http')
        ? linkHref
        : adapter.seedUrl.replace(/\/$/, '') + (linkHref.startsWith('/') ? linkHref : '/' + linkHref),
      category: 'culture',
      source: adapter.sourceId,
      sourceUrl: adapter.seedUrl,
      confidence: {
        score: adapter.aiConfidence,
        hasTitle: true,
        hasDate: Boolean(date),
        hasVenue: Boolean(venue),
        hasUrl: Boolean(linkHref),
        hasDescription: false,
        hasTicketInfo: false,
        signals: ['d-ai-adapter', `confidence-${adapter.aiConfidence}`],
      },
    });
  });

  return events;
}

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  fs.appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

// ── Queue entry ───────────────────────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason?: string;
  workerNotes?: string;
}

function readPreUIQueue(): QueueEntry[] {
  if (!fs.existsSync(PREUI_Q)) return [];
  return fs.readFileSync(PREUI_Q, 'utf-8')
    .split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
}

// ── Main logic ────────────────────────────────────────────────────────────────

interface ExtractResult {
  sourceId: string;
  success: boolean;
  eventsFound: number;
  error?: string;
}

async function extractFromSource(sourceId: string): Promise<ExtractResult> {
  const allSources = getAllSources();
  const source = allSources.find(s => s.id === sourceId);
  if (!source) {
    return { sourceId, success: false, eventsFound: 0, error: 'source not found' };
  }

  console.log(`[extract] ${sourceId} — ${source.url}`);

  // T0099 — API-source dispatch (Ticketmaster, Billetto, etc.)
  // Sources with preferredPath='api' use their adapter instead of HTML fetch.
  if ((source as any).preferredPath === 'api') {
    const adapterName = (source as any).metadata?.sourceAdapter as string | undefined;
    if (adapterName === 'ticketmaster') {
      log(`  [api-dispatch] ${sourceId}: routing to Ticketmaster adapter`);
      try {
        const { fetchTicketmaster } = await import('./adapters/ticketmaster');
        const adapterStatus = await fetchTicketmaster();
        const success = adapterStatus === 'completed';
        updateSourceStatus(sourceId, {
          success,
          eventsFound: success ? 1 : 0,  // adapter queues directly to rawEventsQueue; we report 1 as heartbeat
          pathUsed: 'api',
          ingestionStage: success ? 'completed' : 'failed',
          lastRoutingReason: `runA-extract: Ticketmaster API → ${adapterStatus}`,
        });
        return {
          sourceId,
          success,
          eventsFound: success ? 1 : 0,
          error: success ? undefined : `ticketmaster adapter returned: ${adapterStatus}`,
        };
      } catch (err: any) {
        log(`  [api-dispatch] ${sourceId}: Ticketmaster adapter threw: ${err.message ?? err}`);
        updateSourceStatus(sourceId, {
          success: false,
          eventsFound: 0,
          pathUsed: 'api',
          ingestionStage: 'failed',
          lastRoutingReason: `runA-extract: Ticketmaster API threw: ${err.message ?? err}`,
        });
        return { sourceId, success: false, eventsFound: 0, error: `ticketmaster: ${err.message ?? err}` };
      }
    }
    // Future: billetto, eventbrite, kulturhuset adapters can be added here.
    log(`  [api-dispatch] ${sourceId}: no adapter registered for sourceAdapter='${adapterName}' — falling through to HTML path`);
  }

  let fetchResult = await fetchHtml(source.url, { timeout: 20000 });
  if (!fetchResult.success || !fetchResult.html) {
    // T0098 — TLS/SSL/cert failures (mosebacke, nobel-prize-museum, observatoriet)
    // fall back to ScrapingBee render path which handles TLS via premium proxy.
    const errMsg = fetchResult.error || '';
    const isTlsError = /EPROTO|Hostname\/IP does not match certificate|self signed|unable to verify|certificate|SSL|TLS/i.test(errMsg);
    if (isTlsError) {
      log(`  [tls-fallback] ${sourceId}: direct fetch TLS error — routing through ScrapingBee`);
      const rendered = await renderPage(source.url, { timeout: 25000 });
      if (rendered.success && rendered.html) {
        log(`  [tls-fallback] ${sourceId}: ScrapingBee returned ${rendered.html.length}b — retrying extraction`);
        fetchResult = {
          success: true,
          html: rendered.html,
          statusCode: 200,
          finalUrl: source.url,
          redirectChain: [`tls-fallback:scrapingbee`],
        };
      } else {
        log(`  [tls-fallback] ${sourceId}: ScrapingBee also failed: ${rendered.error ?? 'unknown'}`);
      }
    }
    if (!fetchResult.success || !fetchResult.html) {
      updateSourceStatus(sourceId, {
        success: false,
        eventsFound: 0,
        pathUsed: 'jsonld',
        ingestionStage: 'failed',
        lastRoutingReason: `runA-extract: Fetch failed: ${fetchResult.error}`,
      });
      return { sourceId, success: false, eventsFound: 0, error: `Fetch failed: ${fetchResult.error}` };
    }
  }

  const extractResult = extractFromJsonLd(fetchResult.html, sourceId, source.url);
  const events = extractResult.events;

  if (events.length === 0) {
    // Fallback: check if a validated D-AI adapter exists for this source
    const adapter = loadDaiAdapter(sourceId);
    if (adapter && adapter.validationPassed) {
      log(`  [d-ai-fallback] ${sourceId}: JSON-LD zero — trying D-AI adapter`);
      const adapterEvents = extractWithDaiAdapter(fetchResult.html, adapter);
      if (adapterEvents.length > 0) {
        log(`  [d-ai-fallback] ${sourceId}: ${adapterEvents.length} events via D-AI adapter selectors`);
        const outFile = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
        fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
        const lines = adapterEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(outFile, lines, 'utf-8');
        updateSourceStatus(sourceId, {
          success: true,
          eventsFound: adapterEvents.length,
          pathUsed: 'd-ai-adapter',
          ingestionStage: 'completed',
          lastRoutingReason: `runA-extract: ${adapterEvents.length} events via D-AI adapter`,
        });
        return { sourceId, success: true, eventsFound: adapterEvents.length };
      }
    }

    // T0046 — render-gate fallback for JS-heavy sources
    // Triggers when:
    //   (a) D-AI adapter exists with validationNotes mentioning "render gate" or "SPA", OR
    //   (b) quick check on raw HTML suggests it (small body, JS framework markers)
    const adapterNeedsRender = adapter
      && !adapter.validationPassed
      && adapter.validationNotes
      && /render.gate|SPA|JS.rendered|JS-rendered/i.test(adapter.validationNotes);
    if (adapterNeedsRender || (await needsRendering(source.url))) {
      log(`  [render-gate] ${sourceId}: ${adapterNeedsRender ? 'adapter flagged' : 'needsRendering()=true'} — invoking D-renderGate`);
      try {
        const rendered = await renderPage(source.url, { timeout: 20000 });
        if (rendered.success && rendered.html && rendered.html.length > fetchResult.html.length) {
          // Re-run JSON-LD on rendered HTML
          const renderedJsonLd = extractFromJsonLd(rendered.html, sourceId, source.url);
          // Re-run D-AI adapter (if any) on rendered HTML
          const renderedDai = adapter
            ? extractWithDaiAdapter(rendered.html, adapter)
            : [];
          const merged = [...renderedJsonLd.events, ...renderedDai];
          if (merged.length > 0) {
            log(`  [render-gate] ${sourceId}: ${merged.length} events after JS render (jsonld=${renderedJsonLd.events.length}, d-ai=${renderedDai.length})`);
            const outFile = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
            fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
            const lines = merged.map(e => JSON.stringify(e)).join('\n') + '\n';
            fs.writeFileSync(outFile, lines, 'utf-8');
            updateSourceStatus(sourceId, {
              success: true,
              eventsFound: merged.length,
              pathUsed: 'render-gate',
              ingestionStage: 'completed',
              lastRoutingReason: `runA-extract: ${merged.length} events via render-gate (jsonld=${renderedJsonLd.events.length}, d-ai=${renderedDai.length})`,
            });
            return { sourceId, success: true, eventsFound: merged.length };
          }
          log(`  [render-gate] ${sourceId}: rendered HTML (${rendered.html.length}b) still produced 0 events`);
        } else {
          log(`  [render-gate] ${sourceId}: render failed or no size gain (${rendered.error ?? 'unknown'})`);
        }
      } catch (err: any) {
        log(`  [render-gate] ${sourceId}: exception ${err.message ?? err}`);
      }
    }

    updateSourceStatus(sourceId, {
      success: false,
      eventsFound: 0,
      pathUsed: 'jsonld',
      ingestionStage: 'A',
      lastRoutingReason: 'runA-extract: no-jsonld-or-no-events',
    });
    return { sourceId, success: false, eventsFound: 0, error: 'no-jsonld-or-no-events' };
  }

  // Write events to extractedevents folder
  const outFile = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(outFile, lines, 'utf-8');

  updateSourceStatus(sourceId, {
    success: true,
    eventsFound: events.length,
    pathUsed: 'jsonld',
    ingestionStage: 'completed',
    lastRoutingReason: `runA-extract: ${events.length} events → extractedevents`,
  });

  return { sourceId, success: true, eventsFound: events.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx runA-extract.ts              # alla preUI');
    console.log('  npx tsx runA-extract.ts --limit N  # N källor');
    console.log('  npx tsx runA-extract.ts --dry        # visa utan att köra');
    return;
  }

  const dry = args.includes('--dry');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1]
    ? parseInt(args[limitIdx + 1], 10)
    : Infinity;

  const preUIEntries = readPreUIQueue();
  if (preUIEntries.length === 0) {
    log('[extract] preUI-queue är tom — inget att göra.');
    return;
  }

  const batch = preUIEntries.slice(0, limit);
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(RUN_LOG, '', 'utf8');

  log(`═══ runA-extract ═══`);
  log(`preUI: ${batch.length} källor att extrahera`);

  if (dry) {
    batch.forEach(e => log(`  [dry] ${e.sourceId}`));
    return;
  }

  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });

  let totalEvents = 0;
  let success = 0;
  let fail = 0;

  for (const entry of batch) {
    const result = await extractFromSource(entry.sourceId);
    if (result.success) {
      success++;
      totalEvents += result.eventsFound;
      log(`  ✅ ${entry.sourceId}: ${result.eventsFound} events → extractedevents/`);
    } else {
      fail++;
      log(`  ❌ ${entry.sourceId}: ${result.error}`);
    }
  }

  log('');
  log('═══ KLAR ═══');
  log(`  ✅ ${success} källor | ❌ ${fail} misslyckade | 📄 ${totalEvents} events extraherade`);
  log(`  Output: ${EXTRACTED_DIR}`);
}

main().catch(console.error);
