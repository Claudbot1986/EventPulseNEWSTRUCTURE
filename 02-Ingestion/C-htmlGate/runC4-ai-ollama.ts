/**
 * runC4-ai-ollama.ts — Standalone C4-AI analysis with Qwen local inference
 *
 * Runs C4-AI analysis on failed sources from postB-preC using Ollama Qwen locally.
 * Produces comprehensive markdown reports in reports/C4-ai-runs-only/
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC4-ai-ollama.ts --limit 20 --workers 12
 *   npx tsx 02-Ingestion/C-htmlGate/runC4-ai-ollama.ts --limit 50 --workers 12 --model qwen2.5:7b
 *
 * Goal: Build a rich training corpus of what event pages look like,
 *        where events are found on websites, and what HTML patterns exist.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const REPORTS_DIR = join(__dirname, 'reports', 'C4-ai-runs-only');

// CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '20', 10) : 20;
const workersIdx = args.indexOf('--workers');
const WORKERS = workersIdx >= 0 ? parseInt(args[workersIdx + 1] ?? '12', 10) : 12;
const modelIdx = args.indexOf('--model');
const OLLAMA_MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'qwen2.5:7b';
const reportNameIdx = args.indexOf('--report-name');
const REPORT_NAME = reportNameIdx >= 0 ? args[reportNameIdx + 1] : new Date().toISOString().replace(/[:.]/g, '-');

// Ollama
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// Queue paths
const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  url: string;
  queueReason?: string;
  routingReason?: string;
  queueName?: string;
  queuedAt?: string;
  priority?: number;
  attempt?: number;
  workerNotes?: string;
  winningStage?: string;
  outcomeType?: string;
  routeSuggestion?: string;
  roundNumber?: number;
  roundsParticipated?: number;
}

interface C4InputSource {
  sourceId: string;
  url: string;
  failType: string | null;
  evidence: string;
  winningStage: string;
  c0Candidates: number;
  c2Verdict: string | null;
  c2Score: number | null;
  eventsFound: number;
  consecutiveFailures: number;
  lastPathUsed: string | null;
  triageResult: string | null;
  diversifiers?: string[];
  c0LinksFound?: Array<{ href: string; anchorText: string; score: number; region: string }>;
  c0RootFallback?: boolean;
  c0WinnerUrl?: string | null;
  c1Verdict?: string | null;
  c1LikelyJsRendered?: boolean;
  c1TimeTagCount?: number;
  c1DateCount?: number;
  c2Reason?: string | null;
  networkErrorCount?: number;
  network404Count?: number;
}

interface DiscoveredPath {
  path: string;
  source: 'nav-link' | 'sidebar-link' | 'content-link' | 'url-pattern' | 'derived';
  anchorText?: string;
  confidence: number;
  navReason?: string;
}

interface ConfidenceBreakdown {
  overall: number;
  categoryConfidence: number;
  queueConfidence: number;
  rulesConfidence: number;
}

interface CandidateRule {
  pathPattern: string;
  appliesTo: string;
  confidence: number;
}

interface DirectRouting {
  target: 'A' | 'B' | 'D';
  reason: string;
  confidence: number;
}

interface C4Result {
  sourceId: string;
  url: string;
  likelyCategory: string;
  failCategory: string;
  failCategoryConfidence: number;
  nextQueue: string;
  improvementSignals: string[];
  suggestedRules: string[];
  discoveredPaths: DiscoveredPath[];
  discoveryAttempted: boolean;
  discoveryPathsTried: string[];
  humanLikeDiscoveryReasoning: string;
  candidateRuleForC0C3: CandidateRule | null;
  directRouting?: DirectRouting;
  confidenceBreakdown: ConfidenceBreakdown;
  htmlSignalsFound?: string[];
  eventPageIndicators?: string[];
  jsRenderSignals?: string[];
  robotsStatus?: string;
  discoveredUrl?: string | null;
  extractionHints?: string[];
}

interface C4Report {
  meta: {
    runId: string;
    timestamp: string;
    model: string;
    workers: number;
    limit: number;
    sourcesLoaded: number;
    sourcesAnalyzed: number;
    ollamaHealth: boolean;
    reportVersion: string;
  };
  summary: {
    totalSources: number;
    failCategoryCounts: Record<string, number>;
    nextQueueCounts: Record<string, number>;
    avgConfidence: number;
    avgFailCategoryConfidence: number;
    totalDiscoveredPaths: number;
    totalSuggestedRules: number;
    totalCandidateRules: number;
    highConfidenceRules: number;
    generalizableRules: string[];
    jsRenderLikelyCount: number;
    retryPoolCount: number;
    manualReviewCount: number;
    avgC2ScoreOfFailed: number | null;
    sourcesByFailCategory: Record<string, string[]>;
    routingRecommendations: Record<string, number>;
    eventPageIndicatorsSummary: string[];
    htmlPatternsSummary: string[];
  };
  perSource: C4Result[];
  discoveredPathsCatalog: Array<{
    sourceId: string; url: string; path: string; source: string;
    anchorText: string; confidence: number; navReason: string;
  }>;
  htmlPatternsFound: Array<{
    pattern: string; description: string; count: number;
    sources: string[]; confidence: number;
  }>;
  candidateRulesCatalog: Array<{
    pathPattern: string; appliesTo: string; confidence: number;
    sourceCount: number; sources: string[]; isGeneralizable: boolean;
  }>;
  eventPageStructureCatalog: Array<{
    indicator: string; description: string; frequency: number;
    sources: string[]; reliability: 'high' | 'medium' | 'low';
  }>;
  improvementSignalsCatalog: string[];
  overallObservations: string;
  raw: C4Result[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadFailedSources(limit: number): C4InputSource[] {
  try {
    const content = readFileSync(QUEUES.PREC, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const entries = lines.slice(0, limit).map(line => {
      try { return JSON.parse(line) as QueueEntry; }
      catch { return null; }
    }).filter(Boolean) as QueueEntry[];

    const failTypeMap: Record<string, string> = {
      'no-events': 'ENTRY_PAGE_NO_EVENTS',
      'unfetchable': 'unfetchable',
      'no-candidates': 'no_viable_path_found',
      'js-rendered': 'LIKELY_JS_RENDER',
      'low-score': 'LOW_VALUE_SOURCE',
      'noise': 'insufficient_html_signal',
    };

    return entries.map(e => {
      const fail = e.queueReason ?? e.routingReason ?? '';
      let inferredFailType = 'UNKNOWN';
      for (const [key, val] of Object.entries(failTypeMap)) {
        if (fail.toLowerCase().includes(key)) { inferredFailType = val; break; }
      }
      return {
        sourceId: e.sourceId ?? e.url,
        url: e.url,
        failType: inferredFailType,
        evidence: fail,
        winningStage: e.winningStage ?? 'C',
        c0Candidates: 0,
        c2Verdict: null,
        c2Score: null,
        eventsFound: 0,
        consecutiveFailures: e.attempt ?? 1,
        lastPathUsed: e.workerNotes ?? null,
        triageResult: e.outcomeType ?? null,
      } as C4InputSource;
    });
  } catch {
    return [];
  }
}

async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return (data.models ?? []).some((m: any) => m.name?.includes('qwen'));
  } catch {
    return false;
  }
}

async function analyzeWithOllama(sources: C4InputSource[]): Promise<C4Result[]> {
  const prompt = buildAnalysisPrompt(sources);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 2048 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as any;
    const text: string = data.response ?? '[]';
    const results = robustParse(text);
    return results.map((r: any) => enrichResult(r, sources));
  } catch (err) {
    console.error(`[OLLAMA] Analysis failed: ${err}`);
    return sources.map(s => ({
      sourceId: s.sourceId,
      url: s.url,
      likelyCategory: 'analysis-failed',
      failCategory: 'UNKNOWN',
      failCategoryConfidence: 0.0,
      nextQueue: 'retry-pool',
      improvementSignals: [`Ollama analysis failed: ${err}`],
      suggestedRules: [],
      discoveredPaths: [],
      discoveryAttempted: false,
      discoveryPathsTried: [],
      humanLikeDiscoveryReasoning: '',
      candidateRuleForC0C3: null,
      confidenceBreakdown: { overall: 0, categoryConfidence: 0, queueConfidence: 0, rulesConfidence: 0 },
    } as C4Result));
  }
}

function buildAnalysisPrompt(sources: C4InputSource[]): string {
  const sourcesJson = JSON.stringify(sources, null, 2);
  return `You are an expert analyst for the EventPulse HTML scraping system.

## Your task
Analyze failed event sources using HUMAN-LIKE DISCOVERY. When the entry page did not contain events,
find the correct path to event content through intelligent navigation analysis.

## Input: Array of failed sources
${sourcesJson}

## OUTPUT FORMAT — STRICT JSON
Return a JSON array with one object per source. All fields are required.

{
  "sourceId": "xxx",
  "likelyCategory": "why this source fails in 1-2 words",
  "failCategory": "ENTRY_PAGE_NO_EVENTS" | "NEEDS_SUBPAGE_DISCOVERY" | "LIKELY_JS_RENDER" | "EXTRACTION_PATTERN_MISMATCH" | "LOW_VALUE_SOURCE" | "no_viable_path_found" | "robots_or_policy_blocked" | "likely_js_render_required" | "ambiguous_multiple_paths" | "insufficient_html_signal" | "UNKNOWN",
  "failCategoryConfidence": 0.0-1.0,
  "nextQueue": "UI" | "A" | "B" | "D" | "manual-review" | "retry-pool",
  "improvementSignals": ["signal1", "signal2"],
  "suggestedRules": ["human-readable rule description"],
  "confidenceBreakdown": {
    "overall": 0.0-1.0,
    "categoryConfidence": 0.0-1.0,
    "queueConfidence": 0.0-1.0,
    "rulesConfidence": 0.0-1.0
  },
  "discoveredPaths": [
    {
      "path": "/events",
      "source": "nav-link",
      "anchorText": "Kommande evenemang",
      "confidence": 0.85,
      "navReason": "Human-like reasoning: page has 'Evenemang' link in main nav"
    }
  ],
  "discoveryAttempted": true,
  "discoveryPathsTried": ["/events", "/kalender", "/program"],
  "humanLikeDiscoveryReasoning": "Tried: homepage → Events link in nav → found event listing",
  "candidateRuleForC0C3": {
    "pathPattern": "/events|/kalender|/program",
    "appliesTo": "Swedish cultural/municipal sites with event listings",
    "confidence": 0.8
  },
  "directRouting": {
    "target": "D",
    "reason": "c1LikelyJsRendered=true with 0 timeTags indicates client-side rendering",
    "confidence": 0.92
  },
  "htmlSignalsFound": ["time[datetime] tags", "ISO date patterns", "venue name in h2"],
  "eventPageIndicators": ["date in navigation", "ticket CTA button", "price range displayed"],
  "jsRenderSignals": ["script tag count > 10", "text length < 5000", "no time[datetime]"],
  "extractionHints": ["use dateRegex", "try venueMarker extraction", "check for JSON-LD"]
}

## FailCategory definitions
- ENTRY_PAGE_NO_EVENTS: Entry page had no events — MUST attempt human-like discovery FIRST
- NEEDS_SUBPAGE_DISCOVERY: C4 found subpage candidates worth trying
- LIKELY_JS_RENDER: content rendered client-side → D route
- EXTRACTION_PATTERN_MISMATCH: HTML structure doesn't match extraction patterns
- LOW_VALUE_SOURCE: sparse/archived/outside scope
- no_viable_path_found: exhausted all paths → manual-review
- robots_or_policy_blocked: blocked → manual-review
- ambiguous_multiple_paths: multiple paths → manual-review
- insufficient_html_signal: no event signals → manual-review
- UNKNOWN: insufficient evidence

## Queue routing
- UI: events found → UI | A: API/feed → A | B: structured data → B
- D: JS-rendered → D | retry-pool: paths found, needs another round
- manual-review: only for terminal failure categories

## htmlSignalsFound examples
"time[datetime] tags", "ISO date patterns", "Swedish month dates", "event class selectors",
"price markers", "venue markers", "ticket CTA", "JSON-LD script", "navDate pattern", "newsArticle pattern"

## eventPageIndicators examples
"date in navigation", "ticket CTA button", "price range displayed", "calendar widget",
"event list items", "upcoming events section", "artist/band name", "location/venue name",
"time doors open", "age restriction", "genre/style tags", "event series indication"

## Important
- Do NOT fabricate paths — only use evidence from input + reasoning
- htmlSignalsFound: specific HTML signals indicating events
- eventPageIndicators: what makes this an event page
- extractionHints: what extraction methods would work
- candidateRuleForC0C3 is REQUIRED for ENTRY_PAGE_NO_EVENTS

Return a JSON array. No markdown fences.`;
}

function enrichResult(raw: any, sources: C4InputSource[]): C4Result {
  const src = sources.find(s => s.sourceId === raw.sourceId || s.url === raw.sourceId);
  return {
    sourceId: raw.sourceId ?? raw.url ?? 'unknown',
    url: src?.url ?? raw.url ?? '',
    likelyCategory: raw.likelyCategory ?? 'UNKNOWN',
    failCategory: raw.failCategory ?? 'UNKNOWN',
    failCategoryConfidence: parseFloat(raw.failCategoryConfidence) || 0,
    nextQueue: raw.nextQueue ?? 'retry-pool',
    improvementSignals: Array.isArray(raw.improvementSignals) ? raw.improvementSignals : [],
    suggestedRules: Array.isArray(raw.suggestedRules) ? raw.suggestedRules : [],
    discoveredPaths: (raw.discoveredPaths ?? []).map((p: any) => ({
      path: p.path ?? '',
      source: p.source ?? 'unknown',
      anchorText: p.anchorText,
      confidence: parseFloat(p.confidence) || 0,
      navReason: p.navReason,
    })),
    discoveryAttempted: Boolean(raw.discoveryAttempted),
    discoveryPathsTried: Array.isArray(raw.discoveryPathsTried) ? raw.discoveryPathsTried : [],
    humanLikeDiscoveryReasoning: raw.humanLikeDiscoveryReasoning ?? '',
    candidateRuleForC0C3: raw.candidateRuleForC0C3 ? {
      pathPattern: raw.candidateRuleForC0C3.pathPattern ?? '',
      appliesTo: raw.candidateRuleForC0C3.appliesTo ?? '',
      confidence: parseFloat(raw.candidateRuleForC0C3.confidence) || 0,
    } : null,
    directRouting: raw.directRouting ? {
      target: raw.directRouting.target ?? 'D',
      reason: raw.directRouting.reason ?? '',
      confidence: parseFloat(raw.directRouting.confidence) || 0,
    } : undefined,
    confidenceBreakdown: {
      overall: parseFloat(raw.confidenceBreakdown?.overall) || 0,
      categoryConfidence: parseFloat(raw.confidenceBreakdown?.categoryConfidence) || 0,
      queueConfidence: parseFloat(raw.confidenceBreakdown?.queueConfidence) || 0,
      rulesConfidence: parseFloat(raw.confidenceBreakdown?.rulesConfidence) || 0,
    },
    htmlSignalsFound: Array.isArray(raw.htmlSignalsFound) ? raw.htmlSignalsFound : [],
    eventPageIndicators: Array.isArray(raw.eventPageIndicators) ? raw.eventPageIndicators : [],
    jsRenderSignals: Array.isArray(raw.jsRenderSignals) ? raw.jsRenderSignals : [],
    robotsStatus: raw.robotsStatus,
    discoveredUrl: raw.discoveredUrl,
    extractionHints: Array.isArray(raw.extractionHints) ? raw.extractionHints : [],
  };
}

function robustParse(response: string): any[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); }
    catch {
      try {
        const fixed = jsonMatch[0].replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(fixed);
      } catch {
        try {
          const fixed2 = jsonMatch[0].replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
          return JSON.parse(fixed2);
        } catch { /* fall through */ }
      }
    }
  }
  try { return JSON.parse(response); } catch { /* fall through */ }
  const objectMatches = response.match(/\{[\s\S]*?\}(?=\s*[,}\]]|\s*$)/g);
  if (objectMatches && objectMatches.length > 0) {
    const results: any[] = [];
    for (const objStr of objectMatches) {
      try {
        let fixed = objStr.replace(/,(\s*[}\]])/g, '$1')
          .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        const parsed = JSON.parse(fixed);
        if (parsed.sourceId) results.push(parsed);
      } catch { /* skip */ }
    }
    if (results.length > 0) return results;
  }
  return [];
}

