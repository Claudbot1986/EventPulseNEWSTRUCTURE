/**
 * C0 — HTML Frontier Discovery: Bounded link-based candidate discovery
 *
 * STEP 0 (before C1/C2) of the HTML path.
 * Discovers internal event-list candidate pages before scoring gates.
 */

import { fetchHtml } from '../../tools/fetchTools';
import { load } from 'cheerio';

export interface DiscoveredLink {
  url: string;
  href: string;
  anchorText: string;
  sourceRegion: 'nav' | 'header' | 'submenu' | 'content' | 'sidebar' | 'footer';
  score: number;
  matchedConcepts: string[];
}

export interface CandidatePage {
  url: string;
  href: string;
  sourceRegion: string;
  eventDensityScore: number;
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

function collectLinks($: any, baseUrl: string): DiscoveredLink[] {
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
    
    const urlObj = new URL(fullUrl);
    if (urlObj.origin !== new URL(baseUrl).origin) return;
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

export async function discoverEventCandidates(rootUrl: string): Promise<FrontierDiscoveryResult> {
  const baseUrl = getBaseUrl(rootUrl);
  
  const rootFetch = await fetchHtml(rootUrl, { timeout: 15000 });
  
  if (!rootFetch.success || !rootFetch.html) {
    return {
      rootUrl,
      totalInternalLinks: 0,
      candidatesFound: 0,
      topCandidates: [],
      winner: undefined,
      winnerReason: 'root fetch failed',
      rootRejected: false,
      debug: { allLinksByRegion: {}, topScoringLinks: [] },
    };
  }
  
  const $ = load(rootFetch.html);
  const allLinks = collectLinks($, baseUrl);
  
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
  
  const candidates: CandidatePage[] = [];
  
  for (const link of topLinks) {
    const metrics = await measureEventDensity(link.url);
    
    const eventDensityScore = 
      metrics.dateMentions * 2 +
      metrics.timeTagCount * 3 +
      metrics.eventBlockCount +
      metrics.ticketCtaCount +
      Math.min(metrics.linkCount, 10);
    
    candidates.push({
      url: link.url,
      href: link.href,
      sourceRegion: link.sourceRegion,
      eventDensityScore,
      metrics,
      concepts: link.matchedConcepts,
      rankingReason: `score=${eventDensityScore} from dates:${metrics.dateMentions} timeTags:${metrics.timeTagCount} blocks:${metrics.eventBlockCount} cta:${metrics.ticketCtaCount}`,
    });
  }
  
  candidates.sort((a, b) => b.eventDensityScore - a.eventDensityScore);
  
  const rootMetrics = await measureEventDensity(rootUrl);
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
  } else {
    winnerReason = 'no candidate found with higher density than root';
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
  };
}
