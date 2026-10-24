/**
 * C0 — HTML Frontier Discovery: Bounded link-based candidate discovery
 *
 * STEP 0 (before C1/C2) of the HTML path.
 * Discovers internal event-list candidate pages before scoring gates.
 *
 * Derived Rules Integration:
 * When candidatesFound === 0 AND a NEEDS_SUBPAGE_DISCOVERY rule exists
 * for this source, C0 will also test the suggestedPaths before giving up.
 */

import { fetchHtml, normalizeFetchUrl } from '../../tools/fetchTools';
import { load } from 'cheerio';
import type { DerivedRulesStore } from '../c4-derived-rules';
import { FailCategory } from '../C4-ai-analysis';
import { fetchSitemapEntries as fetchSitemapEntriesDeep } from '../tools/scrapingBeeDeep';

export interface DiscoveredLink {
  url: string;
  href: string;
  anchorText: string;
  sourceRegion: 'nav' | 'header' | 'submenu' | 'content' | 'sidebar' | 'footer';
  score: number;
  matchedConcepts: string[];
}

/**
 * Steg 4 feature-flag: inlänk-räkning som popularitet-tiebreaker.
 * Sätts till false för A/B-jämförelse i Fas B.2 cohort-mätning.
 * Default: true (Steg 4 aktiv).
 */
export const INBOUND_TIEBREAKER_ENABLED =
  process.env.EVENTPULSE_C0_INBOUND_TIEBREAKER !== 'false';

export interface CandidatePage {
  url: string;
  href: string;
  sourceRegion: string;
  eventDensityScore: number;
  inboundCount: number; // Steg 4: antal <a href> på root som pekar hit (popularitet)
  finalScore: number; // eventDensityScore + log2(inboundCount + 1)
  metrics: {
    dateMentions: number;
    timeTagCount: number;
    eventBlockCount: number;
    ticketCtaCount: number;
    linkCount: number;
  };
  concepts: string[];
  rankingReason: string;
}

export interface FrontierDiscoveryResult {
  rootUrl: string;
  totalInternalLinks: number;
  candidatesFound: number;
  topCandidates: CandidatePage[];
  winner?: CandidatePage;
  winnerReason: string;
  rootRejected: boolean;
  rootRejectionReason?: string;
  debug: {
    allLinksByRegion: Record<string, number>;
    topScoringLinks: Array<{ href: string; score: number; concepts: string[] }>;
  };
  // Rule tracking: was a derived rule or built-in pattern used to find the winner?
  ruleApplied: {
    source: 'none' | 'link-discovery' | 'derived-rule' | 'swedish-patterns' | 'sitemap';
    pathsTested: string[];
    winnerPath: string | null;
  };
}

const EVENT_CONCEPTS = [
  'event', 'evenemang', 'events', 'kalender', 'calendar',
  'program', 'programme', 'agenda', 'schema',
];

const SCEN_CONCEPTS = [
  'scen', 'forestailling', 'repertoar', 'produktion', 'show',
  'konsert', 'konserter', 'teater', 'teatral',
];

const CATEGORY_CONCEPTS = [
  'musik', 'music', 'sport', 'humor', 'live', 'tickets',
  'biljetter', 'biljett', 'festival', 'festivaler',
];

const ALL_CONCEPTS = [...EVENT_CONCEPTS, ...SCEN_CONCEPTS, ...CATEGORY_CONCEPTS];

const IGNORE_PATTERNS = [
  'nyheter', 'press', 'kontakt', 'om-oss', 'om-os', 'login', 'logga-in',
  'policy', 'privacy', 'cookies', 'gdpr', 'social', 'facebook', 'instagram',
  'twitter', 'linkedin', 'youtube', 'spotify', 'soundcloud', 'arkiv',
];

/**
 * Swedish event path patterns — common URL paths for event listings on Swedish websites.
 * Used as fallback when link-based discovery finds no candidates.
 * Based on IMP-009 findings from batch-14/batch-15 learning loops.
 * Extended with museum/theater/arena patterns from batch-54+ fail analysis (2026-04-15).
 * Classification: General — verified across 3+ venue types (museums, theaters, arenas).
 */