// ── Report Builder ──────────────────────────────────────────────────────────────

function buildReport(results: C4Result[], meta: C4Report['meta']): C4Report {
  const failCategoryCounts: Record<string, number> = {};
  const nextQueueCounts: Record<string, number> = {};
  const sourcesByFailCategory: Record<string, string[]> = {};
  const allSignals = new Set<string>();
  const allEventIndicators = new Set<string>();
  const allHtmlPatterns = new Set<string>();
  let totalConf = 0;
  let totalFailConf = 0;
  const candidateRules: C4Report['candidateRulesCatalog'] = [];
  const discoveredPathsCatalog: C4Report['discoveredPathsCatalog'] = [];
  const indicatorFrequency: Record<string, {count: number; sources: Set<string>}> = {};
  const patternFrequency: Record<string, {count: number; sources: Set<string>}> = {};
  const ruleSourceCount: Record<string, Set<string>> = {};

  for (const r of results) {
    failCategoryCounts[r.failCategory] = (failCategoryCounts[r.failCategory] ?? 0) + 1;
    nextQueueCounts[r.nextQueue] = (nextQueueCounts[r.nextQueue] ?? 0) + 1;
    if (!sourcesByFailCategory[r.failCategory]) sourcesByFailCategory[r.failCategory] = [];
    sourcesByFailCategory[r.failCategory].push(r.sourceId);

    totalConf += r.confidenceBreakdown.overall;
    totalFailConf += r.failCategoryConfidence;

    for (const sig of r.improvementSignals) allSignals.add(sig);
    for (const ind of (r.eventPageIndicators ?? [])) allEventIndicators.add(ind);
    for (const p of (r.htmlSignalsFound ?? [])) allHtmlPatterns.add(p);

    for (const dp of r.discoveredPaths) {
      discoveredPathsCatalog.push({
        sourceId: r.sourceId, url: r.url, path: dp.path, source: dp.source,
        anchorText: dp.anchorText ?? '', confidence: dp.confidence,
        navReason: dp.navReason ?? '',
      });
    }

    if (r.candidateRuleForC0C3) {
      const cr = r.candidateRuleForC0C3;
      candidateRules.push({
        pathPattern: cr.pathPattern, appliesTo: cr.appliesTo,
        confidence: cr.confidence, sourceCount: 1, sources: [r.sourceId],
        isGeneralizable: false,
      });
    }

    for (const rule of r.suggestedRules) {
      if (!ruleSourceCount[rule]) ruleSourceCount[rule] = new Set();
      ruleSourceCount[rule].add(r.sourceId);
    }

    for (const ind of (r.eventPageIndicators ?? [])) {
      if (!indicatorFrequency[ind]) indicatorFrequency[ind] = { count: 0, sources: new Set() };
      indicatorFrequency[ind].count++;
      indicatorFrequency[ind].sources.add(r.sourceId);
    }

    for (const p of (r.htmlSignalsFound ?? [])) {
      if (!patternFrequency[p]) patternFrequency[p] = { count: 0, sources: new Set() };
      patternFrequency[p].count++;
      patternFrequency[p].sources.add(r.sourceId);
    }
  }

  const generalizableRules = Object.entries(ruleSourceCount)
    .filter(([, sources]) => sources.size >= 2)
    .map(([rule]) => rule);

  const htmlPatternsFound: C4Report['htmlPatternsFound'] = Object.entries(patternFrequency)
    .map(([pattern, data]) => ({
      pattern,
      description: patternDescription(pattern),
      count: data.count,
      sources: Array.from(data.sources),
      confidence: Math.min(1, data.count / results.length),
    }))
    .sort((a, b) => b.count - a.count);

  const eventPageStructureCatalog: C4Report['eventPageStructureCatalog'] = Object.entries(indicatorFrequency)
    .map(([indicator, data]) => ({
      indicator,
      description: indicatorDescription(indicator),
      frequency: data.count,
      sources: Array.from(data.sources),
      reliability: data.count >= Math.ceil(results.length * 0.3) ? 'high'
        : data.count >= Math.ceil(results.length * 0.1) ? 'medium' : 'low',
    }))
    .sort((a, b) => b.frequency - a.frequency);

  const crMap = new Map<string, C4Report['candidateRulesCatalog'][0]>();
  for (const cr of candidateRules) {
    if (crMap.has(cr.pathPattern)) {
      const existing = crMap.get(cr.pathPattern)!;
      existing.sourceCount++;
      if (!existing.sources.includes(cr.sources[0])) existing.sources.push(cr.sources[0]);
      existing.confidence = Math.max(existing.confidence, cr.confidence);
    } else {
      crMap.set(cr.pathPattern, { ...cr });
    }
  }
  const mergedRules = Array.from(crMap.values());
  for (const mr of mergedRules) mr.isGeneralizable = mr.sourceCount >= 2;
  mergedRules.sort((a, b) => b.confidence - a.confidence);

  const n = results.length || 1;

  return {
    meta: { ...meta, sourcesAnalyzed: results.length, reportVersion: '1.0' },
    summary: {
      totalSources: results.length,
      failCategoryCounts,
      nextQueueCounts,
      avgConfidence: parseFloat((totalConf / n).toFixed(3)),
      avgFailCategoryConfidence: parseFloat((totalFailConf / n).toFixed(3)),
      totalDiscoveredPaths: discoveredPathsCatalog.length,
      totalSuggestedRules: Array.from(allSignals).length,
      totalCandidateRules: mergedRules.length,
      highConfidenceRules: mergedRules.filter(r => r.confidence >= 0.75).length,
      generalizableRules,
      jsRenderLikelyCount: results.filter(r =>
        r.failCategory === 'LIKELY_JS_RENDER' || r.failCategory === 'likely_js_render_required'
      ).length,
      retryPoolCount: nextQueueCounts['retry-pool'] ?? 0,
      manualReviewCount:
        (nextQueueCounts['manual-review'] ?? 0) +
        (failCategoryCounts['no_viable_path_found'] ?? 0) +
        (failCategoryCounts['robots_or_policy_blocked'] ?? 0),
      avgC2ScoreOfFailed: null,
      routingRecommendations: nextQueueCounts,
      eventPageIndicatorsSummary: Array.from(allEventIndicators),
      htmlPatternsSummary: Array.from(allHtmlPatterns),
    },
    perSource: results,
    discoveredPathsCatalog,
    htmlPatternsFound,
    candidateRulesCatalog: mergedRules,
    eventPageStructureCatalog,
    improvementSignalsCatalog: Array.from(allSignals),
    overallObservations: generateOverallObservations(results, mergedRules, eventPageStructureCatalog, htmlPatternsFound),
    raw: results,
  };
}

