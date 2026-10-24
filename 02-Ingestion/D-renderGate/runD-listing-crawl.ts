/**
 * runD-listing-crawl.ts — D-gate för källor vars events ligger BAKOM en
 * JS-renderad listningssida (tvåstegsrender).
 *
 * Bakgrund (2026-10-24). Vissa källor har ingen direkt event-sida. Deras
 * events bor på listningssidor som renderas av JavaScript, och varje
 * listningsrad leder vidare till en event-sida som bär JSON-LD Event.
 *
 * Mätning på billetto.se (D-gatens riktiga renderPage via ScrapingBee):
 *
 *   1. Renderad KATEGORISIDA → 0 events.
 *      `scripts/probe-render-extract.mjs https://billetto.se/c/concert-t/stockholm`
 *      → bytes=170999, events=0. Listningssidan har INGEN JSON-LD — bara
 *      Alpine-mallar. Hela vägen render→extrahera ger alltså inget.
 *   2. Renderad EVENT-SIDA → JSON-LD Event med startDate, location, offers.
 *   3. Renderad kategorisida → `/e/{slug}-biljetter-{id}` som <a href>.
 *      Länkarna finns i den renderade DOM:en.
 *
 * Slutsats: en enda render räcker INTE. Det krävs två steg —
 * listningssida → event-URL:er → event-sidor. Därför finns detta skript,
 * utöver den generella D-gaten (runD-scrapingbee.ts) som bara renderar
 * en sida per källa.
 *
 * Bevisad körning (2026-08-19, 5 kategorier):
 *   categoryUrlsDiscovered=50, eventsExtracted=34, eventsFailed=0.
 * Bevisad körning (2026-10-24, `--limit 2 --event-limit 3 --dry-run`):
 *   categoriesProcessed=2, categoryUrlsDiscovered=6, eventsExtracted=3,
 *   eventsFailed=0 — dvs. vägen fungerar fortfarande.
 *
 * ── Varför detta är källspecifikt config och inte C-lager ────────────────
 * CLAUDE.md:s Generalization Protection Rule säger att ett mönster från en
 * enda sajt inte får styra C0/C1/C2. Detta skript rör INTE C-lagret — det
 * är ett eget spår vid sidan om C, och allt källspecifikt (vilka
 * listningssidor, vilket href-mönster, vilket tempo) ligger i källans egen
 * metadata, inte i koden:
 *
 *   metadata.categoryUrls      — listningssidor att rendera
 *   metadata.eventHrefPattern  — regex som matchar event-länkar i DOM:en
 *   metadata.eventUrlPrefix    — prefix för relativa länkar
 *   metadata.rateLimitMs       — paus mellan anrop (robots crawl-delay)
 *
 * En källa som saknar `metadata.categoryUrls` hoppas över helt.
 *
 * CLI:
 *   npx tsx 02-Ingestion/D-renderGate/runD-listing-crawl.ts
 *     [--source=<id>]        bara denna källa (default: alla med categoryUrls)
 *     [--categories=N]       max listningssidor per källa (default: alla)
 *     [--events=N]           max event-sidor per listningssida (default: 50)
 *     [--dry-run]            skriver inte events
 */

import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { renderPage, type RenderBehavior } from './renderGate.js';
import {
  DEFAULT_EVENT_HREF_PATTERN,
  NO_SCOPE,
  extractEventUrlsFromCategory,
  extractPostalCode,
  extractStockholm,
  findJsonLdEvent,
  isInScope,
  normalizeEventUrl,
  pickOffer,
  splitDateTime,
  type ScopeFilter,
} from './listingCrawlCore.js';
import { getAllSources, updateSourceStatus } from '../tools/sourceRegistry.js';
import type { ParsedEvent, ExtractionConfidence } from '../F-eventExtraction/schema.js';

// Utan detta saknas SCRAPINGBEE_API_KEY och renderPage faller tillbaka på
// lokal puppeteer — vilket fungerar men kostar inga credits och ger ett
// sämre renderat resultat (mätt: 169 kB / 0 credits mot 1,5 MB / 25 credits).
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : path.resolve(process.cwd());
const EXTRACTED_DIR = path.join(DATA_ROOT, '03-Queue/03-extractedevents/D');
const LOG_DIR = path.join(DATA_ROOT, 'runtime/listing-crawl-runs');

