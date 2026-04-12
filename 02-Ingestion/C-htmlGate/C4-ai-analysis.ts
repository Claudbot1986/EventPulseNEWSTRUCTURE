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

export enum FailCategory {
  WRONG_ENTRY_PAGE = 'WRONG_ENTRY_PAGE',
  NEEDS_SUBPAGE_DISCOVERY = 'NEEDS_SUBPAGE_DISCOVERY',
  LIKELY_JS_RENDER = 'LIKELY_JS_RENDER',
  EXTRACTION_PATTERN_MISMATCH = 'EXTRACTION_PATTERN_MISMATCH',
  LOW_VALUE_SOURCE = 'LOW_VALUE_SOURCE',
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
    if (r.directRouting) {
      lines.push(`| directRouting | ${r.directRouting.target} (conf=${r.directRouting.confidence.toFixed(2)}) |`);
    }
    lines.push('');
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
Analyze failed event sources and return STRUCTURED routing + improvement advice.

## Input: Array of failed sources
${sourcesJson}

## OUTPUT FORMAT — STRICT JSON
Return a JSON array with one object per source. All fields are required.

{
  "sourceId": "xxx",
  "likelyCategory": "why this source fails in 1-2 words",
  "failCategory": "WRONG_ENTRY_PAGE" | "NEEDS_SUBPAGE_DISCOVERY" | "LIKELY_JS_RENDER" | "EXTRACTION_PATTERN_MISMATCH" | "LOW_VALUE_SOURCE" | "UNKNOWN",
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
      "confidence": 0.85
    }
  ],
  "directRouting": {
    "target": "D",
    "reason": "c1LikelyJsRendered=true with 0 timeTags indicates client-side rendering",
    "confidence": 0.92
  }
}

## Field definitions

### discoveredPaths (REQUIRED — even if empty [])
Specific URL paths discovered from c0LinksFound on THIS source. Each path must:
- Be an EXACT path found in c0LinksFound (e.g. "/events", "/biljetter")
- Reference the link's anchorText if it came from a nav/sidebar/content link
- Have a confidence score based on how likely this path contains events

### directRouting (optional — omit if not applicable)
If c1LikelyJsRendered=true OR strong A/B signals detected in C1/C2, set this to bypass C4 threshold logic:
- target: "D" if JS-render suspected, "A" if API pattern found, "B" if structured data found
- reason: why this routing is warranted
- confidence: 0.0–1.0

### failCategoryConfidence guidelines
- 0.90–1.0: Very strong evidence (e.g., likelyJsRendered=true + 0 timeTags)
- 0.70–0.89: Strong evidence (e.g., likelyJsRendered=true + few timeTags)
- 0.60–0.69: Moderate evidence (e.g., error patterns + domain hints)
- <0.60: Weak evidence → consider "UNKNOWN" or "retry-pool"

### FailCategory definitions
- WRONG_ENTRY_PAGE: entry URL is not the event page, wrong section of site
- NEEDS_SUBPAGE_DISCOVERY: events exist but are on subpages not found from entry
- LIKELY_JS_RENDER: content appears to be rendered client-side, not in raw HTML
- EXTRACTION_PATTERN_MISMATCH: HTML structure doesn't match current extraction patterns
- LOW_VALUE_SOURCE: site has events but they are sparse/archived/outside scope
- UNKNOWN: insufficient evidence to categorize

### Queue routing rules
- "UI": extract succeeded → events found → route to UI
- "A": API/feed pattern detected → route to A
- "B": structured data pattern detected → route to B
- "D": JS-rendered content → route to D (render fallback)
- "manual-review": 3+ rounds without resolution → route to manual review
- "retry-pool": worth another round in the pool with same approach

## CRITICAL — discoveredPaths must come from c0LinksFound
Look at c0LinksFound in the input. For each link that has relevant anchor text or URL:
- Extract the href path (e.g., "/events", "/program/konserter")
- Set source: "nav-link" if from <nav>, "sidebar-link" if from <aside>, "content-link" if from <main>/<article>, "url-pattern" if derived from URL structure
- Set confidence based on how event-indicating the anchor text is

If c0LinksFound is empty or has no relevant links, discoveredPaths should be [].

## Important constraints
- Do NOT fabricate paths — only use what is in c0LinksFound
- Do NOT fabricate events or override measured evidence
- suggestedRules is human-readable explanation, not code
- improvementSignals should identify WHAT to investigate (not HOW to fix)

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
