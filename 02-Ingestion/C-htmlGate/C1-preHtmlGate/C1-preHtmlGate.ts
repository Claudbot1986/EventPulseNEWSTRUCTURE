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
import type { DerivedRulesStore } from '../c4-derived-rules';
import { getRuleForSourceCategory, getGenericSubpagePaths } from '../c4-derived-rules';
import { FailCategory } from '../C4-ai-analysis';

/**
 * Möjliga utfall från C1-preHtmlGate triage
 */
export type TriageResult =
  | 'html_candidate'      // Sida ser ut som HTML-event källa, kan extraheras
  | 'render_candidate'    // Sida är sannolikt JS-renderad, behöver D-renderGate
  | 'manual_review'       // Kan inte avgöra automatiskt, behöver mänsklig granskning
  | 'still_unknown';     // Inte tillräckligt med data för att avgöra

export type PreGateCategorization = 'strong' | 'medium' | 'weak' | 'noise' | 'unfetchable' | 'no-main';

/**
 * Result from the pre-HTML gate screening pass.
 * Flat diagnostic — no routing decision, no weighted scoring.
 */
/**
 * Early routing decision — only set for very strong signals.
 * null = no strong signal detected, use normal C1 flow.
 */
export type EarlyRouteDecision = 'A' | 'B' | 'D' | null;

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
  /** Raw HTML string fetched from targetUrl — use this for extractFromHtml to avoid double-fetch */
  html?: string;
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
  /** Early routing decision — only set for very strong generic signals */
  earlyRoute: EarlyRouteDecision;
}

/**
 * Konvertera PreGateResult till TriageResult för scheduler-användning
 *
 * C1:s categorization är internt, TriageResult är scheduler-gränssnittet.
 */
export function determineTriageOutcome(preGateResult: PreGateResult): TriageResult {
  // Kan inte hämta sidan alls
  if (!preGateResult.fetchable) {
    return 'still_unknown';
  }

  // JS-renderad heuristik
  if (preGateResult.likelyJsRendered) {
    return 'render_candidate';
  }

  // If C0 found candidates via Swedish patterns AND C2 shows density, allow through
  // Even if C1 categorization is "weak", C2/C3 can still extract events
  if (preGateResult.categorization === 'strong' || preGateResult.categorization === 'medium') {
    return 'html_candidate';
  }

  // Pass through weak sources to C2/C3 — even weak pages can yield events via extraction
  // C1 "weak" means uncertain but not clearly negative; let C2/C3 make the final call
  if (preGateResult.categorization === 'weak') {
    return 'html_candidate'; // let C2/C3 decide — weak signals still yield events
  }

  // Block only genuinely noisy/unfetchable — these have no event potential
  if (preGateResult.categorization === 'noise' || preGateResult.categorization === 'no-main') {
    return 'manual_review';
  }

  return 'still_unknown';
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
      earlyRoute: null,
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

  // JS-rendered detection: AppRegistry x2+ (SiteVision), Next.js, React hydration
  // Original heuristic (!hasMain && linkCount < 5) removed — causes false positives on list-heavy pages like konserthuset
  const html = r.html;
  const hasAppRegistry = (html.match(/AppRegistry\.registerInitialState/g) || []).length >= 2;
  const hasNextJs = html.includes('__NEXT_DATA__') || html.includes('id="__NEXT_DATA__"');
  const hasReactHydration = html.includes('data-reactroot') || html.includes('data-react-hydration');

  const likelyJsRendered = hasAppRegistry || hasNextJs || hasReactHydration;

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
    reason: `low-signal page (tt=${timeTagCount} d=${dateCount} h=${headingCount})`;
  }

  // ─────────────────────────────────────────────────────────────
  // EARLY ROUTING — only strong generic signals, very conservative
  // ─────────────────────────────────────────────────────────────
  let earlyRoute: EarlyRouteDecision = null;

  // SIGNAL A/B: Clear structured-data endpoint (JSON/RSS/ICS/API)
  // Strong signals: URL file extension OR content-type link tag
  const urlLower = url.toLowerCase();
  const hasJsonExt  = urlLower.endsWith('.json');
  const hasRssExt   = urlLower.endsWith('.rss') || urlLower.endsWith('.xml') || urlLower.endsWith('.atom');
  const hasIcsExt   = urlLower.endsWith('.ics');
  const hasApiPath  = /\/api\//.test(url) || /\/json\//.test(url) || /\/feed\//.test(url);
  const hasAlternateJson = $('link[type="application/json"], link[type="application/feed+json"], link[type="application/atom+xml"]').length > 0;

  if (hasJsonExt || hasRssExt || hasIcsExt || hasApiPath || hasAlternateJson) {
    earlyRoute = 'A'; // Structured-data path (JSON/RSS extraction)
  }

  // SIGNAL D: Clear JS shell with no event content
  // Requires: likelyJsRendered + very few links + decent page size (not empty/cached)
  const jsShellSignal = !hasMain && linkCount < 5 && likelyJsRendered && htmlBytes > 50000;
  if (jsShellSignal) {
    earlyRoute = 'D'; // JS-render gate needed
  }

  return {
    url,
    fetchable: true,
    htmlBytes,
    html: r.html,
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
    earlyRoute,
  };
}

