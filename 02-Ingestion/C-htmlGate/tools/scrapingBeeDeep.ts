/**
 * scrapingBeeDeep.ts — 5-step event discovery pipeline via ScrapingBee
 *
 * STEP 1: sitemap.xml fetch via regular HTTP (0 ScB credits)
 * STEP 2: AI selects event-URLs from sitemap (MiniMax → Ollama fallback)
 * STEP 3: ScB fetches AI-selected URLs (5 credits/URL, max 10)
 * STEP 4: Swedish paths fallback (~40 credits, only if <3 events)
 * STEP 5: AI homepage analysis fallback (~55 credits, only if <3 events)
 *
 * Usage:
 *   import { deepCrawl } from './tools/scrapingBeeDeep';
 *   const result = await deepCrawl('source-id', 'medium');
 */

import axios from 'axios';
import { fetchHtml } from '../../tools/fetchTools.js';
import { extractFromHtml } from '../../F-eventExtraction/universal-extractor.js';
import { getSource } from '../../tools/sourceRegistry.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CrawlMode = 'shallow' | 'medium' | 'deep';
export type ExitReason = 'ui' | 'd' | 'manual';
export type MethodUsed = 'shallow' | 'sitemap+ai' | 'homepage+ai' | 'swedish-paths';

// ParsedEvent from schema - inline minimal type to avoid circular deps
interface ParsedEvent {
  title: string;
  date: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  venue?: string;
  address?: string;
  city?: string;
  description?: string;
  url?: string;
  ticketUrl?: string;
  organizer?: string;
  performers?: string[];
  category?: string;
  isFree?: boolean;
  priceMin?: number;
  priceMax?: number;
  imageUrl?: string;
  status?: string;
  source: string;
  sourceUrl?: string;
  confidence?: {
    score: number;
    hasTitle: boolean;
    hasDate: boolean;
    hasVenue: boolean;
    hasUrl: boolean;
    hasDescription: boolean;
    hasTicketInfo: boolean;
    eventStatus?: string;
    signals: string[];
  };
}

export interface CrawlResult {
  sourceId: string;
  eventsFound: number;
  events: ParsedEvent[];
  fetchedUrls: string[];
  eventUrls: string[];
  method: MethodUsed;
  creditsUsed: number;
  exitReason: ExitReason;
  /** Why the crawl ended (for debugging) */
  reason?: string;
}