const DEFAULT_RATE_LIMIT_MS = 3000;
const DEFAULT_EVENT_LIMIT = 50;

/**
 * Renderbeteende för LISTNINGSSIDAN.
 *
 * Mätning 2026-10-24 (billetto.se, D-gatens riktiga renderPage):
 *
 *   behavior=auto         → 170 999 B, 0 event-länkar
 *   behavior=premium-only → 1 531 284 B, 59 event-länkar
 *
 * `auto` (mode=auto, max_cost=10) tar den billigaste nivån som svarar —
 * en statisk hämtning utan JS. Listningssidan är en Alpine-SPA, så utan
 * JS-rendering finns inga event-länkar i DOM:en. Därför MÅSTE listningssidan
 * renderas med JS (premium-only).
 */
const LISTING_RENDER_BEHAVIOR: RenderBehavior = 'premium-only';

/**
 * Renderbeteende för EVENT-SIDAN. JSON-LD serveras, så en billig hämtning
 * räcker. Mätning 2026-10-24: static-only → 150 258 B med 3 JSON-LD-block
 * och korrekt name + startDate. Om JSON-LD ändå saknas görs ett försök med
 * premium-only (JS + premium-proxy) innan eventet skrivs som "ingen data".
 */
const EVENT_RENDER_BEHAVIOR: RenderBehavior = 'auto';
const EVENT_RENDER_FALLBACK: RenderBehavior = 'premium-only';

interface ListingSource {
  sourceId: string;
  categoryUrls: string[];
  eventHrefPattern: RegExp;
  eventUrlPrefix: string;
  rateLimitMs: number;
  /** Vilka ortar som räknas som in-scope. Tomt = ingen filtrering. */
  scope: ScopeFilter;
}

interface RunStats {
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  categoriesProcessed: number;
  categoriesFailed: number;
  /** Listningssidor som behövde ett andra render-försök. */
  categoryRetries: number;
  categoryUrlsDiscovered: number;
  eventsExtracted: number;
  eventsSkippedDuplicate: number;
  eventsOutOfScope: number;
  eventsFailed: number;
  creditsUsed: number;
  /**
   * Vilken render-motor som användes. 'scrapingbee' = D-gatens avsedda
   * väg. 'puppeteer' = lokal fallback (ingen nyckel) — då är creditsUsed 0
   * av annan anleding än "gratis", och det ska synas i loggen.
   */
  renderBackend: 'scrapingbee' | 'puppeteer';
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
  sourceId: string | null;
  categoryLimit: number | null;
  eventLimit: number;
  dryRun: boolean;
} {
  let sourceId: string | null = null;
  let categoryLimit: number | null = null;
  let eventLimit = DEFAULT_EVENT_LIMIT;
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') sourceId = argv[++i];
    else if (a === '--categories') categoryLimit = parseInt(argv[++i], 10);
    else if (a === '--events') eventLimit = parseInt(argv[++i], 10);
    else if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--source=')) sourceId = a.slice('--source='.length);
    else if (a.startsWith('--categories=')) categoryLimit = parseInt(a.slice('--categories='.length), 10);
    else if (a.startsWith('--events=')) eventLimit = parseInt(a.slice('--events='.length), 10);
  }
  return { sourceId, categoryLimit, eventLimit, dryRun };
}

/**
 * Välj ut de källor som har en JS-renderad listningssida.
 * Källan deklarerar själv listningssidorna i `metadata.categoryUrls`.
 */
