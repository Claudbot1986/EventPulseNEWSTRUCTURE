/**
 * C2 — HTML Gate: Weighted scoring gate with candidate quality assessment
 *
 * STEP 2 of the HTML path in the source triage pipeline.
 * Makes the actual routing decision: promising / maybe / unclear / low_value.
 *
 * Responsibilities:
 * - Fetch HTML via fetchHtml (timeout 20s)
 * - Compute weighted page-level score across 6 marker categories
 * - Apply negative signal penalties (newsArticle -3, navDate -2)
 * - Extract event-card and event-list-container candidates from DOM
 * - Rate each candidate list on quality (strong/medium/weak/noisy)
 * - Apply candidate quality adjustments: noisy=-2, strong-list-lift=+2 on borderline
 * - Compare adjusted score against diagnosis-aware thresholds
 * - Return HtmlGateResult with verdict, score, reason, marker/candidate details
 *
 * Does NOT do:
 * - Detail page probing (C3 or future step)
 * - Event extraction or field normalization
 * - Browser/render automation
 * - Batch processing (use C1 for that)
 *
 * MODEL STATUS: prelim_1src
 *
 * v2.2 CHANGES (precision calibration against ground truth batch, 2026-03-29):
 * - eventTitle weight: ×2 → ×1, capped at 4 items
 * - venueMarker: ×2 → ×1, priceMarker: ×3 → ×1
 * - breadth_nojsonld threshold: 2 → 12
 * - breadth_wrongtype: 3 → 10
 * - smoke_nojsonld: 4 → 12, smoke_wrongtype: 5 → 14
 *
 * Pipeline position: After JSON-LD and Network Gate, before Render/Manual Review.
 * Path order: JSON-LD → Network → [C1 screening] → C2 gate → Render → Blocked/Review
 *
 * Usage (internal to sourceTriage or C1→C2 pipeline):
 *   import { evaluateHtmlGate } from './C2-htmlGate';
 *   const result = await evaluateHtmlGate(url, diagnosis, phaseMode);
 *   // result.verdict: 'promising' | 'maybe' | 'unclear' | 'low_value'
 *   // result.score: weighted page-level score
 *   // result.candidateQuality: quality assessment of candidate lists
 */

import { fetchHtml } from '../../tools/fetchTools';
import { load, type CheerioAPI } from 'cheerio';

export type HtmlVerdict = 'promising' | 'maybe' | 'unclear' | 'low_value';

/**
 * Verdict is based on weighted page-level score, modulated by candidate list quality.
 *
 * Page-level scoring (v2.1):
 *   timeTags          × 5
 *   datePatterns     × 1  (floor: >=3 matches in scoped text)
 *   eventTitles      × 2  (nav/footer filtered)
 *   venueMarkers     × 2
 *   priceMarkers     × 3
 *   eventListStructure × 1 (gated: >=3 lists in event-scope)
 *
 * Negative penalties:
 *   newsArticle  -3
 *   navDate      -2
 *   noisy candidate list  -2
 *
 * Thresholds by phase and diagnosis:
 *   sanity:  score >= 1
 *   breadth (no-jsonld): score >= 2
 *   breadth (wrong-type): score >= 3
 *   smoke (no-jsonld):    score >= 4
 *   smoke (wrong-type):   score >= 5
 *
 * Candidate quality adjustments:
 *   strong list + borderline score (within 2 of threshold): +2 lift
 *   noisy list: -2 penalty
 *   medium/weak lists: no adjustment
 */
export interface HtmlGateResult {
  verdict: HtmlVerdict;
  reason: string;
  modelStatus: 'prelim_1src';
  htmlBytes?: number;
  /** Raw HTML string fetched from targetUrl — use this for extractFromHtml to avoid double-fetch */
  html?: string;
  phaseMode: 1 | 2 | 3;
  /** Weighted page-level score (after penalties, before candidate adjustment) */
  score: number;
  /** Raw marker counts for transparency */
  markersFound: number;
  markerCategories: {
    timeTags: number;
    datePatterns: number;
    eventTitles: number;
    venueMarkers: number;
    priceMarkers: number;
    eventListStructure: number;
  };
  negativeSignals: {
    newsArticlePattern: boolean;
    navDatePattern: boolean;
  };
  /** Quality assessment of the two candidate list types */
  candidateQuality: {
    eventCardList: CandidateListQuality;
    eventListContainer: CandidateListQuality;
  };
}

