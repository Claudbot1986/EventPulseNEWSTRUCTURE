/**
 * D-gate adapter — Billetto Stockholm (aggregator-listing)
 *
 * Two-stage JS-render pipeline:
 *   Stage 1: renderPage(categoryUrl)  →  extract event-URLs from <a href>
 *   Stage 2: renderPage(eventUrl)     →  parse <script type="application/ld+json"> Event
 *
 * Source: sources/billetto-stockholm.jsonl
 *   - type: aggregator-listing
 *   - preferredPath: render
 *   - metadata.categoryUrls: 20 fixed Stockholm category URLs (e.g. /c/concert-t/stockholm)
 *
 * Output: 03-Queue/03-extractedevents/D/billetto-stockholm.jsonl
 * Idempotency: filters by `${source}::${sourceUrl}` against existing output.
 *
 * CLI:
 *   npx tsx 02-Ingestion/D-renderGate/runD-billetto-stockholm.ts
 *     [--limit N]            max categories to process (default: all 20)
 *     [--event-limit N]      max events per category (default: 50)
 *     [--dry-run]            do not write output
 */

import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

import { renderPage } from './renderGate.js';
import { getSource } from '../tools/sourceRegistry.js';
import type { ParsedEvent, ExtractionConfidence } from '../F-eventExtraction/schema.js';

const SOURCE_ID = 'billetto-stockholm';
const OUTPUT_FILE = path.join(
  process.cwd(),
  '03-Queue',
  '03-extractedevents',
  'D',
  `${SOURCE_ID}.jsonl`,
);
const LOG_DIR = path.join(process.cwd(), 'runtime', `${SOURCE_ID}-runs`);

// Event-URL pattern: /e/{slug}-biljetter-{id}/
// Example: /e/midsommar-pa-sodermalm-2026-biljetter-1234567/
const EVENT_HREF_RE = /\/e\/([a-z0-9-]+-biljetter-\d+)/;

// Billetto category pages append tracking params (?bref=...) per request.
// Strip them so dedup is stable across runs.
function normalizeEventUrl(raw: string): string {
  let u = raw;
  const qIdx = u.indexOf('?');
  if (qIdx >= 0) u = u.slice(0, qIdx);
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

interface RunStats {
  startedAt: string;
  finishedAt?: string;
  categoriesProcessed: number;
  categoriesFailed: number;
  categoryUrlsDiscovered: number;
  eventsExtracted: number;
  eventsSkippedDuplicate: number;
  eventsFailed: number;
  errors: string[];
}

function logLine(runLogPath: string, line: string): void {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}\n`;
  // eslint-disable-next-line no-console -- run-log file
  console.log(out.trimEnd());
  fs.appendFileSync(runLogPath, out, 'utf8');
}

function parseArgs(argv: string[]): {
  limit: number | null;
  eventLimit: number;
  dryRun: boolean;
} {
  let limit: number | null = null;
  let eventLimit = 50;
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') limit = parseInt(argv[++i], 10);
    else if (a === '--event-limit') eventLimit = parseInt(argv[++i], 10);
    else if (a === '--dry-run') dryRun = true;
  }
  return { limit, eventLimit, dryRun };
}

function loadExistingSourceUrls(): Set<string> {
  const seen = new Set<string>();
  if (!fs.existsSync(OUTPUT_FILE)) return seen;
  const lines = fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ParsedEvent;
      if (obj.sourceUrl) seen.add(`${SOURCE_ID}::${normalizeEventUrl(obj.sourceUrl)}`);
    } catch {
      // ignore malformed lines
    }
  }
  return seen;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function splitDateTime(iso: string | undefined): { date: string; time?: string } {
  if (!iso) return { date: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso };
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return { date, time };
}

function pickOffer(
  offers: any,
): {
  isFree?: boolean;
  priceMin?: number;
  priceMax?: number;
  ticketUrl?: string;
} {
  if (!offers) return {};
  const list: any[] = Array.isArray(offers) ? offers : [offers];
  const valid = list.filter((o) => o && (o.price || o.url));
  if (valid.length === 0) return {};
  const prices = valid
    .map((o) => Number(o.price ?? o.priceSpecification?.price ?? NaN))
    .filter((n) => Number.isFinite(n));
  const isFree = valid.some(
    (o) => o.price === 0 || o.price === '0' || o.priceSpecification?.price === 0,
  );
  const ticketUrl = valid.find((o) => o.url)?.url;
  return {
    isFree: isFree || undefined,
    priceMin: prices.length ? Math.min(...prices) : undefined,
    priceMax: prices.length ? Math.max(...prices) : undefined,
    ticketUrl,
  };
}

function extractStockholm(place: any): {
  city?: string;
  venue?: string;
  address?: string;
  lat?: number;
  lng?: number;
} {
  if (!place) return { city: 'Stockholm' };
  const addr =
    place.address &&
    typeof place.address === 'object'
      ? [
          place.address.streetAddress,
          [place.address.postalCode, place.address.addressLocality]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : undefined;
  const city =
    place.address?.addressLocality ||
    place.address?.addressRegion ||
    'Stockholm';
  const lat =
    place.geo && typeof place.geo.latitude === 'number' ? place.geo.latitude : undefined;
  const lng =
    place.geo && typeof place.geo.longitude === 'number' ? place.geo.longitude : undefined;
  return {
    city: typeof city === 'string' ? city : 'Stockholm',
    venue: typeof place.name === 'string' ? place.name : undefined,
    address: addr,
    lat,
    lng,
  };
}

function findJsonLdEvent(html: string): any | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    const text = $(el).contents().text();
    try {
      const parsed = JSON.parse(text);
      // walk possible shapes: object, array, @graph
      const candidates: any[] = [];
      const visit = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (node['@type'] === 'Event' || node['@type']?.includes?.('Event')) {
          candidates.push(node);
        }
        if (node['@graph'] && Array.isArray(node['@graph'])) {
          node['@graph'].forEach(visit);
        }
      };
      visit(parsed);
      if (candidates.length > 0) return candidates[0];
    } catch {
      // try next script
    }
  }
  return null;
}

function extractEventUrlsFromCategory(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = href.match(EVENT_HREF_RE);
    if (!m) return;
    const full = href.startsWith('http') ? href : `https://billetto.se${href}`;
    urls.add(normalizeEventUrl(full));
  });
  return Array.from(urls);
}