function patternDescription(pattern: string): string {
  const map: Record<string, string> = {
    'time[datetime] tags': 'HTML <time> elementer med datetime-attribut — starkaste datumsignalet',
    'ISO date patterns': 'Datum på formatet YYYY-MM-DD i text',
    'Swedish month dates': 'Datum med svenska månadsnamn (jan, feb, mar...)',
    'event class selectors': 'CSS-klasser som innehåller "event", "kalender", "program"',
    'price markers': 'Prisinformation (kr, sek, €) nära events',
    'venue markers': 'Plats/lokalnamn i närheten av datum',
    'ticket CTA': 'Biljett/Köp-knappar eller links',
    'JSON-LD script': '<script type="application/ld+json"> — strukturerad event-data',
    'navDate pattern': 'Datum i navigationsmeny — svag signal, ofta noise',
    'newsArticle pattern': 'Schema.org NewsArticle microdata — ej eventsida',
  };
  return map[pattern] ?? 'HTML-signal för eventinnehåll';
}

function indicatorDescription(indicator: string): string {
  const map: Record<string, string> = {
    'date in navigation': 'Datum eller kalender-länk i huvudmeny',
    'ticket CTA button': 'Explicit "Köp biljett" eller "Buy ticket" knapp',
    'price range displayed': 'Prisintervall synligt på sidan',
    'calendar widget': 'Kalender-widget för datumsval',
    'event list items': 'Lista av event med datum, titel, lokal',
    'upcoming events section': 'Sektion märkt "Kommande evenemang" el. likn',
    'artist/band name': 'Namn på artister eller band',
    'location/venue name': 'Specifik lokal eller arena-namn',
    'time doors open': 'Dörröppningstid eller starttid',
    'age restriction': 'Åldersgränsinformation',
    'genre/style tags': 'Genre- eller stil-kategorier',
    'event series indication': 'Återkommande event-serie eller turnénamn',
  };
  return map[indicator] ?? 'Event-side-indikator';
}