const SWEDISH_EVENT_PATTERNS = [
  // Core event listing paths
  '/events',
  '/program',
  '/kalender',
  '/schema',
  '/evenemang',
  '/kalendarium',
  '/aktiviteter',
  // Museum-specific paths (verified on vasamuseet, historiska-museet, tekniska-museet, kalmar-museum)
  '/utställningar',
  '/exhibition',
  '/exhibitions',
  '/exhibits',
  '/visa',
  // Theater-specific paths
  '/scen',
  '/teater',
  '/repertoar',
  '/forestillinger',
  '/forestilling',
  '/shown',
  // Arena/sports paths (verified on helsingborg-arena)
  '/matcher',
  '/tickets',
  '/biljetter',
  '/arena',
  '/hall',
  // Cultural/generic
  '/kultur',
  '/fritid',
  '/besok',
  '/planera',
  '/oppet',
  // Additional common patterns
  '/konserter',
  '/konsert',
  // Extended patterns (batch-107 learning: mobilia → /aterkommande-event)
  '/aterkommande-event',
  // Additional general Swedish event paths (verified across multiple venue types)
  '/arrangemang',
  '/planditt',
  '/hitta-pa',
  '/vad-hander',
];

const MAX_DEPTH = 2;
const MAX_CANDIDATES_TO_FETCH = 10;

function getBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return '';
  }
}

function getPathDepth(url: string, baseUrl: string): number {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    const pathA = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const pathB = base.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return Math.max(0, pathA.length - pathB.length);
  } catch {
    return 99;
  }
}

function shouldIgnore(href: string, anchorText: string): boolean {
  const combined = (href + ' ' + anchorText).toLowerCase();
  for (const pattern of IGNORE_PATTERNS) {
    if (combined.includes(pattern)) return true;
  }
  return false;
}

function calculateConceptScore(text: string): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  
  for (const concept of EVENT_CONCEPTS) {
    if (lower.includes(concept)) {
      matched.push(concept);
      score += 3;
    }
  }
  for (const concept of SCEN_CONCEPTS) {
    if (lower.includes(concept)) {
      matched.push(concept);
      score += 2;
    }
  }
  for (const concept of CATEGORY_CONCEPTS) {
    if (lower.includes(concept)) {
      matched.push(concept);
      score += 1;
    }
  }
  
  return { score, matched };
}

function classifyRegion($el: any): 'nav' | 'header' | 'submenu' | 'content' | 'sidebar' | 'footer' {
  const tag = $el[0]?.name || '';
  const classes = ($el.attr('class') || '').toLowerCase();
  const id = ($el.attr('id') || '').toLowerCase();
  
  if (tag === 'nav' || classes.includes('nav') || id.includes('nav')) return 'nav';
  if (classes.includes('header') || id.includes('header')) return 'header';
  if (classes.includes('menu') || id.includes('menu') || classes.includes('submenu')) return 'submenu';
  if (classes.includes('sidebar') || id.includes('sidebar')) return 'sidebar';
  if (tag === 'footer' || classes.includes('footer') || id.includes('footer')) return 'footer';
  return 'content';
}

export function collectLinks($: any, baseUrl: string): DiscoveredLink[] {
  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  
  $('a[href]').each((_: any, el: any) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const anchorText = $el.text().trim();
    
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    
    let fullUrl: string;
    try {
      if (href.startsWith('http')) {
        fullUrl = href;
      } else if (href.startsWith('/')) {
        fullUrl = new URL(href, baseUrl).href;
      } else {
        return;
      }
    } catch {
      return;
    }
    
    let urlObj: URL;
    let baseUrlObj: URL;
    try {
      urlObj = new URL(fullUrl);
      baseUrlObj = new URL(baseUrl);
    } catch {
      return;
    }
    if (urlObj.origin !== baseUrlObj.origin) return;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    
    if (shouldIgnore(href, anchorText)) return;
    
    const depth = getPathDepth(fullUrl, baseUrl);
    if (depth > MAX_DEPTH) return;
    
    const { score, matched } = calculateConceptScore(href + ' ' + anchorText);
    if (score === 0) return;
    
    const region = classifyRegion($el.closest('nav, header, aside, main, article, footer, div'));
    
    links.push({
      url: fullUrl,
      href,
      anchorText,
      sourceRegion: region,
      score,
      matchedConcepts: matched,
    });
  });
  
  return links;
}