function selectListingSources(sourceId: string | null): ListingSource[] {
  const all = getAllSources();
  const selected: ListingSource[] = [];

  for (const source of all) {
    if (sourceId && source.id !== sourceId) continue;
    const metadata = (source.metadata ?? {}) as Record<string, unknown>;
    const categoryUrls = metadata.categoryUrls;
    if (!Array.isArray(categoryUrls) || categoryUrls.length === 0) continue;

    const patternSource = metadata.eventHrefPattern;
    let eventHrefPattern = DEFAULT_EVENT_HREF_PATTERN;
    if (typeof patternSource === 'string' && patternSource.length > 0) {
      try {
        eventHrefPattern = new RegExp(patternSource, 'i');
      } catch {
        eventHrefPattern = DEFAULT_EVENT_HREF_PATTERN;
      }
    }

    const prefix = metadata.eventUrlPrefix;
    const eventUrlPrefix =
      typeof prefix === 'string' && prefix.length > 0
        ? prefix
        : (() => {
            try {
              return `${new URL(source.url).origin}/`;
            } catch {
              return '';
            }
          })();

    const rateLimit = metadata.rateLimitMs;
    const scopeMetadata = metadata.scope as Partial<ScopeFilter> | undefined;
    const scope: ScopeFilter =
      scopeMetadata && typeof scopeMetadata === 'object'
        ? {
            postalPrefixes: Array.isArray(scopeMetadata.postalPrefixes)
              ? scopeMetadata.postalPrefixes.filter((p): p is string => typeof p === 'string')
              : [],
            cities: Array.isArray(scopeMetadata.cities)
              ? scopeMetadata.cities.filter((c): c is string => typeof c === 'string')
              : [],
          }
        : NO_SCOPE;

    selected.push({
      sourceId: source.id,
      categoryUrls: categoryUrls.filter((u): u is string => typeof u === 'string'),
      eventHrefPattern,
      eventUrlPrefix,
      rateLimitMs:
        typeof rateLimit === 'number' && rateLimit >= 0 ? rateLimit : DEFAULT_RATE_LIMIT_MS,
      scope,
    });
  }

  return selected;
}

function outputFileFor(sourceId: string): string {
  return path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
}

function loadExistingSourceUrls(sourceId: string): Set<string> {
  const seen = new Set<string>();
  const file = outputFileFor(sourceId);
  if (!fs.existsSync(file)) return seen;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ParsedEvent;
      if (obj.sourceUrl) seen.add(`${sourceId}::${normalizeEventUrl(obj.sourceUrl)}`);
    } catch {
      // ignorera trasiga rader
    }
  }
  return seen;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function extractEventFromPage(
  eventUrl: string,
  sourceId: string,
  scope: ScopeFilter,
  runLogPath: string,
): Promise<{ event: ParsedEvent | null; inScope: boolean; creditsUsed: number }> {
  const result = await renderPage(eventUrl, {
    behavior: EVENT_RENDER_BEHAVIOR,
    timeout: 20000,
  });
  let creditsUsed = result.metrics?.creditsCharged ?? 0;
  if (!result.success || !result.html) {
    logLine(runLogPath, `  FAIL ${eventUrl} → ${result.error ?? 'no html'}`);
    return { event: null, inScope: false, creditsUsed };
  }

  let jsonLd = findJsonLdEvent(result.html);
  if (!jsonLd) {
    // JSON-LD serveras på event-sidor, så bristen på JSON-LD betyder att
    // sidan inte levererade innehåll. Prova då med JS + premium-proxy.
    const retry = await renderPage(eventUrl, {
      behavior: EVENT_RENDER_FALLBACK,
      timeout: 30000,
    });
    creditsUsed += retry.metrics?.creditsCharged ?? 0;
    if (retry.success && retry.html) {
      jsonLd = findJsonLdEvent(retry.html);
    }
  }
  if (!jsonLd) {
    logLine(runLogPath, `  SKIP ${eventUrl} → no JSON-LD Event`);
    return { event: null, inScope: false, creditsUsed };
  }

  const start = splitDateTime(jsonLd.startDate);
  const end = splitDateTime(jsonLd.endDate);
  const offer = pickOffer(jsonLd.offers);
  const place = extractStockholm(jsonLd.location);

  const postalCode = extractPostalCode(place.address, place.postalCode);
  const inScope = isInScope(scope, postalCode, place.city);

  const confidence: ExtractionConfidence = {
    score: 0.85,
    hasTitle: Boolean(jsonLd.name),
    hasDate: Boolean(start.date),
    hasVenue: Boolean(place.venue),
    hasUrl: true,
    hasDescription: Boolean(jsonLd.description),
    hasTicketInfo: offer.isFree === true || Number.isFinite(offer.priceMin ?? NaN),
    signals: ['jsonld-event-listing-crawl'],
  };

  return {
    event: {
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
        typeof jsonLd.organizer === 'object' && jsonLd.organizer
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
      source: sourceId,
      sourceUrl: normalizeEventUrl(eventUrl),
      confidence,
    },
    inScope,
    creditsUsed,
  };
}