function generateOverallObservations(
  results: C4Result[],
  rules: C4Report['candidateRulesCatalog'][],
  eventPageStructure: C4Report['eventPageStructureCatalog'][],
  htmlPatterns: C4Report['htmlPatternsFound'][]
): string {
  const lines: string[] = [];
  const topPatterns = htmlPatterns.slice(0, 5);
  if (topPatterns.length > 0) {
    lines.push(`**Vanligaste HTML-signaler:** ${topPatterns.map(p => `\`${p.pattern}\` (${p.count} källor)`).join(', ')}.`);
  }
  const highRelIndicators = eventPageStructure.filter(e => e.reliability === 'high');
  if (highRelIndicators.length > 0) {
    lines.push(`**Högdragna event-indikatorer:** ${highRelIndicators.map(e => `\`${e.indicator}\``).join(', ')}.`);
  }
  const generalizable = rules.filter(r => r.isGeneralizable);
  if (generalizable.length > 0) {
    lines.push(`**Generaliserbara mönster (2+ källor):**`);
    for (const r of generalizable) {
      lines.push(`  - \`${r.pathPattern}\` (conf=${r.confidence.toFixed(2)}, ${r.sourceCount} källor): ${r.appliesTo}`);
    }
  }
  return lines.join('\n') || 'Inga tydliga mönster observerade ännu.';
}