async function measureEventDensity(url: string): Promise<CandidatePage['metrics']> {
  const result = await fetchHtml(url, { timeout: 10000 });
  
  if (!result.success || !result.html) {
    return { dateMentions: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, linkCount: 0 };
  }
  
  const $ = load(result.html);
  
  const isoDateRegex = /\d{4}-\d{2}-\d{2}/g;
  const sweDateRegex = /\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\s+\d{4}/gi;
  const scopeText = $('body').text();
  const isoDates = (scopeText.match(isoDateRegex) || []).length;
  const sweDates = (scopeText.match(sweDateRegex) || []).length;
  const dateMentions = isoDates + sweDates;
  
  const timeTagCount = $('time[datetime]').length;
  
  const eventSelectors = [
    '.event', '.kalender', '.program', '.konsert', '.concert',
    '[class*="event"]', '[class*="kalender"]', '[class*="program"]',
  ];
  let eventBlockCount = 0;
  for (const sel of eventSelectors) {
    eventBlockCount += $(sel).length;
  }
  
  const ticketSelectors = ['.biljett', '.ticket', '.kopa', '[class*="biljett"]', '[class*="ticket"]'];
  let ticketCtaCount = 0;
  for (const sel of ticketSelectors) {
    ticketCtaCount += $(sel).length;
  }
  
  const linkCount = $('main a[href], article a[href]').length;
  
  return { dateMentions, timeTagCount, eventBlockCount, ticketCtaCount, linkCount };
}