/**
 * Minsta antal event-länkar vi förväntar oss från en listningssida.
 *
 * Mätning 2026-10-24 (billetto.se, premium-only): 3 av 3 oberoende renders
 * av samma kategori gav 52–54 länkar. Men i en riktig crawl-körning gav
 * renderingen av `/c/performing_arts-c/stockholm` bara 3 länkar i ett render,
 * medan en omedelbar upprepning av samma URL gav 54. Listningssidan är en
 * SPA: ibland hinner den serverrenderade listan inte med i svaret.
 *
 * Ett render med färre länkar än detta är därför misstänkt som degraderat,
 * inte som "kategorin är tom". Ett andra försök kostar 25 credits och
 * räddar 50进一步提高 event-URL:er.
 */
const MIN_LINKS_PER_CATEGORY = 5;

/**
 * Rendera en listningssida och hämta event-länkarna. Om renderingen ser
 * degraderad ut görs ett andra försök innan kategorin accepteras.
 */
async function renderCategoryWithRetry(
  catUrl: string,
  source: ListingSource,
  runLogPath: string,
): Promise<{ eventUrls: string[]; creditsUsed: number; failed: boolean; error?: string; retried: boolean }> {
  let creditsUsed = 0;
  let lastError: string | undefined;
  let best: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await renderPage(catUrl, {
        behavior: LISTING_RENDER_BEHAVIOR,
        timeout: 30000,
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    creditsUsed += res.metrics?.creditsCharged ?? 0;
    if (!res.success || !res.html) {
      lastError = res.error ?? 'no html';
      continue;
    }
    const links = extractEventUrlsFromCategory(res.html, source);
    if (links.length > best.length) best = links;
    if (links.length >= MIN_LINKS_PER_CATEGORY) {
      if (attempt > 1) {
        logLine(runLogPath, `  RETRY category → ${links.length} event-URLs (försök ${attempt})`);
      }
      return { eventUrls: links, creditsUsed, failed: false, retried: attempt > 1 };
    }
    logLine(
      runLogPath,
      `  DEGRADED category → ${links.length} event-URLs (försök ${attempt}), försöker igen`,
    );
  }

  if (best.length > 0) {
    logLine(runLogPath, `  ACCEPT degraded category → ${best.length} event-URLs (försök 2 gav inget bättre)`);
    return { eventUrls: best, creditsUsed, failed: false, retried: true };
  }
  return { eventUrls: [], creditsUsed, failed: true, error: lastError, retried: true };
}

async function crawlSource(
  source: ListingSource,
  args: ReturnType<typeof parseArgs>,
  runLogPath: string,
): Promise<RunStats> {
  const stats: RunStats = {
    sourceId: source.sourceId,
    startedAt: new Date().toISOString(),
    categoriesProcessed: 0,
    categoriesFailed: 0,
    categoryRetries: 0,
    categoryUrlsDiscovered: 0,
    eventsExtracted: 0,
    eventsSkippedDuplicate: 0,
    eventsOutOfScope: 0,
    eventsFailed: 0,
    creditsUsed: 0,
    renderBackend: process.env.SCRAPINGBEE_API_KEY ? 'scrapingbee' : 'puppeteer',
    errors: [],
  };

  const categoryUrls = source.categoryUrls.slice(
    0,
    Math.max(0, args.categoryLimit ?? source.categoryUrls.length),
  );

  const seen = loadExistingSourceUrls(source.sourceId);
  const outLines: string[] = [];

  logLine(
    runLogPath,
    `START source=${source.sourceId} categories=${categoryUrls.length}/${source.categoryUrls.length} ` +
      `eventLimit=${args.eventLimit} dryRun=${args.dryRun}`,
  );

  for (const catUrl of categoryUrls) {
    logLine(runLogPath, `→ category ${catUrl}`);
    if (source.rateLimitMs > 0) await sleep(source.rateLimitMs);

    let eventUrls: string[];
    try {
      const rendered = await renderCategoryWithRetry(catUrl, source, runLogPath);
      stats.creditsUsed += rendered.creditsUsed;
      if (rendered.retried) stats.categoryRetries++;
      if (rendered.failed) {
        stats.categoriesFailed++;
        stats.errors.push(`category ${catUrl}: ${rendered.error ?? 'no html'}`);
        logLine(runLogPath, '  FAIL category render');
        continue;
      }
      eventUrls = rendered.eventUrls.slice(0, args.eventLimit);
    } catch (e) {
      stats.categoriesFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      stats.errors.push(`category ${catUrl}: ${msg}`);
      logLine(runLogPath, `  FAIL category exception: ${msg}`);
      continue;
    }

    stats.categoriesProcessed++;

    stats.categoryUrlsDiscovered += eventUrls.length;
    logLine(runLogPath, `  discovered ${eventUrls.length} event-URLs`);

    for (const eventUrl of eventUrls) {
      const key = `${source.sourceId}::${eventUrl}`;
      if (seen.has(key)) {
        stats.eventsSkippedDuplicate++;
        continue;
      }
      if (source.rateLimitMs > 0) await sleep(source.rateLimitMs);

      try {
        const { event, inScope, creditsUsed } = await extractEventFromPage(
          eventUrl,
          source.sourceId,
          source.scope,
          runLogPath,
        );
        stats.creditsUsed += creditsUsed;
        if (!event) {
          stats.eventsFailed++;
          continue;
        }
        const canonicalKey = `${source.sourceId}::${normalizeEventUrl(event.sourceUrl ?? eventUrl)}`;
        if (seen.has(canonicalKey)) {
          stats.eventsSkippedDuplicate++;
          continue;
        }
        seen.add(key);
        seen.add(canonicalKey);
        if (!inScope) {
          stats.eventsOutOfScope++;
          logLine(
            runLogPath,
            `  OUT-OF-SCOPE ${eventUrl} → ${event.city ?? '?'} (${event.title ?? '?'})`,
          );
          continue;
        }
        outLines.push(JSON.stringify(event));
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
    fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
    fs.appendFileSync(outputFileFor(source.sourceId), outLines.join('\n') + '\n', 'utf8');
    logLine(runLogPath, `WROTE ${outLines.length} events → ${outputFileFor(source.sourceId)}`);
  } else {
    logLine(runLogPath, 'DRY-RUN — no events written');
  }

  // Källstatusen ska spegla verkligheten: en källa som ger events är inte
  // död, även om C-gatens HTML-spår inte hittade något.
  if (!args.dryRun && stats.eventsExtracted > 0) {
    updateSourceStatus(source.sourceId, {
      success: true,
      eventsFound: stats.eventsExtracted,
      pathUsed: 'render',
      ingestionStage: 'completed',
      lastRoutingReason: `D-listing-crawl: ${stats.eventsExtracted} events`,
      lastRoutingSource: 'runtime_status',
    });
  }

  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runTs = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const runLogPath = path.join(LOG_DIR, `${runTs}.log`);

  const sources = selectListingSources(args.sourceId);
  if (sources.length === 0) {
    logLine(runLogPath, 'SKIP — ingen källa deklarerar metadata.categoryUrls');
    // eslint-disable-next-line no-console -- summary line
    console.log('Ingen källa med metadata.categoryUrls — inget att köra.');
    return;
  }

  const allStats: RunStats[] = [];
  for (const source of sources) {
    allStats.push(await crawlSource(source, args, runLogPath));
  }

  for (const stats of allStats) {
    logLine(runLogPath, `STATS ${JSON.stringify(stats)}`);
  }

  // eslint-disable-next-line no-console -- summary line
  console.log('\n=== Listing-crawl summary ===');
  // eslint-disable-next-line no-console -- summary line
  console.log(JSON.stringify(allStats, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- fatal entrypoint error
  console.error('FATAL', e);
  process.exit(1);
});