/**
 * C1 med stöd för derived rules (C4 feedback loop).
 *
 * Om en source har en NEEDS_SUBPAGE_DISCOVERY rule med suggestedPaths:
 * - Testar source URL först (vanligt screenUrl)
 * - Vid fail: testar varje suggestedPath som candidate URL
 * - Returnerar bästa resultatet bland alla candidates
 *
 * Regel最后一次:
 * - sourceId behövs för att slå upp rule
 * - derivedRules behövs för att hämta regler
 * - Base URL behövs för att bygga candidate URLs
 */
export async function screenUrlWithDerivedRules(
  sourceId: string,
  baseUrl: string,
  derivedRules?: DerivedRulesStore
): Promise<PreGateResult & { testedSubpages?: string[]; bestSubpageUrl?: string }> {
  // Steg 1: Testa source URL
  const initialResult = await screenUrl(baseUrl);

  // Steg 2: Om redan stark candidate, returnera direkt
  if (initialResult.categorization === 'strong' || initialResult.categorization === 'medium') {
    return { ...initialResult, testedSubpages: [], bestSubpageUrl: undefined };
  }

  // Steg 3: Kolla om det finns en NEEDS_SUBPAGE_DISCOVERY rule
  // SOURCE-SPECIFIC RULE HAR HÖGST PRIORITET (från c4-derived-rules.jsonl)
  let rule = derivedRules
    ? getRuleForSourceCategory(derivedRules, sourceId, FailCategory.NEEDS_SUBPAGE_DISCOVERY)
    : null;

  // Steg 3b: GENERIC FALLBACK från improvements-bank.jsonl (via IMP-006)
  // Endast om ingen source-specifik rule finns
  const subpagePaths = rule?.suggestedPaths?.length
    ? rule.suggestedPaths
    : getGenericSubpagePaths(FailCategory.NEEDS_SUBPAGE_DISCOVERY);

  if (subpagePaths.length === 0) {
    return { ...initialResult, testedSubpages: [], bestSubpageUrl: undefined };
  }

  // Steg 4: Bygg candidate URLs och testa dem
  const testedSubpages: string[] = [];
  const baseOrigin = new URL(baseUrl).origin;

  for (const suggestedPath of subpagePaths) {
    const candidateUrl = `${baseOrigin}${suggestedPath}`;
    testedSubpages.push(candidateUrl);

    const candidateResult = await screenUrl(candidateUrl);

    // Behåll bästa candidate baserat på categorization
    if (candidateResult.categorization === 'strong' || candidateResult.categorization === 'medium') {
      console.log(`[C1-DerivedRules] Found better candidate via subpage: ${candidateUrl} → ${candidateResult.categorization}`);
      return {
        ...candidateResult,
        testedSubpages,
        bestSubpageUrl: candidateUrl,
      };
    }

    // Behåll bästa även om 'weak' (förbättring mot 'noise'/'no-main')
    if (
      candidateResult.categorization === 'weak' &&
      (initialResult.categorization === 'noise' || initialResult.categorization === 'no-main')
    ) {
      console.log(`[C1-DerivedRules] Improved via subpage: ${candidateUrl} → ${candidateResult.categorization}`);
      return {
        ...candidateResult,
        testedSubpages,
        bestSubpageUrl: candidateUrl,
      };
    }
  }

  // Alla candidates misslyckades, returnera initial result
  return { ...initialResult, testedSubpages, bestSubpageUrl: undefined };
}