// ── Markdown Writer ─────────────────────────────────────────────────────────────

function writeMarkdownReport(report: C4Report): string {
  const lines: string[] = [];

  lines.push(`# C4-AI Analysis Report`);
  lines.push(`**Run ID:** \`${report.meta.runId}\``);
  lines.push(`**Timestamp:** ${report.meta.timestamp}`);
  lines.push(`**Model:** ${report.meta.model} via Ollama (${report.meta.workers} workers)`);
  lines.push(`**Sources analyzed:** ${report.meta.sourcesAnalyzed} / ${report.meta.sourcesLoaded} loaded`);
  lines.push(``);

  lines.push(`## Meta`);
  lines.push(`| Parameter | Value |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| runId | \`${report.meta.runId}\` |`);
  lines.push(`| timestamp | ${report.meta.timestamp} |`);
  lines.push(`| model | ${report.meta.model} |`);
  lines.push(`| workers | ${report.meta.workers} |`);
  lines.push(`| limit | ${report.meta.limit} |`);
  lines.push(`| sourcesLoaded | ${report.meta.sourcesLoaded} |`);
  lines.push(`| sourcesAnalyzed | ${report.meta.sourcesAnalyzed} |`);
  lines.push(`| ollamaHealth | ${report.meta.ollamaHealth} |`);
  lines.push(`| reportVersion | ${report.meta.reportVersion} |`);
  lines.push(``);

  lines.push(`## Summary`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total sources | ${report.summary.totalSources} |`);
  lines.push(`| Avg overall confidence | ${report.summary.avgConfidence} |`);
  lines.push(`| Avg fail category confidence | ${report.summary.avgFailCategoryConfidence} |`);
  lines.push(`| Total discovered paths | ${report.summary.totalDiscoveredPaths} |`);
  lines.push(`| Total candidate rules | ${report.summary.totalCandidateRules} |`);
  lines.push(`| High-confidence rules (≥0.75) | ${report.summary.highConfidenceRules} |`);
  lines.push(`| Generalizable rules (2+ sources) | ${report.summary.generalizableRules.length} |`);
  lines.push(`| JS-render likely | ${report.summary.jsRenderLikelyCount} |`);
  lines.push(`| Retry pool | ${report.summary.retryPoolCount} |`);
  lines.push(`| Manual review | ${report.summary.manualReviewCount} |`);
  lines.push(``);

  lines.push(`### Fail Category Distribution`);
  for (const [cat, count] of Object.entries(report.summary.failCategoryCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / report.summary.totalSources) * 100).toFixed(1);
    lines.push(`- \`${cat}\`: ${count} (${pct}%)`);
  }
  lines.push(``);

  lines.push(`### Next Queue Routing`);
  for (const [queue, count] of Object.entries(report.summary.nextQueueCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / report.summary.totalSources) * 100).toFixed(1);
    lines.push(`- \`${queue}\`: ${count} (${pct}%)`);
  }
  lines.push(``);

  lines.push(`## Overall Observations`);
  lines.push(report.overallObservations);
  lines.push(``);

  lines.push(`## HTML Patterns Found (${report.htmlPatternsFound.length})`);
  lines.push(`| Pattern | Description | Count | Sources | Confidence |`);
  lines.push(`|---------|-------------|-------|---------|-------------|`);
  for (const p of report.htmlPatternsFound.slice(0, 30)) {
    lines.push(`| \`${esc(p.pattern)}\` | ${p.description} | ${p.count} | ${p.sources.length} | ${p.confidence.toFixed(2)} |`);
  }
  lines.push(``);

  lines.push(`## Event Page Structure Indicators (${report.eventPageStructureCatalog.length})`);
  lines.push(`| Indicator | Description | Frequency | Reliability | Sources |`);
  lines.push(`|-----------|-------------|-----------|-------------|---------|`);
  for (const e of report.eventPageStructureCatalog) {
    lines.push(`| \`${esc(e.indicator)}\` | ${e.description} | ${e.frequency} | ${e.reliability} | ${e.sources.length} |`);
  }
  lines.push(``);

  lines.push(`## Candidate Rules for C0/C3 (${report.candidateRulesCatalog.length})`);
  if (report.candidateRulesCatalog.length > 0) {
    lines.push(`| Path Pattern | Applies To | Confidence | Sources | Generalizable |`);
    lines.push(`|--------------|------------|------------|---------|---------------|`);
    for (const r of report.candidateRulesCatalog.slice(0, 20)) {
      lines.push(`| \`${esc(r.pathPattern)}\` | ${r.appliesTo} | ${r.confidence.toFixed(2)} | ${r.sourceCount} | ${r.isGeneralizable ? '✅' : '❌'} |`);
    }
  } else {
    lines.push(`Inga candidate rules genererade.`);
  }
  lines.push(``);

  lines.push(`## Generalizable Rules (${report.summary.generalizableRules.length})`);
  if (report.summary.generalizableRules.length > 0) {
    for (const rule of report.summary.generalizableRules) lines.push(`- ${esc(rule)}`);
  } else {
    lines.push(`Inga generaliserbara regler ännu (kräver 2+ källor med samma regel).`);
  }
  lines.push(``);

  lines.push(`## Discovered Paths Catalog (${report.discoveredPathsCatalog.length})`);
  lines.push(`| Path | Source | Anchor Text | Confidence | Source URL |`);
  lines.push(`|------|--------|-------------|------------|-------------|`);
  for (const dp of report.discoveredPathsCatalog.slice(0, 50)) {
    const shortUrl = dp.url.length > 50 ? dp.url.slice(0, 50) + '...' : dp.url;
    lines.push(`| \`${esc(dp.path)}\` | ${dp.source} | ${esc(dp.anchorText || '-')} | ${dp.confidence.toFixed(2)} | ${esc(shortUrl)} |`);
  }
  lines.push(``);

  lines.push(`## Per-Source Results (${report.perSource.length})`);
  for (const r of report.perSource) {
    lines.push(`### ${esc(r.sourceId)}`);
    lines.push(`**URL:** \`${esc(r.url)}\``);
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| likelyCategory | ${esc(r.likelyCategory)} |`);
    lines.push(`| failCategory | \`${r.failCategory}\` |`);
    lines.push(`| failCategoryConfidence | ${r.failCategoryConfidence.toFixed(3)} |`);
    lines.push(`| nextQueue | \`${r.nextQueue}\` |`);
    lines.push(`| discoveryAttempted | ${r.discoveryAttempted ? '✅' : '❌'} |`);
    lines.push(`| overallConfidence | ${r.confidenceBreakdown.overall.toFixed(3)} |`);
    lines.push(`| categoryConfidence | ${r.confidenceBreakdown.categoryConfidence.toFixed(3)} |`);
    lines.push(`| queueConfidence | ${r.confidenceBreakdown.queueConfidence.toFixed(3)} |`);
    lines.push(`| rulesConfidence | ${r.confidenceBreakdown.rulesConfidence.toFixed(3)} |`);
    if (r.directRouting) lines.push(`| directRouting | ${r.directRouting.target} (${r.directRouting.confidence.toFixed(2)}) |`);
    if (r.discoveredUrl) lines.push(`| discoveredUrl | \`${esc(r.discoveredUrl)}\` |`);
    lines.push(``);
    if (r.htmlSignalsFound?.length) lines.push(`**htmlSignalsFound:** ${r.htmlSignalsFound.map(s => `\`${esc(s)}\``).join(', ')}`);
    if (r.eventPageIndicators?.length) lines.push(`**eventPageIndicators:** ${r.eventPageIndicators.map(s => `\`${esc(s)}\``).join(', ')}`);
    if (r.jsRenderSignals?.length) lines.push(`**jsRenderSignals:** ${r.jsRenderSignals.map(s => `\`${esc(s)}\``).join(', ')}`);
    if (r.extractionHints?.length) lines.push(`**extractionHints:** ${r.extractionHints.map(s => `\`${esc(s)}\``).join(', ')}`);
    if (r.discoveryPathsTried.length) lines.push(`**discoveryPathsTried:** ${r.discoveryPathsTried.map(p => `\`${esc(p)}\``).join(', ')}`);
    if (r.humanLikeDiscoveryReasoning) { lines.push(`**humanLikeDiscoveryReasoning:**`); lines.push(r.humanLikeDiscoveryReasoning); }
    if (r.discoveredPaths.length) {
      lines.push(`**discoveredPaths:**`);
      for (const dp of r.discoveredPaths) {
        lines.push(`  - \`${esc(dp.path)}\` [${dp.source}] conf=${dp.confidence.toFixed(2)}${dp.anchorText ? ` "${esc(dp.anchorText)}"` : ''}`);
        if (dp.navReason) lines.push(`    Reasoning: ${dp.navReason}`);
      }
    }
    if (r.candidateRuleForC0C3) {
      lines.push(`**candidateRuleForC0C3:**`);
      lines.push(`  - pathPattern: \`${esc(r.candidateRuleForC0C3.pathPattern)}\``);
      lines.push(`  - appliesTo: ${r.candidateRuleForC0C3.appliesTo}`);
      lines.push(`  - confidence: ${r.candidateRuleForC0C3.confidence.toFixed(2)}`);
    }
    if (r.improvementSignals.length) { lines.push(`**improvementSignals:**`); for (const sig of r.improvementSignals) lines.push(`  - ${esc(sig)}`); }
    if (r.suggestedRules.length) { lines.push(`**suggestedRules:**`); for (const rule of r.suggestedRules) lines.push(`  - ${esc(rule)}`); }
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`## Improvement Signals Catalog (${report.improvementSignalsCatalog.length})`);
  for (const sig of report.improvementSignalsCatalog) lines.push(`- ${esc(sig)}`);
  lines.push(``);

  lines.push(`## Raw Results (JSON)`);
  lines.push(`<details>`);
  lines.push(`<summary>Click to expand raw JSON (${report.raw.length} sources)</summary>`);
  lines.push(`\`\`\`json`);
  lines.push(JSON.stringify(report.raw, null, 2));
  lines.push(`\`\`\``);
  lines.push(`</details>`);

  return lines.join('\n');
}

