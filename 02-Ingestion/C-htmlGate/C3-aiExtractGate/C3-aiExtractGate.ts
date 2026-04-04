/**
 * C3 — AI Extract Gate: AI-augmented event extraction
 *
 * STEP 3 of the HTML path (after C2).
 * Activated when C2 returns "promising" but extractFromHtml() finds 0 events.
 *
 * Uses AI to understand page semantics and extract events from complex HTML structures
 * that rule-based extractors cannot handle.
 *
 * Pipeline: JSON-LD → Network → C1 → C2 → [C3 if needed] → D-renderGate
 *
 * Model: MiniMax m2.7 (configured via 02-Ingestion/AI/minimaxConfig.ts)
 */

import { load, type CheerioAPI } from 'cheerio';
import { callMinimax } from '../../AI/minimaxConfig';

export type AiVerdict = 'success' | 'partial' | 'failed' | 'needs_render';

export interface AiExtractedEvent {
  title: string;
  date?: string;
  time?: string;
  venue?: string;
  url?: string;
  ticketUrl?: string;
  confidence: {
    overall: number;
    fields: Record<string, number>;
  };
  reasoning?: string;
}

export interface AiExtractScope {
  selector: string;
  confidence: number;
  reasoning: string;
}

export interface AiExtractResult {
  verdict: AiVerdict;
  events: AiExtractedEvent[];
  scopes: AiExtractScope[];
  reasoning: string;
  fallbackToRender: boolean;
  rawAiOutput?: string;
}

/**
 * AI Extractor implementation using MiniMax m2.7
 */
async function aiExtractWithMinimax(html: string, url: string): Promise<AiExtractResult> {
  const $ = load(html);
  
  // Truncate HTML to avoid token limits (keep first ~50KB)
  const truncatedHtml = html.length > 50000 ? html.substring(0, 50000) : html;
  
  // Truncate page text similarly
  const pageText = $('body').text().substring(0, 10000);

  const systemPrompt = `You are an expert event extraction AI for Swedish cultural websites.

Your task is to analyze HTML from event listing pages and extract structured event data.

IMPORTANT:
- Extract ONLY real events (concerts, theater, exhibitions, sports, etc.)
- Ignore navigation, ads, footer, sidebar content
- Date format should be: YYYY-MM-DD
- Time format should be: HH:MM (24-hour)
- If no events found, return empty events array

Return your response as JSON with this exact structure:
{
  "verdict": "success" | "partial" | "failed" | "needs_render",
  "events": [
    {
      "title": "Event name",
      "date": "YYYY-MM-DD",
      "time": "HH:MM or empty",
      "venue": "Venue name or empty",
      "url": "https://full-url or empty",
      "ticketUrl": "https://url or empty",
      "confidence": { "overall": 0.0-1.0, "fields": { "title": 0.0-1.0, "date": 0.0-1.0 } }
    }
  ],
  "scopes": [
    { "selector": "CSS selector", "confidence": 0.0-1.0, "reasoning": "why this contains events" }
  ],
  "reasoning": "explanation of your analysis",
  "fallbackToRender": true/false,
  "rawAiOutput": "optional raw text if JSON parsing fails"
}`;

  const userPrompt = `Analyze this HTML page and extract events.

URL: ${url}

Page text preview (first 2000 chars):
${pageText.substring(0, 2000)}

HTML structure preview (first 30000 chars):
${truncatedHtml.substring(0, 30000)}

Look for:
1. Event listing containers (ul, div, article with event content)
2. Event cards with title, date, time, venue, URL
3. Swedish date formats: "7 april 2026", "26 april 2026"
4. Calendar/Program/Kalender sections

Return JSON only, no markdown fences.`;

  try {
    const response = await callMinimax(userPrompt, { system: systemPrompt });
    
    // Parse JSON response
    let parsed: any;
    try {
      // Try to extract JSON from response (handle potential markdown)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(response);
      }
    } catch (parseError) {
      return {
        verdict: 'failed',
        events: [],
        scopes: [],
        reasoning: `Failed to parse AI response as JSON: ${response.substring(0, 200)}`,
        fallbackToRender: false,
        rawAiOutput: response,
      };
    }

    // Validate and transform response
    const events: AiExtractedEvent[] = (parsed.events || []).map((e: any) => ({
      title: e.title || 'Unknown',
      date: e.date || undefined,
      time: e.time || undefined,
      venue: e.venue || undefined,
      url: e.url || undefined,
      ticketUrl: e.ticketUrl || undefined,
      confidence: {
        overall: typeof e.confidence?.overall === 'number' ? e.confidence.overall : 0.5,
        fields: e.confidence?.fields || {},
      },
    }));

    return {
      verdict: events.length > 0 ? 'success' : (parsed.verdict || 'failed'),
      events,
      scopes: (parsed.scopes || []).map((s: any) => ({
        selector: s.selector || '',
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
        reasoning: s.reasoning || '',
      })),
      reasoning: parsed.reasoning || 'No reasoning provided',
      fallbackToRender: parsed.fallbackToRender || false,
      rawAiOutput: response,
    };
  } catch (error) {
    return {
      verdict: 'failed',
      events: [],
      scopes: [],
      reasoning: `MiniMax API error: ${error instanceof Error ? error.message : 'unknown'}`,
      fallbackToRender: false,
    };
  }
}

