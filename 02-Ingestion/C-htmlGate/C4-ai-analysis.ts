/**
 * C4 — AI Analysis Gate
 *
 * Analyzes unresolved (fail-type) sources after each round.
 * Returns structured insights per source:
 *   - likelyCategory: why the source is failing
 *   - nextQueue: suggested queue routing
 *   - improvementSignals: what to improve
 *   - suggestedRules: generic rules to improve C0/C1/C2/C3
 *
 * Uses: callMinimax from 02-Ingestion/AI/minimaxConfig
 */

import { callMinimax } from '../AI/minimaxConfig';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * FAILURE CATEGORY REPLACEMENT (2026-04-14):
 *
 * OLD: WRONG_ENTRY_PAGE was treated as terminal failure → manual-review.
 * NEW: "Entry page did not contain events yet — continue guided discovery."
 *
 * WRONG_ENTRY_PAGE is now DEPRECATED. It is replaced by:
 *   - ENTRY_PAGE_NO_EVENTS: C4 should attempt human-like discovery first
 *   - If discovery fails after 1-3 nav levels → no_viable_path_found
 *
 * New manual-review categories (only reached AFTER limited human-like discovery):
 *   - no_viable_path_found: exhausted all reasonable navigation paths
 *   - robots_or_policy_blocked: robots.txt or meta policy blocked discovery
 *   - likely_js_render_required: content requires JS rendering (D-route)
 *   - ambiguous_multiple_paths: multiple equally valid paths, no way to choose
 *   - insufficient_html_signal: HTML lacks any event-like signals
 */
export enum FailCategory {
  // DEPRECATED — replaced by ENTRY_PAGE_NO_EVENTS + no_viable_path_found
  WRONG_ENTRY_PAGE = 'WRONG_ENTRY_PAGE',
  // NEW: Entry page had no events — C4 must attempt human-like discovery first
  ENTRY_PAGE_NO_EVENTS = 'ENTRY_PAGE_NO_EVENTS',
  // Continues to exist — C4 found subpage candidates worth trying
  NEEDS_SUBPAGE_DISCOVERY = 'NEEDS_SUBPAGE_DISCOVERY',
  // Continues to exist — direct D-routing warranted
  LIKELY_JS_RENDER = 'LIKELY_JS_RENDER',
  // Continues to exist
  EXTRACTION_PATTERN_MISMATCH = 'EXTRACTION_PATTERN_MISMATCH',
  // Continues to exist
  LOW_VALUE_SOURCE = 'LOW_VALUE_SOURCE',
  // NEW: only reached AFTER human-like discovery exhausted
  NO_VIABLE_PATH_FOUND = 'no_viable_path_found',
  // NEW: robots.txt or policy blocked discovery
  ROBOTS_OR_POLICY_BLOCKED = 'robots_or_policy_blocked',
  // NEW: same as LIKELY_JS_RENDER but explicit
  LIKELY_JS_RENDER_REQUIRED = 'likely_js_render_required',
  // NEW: multiple paths, cannot determine correct one
  AMBIGUOUS_MULTIPLE_PATHS = 'ambiguous_multiple_paths',
  // NEW: HTML lacks event signals
  INSUFFICIENT_HTML_SIGNAL = 'insufficient_html_signal',
  // Fallback
  UNKNOWN = 'UNKNOWN',
}

export interface C4InputSource {
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
  // C0 debug: actual links discovered on this source
  c0LinksFound?: Array<{ href: string; anchorText: string; score: number; region: string }>;
  // C0 debug: whether C0 fell back to root URL
  c0RootFallback?: boolean;
  // C0 debug: winner URL if found
  c0WinnerUrl?: string | null;
  // C1 signals
  c1Verdict?: string | null;
  c1LikelyJsRendered?: boolean;
  c1TimeTagCount?: number;
  c1DateCount?: number;
  // C2 signals
  c2Reason?: string | null;
  // Network inspection signals (if available)
  networkErrorCount?: number;
  network404Count?: number;
}

export interface ConfidenceBreakdown {
  overall: number; // 0–1
  categoryConfidence: number;
  queueConfidence: number;
  rulesConfidence: number;
}

export interface DiscoveredPath {
  path: string;        // e.g. "/events" or "/fotboll/matcher"
  source: 'nav-link' | 'sidebar-link' | 'content-link' | 'url-pattern' | 'derived';
  anchorText?: string; // if discovered from a link
  confidence: number;  // 0–1 how confident this path contains events
}