function esc(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/`/g, '\\`');
}

// ── Parallel ───────────────────────────────────────────────────────────────────

async function runParallelAnalysis(sources: C4InputSource[], workers: number): Promise<C4Result[]> {
  const batches: C4InputSource[][] = [];
  for (let i = 0; i < sources.length; i += workers) {
    batches.push(sources.slice(i, i + workers));
  }
  const allResults: C4Result[] = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`[C4-POOL] Batch ${i + 1}/${batches.length} — ${batches[i].length} sources`);
    const batchResults = await analyzeWithOllama(batches[i]);
    allResults.push(...batchResults);
  }
  return allResults;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('C4-AI OLLAMA — Standalone C4 analysis with Qwen local inference');
  console.log('============================================================');
  console.log(`Limit: ${LIMIT} | Workers: ${WORKERS} | Model: ${OLLAMA_MODEL}`);

  const ollamaUp = await checkOllamaHealth();
  if (!ollamaUp) {
    console.error('ERROR: Ollama not running or no Qwen model. Run: ollama serve && ollama pull qwen2.5:7b');
    process.exit(1);
  }
  console.log('[OLLAMA] Connected\n');

  mkdirSync(REPORTS_DIR, { recursive: true });

  const sources = loadFailedSources(LIMIT);
  console.log(`Loaded ${sources.length} sources from postB-preC\n`);

  if (sources.length === 0) {
    console.log('No sources in postB-preC queue.');
    process.exit(0);
  }

  const results = await runParallelAnalysis(sources, WORKERS);

  const meta: C4Report['meta'] = {
    runId: REPORT_NAME,
    timestamp: new Date().toISOString(),
    model: OLLAMA_MODEL,
    workers: WORKERS,
    limit: LIMIT,
    sourcesLoaded: sources.length,
    sourcesAnalyzed: results.length,
    ollamaHealth: ollamaUp,
    reportVersion: '1.0',
  };

  const report = buildReport(results, meta);
  const mdContent = writeMarkdownReport(report);

  const mdPath = join(REPORTS_DIR, `c4-run-${REPORT_NAME}.md`);
  writeFileSync(mdPath, mdContent);

  const jsonPath = join(REPORTS_DIR, `c4-run-${REPORT_NAME}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log(`\n============================================================`);
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`Sources analyzed: ${report.summary.totalSources}`);
  console.log(`Fail categories: ${JSON.stringify(report.summary.failCategoryCounts)}`);
  console.log(`Routing: ${JSON.stringify(report.summary.nextQueueCounts)}`);
  console.log(`Discovered paths: ${report.summary.totalDiscoveredPaths}`);
  console.log(`Candidate rules: ${report.summary.totalCandidateRules}`);
  console.log(`Generalizable rules: ${report.summary.generalizableRules.length}`);
  console.log(`\nReports:`);
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  JSON:     ${jsonPath}`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