/**
 * Rule-based fallback extraction when no AI is configured
 */
function ruleBasedExtract(url: string, html: string): AiExtractResult {
  const $ = load(html);
  const scopes: AiExtractScope[] = [];

  // Heuristic scope discovery
  const scopeSelectors = [
    { selector: 'ul.event-list li', confidence: 0.7 },
    { selector: 'div.event-card', confidence: 0.65 },
    { selector: 'article.event', confidence: 0.75 },
    { selector: '.kalender-item', confidence: 0.8 },
    { selector: '[data-event]', confidence: 0.6 },
    { selector: '.program-listing li', confidence: 0.7 },
    { selector: '.arrangement', confidence: 0.65 },
    { selector: '.spelning', confidence: 0.75 },
  ];

  for (const scope of scopeSelectors) {
    const elements = $(scope.selector);
    if (elements.length > 0) {
      scopes.push({
        selector: scope.selector,
        confidence: scope.confidence * Math.min(elements.length / 5, 1),
        reasoning: `Found ${elements.length} elements matching ${scope.selector}`,
      });
    }
  }

  const pageText = $('body').text();
  const sweDateRegex = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/gi;
  const dates = pageText.match(sweDateRegex) || [];

  const hasJsIndicators = html.includes('id="__NEXT_DATA__"') ||
    html.includes('window.__INITIAL_STATE__') ||
    html.includes('ng-app') ||
    html.includes('data-vue-app') ||
    html.includes('React.createElement');

  const reasoning = [
    `Rule-based analysis found ${scopes.length} potential event scopes`,
    `Page contains ${dates.length} Swedish date mentions`,
    hasJsIndicators ? 'Page appears to be JS-rendered (likely needs D-renderGate)' : 'Page appears to be static HTML',
    scopes.length === 0 ? 'No event scopes detected by heuristics' : `Top scope: ${scopes[0]?.selector || 'none'}`,
  ].join('. ');

  return {
    verdict: scopes.length > 0 ? 'partial' : 'failed',
    events: [],
    scopes: scopes.sort((a, b) => b.confidence - a.confidence),
    reasoning,
    fallbackToRender: hasJsIndicators && scopes.length === 0,
  };
}

/**
 * Main entry point for C3 AI Extract Gate
 */
export async function evaluateAiExtract(
  url: string,
  html: string,
  options: {
    useAi?: boolean;
    c2Score?: number;
    c2Candidates?: string[];
  } = {}
): Promise<AiExtractResult> {
  // Check if AI is available
  const apiKey = process.env.MINIMAX_API_KEY;
  
  if (apiKey && options.useAi !== false) {
    console.log('[C3] Using MiniMax AI for extraction');
    return aiExtractWithMinimax(html, url);
  }

  console.log('[C3] No AI configured, using rule-based fallback');
  return ruleBasedExtract(url, html);
}