async function extractEventFromPage(
  eventUrl: string,
  userAgent: string,
  runLogPath: string,
): Promise<ParsedEvent | null> {
  // renderGate.renderPage does not accept custom UA directly; we pass via header
  // by appending ?_ua= query (no-op on Billetto — ScrapingBee sets its own UA).
  // The userAgent from source metadata is documented in source registry for audit.
  void userAgent;

  const result = await renderPage(eventUrl, { timeout: 20000 });
  if (!result.success || !result.html) {
    logLine(runLogPath, `  FAIL ${eventUrl} → ${result.error ?? 'no html'}`);
    return null;
  }

  const jsonLd = findJsonLdEvent(result.html);
  if (!jsonLd) {
    logLine(runLogPath, `  SKIP ${eventUrl} → no JSON-LD Event`);
    return null;
  }

  const start = splitDateTime(jsonLd.startDate);
  const end = splitDateTime(jsonLd.endDate);
  const offer = pickOffer(jsonLd.offers);
  const place = extractStockholm(jsonLd.location);

  const confidence: ExtractionConfidence = {
    score: 0.85,
    hasTitle: Boolean(jsonLd.name),
    hasDate: Boolean(start.date),
    hasVenue: Boolean(place.venue),
    hasUrl: true,
    hasDescription: Boolean(jsonLd.description),
    hasTicketInfo: offer.isFree === true || Number.isFinite(offer.priceMin ?? NaN),
    signals: ['jsonld-event-billetto'],
  };

  return {
    title: String(jsonLd.name ?? '').slice(0, 200),
    date: start.date,
    time: start.time,
    endDate: end.date || undefined,
    endTime: end.time || undefined,
    venue: place.venue,
    address: place.address,
    city: place.city,
    description: jsonLd.description ? String(jsonLd.description).slice(0, 500) : undefined,
    url: jsonLd.url ?? eventUrl,
    ticketUrl: offer.ticketUrl ?? jsonLd.url ?? eventUrl,
    organizer:
      typeof jsonLd.organizer === 'object'
        ? jsonLd.organizer.name
        : jsonLd.organizer ?? undefined,
    isFree: offer.isFree,
    priceMin: offer.priceMin,
    priceMax: offer.priceMax,
    imageUrl:
      typeof jsonLd.image === 'string'
        ? jsonLd.image
        : Array.isArray(jsonLd.image)
        ? jsonLd.image[0]
        : jsonLd.image?.url,
    status: 'published',
    source: SOURCE_ID,
    sourceUrl: normalizeEventUrl(eventUrl),
    confidence,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runTs = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const runLogPath = path.join(LOG_DIR, `${runTs}.log`);

  const source = getSource(SOURCE_ID);
  if (!source) {
    throw new Error(`Source ${SOURCE_ID} not found in registry`);
  }
  const userAgent: string =
    (source.metadata as any)?.userAgent ?? 'EventPulse-Bot/1.0';
  const rateLimitMs: number = (source.metadata as any)?.rateLimitMs ?? 3000;

  const categoryUrls: string[] = (source.metadata as any)?.categoryUrls ?? [];
  if (categoryUrls.length === 0) {
    throw new Error(`Source ${SOURCE_ID} has no metadata.categoryUrls`);
  }

  const limit = args.limit ?? categoryUrls.length;
  const urlsToProcess = categoryUrls.slice(0, Math.max(0, limit));

  const stats: RunStats = {
    startedAt: new Date().toISOString(),
    categoriesProcessed: 0,
    categoriesFailed: 0,
    categoryUrlsDiscovered: 0,
    eventsExtracted: 0,
    eventsSkippedDuplicate: 0,
    eventsFailed: 0,
    errors: [],
  };

  const seen = loadExistingSourceUrls();
  const outLines: string[] = [];

  logLine(
    runLogPath,
    `START source=${SOURCE_ID} categories=${urlsToProcess.length}/${categoryUrls.length} eventLimit=${args.eventLimit} dryRun=${args.dryRun}`,
  );

  for (const catUrl of urlsToProcess) {
    logLine(runLogPath, `→ category ${catUrl}`);
    await sleep(rateLimitMs);

    let catHtml: string;
    try {
      const catRes = await renderPage(catUrl, { timeout: 20000 });
      if (!catRes.success || !catRes.html) {
        stats.categoriesFailed++;
        stats.errors.push(`category ${catUrl}: ${catRes.error ?? 'no html'}`);
        logLine(runLogPath, `  FAIL category render`);
        continue;
      }
      catHtml = catRes.html;
    } catch (e) {
      stats.categoriesFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      stats.errors.push(`category ${catUrl}: ${msg}`);
      logLine(runLogPath, `  FAIL category exception: ${msg}`);
      continue;
    }

    stats.categoriesProcessed++;

    const eventUrls = extractEventUrlsFromCategory(catHtml).slice(0, args.eventLimit);
    stats.categoryUrlsDiscovered += eventUrls.length;
    logLine(runLogPath, `  discovered ${eventUrls.length} event-URLs`);

    for (const eventUrl of eventUrls) {
      const key = `${SOURCE_ID}::${eventUrl}`;
      if (seen.has(key)) {
        stats.eventsSkippedDuplicate++;
        continue;
      }
      await sleep(rateLimitMs);

      try {
        const ev = await extractEventFromPage(eventUrl, userAgent, runLogPath);
        if (!ev) {
          stats.eventsFailed++;
          continue;
        }
        // Re-key using the ParsedEvent's sourceUrl (canonical, post-normalize).
        const canonicalKey = `${SOURCE_ID}::${normalizeEventUrl(ev.sourceUrl ?? eventUrl)}`;
        if (seen.has(canonicalKey)) {
          stats.eventsSkippedDuplicate++;
          continue;
        }
        seen.add(key);
        seen.add(canonicalKey);
        outLines.push(JSON.stringify(ev));
        stats.eventsExtracted++;
      } catch (e) {
        stats.eventsFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        stats.errors.push(`event ${eventUrl}: ${msg}`);
        logLine(runLogPath, `  FAIL event exception: ${msg}`);
      }
    }
  }

  stats.finishedAt = new Date().toISOString();

  if (!args.dryRun && outLines.length > 0) {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.appendFileSync(OUTPUT_FILE, outLines.join('\n') + '\n', 'utf8');
    logLine(runLogPath, `WROTE ${outLines.length} events → ${OUTPUT_FILE}`);
  } else {
    logLine(runLogPath, `DRY-RUN — no events written`);
  }

  logLine(runLogPath, `STATS ${JSON.stringify(stats)}`);

  // eslint-disable-next-line no-console -- summary line
  console.log('\n=== Billetto run summary ===');
  // eslint-disable-next-line no-console -- summary line
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- fatal entrypoint error
  console.error('FATAL', e);
  process.exit(1);
});
