/**
 * Scout: Sök kandidater på en source.
 * 
 * Steg 1 av 3 i nya Universal Engine:
 *   Scout → Ranker → MultiExtractor
 * 
 * Strategi:
 * 1. Hämta root-sidan
 * 2. Samla ALLA interna event-liknande linker
 * 3. Mät event-density på alla kandidater parallellt
 * 4. Testa Swedish event patterns som fallback
 * 5. Returnera upp till 20 kandidater med deras density metrics
 * 
 * Inga gate-beslut här — Scout samlar bara, Ranker väljer.
 */

import * as cheerio from 'cheerio';
import { fetchHtml } from '../tools/fetchTools.js';

export interface ScoutCandidate {
  url: string;
  href: string;            // relative href from root
  sourceRegion: 'nav' | 'menu' | 'submenu' | 'content' | 'sidebar' | 'footer' | 'swedish-pattern' | 'api-path';
  matchedConcepts: string[];
  // Density metrics (fetched from candidate page)
  metrics: {
    isoDateCount: number;     // \d{4}-\d{2}-\d{2}
    sweDateCount: number;     // Swedish dates
    timeTagCount: number;     // <time datetime>
    eventBlockCount: number;  // .event, .kalender, [class*="event"]
    ticketCtaCount: number;   // biljett, ticket, köp
    linkCount: number;        // links in main content
    jsBlockCount: number;     // <script> blocks over 5KB
    hasJsonLd: boolean;       // has schema.org/Event JSON-LD
    hasAppRegistry: boolean;  // has AppRegistry pattern
    htmlSize: number;         // raw HTML size
  };
  densityScore: number;  // computed: weighted sum
  rawFetchMs: number;   // how long the page took to fetch
}

export interface ScoutResult {
  sourceId: string;
  rootUrl: string;
  rootMetrics: ScoutCandidate['metrics'];  // metrics from root page
  candidates: ScoutCandidate[];
  totalCandidatesFound: number;
  swedishPatternHits: string[];  // which patterns matched
  fetchErrors: string[];         // sources that failed to fetch
  scoutDurationMs: number;
  // Debug
  allLinksFound: number;
  linksByRegion: Record<string, number>;
}

// ─── Swedish Event Patterns ────────────────────────────────────────────────────

const SWEDISH_PATTERNS = [
  // Core
  '/evenemang', '/events', '/kalender', '/program', '/schema', '/kalendarium',
  // Activity/booking
  '/aktiviteter', '/aktivitet', '/biljetter', '/tickets', '/boka', '/booking',
  // Museum/exhibition
  '/utställningar', '/utstallningar', '/exhibition', '/exhibitions', '/visa',
  // Theater/performance
  '/scen', '/teater', '/repertoar', '/foreställningar', '/forestillingar',
  // Concerts/music
  '/konserter', '/konsert', '/musik',
  // Sports/arena
  '/matcher', '/spelprogram', '/arena', '/hall',
  // Culture
  '/kultur', '/fritid', '/besok',
  // Archive/old events (lower priority)
  '/arkiv',
];

// ─── Ignore patterns ───────────────────────────────────────────────────────────

const IGNORE_PATTERNS = [
  'nyheter', 'nyhet', 'press', 'kontakt', 'om-oss', 'om-os', 'login', 'logga-in',
  'policy', 'privacy', 'cookies', 'gdpr', 'social', 'facebook', 'instagram',
  'twitter', 'linkedin', 'youtube', 'spotify', 'soundcloud',
  'lediga-tjanster', 'jobb', 'jobbannonser',
  'bli-medlem', 'medlemskap', 'prenumerera',
  'foretag', 'företag', 'handlare',
];

// ─── URL helpers ───────────────────────────────────────────────────────────────

function getBaseUrl(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

function getPathDepth(url: string, base: string): number {
  try {
    const u = new URL(url);
    const b = new URL(base);
    const pathA = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const pathB = b.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return Math.max(0, pathA.length - pathB.length);
  } catch { return 99; }
}

function shouldIgnore(href: string, anchorText: string): boolean {
  const combined = (href + ' ' + anchorText).toLowerCase();
  return IGNORE_PATTERNS.some(p => combined.includes(p));
}

function resolveUrl(href: string, base: string): string | null {
  try {
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return new URL(href, base).href;
    return null;
  } catch { return null; }
}

// ─── Concept detection ────────────────────────────────────────────────────────

const CONCEPT_KEYWORDS: [string[], number][] = [
  [['event', 'evenemang', 'events', 'kalender', 'calendar', 'kalendarium', 'aktiviteter', 'aktivitet'], 3],
  [['program', 'programme', 'schema', 'spelprogram', 'repertoar', 'foreställningar', 'forestillingar'], 3],
  [['konsert', 'konserter', 'musik', 'live', 'scen', 'teater', 'teatral', 'show'], 2],
  [['biljett', 'biljetter', 'ticket', 'tickets', 'köp', 'köpa', 'boka', 'booking', 'köp', 'kopa'], 2],
  [['festival', 'festivaler', 'mässa', 'mässor'], 1],
  [['sport', 'match', 'matcher', 'arena', 'hall'], 1],
];

function conceptScore(text: string): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  for (const [keywords, weight] of CONCEPT_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { matched.push(kw); score += weight; }
    }
  }
  return { score, matched };
}