// ─── Types for candidate quality ──────────────────────────────────────────────

type CandidateQualityRating = 'strong' | 'medium' | 'weak' | 'noisy';

interface CandidateItem {
  tagName: string;
  classAttr: string;
  hasTitle: boolean;
  hasLink: boolean;
  hasDatetime: boolean;
}

export interface CandidateListQuality {
  rating: CandidateQualityRating;
  itemCount: number;
  titleCount: number;
  linkCount: number;
  datetimeCount: number;
  consistencyScore: number;
  signal: string;
}

// ─── Signal weights ──────────────────────────────────────────────────────────

const WEIGHT = {
  timeTag: 5,
  datePattern: 1,
  eventTitle: 1,    // v2.2: lowered from ×2, capped at 4 — headings are noisy without time/date signals
  venueMarker: 1,    // v2.2: lowered from ×2 — venue name in page title != event location data
  priceMarker: 1,    // v2.2: lowered from ×3 — "Köp biljett" is common UI, not event proof
  eventListStructure: 1,
} as const;

const NEG_PENALTY = {
  newsArticle: -3,
  navDate: -2,
} as const;

const CANDIDATE_PENALTY = {
  noisy: -2,
} as const;

// ─── Page-level marker counting ───────────────────────────────────────────────

function countTimeTags($: CheerioAPI): number {
  return $('time[datetime]').length;
}

function countDatePatterns($: CheerioAPI): number {
  const isoDateRegex = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?/g;
  const swedishDateRegex = /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\s+\d{4}|\d{1,2}\/\d{1,2}\s+\d{4}/gi;
  const scopeText = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list').text();
  if (!scopeText) return 0;
  const isoMatches = (scopeText.match(isoDateRegex) || []).length;
  const sweMatches = (scopeText.match(swedishDateRegex) || []).length;
  const total = isoMatches + sweMatches;
  return total >= 3 ? total : 0;
}

function countEventTitles($: CheerioAPI): number {
  let count = 0;
  const headingsNearTime = $('time[datetime]').parents('article, .event, .calender-item, .kalender-item, [class*="event"], [class*="kalender"], li').find('h1, h2, h3').length;
  count += headingsNearTime;
  const mainHeadings = $('main h1, main h2, article h1, article h2, [role="main"] h1, [role="main"] h2')
    .not('nav *, footer *, .nav *, .sidebar *')
    .filter((_: any, el: any) => $(el).closest('nav, footer, .nav, .sidebar').length === 0);
  count += mainHeadings.length;
  return count;
}

function countVenueMarkers($: CheerioAPI): number {
  const selectors = ['[class*="venue"]', '[class*="location"]', '[class*="plats"]', '[class*="adress"]', '[class*="arena"]', '[class*="scene"]', 'address'];
  let total = 0;
  for (const sel of selectors) total += $(sel).length;
  return total;
}

function countPriceMarkers($: CheerioAPI): number {
  const selectors = ['[class*="price"]', '[class*="biljett"]', '[class*="kostnad"]', '[class*="pris"]', '[class*="entry-price"]', '[class*="ticket"]'];
  let total = 0;
  for (const sel of selectors) total += $(sel).length;
  return total;
}

function countEventListStructure($: CheerioAPI): number {
  const eventScope = $('main, article, [role="main"], .kalender, .event-list, .event, [class*="event"]');
  if (eventScope.length === 0) return 0;
  let listCount = 0;
  eventScope.find('ul, ol').each((_: any, el: any) => {
    if ($(el).children('li').length >= 3) listCount++;
  });
  return listCount >= 3 ? listCount : 0;
}