export interface SitemapResult {
  urls: string[];
  found: boolean;
  sitemapUrl: string;
  attempts: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY ?? '';
const SCRAPINGBEE_BASE = 'https://app.scrapingbee.com/api/v1/';
const SCRAPINGBEE_CREDITS_PER_URL = 5;
const MAX_CREDITS_PER_SOURCE = 120;
const MAX_SCB_CONCURRENT = 5;
const SCB_DELAY_MS = 200;
const MAX_SITEMAP_URLS_FOR_AI = 100;
const MAX_AI_SELECTED_URLS = 15;
const MIN_EVENTS_THRESHOLD = 3;

const SITEMAP_VARIANTS = [
  '/sitemap.xml',
  '/sitemap-index.xml',
  '/wp-sitemap.xml',
  '/sitemap.xml.gz',
];

const SWEDISH_PATHS = [
  '/kalender',
  '/kalender/',
  '/evenemang',
  '/evenemang/',
  '/events',
  '/events/',
  '/program',
  '/program/',
  '/biljetter',
  '/biljetter/',
  '/tickets',
  '/tickets/',
  '/whatson',
  '/?view=events',
  '/?type=event',
];

const JS_RENDER_MARKERS = [
  '__NEXT_DATA__',
  'data-reactroot',
  'AppRegistry.registerInitialState',
  '__INITIAL_STATE__',
  'window.__STATE__',
  'hydrate',
];

// ─── AI Config ─────────────────────────────────────────────────────────────────

const MINIMAX_CONFIG = {
  provider: 'minimax' as const,
  model: 'minimax-m2.7:cloud',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: 'ollama',
  maxTokens: 2048,
  temperature: 0.1,
};

async function callMinimax(prompt: string, system?: string): Promise<string> {
  const { baseUrl, apiKey, maxTokens, temperature } = MINIMAX_CONFIG;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MINIMAX_CONFIG.model,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content || '';
}

// ─── Step 1: Sitemap Fetch ─────────────────────────────────────────────────────

/**
 * Fetch and parse sitemap.xml from a base URL.
 * Tries multiple sitemap variants, returns URLs from first successful fetch.
 */
export async function fetchSitemap(baseUrl: string): Promise<SitemapResult> {
  const attempts: string[] = [];
  const base = baseUrl.replace(/\/$/, '');

  for (const variant of SITEMAP_VARIANTS) {
    const sitemapUrl = base + variant;
    attempts.push(sitemapUrl);

    try {
      const result = await fetchHtml(sitemapUrl, { timeout: 10000 });
      if (result.success && result.html) {
        const urls = parseXmlSitemap(result.html);
        if (urls.length > 0) {
          return { urls, found: true, sitemapUrl, attempts };
        }
      }
    } catch {
      // Continue to next variant
    }
  }

  return { urls: [], found: false, sitemapUrl: '', attempts };
}

/**
 * Parse XML and extract all <loc> URLs.
 * Simple regex approach — avoids heavy XML parser dependency.
 */
export function parseXmlSitemap(xml: string): string[] {
  const locMatches = xml.match(/<loc[^>]*>([^<]*)<\/loc>/gi);
  if (!locMatches) return [];

  return locMatches
    .map(loc => {
      const match = loc.match(/<loc[^>]*>([^<]*)<\/loc>/i);
      return match ? match[1].trim() : null;
    })
    .filter((url): url is string => url !== null && url.length > 0);
}

// ─── Step 2: AI URL Selection ────────────────────────────────────────────────────

/**
 * Ask AI to select event-URLs from a list of sitemap URLs.
 * Returns up to MAX_AI_SELECTED_URLS validated URLs.
 */
export async function aiSelectEventUrlsFromSitemap(
  sitemapUrls: string[],
  siteUrl: string
): Promise<string[]> {
  if (sitemapUrls.length === 0) return [];

  // Truncate to avoid token overflow
  const truncated = sitemapUrls.slice(0, MAX_SITEMAP_URLS_FOR_AI);
  const urlList = truncated.join('\n');

  const systemPrompt = `You are an event-discovery assistant for Swedish event websites.
Your task: identify URLs that are MOST LIKELY to be event/program pages.

Examples of event-like URLs:
- /kalender, /evenemang, /events, /program
- /biljetter, /tickets (but only if combined with calendar-like paths)
- /whatson, /?view=events
- /event/vernissage, /arrangement

Examples of NON-event URLs (filter these out):
- /om, /about, /kontakt, /contact
- /nyheter, /news, /press
- /arkiv, /archive
- /faq, /terms, /privacy
- /media, /bilder, /images

Return ONLY a JSON array of URLs (no explanation). Max 15 URLs.
Example: ["/kalender", "/events/2024", "/program"]

Site: ${siteUrl}`;

  const userPrompt = `Analyze these URLs from ${siteUrl} sitemap:

${urlList}

Which URLs are most likely EVENT or PROGRAM pages? Return JSON array (max 15):`;

  try {
    const response = await callMinimax(userPrompt, systemPrompt);

    // Parse JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as string[];
    const validated = validateUrls(parsed, siteUrl);

    return validated.slice(0, MAX_AI_SELECTED_URLS);
  } catch (err) {
    console.warn(`[scrapingBeeDeep] AI URL selection failed: ${err}`);
    return [];
  }
}

/**
 * Ask AI to find event-URLs from homepage HTML.
 * Used when sitemap is not available.
 */
export async function aiSelectEventUrlsFromHomepage(
  html: string,
  siteUrl: string
): Promise<string[]> {
  const base = siteUrl.replace(/\/$/, '');

  const systemPrompt = `You are an event-discovery assistant for Swedish event websites.
Analyze the HTML and find links that lead to EVENT or PROGRAM pages.
Look for:
- Link text: "Kalendarium", "Evenemang", "Biljetter", "Program", "What's On"
- URL paths: /kalender, /events, /program, /whatson
- Context: dates nearby, "Boka", "Anmälan", "Biljetter"

Return ONLY a JSON array of URLs (no explanation). Max 10 URLs.
Example: ["/kalender", "/arrangement/2024"]

Site: ${siteUrl}`;

  // Truncate HTML to avoid token overflow
  const truncatedHtml = html.slice(0, 50000);

  const userPrompt = `Analyze this homepage HTML from ${siteUrl}:

${truncatedHtml}

Find all <a href> links that lead to EVENT or PROGRAM pages.
Return ONLY a JSON array of URLs (max 10):`;

  try {
    const response = await callMinimax(userPrompt, systemPrompt);

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as string[];
    const validated = validateUrls(parsed, siteUrl);

    return validated.slice(0, 10);
  } catch (err) {
    console.warn(`[scrapingBeeDeep] AI homepage analysis failed: ${err}`);
    return [];
  }
}

/**
 * Validate URLs start with the site's base URL or are relative paths.
 * Filters out invalid URLs that could point to external sites.
 */
function validateUrls(urls: string[], siteUrl: string): string[] {
  const base = siteUrl.replace(/\/$/, '');
  let baseHost = '';
  try {
    baseHost = new URL(base).hostname;
  } catch {
    return [];
  }

  return urls
    .map(url => {
      // Handle relative URLs
      if (url.startsWith('/')) {
        return base + url;
      }
      // Handle full URLs — validate same hostname
      try {
        const parsed = new URL(url);
        if (parsed.hostname === baseHost) {
          return url;
        }
        return null;
      } catch {
        return null;
      }
    })
    .filter((u): u is string => u !== null);
}

// ─── Step 3: ScB Fetch ─────────────────────────────────────────────────────────

/**
 * Fetch multiple URLs via ScrapingBee with rate limiting.
 * Returns map of URL → result with HTML or error.
 */
export async function fetchUrlsWithScB(
  urls: string[],
  signal?: AbortSignal
): Promise<Map<string, { html?: string; error?: string }>> {
  const results = new Map<string, { html?: string; error?: string }>();
  let creditsUsed = 0;

  // Process in batches of MAX_SCB_CONCURRENT
  for (let i = 0; i < urls.length; i += MAX_SCB_CONCURRENT) {
    if (signal?.aborted) break;
    if (creditsUsed > MAX_CREDITS_PER_SOURCE) break;

    const batch = urls.slice(i, i + MAX_SCB_CONCURRENT);

    const batchResults = await Promise.all(
      batch.map(url => fetchSingleWithScB(url, signal))
    );

    for (let j = 0; j < batch.length; j++) {
      results.set(batch[j], batchResults[j]);
      if (batchResults[j].html) {
        creditsUsed += SCRAPINGBEE_CREDITS_PER_URL;
      }
    }

    // Rate limit delay between batches
    if (i + MAX_SCB_CONCURRENT < urls.length) {
      await sleep(SCB_DELAY_MS);
    }
  }

  return results;
}

async function fetchSingleWithScB(
  url: string,
  signal?: AbortSignal
): Promise<{ html?: string; error?: string }> {
  if (!SCRAPINGBEE_API_KEY) {
    return { error: 'SCRAPINGBEE_API_KEY not configured' };
  }

  try {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY,
      url: url,
      render_js: 'true',
      country_code: 'se',
      block_resources: 'false',
    });