// ─── Region classification ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyRegion(el: any): ScoutCandidate['sourceRegion'] {
  const classes = (el.attribs?.class || '').toLowerCase();
  const id = (el.attribs?.id || '').toLowerCase();
  const tag = el.name || '';
  
  if (tag === 'nav' || classes.includes('nav') || id.includes('nav')) return 'nav';
  if (classes.includes('menu') || id.includes('menu') || classes.includes('submenu')) return 'submenu';
  if (classes.includes('sidebar') || id.includes('sidebar')) return 'sidebar';
  if (tag === 'footer' || classes.includes('footer')) return 'footer';
  if (classes.includes('header') || id.includes('header')) return 'menu';
  return 'content';
}

// ─── Metric extraction ─────────────────────────────────────────────────────────

function extractMetrics(html: string): ScoutCandidate['metrics'] {
  const $ = cheerio.load(html);
  const body = $('body').text();
  
  const isoDateRx = /\d{4}-\d{2}-\d{2}/g;
  const sweDateRx = /\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+\d{4}/gi;
  
  const isoDates = (body.match(isoDateRx) || []).length;
  const sweDates = (body.match(sweDateRx) || []).length;
  
  const timeTagCount = $('time[datetime]').length;
  
  const eventBlockSelectors = [
    '.event', '.kalender', '.program', '.konsert', '.concert',
    '[class*="event"]', '[class*="kalender"]', '[class*="program"]',
    '[class*="activity"]', '[class*="aktivitet"]', 'article',
  ];
  let eventBlockCount = 0;
  for (const sel of eventBlockSelectors) {
    eventBlockCount += $(sel).length;
  }
  
  const ticketSelectors = ['.biljett', '.ticket', '.kopa', '[class*="biljett"]', '[class*="ticket"]', '[class*="book"]'];
  let ticketCtaCount = 0;
  for (const sel of ticketSelectors) {
    ticketCtaCount += $(sel).length;
  }
  
  const linkCount = $('main a[href], article a[href], .content a[href]').length;
  
  // Large JS blocks (indicates AppRegistry/React/Next.js data)
  let jsBlockCount = 0;
  $('script').each((_, el) => {
    const content = (el.children[0] as { data?: string } | undefined)?.data || '';
    if (content.length > 5000) jsBlockCount++;
  });
  
  // JSON-LD check
  const hasJsonLd = $('script[type="application/ld+json"]').length > 0;
  
  // AppRegistry check
  const hasAppRegistry = html.includes('AppRegistry.registerInitialState');
  
  return {
    isoDateCount: isoDates,
    sweDateCount: sweDates,
    timeTagCount,
    eventBlockCount,
    ticketCtaCount,
    linkCount,
    jsBlockCount,
    hasJsonLd,
    hasAppRegistry,
    htmlSize: html.length,
  };
}

function computeDensityScore(m: ScoutCandidate['metrics']): number {
  return (
    m.isoDateCount * 2 +
    m.sweDateCount * 2 +
    m.timeTagCount * 4 +
    m.eventBlockCount * 1 +
    m.ticketCtaCount * 2 +
    Math.min(m.linkCount, 15) * 0.3 +
    (m.hasJsonLd ? 20 : 0) +
    (m.hasAppRegistry ? 25 : 0) +
    (m.jsBlockCount > 0 ? 5 : 0)
  );
}

// ─── Main Scout ───────────────────────────────────────────────────────────────