// ─── Swedish date text helper ─────────────────────────────────────────────────

const SWE_DATE_REGEX = /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\b|\d{4}-\d{2}-\d{2}|(?:Idag|Imorgon|Måndag|Tisdag|Onsdag|Torsdag|Fredag|Lördag|Söndag)\s+\d|\b\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/gi;

function hasSwedishDateText($el: any): boolean {
  return SWE_DATE_REGEX.test($el.text());
}

// ─── Candidate list extraction ────────────────────────────────────────────────

function extractEventCardCandidates($: CheerioAPI): CandidateItem[] {
  const eventScope = $('main, article, [role="main"], .kalender, .event-list, .event, [class*="event"], .content');
  const candidates: CandidateItem[] = [];

  eventScope.find('li').each((_: any, el: any) => {
    const $el = $(el);
    if ($el.find('time[datetime]').length === 0) return;
    candidates.push(assessItemQuality($, $el));
  });

  eventScope.find('article').each((_: any, el: any) => {
    const $el = $(el);
    if ($el.find('time[datetime]').length === 0) return;
    candidates.push(assessItemQuality($, $el));
  });

  // Fallback: if no candidates found, try link + Swedish date text (no <time datetime> required)
  if (candidates.length === 0) {
    eventScope.find('li, article').each((_: any, el: any) => {
      const $el = $(el);
      const hasLink = $el.find('a[href]').filter((_: any, a: any) => ($(a).attr('href') ?? '').trim().length > 0).length > 0;
      if (hasLink && hasSwedishDateText($el)) {
        candidates.push(assessItemQuality($, $el));
      }
    });
  }

  return candidates;
}

function extractEventListContainerCandidates($: CheerioAPI): CandidateItem[] {
  const eventScope = $('main, article, [role="main"], .kalender, .event-list, .event, [class*="event"], .content');
  const candidates: CandidateItem[] = [];

  eventScope.find('ul, ol').each((_: any, el: any) => {
    const $el = $(el);
    const children = $el.children('li');
    if (children.length < 3) return;
    const hasTimeChild = children.filter((_: any, li: any) => $(li).find('time[datetime]').length > 0).length > 0;
    if (!hasTimeChild) return;

    const items: CandidateItem[] = [];
    children.each((__: any, li: any) => { items.push(assessItemQuality($, $(li))); });

    const tagNames = items.map(i => i.tagName);
    const mostCommonTag = mode(tagNames);
    const tagConsistency = tagNames.filter(t => t === mostCommonTag).length / tagNames.length;

    const classPatterns = items.map(i => i.classAttr.split(' ')[0]);
    const mostCommonClass = mode(classPatterns);
    const classConsistency = classPatterns.filter(c => c === mostCommonClass).length / classPatterns.length;

    const consistencyScore = (tagConsistency + classConsistency) / 2;

    candidates.push({
      tagName: mostCommonTag,
      classAttr: mostCommonClass,
      hasTitle: items.filter(i => i.hasTitle).length / items.length > 0.5,
      hasLink: items.filter(i => i.hasLink).length / items.length > 0.5,
      hasDatetime: items.filter(i => i.hasDatetime).length / items.length > 0.5,
    });
  });

  return candidates;
}

function assessItemQuality($: CheerioAPI, $el: any): CandidateItem {
  const tagName = $el[0]?.name || '';
  const classAttr = ($el.attr('class') || '').toLowerCase().trim();
  const hasTitle = $el.find('h1, h2, h3, h4, b, strong').filter((_: any, el: any) => $(el).text().trim().length > 0).length > 0;
  const hasLink = $el.find('a[href]').filter((_: any, el: any) => ($(el).attr('href') ?? '').trim().length > 0).length > 0;
  const hasDatetime = $el.find('time[datetime]').length > 0;
  return { tagName, classAttr, hasTitle, hasLink, hasDatetime };
}

// ─── Candidate quality rating ────────────────────────────────────────────────