    const response = await axios.get(SCRAPINGBEE_BASE, {
      params,
      timeout: 30000,
      signal,
    });

    if (response.status === 200) {
      return { html: response.data as string };
    }

    return { error: `HTTP ${response.status}` };
  } catch (err: any) {
    if (err.response?.status === 429) {
      // Rate limited — wait and retry once
      await sleep(2000);
      return fetchSingleWithScB(url, signal);
    }
    return { error: err.message || 'unknown' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Step 4: Swedish Paths ─────────────────────────────────────────────────────

/**
 * Test common Swedish event paths on a site.
 * Only runs if < MIN_EVENTS_THRESHOLD events found in steps 1-3.
 * Returns events found and paths that yielded results.
 */
export async function testSwedishPaths(
  baseUrl: string,
  signal?: AbortSignal
): Promise<{ events: ParsedEvent[]; pathsFound: string[] }> {
  const base = baseUrl.replace(/\/$/, '');
  const allEvents: ParsedEvent[] = [];
  const pathsFound: string[] = [];

  for (const eventPath of SWEDISH_PATHS) {
    if (signal?.aborted) break;

    const testUrl = base + eventPath;
    const result = await fetchSingleWithScB(testUrl, signal);

    if (result.html) {
      const extractResult = extractFromHtml(result.html, 'swedish-paths', testUrl);
      if (extractResult.events.length > 0) {
        allEvents.push(...extractResult.events);
        pathsFound.push(eventPath);
      }
    }

    await sleep(SCB_DELAY_MS);
  }

  return { events: allEvents, pathsFound };
}

// ─── JS Render Detection ───────────────────────────────────────────────────────

/**
 * Detect markers of JavaScript-rendered content.
 */
export function detectJsRender(html: string): boolean {
  return JS_RENDER_MARKERS.some(marker => html.includes(marker));
}

// ─── Event Extraction ─────────────────────────────────────────────────────────

/**
 * Extract events from HTML and deduplicate by title+date.
 */
function extractEventsFromHtml(
  html: string,
  sourceId: string,
  url: string
): ParsedEvent[] {
  const result = extractFromHtml(html, sourceId, url);
  return deduplicateEvents(result.events);
}

function deduplicateEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.title}|${event.date}|${event.venue || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main Pipeline ─────────────────────────────────────────────────────────────

/**
 * Deep crawl a source using the 5-step pipeline.
 *
 * Modes:
 * - shallow: homepage only (~5 credits, current behavior)
 * - medium: sitemap + AI + ScB (~55 credits, recommended)
 * - deep: full pipeline (~100 credits)
 *
 * Max credits guard: stops if creditsUsed > MAX_CREDITS_PER_SOURCE
 */
export async function deepCrawl(
  sourceId: string,
  mode: CrawlMode,
  opts?: { signal?: AbortSignal; onProgress?: (msg: string) => void }
): Promise<CrawlResult> {
  const { signal, onProgress } = opts ?? {};
  let creditsUsed = 0;
  const allEvents: ParsedEvent[] = [];
  const fetchedUrls: string[] = [];
  const eventUrls: string[] = [];
  let method: MethodUsed = 'shallow';

  const source = getSource(sourceId);
  if (!source) {
    return {
      sourceId,
      eventsFound: 0,
      events: [],
      fetchedUrls: [],
      eventUrls: [],
      method: 'shallow',
      creditsUsed: 0,
      exitReason: 'manual',
    };
  }

  const baseUrl = source.url;
  onProgress?.(`[deepCrawl] Starting ${sourceId} in ${mode} mode`);

  // ── SHALLOW MODE: homepage only ──────────────────────────────────────────────
  if (mode === 'shallow') {
    const result = await fetchSingleWithScB(baseUrl, signal);

    if (result.error) {
      onProgress?.(`[deepCrawl] ScB error: ${result.error}`);
      return {
        sourceId,
        eventsFound: 0,
        events: [],
        fetchedUrls,
        eventUrls: [],
        method: 'shallow',
        creditsUsed,
        exitReason: 'manual',
        reason: `ScB error: ${result.error}`,
      };
    }

    if (result.html) {
      creditsUsed += SCRAPINGBEE_CREDITS_PER_URL;
      fetchedUrls.push(baseUrl);

      const jsRender = detectJsRender(result.html);
      if (jsRender) {
        return {
          sourceId,
          eventsFound: 0,
          events: [],
          fetchedUrls,
          eventUrls: [],
          method: 'shallow',
          creditsUsed,
          exitReason: 'd',
          reason: 'JS-render detected',
        };
      }

      const events = extractEventsFromHtml(result.html, sourceId, baseUrl);
      if (events.length > 0) {
        return {
          sourceId,
          eventsFound: events.length,
          events,
          fetchedUrls,
          eventUrls: baseUrl ? [baseUrl] : [],
          method: 'shallow',
          creditsUsed,
          exitReason: 'ui',
          reason: `Found ${events.length} events on homepage`,
        };
      }

      return {
        sourceId,
        eventsFound: 0,
        events: [],
        fetchedUrls,
        eventUrls: [],
        method: 'shallow',
        creditsUsed,
        exitReason: 'manual',
        reason: 'No events on homepage (0 credits)',
      };
    }

    return {
      sourceId,
      eventsFound: 0,
      events: [],
      fetchedUrls,
      eventUrls: [],
      method: 'shallow',
      creditsUsed,
      exitReason: 'manual',
      reason: 'No HTML returned',
    };
  }

  // ── MEDIUM/DEEP MODE: sitemap-first ─────────────────────────────────────────
  onProgress?.(`[deepCrawl] Step 1: Fetching sitemap for ${baseUrl}`);
  const sitemapResult = await fetchSitemap(baseUrl);

  if (!sitemapResult.found) {
    // No sitemap — skip to step 5 (AI homepage analysis)
    onProgress?.(`[deepCrawl] No sitemap found, skipping to AI homepage analysis`);
    return crawlWithHomepageAi(sourceId, baseUrl, signal, onProgress);
  }

  // ── Step 2: AI selects event URLs from sitemap ──────────────────────────────
  onProgress?.(`[deepCrawl] Step 2: AI selecting event URLs from ${sitemapResult.urls.length} sitemap URLs`);
  const aiSelectedUrls = await aiSelectEventUrlsFromSitemap(sitemapResult.urls, baseUrl);

  if (aiSelectedUrls.length === 0) {
    onProgress?.(`[deepCrawl] AI selected no URLs, trying Swedish paths`);
    return crawlWithSwedishPaths(sourceId, baseUrl, signal, onProgress);
  }

  // ── Step 3: ScB fetch AI-selected URLs ─────────────────────────────────────
  onProgress?.(`[deepCrawl] Step 3: Fetching ${aiSelectedUrls.length} AI-selected URLs via ScB`);
  const scbResults = await fetchUrlsWithScB(aiSelectedUrls, signal);

  for (const [url, result] of scbResults) {
    if (result.html) {
      creditsUsed += SCRAPINGBEE_CREDITS_PER_URL;
      fetchedUrls.push(url);

      const jsRender = detectJsRender(result.html);
      if (jsRender) continue;

      const events = extractEventsFromHtml(result.html, sourceId, url);
      if (events.length > 0) {
        allEvents.push(...events);
        eventUrls.push(url);
        onProgress?.(`[deepCrawl] Found ${events.length} events at ${url}`);
      }
    }

    if (creditsUsed > MAX_CREDITS_PER_SOURCE) {
      onProgress?.(`[deepCrawl] Max credits (${MAX_CREDITS_PER_SOURCE}) reached`);
      break;
    }
  }

  // Check if we have enough events
  if (allEvents.length >= MIN_EVENTS_THRESHOLD) {
    return {
      sourceId,
      eventsFound: allEvents.length,
      events: deduplicateEvents(allEvents),
      fetchedUrls,
      eventUrls,
      method: 'sitemap+ai',
      creditsUsed,
      exitReason: 'ui',
      reason: `Found ${allEvents.length} events via sitemap+AI URLs`,
    };
  }

  // ── Step 4: Swedish paths fallback (if < 3 events) ─────────────────────────
  if (mode === 'deep') {
    onProgress?.(`[deepCrawl] Step 4: Testing Swedish paths (only ${allEvents.length} events found)`);
    const swedishResult = await testSwedishPaths(baseUrl, signal);

    for (const event of swedishResult.events) {
      allEvents.push(event);
    }

    if (swedishResult.pathsFound.length > 0) {
      onProgress?.(`[deepCrawl] Swedish paths found events on: ${swedishResult.pathsFound.join(', ')}`);
    }
  }

  if (allEvents.length >= MIN_EVENTS_THRESHOLD) {
    return {
      sourceId,
      eventsFound: allEvents.length,
      events: deduplicateEvents(allEvents),
      fetchedUrls,
      eventUrls,
      method: 'swedish-paths',
      creditsUsed,
      exitReason: 'ui',
      reason: `Found ${allEvents.length} events via Swedish paths fallback`,
    };
  }

  // ── Step 5: AI homepage analysis fallback ────────────────────────────────────
  if (mode === 'deep') {
    onProgress?.(`[deepCrawl] Step 5: AI homepage analysis fallback`);
    return crawlWithHomepageAi(sourceId, baseUrl, signal, onProgress);
  }

  // Not enough events and medium mode — route to manual
  const mediumMethod = allEvents.length > 0 ? 'swedish-paths' : 'shallow';
  return {
    sourceId,
    eventsFound: allEvents.length,
    events: deduplicateEvents(allEvents),
    fetchedUrls,
    eventUrls,
    method: mediumMethod,
    creditsUsed,
    exitReason: allEvents.length > 0 ? 'ui' : 'manual',
    reason: allEvents.length > 0
      ? `Found ${allEvents.length} events via sitemap+AI, insufficient for threshold`
      : 'sitemap+AI found no events, no Swedish paths in medium mode',
  };
}

/**
 * Fallback: fetch homepage, then use AI to find event links.
 */
async function crawlWithHomepageAi(
  sourceId: string,
  baseUrl: string,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<CrawlResult> {
  let creditsUsed = 0;
  const allEvents: ParsedEvent[] = [];
  const fetchedUrls: string[] = [];
  const eventUrls: string[] = [];

  // Fetch homepage via ScB
  const homeResult = await fetchSingleWithScB(baseUrl, signal);
  if (!homeResult.html) {
    return {
      sourceId,
      eventsFound: 0,
      events: [],
      fetchedUrls,
      eventUrls: [],
      method: 'homepage+ai',
      creditsUsed: 0,
      exitReason: 'manual',
      reason: `ScB failed to return homepage HTML`,
    };
  }

  creditsUsed += SCRAPINGBEE_CREDITS_PER_URL;
  fetchedUrls.push(baseUrl);

  // Check homepage directly
  const homeEvents = extractEventsFromHtml(homeResult.html, sourceId, baseUrl);
  if (homeEvents.length >= MIN_EVENTS_THRESHOLD) {
    return {
      sourceId,
      eventsFound: homeEvents.length,
      events: homeEvents,
      fetchedUrls,
      eventUrls: [baseUrl],
      method: 'homepage+ai',
      creditsUsed,
      exitReason: 'ui',
      reason: `Found ${homeEvents.length} events directly on homepage`,
    };
  }

  allEvents.push(...homeEvents);

  // AI homepage analysis to find more links
  const aiUrls = await aiSelectEventUrlsFromHomepage(homeResult.html, baseUrl);

  if (aiUrls.length === 0) {
    return {
      sourceId,
      eventsFound: allEvents.length,
      events: deduplicateEvents(allEvents),
      fetchedUrls,
      eventUrls,
      method: 'homepage+ai',
      creditsUsed,
      exitReason: allEvents.length > 0 ? 'ui' : 'manual',
      reason: allEvents.length > 0
        ? `AI found no new URLs, had ${allEvents.length} from homepage`
        : `AI found no event URLs on homepage`,
    };
  }

  // Fetch AI-selected URLs
  const scbResults = await fetchUrlsWithScB(aiUrls, signal);

  for (const [url, result] of scbResults) {
    if (result.html) {
      creditsUsed += SCRAPINGBEE_CREDITS_PER_URL;
      fetchedUrls.push(url);

      if (detectJsRender(result.html)) continue;

      const events = extractEventsFromHtml(result.html, sourceId, url);
      if (events.length > 0) {
        allEvents.push(...events);
        eventUrls.push(url);
      }
    }

    if (creditsUsed > MAX_CREDITS_PER_SOURCE) break;
  }

  return {
    sourceId,
    eventsFound: allEvents.length,
    events: deduplicateEvents(allEvents),
    fetchedUrls,
    eventUrls,
    method: 'homepage+ai',
    creditsUsed,
    exitReason: allEvents.length > 0 ? 'ui' : 'manual',
    reason: allEvents.length > 0
      ? `Found ${allEvents.length} events via homepage+AI links`
      : `homepage+AI found 0 events after scraping all links`,
  };
}

/**
 * Swedish paths fallback (for medium mode when sitemap exists but few events).
 */
async function crawlWithSwedishPaths(
  sourceId: string,
  baseUrl: string,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<CrawlResult> {
  const swedishResult = await testSwedishPaths(baseUrl, signal);

  const allEvents = swedishResult.events;
  const fetchedUrls = swedishResult.pathsFound.map(p => baseUrl + p);

  return {
    sourceId,
    eventsFound: allEvents.length,
    events: deduplicateEvents(allEvents),
    fetchedUrls,
    eventUrls: swedishResult.pathsFound,
    method: 'swedish-paths',
    creditsUsed: swedishResult.pathsFound.length * SCRAPINGBEE_CREDITS_PER_URL,
    exitReason: allEvents.length > 0 ? 'ui' : 'manual',
    reason: allEvents.length > 0
      ? `Found ${allEvents.length} events on Swedish paths: ${swedishResult.pathsFound.join(', ')}`
      : `No events found on any Swedish path`,
  };
}

// ─── Exports for testing ───────────────────────────────────────────────────────

export { SCRAPINGBEE_CREDITS_PER_URL, MAX_CREDITS_PER_SOURCE };