export async function scout(
  sourceId: string,
  rootUrl: string,
  abortSignal?: AbortSignal,
): Promise<ScoutResult> {
  const startTime = Date.now();
  const baseUrl = getBaseUrl(rootUrl);
  const fetchErrors: string[] = [];
  const swedishPatternHits: string[] = [];
  
  // ── Step 1: Fetch root page ──────────────────────────────────────────────────
  const rootFetch = await fetchHtml(rootUrl, { timeout: 15000, signal: abortSignal });
  
  let rootMetrics: ScoutCandidate['metrics'] = {
    isoDateCount: 0, sweDateCount: 0, timeTagCount: 0, eventBlockCount: 0,
    ticketCtaCount: 0, linkCount: 0, jsBlockCount: 0, hasJsonLd: false,
    hasAppRegistry: false, htmlSize: 0,
  };
  
  let html: string | null = null;
  
  if (rootFetch.success && rootFetch.html) {
    html = rootFetch.html;
    rootMetrics = extractMetrics(html);
  } else {
    fetchErrors.push(`root: ${rootFetch.error || 'fetch failed'}`);
  }
  
  // ── Step 2: Collect internal event links ────────────────────────────────────
  const seen = new Set<string>();
  const allLinks: ScoutCandidate[] = [];
  const linksByRegion: Record<string, number> = {};
  
  if (html != null) {
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = el.attribs?.href || '';
      const anchorText = $(el).text().trim();
      
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (shouldIgnore(href, anchorText)) return;
      
      const fullUrl = resolveUrl(href, baseUrl);
      if (!fullUrl) return;
      if (seen.has(fullUrl)) return;
      
      try {
        if (new URL(fullUrl).origin !== new URL(baseUrl).origin) return;
      } catch { return; }
      seen.add(fullUrl);
      
      const depth = getPathDepth(fullUrl, baseUrl);
      if (depth > 3) return;
      
      const { score, matched } = conceptScore(href + ' ' + anchorText);
      if (score === 0) return;
      
      const region = classifyRegion(el);
      linksByRegion[region] = (linksByRegion[region] || 0) + 1;
      
      allLinks.push({
        url: fullUrl,
        href,
        sourceRegion: region,
        matchedConcepts: matched,
        metrics: { isoDateCount: 0, sweDateCount: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, linkCount: 0, jsBlockCount: 0, hasJsonLd: false, hasAppRegistry: false, htmlSize: 0 },
        densityScore: 0,
        rawFetchMs: 0,
      });
    });
  }
  
  // Sort by concept score and take top 30 for density measurement
  allLinks.sort((a, b) => {
    const regionBoost = (r: ScoutCandidate['sourceRegion']) => r === 'nav' ? 5 : r === 'menu' ? 4 : r === 'submenu' ? 3 : r === 'content' ? 2 : 0;
    return (b.matchedConcepts.length * 3 + regionBoost(b.sourceRegion)) -
           (a.matchedConcepts.length * 3 + regionBoost(a.sourceRegion));
  });
  
  const topLinks = allLinks.slice(0, 20);
  
  // ── Step 3: Measure density on candidates in parallel ────────────────────────
  const candidates: ScoutCandidate[] = [];
  
  const fetches = topLinks.map(async (link): Promise<void> => {
    const t0 = Date.now();
    try {
      const result = await fetchHtml(link.url, { timeout: 10000, signal: abortSignal });
      const fetchMs = Date.now() - t0;
      
      if (result.success && result.html) {
        const metrics = extractMetrics(result.html);
        const densityScore = computeDensityScore(metrics);
        
        link.metrics = metrics;
        link.densityScore = densityScore;
        link.rawFetchMs = fetchMs;
        candidates.push(link);
      } else {
        fetchErrors.push(`${link.href}: ${result.error || 'fetch failed'}`);
      }
    } catch (e) {
      fetchErrors.push(`${link.href}: ${(e as Error).message}`);
    }
  });
  
  await Promise.allSettled(fetches);
  
  // ── Step 4: Swedish patterns fallback ────────────────────────────────────────
  if (html != null) {
    for (const pattern of SWEDISH_PATTERNS) {
      const candidateUrl = new URL(pattern, rootUrl).href;
      if (seen.has(candidateUrl)) continue;  // already discovered via links
      
      try {
        const t0 = Date.now();
        const result = await fetchHtml(candidateUrl, { timeout: 10000, signal: abortSignal });
        const fetchMs = Date.now() - t0;
        
        if (result.success && result.html) {
          const metrics = extractMetrics(result.html);
          const densityScore = computeDensityScore(metrics);
          
          if (densityScore > 0 || metrics.isoDateCount > 0 || metrics.sweDateCount > 0 || metrics.timeTagCount > 0) {
            swedishPatternHits.push(pattern);
            candidates.push({
              url: candidateUrl,
              href: pattern,
              sourceRegion: 'swedish-pattern',
              matchedConcepts: [pattern.replace('/', '')],
              metrics,
              densityScore,
              rawFetchMs: fetchMs,
            });
          }
        }
      } catch { /* try next pattern */ }
    }
  }
  
  // ── Step 5: Sort by density score ───────────────────────────────────────────
  candidates.sort((a, b) => b.densityScore - a.densityScore);
  
  return {
    sourceId,
    rootUrl,
    rootMetrics,
    candidates,
    totalCandidatesFound: candidates.length,
    swedishPatternHits,
    fetchErrors,
    scoutDurationMs: Date.now() - startTime,
    allLinksFound: allLinks.length,
    linksByRegion,
  };
}