function rateCandidateList(items: CandidateItem[]): CandidateListQuality {
  if (items.length === 0) {
    return { rating: 'weak', itemCount: 0, titleCount: 0, linkCount: 0, datetimeCount: 0, consistencyScore: 0, signal: 'none' };
  }

  const titleCount = items.filter(i => i.hasTitle).length;
  const linkCount = items.filter(i => i.hasLink).length;
  const datetimeCount = items.filter(i => i.hasDatetime).length;

  const patterns = items.map(i => `${i.tagName}__${i.classAttr.split(' ')[0]}`);
  const mostCommon = mode(patterns);
  const consistencyScore = patterns.filter(p => p === mostCommon).length / patterns.length;

  const noisyItems = items.filter(i =>
    i.tagName === 'li' && i.hasLink && i.hasDatetime && !i.hasTitle &&
    (i.classAttr.length < 3 || i.classAttr.includes('menu') || i.classAttr.includes('nav'))
  );

  if (noisyItems.length > 0) {
    return { rating: 'noisy', itemCount: items.length, titleCount, linkCount, datetimeCount, consistencyScore, signal: `noisy(${noisyItems.length}/${items.length})` };
  }

  const strongCount = items.filter(i => i.hasTitle && i.hasLink && i.hasDatetime).length;
  if (items.length >= 3 && strongCount / items.length >= 0.6 && consistencyScore >= 0.6) {
    return { rating: 'strong', itemCount: items.length, titleCount, linkCount, datetimeCount, consistencyScore, signal: `strong(${strongCount}/${items.length})` };
  }

  const mediumCount = items.filter(i => [i.hasTitle, i.hasLink, i.hasDatetime].filter(Boolean).length >= 2).length;
  if (items.length >= 2 && mediumCount / items.length >= 0.5) {
    return { rating: 'medium', itemCount: items.length, titleCount, linkCount, datetimeCount, consistencyScore, signal: `medium(${mediumCount}/${items.length})` };
  }

  return { rating: 'weak', itemCount: items.length, titleCount, linkCount, datetimeCount, consistencyScore, signal: `weak(${titleCount}t ${linkCount}l ${datetimeCount}d)` };
}

// ─── Score adjustment ────────────────────────────────────────────────────────

function applyCandidateAdjustment(
  score: number,
  threshold: number,
  cardQuality: CandidateListQuality,
  listQuality: CandidateListQuality
): { adjustedScore: number; adjustmentNote: string } {
  let adjustmentNote = '';

  if (cardQuality.rating === 'noisy' || listQuality.rating === 'noisy') {
    score += CANDIDATE_PENALTY.noisy;
    adjustmentNote += ' noisy';
  }

  const isBorderline = score >= threshold - 2 && score < threshold;
  if (isBorderline && (cardQuality.rating === 'strong' || listQuality.rating === 'strong')) {
    score += 2;
    adjustmentNote += ' strong-list-lift';
  }

  return { adjustedScore: Math.max(0, score), adjustmentNote };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function mode(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] ?? 0) + 1;
  let best = arr[0] ?? '';
  for (const v of arr) if (freq[v] > freq[best]) best = v;
  return best;
}

// ─── Page-level negative signals ─────────────────────────────────────────────