export async function discoverEventCandidates(
  rootUrl: string,
  derivedRules?: DerivedRulesStore,
  sourceId?: string,
): Promise<FrontierDiscoveryResult> {
  const normalizedRootUrl = normalizeFetchUrl(rootUrl);
  const baseUrl = getBaseUrl(normalizedRootUrl);
  
  const rootFetch = await fetchHtml(normalizedRootUrl, { timeout: 15000 });
  
  if (!rootFetch.success || !rootFetch.html) {
    // Distinguish between fetch errors and empty discovery
    const isNetworkError = rootFetch.error && (
      rootFetch.error.includes('DNS') ||
      rootFetch.error.includes('ENOTFOUND') ||
      rootFetch.error.includes('ECONNREFUSED') ||
      rootFetch.error.includes('ETIMEDOUT') ||
      rootFetch.error.includes('SSL') ||
      rootFetch.error.includes('TIMEOUT') ||
      rootFetch.error.includes('fetch') ||
      rootFetch.error.includes('network')
    );
    return {
      rootUrl,
      totalInternalLinks: 0,
      candidatesFound: 0,
      topCandidates: [],
      winner: undefined,
      winnerReason: isNetworkError 
        ? `fetch error: ${rootFetch.error}`
        : 'no internal event candidates discovered',
      rootRejected: false,
      debug: { allLinksByRegion: {}, topScoringLinks: [] },
      ruleApplied: { source: 'none', pathsTested: [], winnerPath: null },
    };
  }
  
  const $ = load(rootFetch.html);
  const allLinks = collectLinks($, baseUrl);

  // -----------------------------------------------------------------------
  // Steg 4 (2026-10-09): Inlänk-räkning (popularitet-signal)
  // Räknar hur många gånger varje unik URL förekommer som <a href> på root-sidan.
  // Till skillnad från allLinks (som deduperas via `seen`-set) räknar vi VARJE
  // förekomst, så att en URL som länkas in 5 ggr får högre popularity.
  //
  // Generalization Protection: General — <a href> är universell HTML, inget
  // sajtspecifikt mönster. Inget IGNORE_PATTERNS-tillägg, ingen scoring-vikt.
  // Tiebreaker-formel: eventDensityScore + log2(inboundCount + 1).
  // Logaritmisk för att undvika att dominera täta nav-länkar.
  // -----------------------------------------------------------------------
  const inboundCounts = new Map<string, number>();
  $('a[href]').each((_: any, el: any) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    let fullUrl: string;
    try {
      if (href.startsWith('http')) {
        fullUrl = href;
      } else if (href.startsWith('/')) {
        fullUrl = new URL(href, baseUrl).href;
      } else {
        return;
      }
    } catch {
      return;
    }
    try {
      const uObj = new URL(fullUrl);
      const bObj = new URL(baseUrl);
      if (uObj.origin !== bObj.origin) return;
    } catch {
      return;
    }
    // Normalisera: ta bort fragment
    const cleanUrl = fullUrl.split('#')[0];
    inboundCounts.set(cleanUrl, (inboundCounts.get(cleanUrl) ?? 0) + 1);
  });

  const linksByRegion: Record<string, number> = {};
  for (const link of allLinks) {
    linksByRegion[link.sourceRegion] = (linksByRegion[link.sourceRegion] || 0) + 1;
  }
  
  const sortedLinks = [...allLinks].sort((a, b) => {
    const regionBoost = (region: string) => {
      if (['nav', 'header', 'submenu'].includes(region)) return 10;
      if (region === 'content') return 5;
      return 0;
    };
    const scoreA = a.score + regionBoost(a.sourceRegion);
    const scoreB = b.score + regionBoost(b.sourceRegion);
    return scoreB - scoreA;
  });
  
  const topLinks = sortedLinks.slice(0, MAX_CANDIDATES_TO_FETCH);

  // -----------------------------------------------------------------------
  // STEP 0 (Fas 2, 2026-10-09): sitemap.xml + robots.txt Sitemap-direktiv
  // Lägger till sitemap-URL:er som ett extra kandidat-set SOM KONKURRERAR
  // MED BFS-resultatet via samma eventDensityScore-formel (inga nya scoringvikter).
  // Filtret shouldIgnore() återanvänds rakt av — INGA nya IGNORE_PATTERNS.
  // Graceful degradation: om sitemap-miss, returnerar tom array → oförändrat beteende.
  //
  // FIX 2026-10-24 — sitemap-EXPANSION:
  // Sitemapens <loc>-barn är INTE alltid event-sidor. På sajter med en
  // sitemap-INDEX (vanligt i WordPress) är <loc>-barnen i stället
  // sub-sitemap-FILER (/event-sitemap.xml). C0 mätte dem med HTML-formeln
  // measureEventDensity, och eftersom varje <lastmod> räknas som ett datum
  // fick .xml-filer 50–250× högre density än riktiga sidor → de vann
  // tävlingslopet → C1 svarade "no <main>" → källan dog.
  //
  // Bevis (2026-10-24):
  //   - 112 av 112 C-gate-traces med .xml som effectiveUrl slutade i
  //     C1_NO_MAIN_ARTICLE. NOLL lyckades. XML:en gav alltså aldrig events,
  //     så att ta bort den ur tävlingslopet kan inte förlora något.
  //   - 21 av 30 live-källor med XML-vinnare gav events när sitemapen
  //     expanderades till sina barn (teatrar, museum, jazzklubb, universitet).
  //
  // Generalization Protection: General — sitemap-INDEX och <lastmod> är
  // Sitemap Protocol 1.1-standard, inte site-specifika konventioner.
  // Ingen ny IGNORE_PATTERN, ingen ny scoring-vikt: barnen mäts med
  // EXAKT samma formel som BFS-länkar.
  // -----------------------------------------------------------------------
  const sitemapUrls: string[] = [];
  let sitemapStats = { attempted: 0, found: 0, afterFilter: 0 };
  let sitemapLastmod = new Map<string, string>();
  try {
    const sitemapResult = await fetchSitemapEntriesDeep(baseUrl);
    sitemapStats.attempted = sitemapResult.attempts.length;
    sitemapStats.found = sitemapResult.entries.length;
    for (const entry of sitemapResult.entries) {
      const u = entry.loc;
      // En .xml-rad är en index-pekare, inte en sida. Mäta den aldrig med
      // HTML-formeln — det var exakt hur .xml:en vann densitetsloppet.
      if (entry.isSitemapFile) continue;
      // Same-origin check (samma som collectLinks): hoppa externa
      try {
        const uObj = new URL(u);
        const bObj = new URL(baseUrl);
        if (uObj.origin !== bObj.origin) continue;
      } catch {
        continue;
      }
      // Same ignore-filter som BFS-länkar (inga nya IGNORE_PATTERNS)
      const uPath = (() => { try { return new URL(u).pathname; } catch { return u; } })();
      if (shouldIgnore(uPath, '')) continue;
      // Depth-cap (samma som BFS-länkar)
      if (getPathDepth(u, baseUrl) > MAX_DEPTH) continue;
      sitemapUrls.push(u);
      if (entry.lastmod) sitemapLastmod.set(u, entry.lastmod);
    }
    sitemapStats.afterFilter = sitemapUrls.length;
    if (sitemapUrls.length > 0) {
      console.log(`[C0] ${sourceId || rootUrl}: sitemap discovery found ${sitemapUrls.length} candidate URLs (raw=${sitemapResult.entries.length}, attempts=${sitemapResult.attempts.length}, files=${sitemapResult.sitemapFiles.length})`);
    }
  } catch (err) {
    // Graceful: fortsätt med BFS-resultatet ensam
    console.warn(`[C0] ${sourceId || rootUrl}: sitemap discovery failed: ${err}`);
  }

  // Sortera sitemap-barnen på <lastmod> (nyast ändrade först) så att vi mäter
  // de AKTUELLA sidorna när sitemapen har tusentals barn. Barn utan <lastmod>
  // hamnar sist (dokumentordning bevaras mellan dem).
  const sitemapOrdered = [...sitemapUrls].sort((a, b) => {
    const ta = sitemapLastmod.get(a) ? Date.parse(sitemapLastmod.get(a)!) || 0 : -1;
    const tb = sitemapLastmod.get(b) ? Date.parse(sitemapLastmod.get(b)!) || 0 : -1;
    return tb - ta;
  });

  // Cap sitemap-össök så att vi inte överskrider MAX_CANDIDATES_TO_FETCH totalt
  const sitemapTop = sitemapOrdered.slice(0, MAX_CANDIDATES_TO_FETCH);

  const candidates: CandidatePage[] = [];

  for (const link of topLinks) {
    const metrics = await measureEventDensity(link.url);

    const eventDensityScore =
      metrics.dateMentions * 2 +
      metrics.timeTagCount * 3 +
      metrics.eventBlockCount +
      metrics.ticketCtaCount +
      Math.min(metrics.linkCount, 10);

    // Steg 4: inlänk-räkning som tiebreaker
    const inboundCount = inboundCounts.get(link.url.split('#')[0]) ?? 0;
    const finalScore = eventDensityScore + Math.log2(inboundCount + 1);

    candidates.push({
      url: link.url,
      href: link.href,
      sourceRegion: link.sourceRegion,
      eventDensityScore,
      inboundCount,
      finalScore,
      metrics,
      concepts: link.matchedConcepts,
      rankingReason: `score=${eventDensityScore} + log2(${inboundCount + 1})=${finalScore.toFixed(2)} (inbound=${inboundCount})`,
    });
  }

  // Mät density för sitemapens barn på samma sätt som BFS-länkar. Barnen är
  // riktiga HTML-sidor (sitemap-index har redan expanderats), så samma formel
  // ger en rättvis jämförelse.
  for (const url of sitemapTop) {
    try {
      const metrics = await measureEventDensity(url);
      const eventDensityScore =
        metrics.dateMentions * 2 +
        metrics.timeTagCount * 3 +
        metrics.eventBlockCount +
        metrics.ticketCtaCount +
        Math.min(metrics.linkCount, 10);
      if (eventDensityScore === 0) continue; // sida utan signaler → skippa (minskar brus)
      let urlPath = '';
      try { urlPath = new URL(url).pathname; } catch { /* keep empty */ }
      // Steg 4: inlänk-räkning — sitemap-sidor har ofta 0 inlänkar på root, men log2(1)=0 så de konkurrerar rättvist
      const inboundCount = inboundCounts.get(url.split('#')[0]) ?? 0;
      const finalScore = eventDensityScore + Math.log2(inboundCount + 1);
      candidates.push({
        url,
        href: urlPath,
        sourceRegion: 'sitemap',
        eventDensityScore,
        inboundCount,
        finalScore,
        metrics,
        concepts: ['sitemap-discovery'],
        rankingReason: `sitemap: score=${eventDensityScore} + log2(${inboundCount + 1})=${finalScore.toFixed(2)} (inbound=${inboundCount})`,
      });
    } catch {
      // skippa URLs som inte går att mäta
    }
  }

  candidates.sort((a, b) => {
    // Steg 4: primär sort på eventDensityScore (befintlig semantik),
    // tiebreaker på finalScore (inlänk-viktad) om feature-flag aktiv.
    if (b.eventDensityScore !== a.eventDensityScore) {
      return b.eventDensityScore - a.eventDensityScore;
    }
    if (INBOUND_TIEBREAKER_ENABLED) {
      return b.finalScore - a.finalScore;
    }
    return 0; // Ingen tiebreaker — bevara insättningsordning
  });

  // -----------------------------------------------------------------------
  // Swedish Patterns Fallback (IMP-009) — IMMEDIATE when 0 candidates
  // Run BEFORE density threshold check so discovered candidates compete properly
  // -----------------------------------------------------------------------
  let subpageFallback: CandidatePage | undefined;
  let subpageFallbackSource: 'derived-rule' | 'swedish-patterns' | undefined;
  const pathsTested: string[] = [];
  if (candidates.length === 0) {
    console.log(`[C0] ${sourceId || rootUrl}: no candidates from link discovery — testing ${SWEDISH_EVENT_PATTERNS.length} Swedish event path patterns`);
    for (const pattern of SWEDISH_EVENT_PATTERNS) {
      pathsTested.push(pattern);
      const candidateUrl = new URL(pattern, normalizedRootUrl).href;
      try {
        const metrics = await measureEventDensity(candidateUrl);
        const densityScore =
          metrics.dateMentions * 2 +
          metrics.timeTagCount * 3 +
          metrics.eventBlockCount +
          metrics.ticketCtaCount +
          Math.min(metrics.linkCount, 10);
        if (densityScore > 0) {
          // Steg 4: inlänk-räkning som tiebreaker även i fallback
          const inboundCount = inboundCounts.get(candidateUrl.split('#')[0]) ?? 0;
          const finalScore = densityScore + Math.log2(inboundCount + 1);
          subpageFallback = {
            url: candidateUrl,
            href: pattern,
            sourceRegion: 'swedish-patterns',
            eventDensityScore: densityScore,
            inboundCount,
            finalScore,
            metrics,
            concepts: SWEDISH_EVENT_PATTERNS,
            rankingReason: `swedish-patterns fallback: ${pattern} score=${densityScore} + log2(${inboundCount + 1})=${finalScore.toFixed(2)}`,
          };
          subpageFallbackSource = 'swedish-patterns';
          console.log(`[C0] ${sourceId || rootUrl}: SWEDISH_PATTERN HIT → ${candidateUrl} (score=${densityScore}, inbound=${inboundCount}) — WINNER via built-in Swedish path`);
          break;
        }
      } catch {
        // try next path
      }
    }
    // Also test domain-base Swedish pattern as last resort (for sites like lund.se/stadsteatern
    // where the event calendar lives at lund.se/evenemang, not lund.se/stadsteatern/evenemang)
    if (!subpageFallback) {
      for (const pattern of SWEDISH_EVENT_PATTERNS) {
        const candidateUrl = `${baseUrl}${pattern}`;
        try {
          const metrics = await measureEventDensity(candidateUrl);
          const densityScore =
            metrics.dateMentions * 2 +
            metrics.timeTagCount * 3 +
            metrics.eventBlockCount +
            metrics.ticketCtaCount +
            Math.min(metrics.linkCount, 10);
          if (densityScore > 0) {
            const inboundCount = inboundCounts.get(candidateUrl.split('#')[0]) ?? 0;
            const finalScore = densityScore + Math.log2(inboundCount + 1);
            subpageFallback = {
              url: candidateUrl,
              href: pattern,
              sourceRegion: 'swedish-patterns-domain-base',
              eventDensityScore: densityScore,
              inboundCount,
              finalScore,
              metrics,
              concepts: SWEDISH_EVENT_PATTERNS,
              rankingReason: `swedish-patterns domain-base fallback: ${candidateUrl} score=${densityScore} + log2(${inboundCount + 1})=${finalScore.toFixed(2)}`,
            };
            subpageFallbackSource = 'swedish-patterns';
            console.log(`[C0] ${sourceId || rootUrl}: SWEDISH_PATTERN HIT (domain-base) → ${candidateUrl} (score=${densityScore}, inbound=${inboundCount})`);
            break;
          }
        } catch {
          // try next
        }
      }
    }
    if (!subpageFallback) {
      console.log(`[C0] ${sourceId || rootUrl}: all Swedish patterns exhausted — no event density found`);
    }
  }

  const rootMetrics = await measureEventDensity(normalizedRootUrl);
  const rootDensityScore = 
    rootMetrics.dateMentions * 2 +
    rootMetrics.timeTagCount * 3 +
    rootMetrics.eventBlockCount +
    rootMetrics.ticketCtaCount +
    Math.min(rootMetrics.linkCount, 10);
  
  const bestCandidate = candidates[0];
  let winner: CandidatePage | undefined;
  let winnerReason: string;
  let rootRejected = false;
  let rootRejectionReason: string | undefined;
  
  // If candidates found via link discovery, compare against root density
  if (bestCandidate && bestCandidate.eventDensityScore > rootDensityScore * 1.5) {
    winner = bestCandidate;
    rootRejected = true;
    rootRejectionReason = `root density=${rootDensityScore}, best candidate=${bestCandidate.eventDensityScore} (${bestCandidate.href})`;
    winnerReason = `candidate ${bestCandidate.href} has ${(bestCandidate.eventDensityScore / rootDensityScore).toFixed(1)}x higher event density than root`;
  } else if (bestCandidate) {
    winner = bestCandidate;
    winnerReason = bestCandidate.eventDensityScore >= rootDensityScore 
      ? `candidate ${bestCandidate.href} has comparable/lower density but better structural signals`
      : `root has good density (${rootDensityScore}) but candidate ${bestCandidate.href} provides additional coverage`;
  } else if (subpageFallback) {
    // Rule-based subpage succeeded where link discovery failed
    winner = subpageFallback;
    rootRejected = false;
    const sourceLabel = subpageFallbackSource === 'swedish-patterns' ? 'built-in Swedish patterns' : 'derived-rule';
    winnerReason = `${sourceLabel} fallback candidate ${subpageFallback.href} (score=${subpageFallback.eventDensityScore}) selected — link discovery found 0 candidates`;
  } else {
    winnerReason = 'no candidate found with higher density than root';
  }
  
  // Determine ruleApplied
  let ruleAppliedSource: 'none' | 'link-discovery' | 'derived-rule' | 'swedish-patterns' | 'sitemap' = 'none';
  if (bestCandidate) {
    // Om vinnaren kom från sitemap-source-regionen, rapportera det (Fas 2, 2026-10-09)
    ruleAppliedSource = bestCandidate.sourceRegion === 'sitemap' ? 'sitemap' : 'link-discovery';
  } else if (subpageFallback) {
    ruleAppliedSource = subpageFallbackSource || 'none';
  }

  return {
    rootUrl,
    totalInternalLinks: allLinks.length,
    candidatesFound: candidates.length,
    topCandidates: candidates,
    winner,
    winnerReason,
    rootRejected,
    rootRejectionReason,
    debug: {
      allLinksByRegion: linksByRegion,
      topScoringLinks: sortedLinks.slice(0, 5).map(l => ({ href: l.href, score: l.score, concepts: l.matchedConcepts })),
    },
    ruleApplied: {
      source: ruleAppliedSource,
      pathsTested,
      winnerPath: winner?.href || null,
    },
  };
}