export interface CandidateRuleForC0C3 {
  pathPattern: string;       // e.g. "/events|/kalender|/program"
  appliesTo: string;         // e.g. "Swedish cultural/municipal sites with event listings"
  confidence: number;        // 0–1
}

export interface C4AnalysisResult {
  sourceId: string;
  likelyCategory: string;
  failCategory: FailCategory;
  failCategoryConfidence: number; // 0–1
  nextQueue: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'retry-pool';
  improvementSignals: string[];
  suggestedRules: string[];
  // Structured: specific paths discovered from C0 links/URLs on THIS source
  discoveredPaths: DiscoveredPath[];
  // NEW: whether C4 attempted human-like discovery
  discoveryAttempted: boolean;
  // NEW: paths actually tried during human-like discovery
  discoveryPathsTried: string[];
  // NEW: free-text reasoning about the discovery path
  humanLikeDiscoveryReasoning: string;
  // NEW: generalizable candidate rule for C0–C3
  candidateRuleForC0C3: CandidateRuleForC0C3 | null;
  // Structured: explicit routing if C1/C2 signals are strong enough
  directRouting?: {
    target: 'A' | 'B' | 'D';
    reason: string;
    confidence: number;
  };
  confidenceBreakdown: ConfidenceBreakdown;
}

export interface C4RoundAnalysis {
  roundNumber: number;
  batchId: string;
  sourcesAnalyzed: number;
  results: C4AnalysisResult[];
  overallPattern: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Report writer (writes c4-ai-analysis-round-X.md)
// ---------------------------------------------------------------------------

function writeC4Report(
  analysis: C4RoundAnalysis,
  batchDir: string
): void {
  // Ensure batch directory exists before writing (defense in depth)
  mkdirSync(batchDir, { recursive: true });

  const roundFile = join(batchDir, `c4-ai-analysis-round-${analysis.roundNumber}.md`);

  const lines: string[] = [
    `## C4-AI Analysis Round ${analysis.roundNumber} (${analysis.batchId})`,
    '',
    `**Timestamp:** ${analysis.timestamp}`,
    `**Sources analyzed:** ${analysis.sourcesAnalyzed}`,
    '',
    `### Overall Pattern`,
    analysis.overallPattern,
    '',
    '---',
    '',
  ];

  for (const r of analysis.results) {
    lines.push(`### Source: ${r.sourceId}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| likelyCategory | ${r.likelyCategory} |`);
    lines.push(`| failCategory | ${r.failCategory} |`);
    lines.push(`| failCategoryConfidence | ${r.failCategoryConfidence.toFixed(2)} |`);
    lines.push(`| nextQueue | ${r.nextQueue} |`);
    lines.push(`| discoveryAttempted | ${r.discoveryAttempted} |`);
    if (r.discoveryPathsTried.length > 0) {
      lines.push(`| discoveryPathsTried | ${r.discoveryPathsTried.join(', ')} |`);
    }
    if (r.directRouting) {
      lines.push(`| directRouting | ${r.directRouting.target} (conf=${r.directRouting.confidence.toFixed(2)}) |`);
    }
    lines.push('');
    if (r.humanLikeDiscoveryReasoning) {
      lines.push('**humanLikeDiscoveryReasoning:**');
      lines.push(r.humanLikeDiscoveryReasoning);
      lines.push('');
    }
    if (r.candidateRuleForC0C3) {
      lines.push('**candidateRuleForC0C3:**');
      lines.push(`- pathPattern: \`${r.candidateRuleForC0C3.pathPattern}\``);
      lines.push(`- appliesTo: ${r.candidateRuleForC0C3.appliesTo}`);
      lines.push(`- confidence: ${r.candidateRuleForC0C3.confidence.toFixed(2)}`);
      lines.push('');
    }
    lines.push('**discoveredPaths:**');
    if (r.discoveredPaths.length > 0) {
      for (const dp of r.discoveredPaths) {
        lines.push(`- ${dp.path} [${dp.source}]${dp.anchorText ? ` anchor="${dp.anchorText}"` : ''} conf=${dp.confidence.toFixed(2)}`);
      }
    } else {
      lines.push('(none)');
    }
    lines.push('');
    lines.push('**improvementSignals:**');
    for (const sig of r.improvementSignals) {
      lines.push(`- ${sig}`);
    }
    lines.push('');
    lines.push('**suggestedRules:**');
    for (const rule of r.suggestedRules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  writeFileSync(roundFile, lines.join('\n'));
  console.log(`[C4] Report written: c4-ai-analysis-round-${analysis.roundNumber}.md`);
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(sources: C4InputSource[]): string {
  const sourcesJson = JSON.stringify(sources, null, 2);

  return `You are an expert analyst for the EventPulse HTML scraping system.

## Your task
Analyze failed event sources using HUMAN-LIKE DISCOVERY. When the entry page did not contain events,
your job is to find the correct path to event content through intelligent navigation analysis —
NOT to immediately send to manual-review.

## Input: Array of failed sources
${sourcesJson}

## OUTPUT FORMAT — STRICT JSON
Return a JSON array with one object per source. All fields are required.

{
  "sourceId": "xxx",
  "likelyCategory": "why this source fails in 1-2 words",
  "failCategory": "ENTRY_PAGE_NO_EVENTS" | "NEEDS_SUBPAGE_DISCOVERY" | "LIKELY_JS_RENDER" | "EXTRACTION_PATTERN_MISMATCH" | "LOW_VALUE_SOURCE" | "no_viable_path_found" | "robots_or_policy_blocked" | "likely_js_render_required" | "ambiguous_multiple_paths" | "insufficient_html_signal" | "UNKNOWN",
  "failCategoryConfidence": 0.0–1.0,
  "nextQueue": "UI" | "A" | "B" | "D" | "manual-review" | "retry-pool",
  "improvementSignals": ["signal1", "signal2"],
  "suggestedRules": ["human-readable rule description"],
  "confidenceBreakdown": {
    "overall": 0.0–1.0,
    "categoryConfidence": 0.0–1.0,
    "queueConfidence": 0.0–1.0,
    "rulesConfidence": 0.0–1.0
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
    pathPattern: "/events|/kalender|/program",
    appliesTo: "Swedish cultural/municipal sites with event listings",
    confidence: 0.8
  },
  "directRouting": {
    "target": "D",
    "reason": "c1LikelyJsRendered=true with 0 timeTags indicates client-side rendering",
    "confidence": 0.92
  }
}

## NEW BEHAVIOR: Human-Like Discovery for ENTRY_PAGE_NO_EVENTS

When failCategory would previously have been WRONG_ENTRY_PAGE, you MUST now:

1. **Try to find the correct path** — analyze c0LinksFound for event-indicating links
2. **Consider these common Swedish event paths**:
   - /events, /evenemang, /kalender, /program, /schema
   - /konserter, /biljetter, /aktuelt, /aktuellt, /vad-hander
   - /schedule, /lineup, /dates, /tickets
3. **Weigh link signals**:
   - Anchor text: evenemang, kalender, events, program, händer, aktuellt, biljetter, schedule, lineup
   - Date signals in proximity: månad, vecka, dag, januari, feb, mars, etc.
   - Event structure: time tags, location, ticket prices near links
4. **Max 1–3 navigation levels** — do NOT crawl extensively
5. **Document the path that worked** in discoveredPaths + humanLikeDiscoveryReasoning
6. **Formulate a general candidate rule** in candidateRuleForC0C3.pathPattern

Only send to manual-review via "no_viable_path_found" AFTER attempting human-like discovery.

## FailCategory definitions (UPDATED 2026-04-14)

- **ENTRY_PAGE_NO_EVENTS** (NEW, replaces WRONG_ENTRY_PAGE): Entry page had no events — C4 must attempt human-like discovery FIRST. This is NOT a terminal failure. nextQueue should be "retry-pool" with discovered paths.
- **NEEDS_SUBPAGE_DISCOVERY**: C4 found subpage candidates worth trying via derived rules
- **LIKELY_JS_RENDER**: content appears to be rendered client-side → direct D route
- **LIKELY_JS_RENDER_REQUIRED** (NEW): same as above but explicit → D route
- **EXTRACTION_PATTERN_MISMATCH**: HTML structure doesn't match extraction patterns
- **LOW_VALUE_SOURCE**: site has events but sparse/archived/outside scope
- **no_viable_path_found** (NEW): exhausted all reasonable navigation paths → manual-review
- **robots_or_policy_blocked** (NEW): robots.txt or meta policy blocked discovery → manual-review
- **ambiguous_multiple_paths** (NEW): multiple equally valid paths, cannot determine → manual-review
- **insufficient_html_signal** (NEW): HTML lacks any event-like signals → manual-review
- **UNKNOWN**: insufficient evidence to categorize

## Queue routing rules
- "UI": extract succeeded → events found → route to UI
- "A": API/feed pattern detected → route to A
- "B": structured data pattern detected → route to B
- "D": JS-rendered content → route to D (render fallback)
- "retry-pool": C4 found event-indicating paths but needs another round to test them
- "manual-review": only for no_viable_path_found, robots_or_policy_blocked, ambiguous_multiple_paths, insufficient_html_signal

## CRITICAL — discoveredPaths must come from c0LinksFound + human-like reasoning
Look at c0LinksFound in the input. For each link:
- Extract the href path (e.g., "/events", "/program/konserter")
- Set source: "nav-link" if from <nav>, "sidebar-link" if from <aside>, "content-link" if from <main>/<article>, "url-pattern" if derived from URL structure
- Set confidence based on how event-indicating the anchor text is

For ENTRY_PAGE_NO_EVENTS: MUST provide discoveredPaths with confidence > 0.5 OR explain why no paths were found.

## Important constraints
- Do NOT fabricate paths — only use c0LinksFound + reasoning
- Do NOT fabricate events or override measured evidence
- suggestedRules is human-readable explanation, not code
- improvementSignals should identify WHAT to investigate (not HOW to fix)
- C4 must ATTEMPT human-like discovery before sending to manual-review
- candidateRuleForC0C3 is REQUIRED for ENTRY_PAGE_NO_EVENTS — formulate a general path pattern

Return a JSON array with one entry per source. No markdown fences, no code blocks.`;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export async function runC4Analysis(
  sources: C4InputSource[],
  batchId: string,
  roundNumber: number,
  batchDir: string
): Promise<C4RoundAnalysis> {
  console.log(`[C4] Analyzing ${sources.length} failed sources...`);

  const timestamp = new Date().toISOString();

  if (sources.length === 0) {
    const empty: C4RoundAnalysis = {
      roundNumber,
      batchId,
      sourcesAnalyzed: 0,
      results: [],
      overallPattern: 'No failed sources to analyze.',
      timestamp,
    };
    writeC4Report(empty, batchDir);
    return empty;
  }

  try {
    const prompt = buildAnalysisPrompt(sources);
    const response = await callMinimax(prompt, {
      system: 'You are an expert EventPulse system analyst. Return only valid JSON.',
    });

    // Parse JSON array from response
    let parsed: any[];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(response);
      }
    } catch {
      console.warn('[C4] Failed to parse AI response, using fallback per-source analysis');
      parsed = sources.map(s => ({
        sourceId: s.sourceId,
        likelyCategory: 'unclear',
        nextQueue: 'retry-pool',
        improvementSignals: ['AI analysis unavailable'],
        suggestedRules: [],
        reasoning: 'C4-AI parse failure — default to retry-pool',
      }));
    }

    const results: C4AnalysisResult[] = sources.map((src, idx) => {
      const aiResult = parsed[idx] || {};
      const failCategoryRaw = aiResult.failCategory || 'UNKNOWN';
      const failCategoryConfidence = aiResult.failCategoryConfidence ?? 0.5;

      // Validate failCategory against enum
      const isValidFailCategory = Object.values(FailCategory).includes(failCategoryRaw as FailCategory);
      const normalizedFailCategory = isValidFailCategory
        ? (failCategoryRaw as FailCategory)
        : FailCategory.UNKNOWN;

      // Parse confidenceBreakdown
      const cb = aiResult.confidenceBreakdown || {};
      const normalizedCb = {
        overall: typeof cb.overall === 'number' ? cb.overall : 0.5,
        categoryConfidence: typeof cb.categoryConfidence === 'number' ? cb.categoryConfidence : 0.5,
        queueConfidence: typeof cb.queueConfidence === 'number' ? cb.queueConfidence : 0.5,
        rulesConfidence: typeof cb.rulesConfidence === 'number' ? cb.rulesConfidence : 0.5,
      };

      // Parse discoveredPaths — must have path, source, confidence
      const discoveredPaths: DiscoveredPath[] = [];
      if (Array.isArray(aiResult.discoveredPaths)) {
        for (const dp of aiResult.discoveredPaths) {
          if (dp.path && typeof dp.path === 'string') {
            discoveredPaths.push({
              path: dp.path,
              source: (dp.source === 'nav-link' || dp.source === 'sidebar-link' || dp.source === 'content-link' || dp.source === 'url-pattern' || dp.source === 'derived')
                ? dp.source
                : 'derived',
              anchorText: typeof dp.anchorText === 'string' ? dp.anchorText : undefined,
              confidence: typeof dp.confidence === 'number' ? dp.confidence : 0.5,
            });
          }
        }
      }

      // Parse directRouting — optional
      const directRouting = aiResult.directRouting
        ? {
            target: (aiResult.directRouting.target === 'A' || aiResult.directRouting.target === 'B' || aiResult.directRouting.target === 'D')
              ? aiResult.directRouting.target
              : null,
            reason: typeof aiResult.directRouting.reason === 'string' ? aiResult.directRouting.reason : '',
            confidence: typeof aiResult.directRouting.confidence === 'number' ? aiResult.directRouting.confidence : 0.5,
          }
        : undefined;

      // Parse new human-like discovery fields
      const discoveryAttempted = Boolean(aiResult.discoveryAttempted);
      const discoveryPathsTried: string[] = Array.isArray(aiResult.discoveryPathsTried)
        ? aiResult.discoveryPathsTried.filter((p: any) => typeof p === 'string')
        : [];
      const humanLikeDiscoveryReasoning = typeof aiResult.humanLikeDiscoveryReasoning === 'string'
        ? aiResult.humanLikeDiscoveryReasoning
        : '';
      const candidateRuleForC0C3: CandidateRuleForC0C3 | null =
        aiResult.candidateRuleForC0C3 && typeof aiResult.candidateRuleForC0C3 === 'object'
          ? {
              pathPattern: typeof aiResult.candidateRuleForC0C3.pathPattern === 'string'
                ? aiResult.candidateRuleForC0C3.pathPattern
                : '',
              appliesTo: typeof aiResult.candidateRuleForC0C3.appliesTo === 'string'
                ? aiResult.candidateRuleForC0C3.appliesTo
                : '',
              confidence: typeof aiResult.candidateRuleForC0C3.confidence === 'number'
                ? aiResult.candidateRuleForC0C3.confidence
                : 0.5,
            }
          : null;

      return {
        sourceId: src.sourceId,
        likelyCategory: aiResult.likelyCategory || 'unclear',
        failCategory: normalizedFailCategory,
        failCategoryConfidence,
        nextQueue: (aiResult.nextQueue as any) || 'retry-pool',
        improvementSignals: Array.isArray(aiResult.improvementSignals)
          ? aiResult.improvementSignals
          : [],
        suggestedRules: Array.isArray(aiResult.suggestedRules)
          ? aiResult.suggestedRules
          : [],
        discoveredPaths,
        discoveryAttempted,
        discoveryPathsTried,
        humanLikeDiscoveryReasoning,
        candidateRuleForC0C3,
        directRouting: directRouting?.target ? directRouting : undefined,
        confidenceBreakdown: normalizedCb,
      };
    });

    // Derive overall pattern from results
    const categoryCounts: Record<string, number> = {};
    for (const r of results) {
      categoryCounts[r.likelyCategory] = (categoryCounts[r.likelyCategory] || 0) + 1;
    }
    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => `${count}× ${cat}`)
      .join(', ');
    const overallPattern = `Top failure categories: ${topCategories}`;

    const analysis: C4RoundAnalysis = {
      roundNumber,
      batchId,
      sourcesAnalyzed: sources.length,
      results,
      overallPattern,
      timestamp,
    };

    writeC4Report(analysis, batchDir);
    console.log(`[C4] Analysis complete: ${sources.length} sources analyzed`);

    return analysis;

  } catch (error) {
    console.error('[C4] AI analysis failed:', error);

    // Fallback: all fails go to retry-pool
    const fallbackResults: C4AnalysisResult[] = sources.map(s => ({
      sourceId: s.sourceId,
      likelyCategory: 'analysis_unavailable',
      failCategory: FailCategory.UNKNOWN,
      failCategoryConfidence: 0.1,
      nextQueue: 'retry-pool' as const,
      improvementSignals: ['C4-AI unavailable — default to retry-pool'],
      suggestedRules: [],
      discoveredPaths: [],
      discoveryAttempted: false,
      discoveryPathsTried: [],
      humanLikeDiscoveryReasoning: '',
      candidateRuleForC0C3: null,
      confidenceBreakdown: {
        overall: 0.1,
        categoryConfidence: 0.1,
        queueConfidence: 0.1,
        rulesConfidence: 0.1,
      },
    }));

    const analysis: C4RoundAnalysis = {
      roundNumber,
      batchId,
      sourcesAnalyzed: sources.length,
      results: fallbackResults,
      overallPattern: 'C4-AI unavailable — fallback to retry-pool for all sources',
      timestamp,
    };

    writeC4Report(analysis, batchDir);
    return analysis;
  }
}
