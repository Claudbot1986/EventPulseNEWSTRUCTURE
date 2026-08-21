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

    // Date
    const dateSel = adapter.selectors.date;
    const dateText = dateSel ? $el.find(dateSel).first().text().trim() : '';
    const dateMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';

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

  const fetchResult = await fetchHtml(source.url, { timeout: 20000 });
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
