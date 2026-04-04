/**
 * C1 — Pre-HTML Gate: Lightweight HTML screening
 *
 * STEP 1 of the HTML path in source triage.
 * Performs a quick, cheap fetch + DOM inspection pass on a URL.
 * Does NOT make a routing decision — that is C2's responsibility.
 *
 * What it does:
 * - Fetches HTML via fetchHtml (same tool used by C2)
 * - Counts basic structural markers: <time>, <article>, <main>, lists, headings
 * - Detects ISO and Swedish date patterns in scoped text
 * - Detects venue/price class markers
 * - Classifies fetchability and page structure
 * - Returns a flat diagnostic object with no weighted scoring
 *
 * What it does NOT do:
 * - No weighted scoring
 * - No threshold comparison
 * - No verdict / routing decision
 * - No candidate extraction
 * - No penalties
 * - No extraction or normalization
 *
 * Use this as a quick first pass before committing to C2,
 * or for screening a batch of URLs without running the full gate.
 *
 * Usage:
 *   import { screenUrl } from './C1-preHtmlGate';
 *   const info = await screenUrl(url);
 *   // info.verdict: 'fetchable' | 'unfetchable' | 'no-main'
 *   // info.categorization: 'strong' | 'medium' | 'weak' | 'noise'
 *   // info.reason: string
 */
import { fetchHtml } from '../../tools/fetchTools';
import { load } from 'cheerio';

export type PreGateCategorization = 'strong' | 'medium' | 'weak' | 'noise' | 'unfetchable' | 'no-main';

/**
 * Result from the pre-HTML gate screening pass.
 * Flat diagnostic — no routing decision, no weighted scoring.
 */
export interface PreGateResult {
  /** Source URL */
  url: string;
  /** Whether the fetch succeeded */
  fetchable: boolean;
  /** HTTP error or fetch error message */
  fetchError?: string;
  /** HTML byte size if fetched */
  htmlBytes?: number;
  /** Whether <main> was found in the document */
  hasMain: boolean;
  /** Whether <article> was found */
  hasArticle: boolean;
  /** Number of <time datetime> elements */
  timeTagCount: number;
  /** Number of ISO date patterns (YYYY-MM-DD) in scoped text */
  isoDateCount: number;
  /** Number of Swedish date patterns in scoped text */
  sweDateCount: number;
  /** Total dates (capped at 20 for sanity) */
  dateCount: number;
  /** Number of <h1>/<h2> inside main/article */
  headingCount: number;
  /** Number of <ul>/<ol> in main/article */
  listContainerCount: number;
  /** Number of <li> in main/article */
  listItemCount: number;
  /** Number of <a href> in main/article */
  linkCount: number;
  /** Venue class count */
  venueMarkerCount: number;
  /** Price class count */
  priceMarkerCount: number;
  /** Whether page appears to be JS-rendered (no main, low text density) */
  likelyJsRendered: boolean;
  /** Quick categorization for triage decision support */
  categorization: PreGateCategorization;
  /** Human-readable summary of what was found */
  reason: string;
}

/**
 * Quick screening pass — no scoring, no thresholds, no routing decision.
 */
export async function screenUrl(url: string): Promise<PreGateResult> {
  const r = await fetchHtml(url, { timeout: 15000 });

  if (!r.success || !r.html) {
    return {
      url,
      fetchable: false,
      fetchError: r.error ?? 'unknown',
      categorization: 'unfetchable',
      reason: `fetch-fail: ${r.error ?? 'unknown'}`,
      hasMain: false, hasArticle: false,
      timeTagCount: 0, isoDateCount: 0, sweDateCount: 0, dateCount: 0,
      headingCount: 0, listContainerCount: 0, listItemCount: 0, linkCount: 0,
      venueMarkerCount: 0, priceMarkerCount: 0, likelyJsRendered: false,
    };
  }

  const $ = load(r.html);
  const htmlBytes = Buffer.byteLength(r.html, 'utf8');

  const hasMain = $('main').length > 0;
  const hasArticle = $('article').length > 0;
  const timeTagCount = $('time[datetime]').length;

  // Scope text for date scanning: main and article only
  const scopeText = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list').text() || '';
  const isoDateRegex = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?/g;
  const swedishDateRegex = /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\s+\d{4}|\d{1,2}\/\d{1,2}\s+\d{4}/gi;
  const isoDateCount = Math.min(20, (scopeText.match(isoDateRegex) || []).length);
  const sweDateCount = Math.min(20, (scopeText.match(swedishDateRegex) || []).length);
  const dateCount = Math.min(20, isoDateCount + sweDateCount);

  const headingCount = $('main h1, main h2, article h1, article h2, [role="main"] h1, [role="main"] h2').length;
  const listContainerCount = $('main ul, main ol, article ul, article ol, [role="main"] ul, [role="main"] ol').length;
  const listItemCount = $('main li, article li, [role="main"] li').length;
  const linkCount = $('main a[href], article a[href], [role="main"] a[href]').length;

  const venueMarkerCount = $('[class*="venue"],[class*="location"],[class*="plats"],[class*="adress"]').length;
  const priceMarkerCount = $('[class*="price"],[class*="biljett"],[class*="pris"]').length;

  // JS-rendered heuristic: no main, very few links, mostly nav
  const likelyJsRendered = !hasMain && linkCount < 5;

  // Categorization based on raw counts
  let categorization: PreGateCategorization;
  let reason: string;

  if (!hasMain && !hasArticle) {
    categorization = 'no-main';
    reason = 'no <main> or <article>';
  } else if (timeTagCount >= 3 && dateCount >= 3) {
    categorization = 'strong';
    reason = `${timeTagCount} time-tags + ${dateCount} dates`;
  } else if (timeTagCount >= 1 && (dateCount >= 3 || headingCount >= 3 || venueMarkerCount >= 2)) {
    categorization = 'medium';
    reason = `${timeTagCount}tt ${dateCount}d ${headingCount}h ${venueMarkerCount}v`;
  } else if (dateCount >= 1 || headingCount >= 2 || listItemCount >= 3) {
    categorization = 'weak';
    reason = `tt=${timeTagCount} d=${dateCount} h=${headingCount} li=${listItemCount}`;
  } else {
    categorization = 'noise';
    reason = `low-signal page (tt=${timeTagCount} d=${dateCount} h=${headingCount})`;
  }

  return {
    url,
    fetchable: true,
    htmlBytes,
    hasMain,
    hasArticle,
    timeTagCount,
    isoDateCount,
    sweDateCount,
    dateCount,
    headingCount,
    listContainerCount,
    listItemCount,
    linkCount,
    venueMarkerCount,
    priceMarkerCount,
    likelyJsRendered,
    categorization,
    reason,
  };
}