function detectNegativeSignals($: CheerioAPI): HtmlGateResult['negativeSignals'] {
  const mainArticle = $('main article, [role="main"] article, article');
  const hasTimeInArticle = mainArticle.find('time[datetime]').length > 0;
  const hasVenueInArticle = mainArticle.find('[class*="venue"], [class*="location"], [class*="plats"]').length > 0;
  const hasPriceInArticle = mainArticle.find('[class*="price"], [class*="biljett"], [class*="pris"]').length > 0;
  const newsArticlePattern = hasTimeInArticle && !hasVenueInArticle && !hasPriceInArticle;
  const navDates = $('nav time[datetime], .breadcrumbs time[datetime], [class*="breadcrumb"] time[datetime]').length;
  const navDatePattern = navDates > 0;
  return { newsArticlePattern, navDatePattern };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface MarkerCounts {
  timeTags: number;
  datePatterns: number;
  eventTitles: number;
  venueMarkers: number;
  priceMarkers: number;
  eventListStructure: number;
}

function computeWeightedScore(markers: MarkerCounts): number {
  // Cap eventTitles at 4 items — a page with 20 headings should not dominate
  // purely on heading count; titles are noisy without time/date signals nearby
  const eventTitlesCapped = Math.min(markers.eventTitles, 4);
  return Math.max(0,
    markers.timeTags * WEIGHT.timeTag +
    markers.datePatterns * WEIGHT.datePattern +
    eventTitlesCapped * WEIGHT.eventTitle +
    markers.venueMarkers * WEIGHT.venueMarker +
    markers.priceMarkers * WEIGHT.priceMarker +
    markers.eventListStructure * WEIGHT.eventListStructure
  );
}

// ─── Main gate ───────────────────────────────────────────────────────────────

export async function evaluateHtmlGate(
  url: string,
  diagnosis: string,
  phaseMode: 1 | 2 | 3 = 2
): Promise<HtmlGateResult> {
  const htmlResult = await fetchHtml(url, { timeout: 20000 });

  if (!htmlResult.success || !htmlResult.html) {
    return {
      verdict: 'unclear',
      reason: `fetchHtml failed: ${htmlResult.error ?? 'unknown'}`,
      modelStatus: 'prelim_1src',
      phaseMode,
      score: 0,
      markersFound: 0,
      markerCategories: { timeTags: 0, datePatterns: 0, eventTitles: 0, venueMarkers: 0, priceMarkers: 0, eventListStructure: 0 },
      negativeSignals: { newsArticlePattern: false, navDatePattern: false },
      candidateQuality: {
        eventCardList: { rating: 'weak', itemCount: 0, titleCount: 0, linkCount: 0, datetimeCount: 0, consistencyScore: 0, signal: 'none' },
        eventListContainer: { rating: 'weak', itemCount: 0, titleCount: 0, linkCount: 0, datetimeCount: 0, consistencyScore: 0, signal: 'none' },
      },
    };
  }

  const htmlBytes = Buffer.byteLength(htmlResult.html, 'utf8');
  const $ = load(htmlResult.html);

  const markers: MarkerCounts = {
    timeTags: countTimeTags($),
    datePatterns: countDatePatterns($),
    eventTitles: countEventTitles($),
    venueMarkers: countVenueMarkers($),
    priceMarkers: countPriceMarkers($),
    eventListStructure: countEventListStructure($),
  };

  const negativeSignals = detectNegativeSignals($);
  let score = computeWeightedScore(markers);

  if (negativeSignals.newsArticlePattern) score += NEG_PENALTY.newsArticle;
  if (negativeSignals.navDatePattern) score += NEG_PENALTY.navDate;

  // [OPTIMIZATION D] URL-segment bonus — positive scoring for event-rich URL paths
  // If the URL path contains known event-page segments, give a small score boost
  // Classification: General — these segments consistently indicate event listing pages
  const URL_SEGMENT_BONUS = 3;
  const eventUrlSegments = ['aterkommande-event', 'forestallningar', 'spelprogram', 'aktiviteter'];
  const urlPath = url.toLowerCase();
  for (const seg of eventUrlSegments) {
    if (urlPath.includes(seg)) {
      score += URL_SEGMENT_BONUS;
      break; // Apply bonus once only
    }
  }

  score = Math.max(0, score);

  // Candidate quality assessment
  const cardQuality = rateCandidateList(extractEventCardCandidates($));
  const listQuality = rateCandidateList(extractEventListContainerCandidates($));

  type ThresholdKey = 'sanity' | 'breadth_nojsonld' | 'breadth_wrongtype' | 'smoke_nojsonld' | 'smoke_wrongtype';
  const thresholds: Record<ThresholdKey, number> = {
    sanity:            1,
    breadth_nojsonld:  6,   // v3: lowered from 12 — many "unclear" sources yield events via C3; reduce from 12 to 6
    breadth_wrongtype: 6,   // v3: lowered from 10 — allow more through to C3 extraction attempt
    smoke_nojsonld:    6,   // v3: lowered from 12 — C3 can extract from low-density pages
    smoke_wrongtype:   8,   // v3: lowered from 14 — C3 handles smoke cases better than C2 density scoring
  };
  const thresholdKey: ThresholdKey = phaseMode === 1
    ? 'sanity'
    : phaseMode === 2
      ? (diagnosis === 'no-jsonld' ? 'breadth_nojsonld' : 'breadth_wrongtype')
      : (diagnosis === 'no-jsonld' ? 'smoke_nojsonld' : 'smoke_wrongtype');

  const { adjustedScore, adjustmentNote } = applyCandidateAdjustment(score, thresholds[thresholdKey], cardQuality, listQuality);
  score = adjustedScore;

  const dominantCategory = Object.entries({
    timeTags:           markers.timeTags * WEIGHT.timeTag,
    datePatterns:       markers.datePatterns * WEIGHT.datePattern,
    eventTitles:        markers.eventTitles * WEIGHT.eventTitle,
    venueMarkers:       markers.venueMarkers * WEIGHT.venueMarker,
    priceMarkers:       markers.priceMarkers * WEIGHT.priceMarker,
    eventListStructure: markers.eventListStructure * WEIGHT.eventListStructure,
  }).sort((a, b) => b[1] - a[1])[0][0];

  const dominantLabel: Record<string, string> = {
    timeTags:          'time-tag',
    datePatterns:      'date-pattern',
    eventTitles:       'event-heading',
    venueMarkers:      'venue-marker',
    priceMarkers:      'price-marker',
    eventListStructure: 'event-list',
  };

  let verdict: HtmlVerdict;
  if (score >= thresholds[thresholdKey]) {
    const strongSignals = markers.timeTags + (markers.priceMarkers > 0 ? 1 : 0);
    const mediumCategories = [markers.datePatterns, markers.eventTitles, markers.venueMarkers].filter(v => v > 0).length;
    verdict = (strongSignals >= 1 || mediumCategories >= 2) ? 'promising' : 'maybe';
  } else if (score >= thresholds[thresholdKey] - 1) {
    verdict = 'maybe';
  } else {
    verdict = score > 0 ? 'unclear' : 'low_value';
  }

  const negParts: string[] = [];
  if (negativeSignals.newsArticlePattern) negParts.push('news-article');
  if (negativeSignals.navDatePattern) negParts.push('nav-date');

  const candidateNoteParts: string[] = [];
  if (cardQuality.rating !== 'weak' || listQuality.rating !== 'weak') {
    candidateNoteParts.push(`cards=${cardQuality.signal}`);
    candidateNoteParts.push(`lists=${listQuality.signal}`);
  }
  if (adjustmentNote) candidateNoteParts.push(`adj${adjustmentNote}`);

  const reasonParts: string[] = [`[${thresholdKey}] score=${score}(adj) >= ${thresholds[thresholdKey]}? ${verdict}`];
  if (dominantLabel[dominantCategory]) reasonParts.push(`pg=${dominantLabel[dominantCategory]}`);
  if (negParts.length > 0) reasonParts.push(`neg=${negParts.join('+')}`);
  if (candidateNoteParts.length > 0) reasonParts.push(`cand=${candidateNoteParts.join(',')}`);

  return {
    verdict,
    reason: reasonParts.join(' '),
    modelStatus: 'prelim_1src',
    htmlBytes,
    html: htmlResult.html,
    phaseMode,
    score,
    markersFound: markers.timeTags + markers.datePatterns + markers.eventTitles + markers.venueMarkers + markers.priceMarkers + markers.eventListStructure,
    markerCategories: markers,
    negativeSignals,
    candidateQuality: { eventCardList: cardQuality, eventListContainer: listQuality },
  };
}
