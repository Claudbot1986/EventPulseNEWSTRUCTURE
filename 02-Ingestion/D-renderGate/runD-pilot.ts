/**
 * D-render pilot runner (Val C, 2026-10-09).
 *
 * Per CLAUDE.md "DO NOT BUILD YET": D-render as default path is forbidden.
 * This runner is the source-specific entrypoint: it accepts a `sourceId`
 * that must be in RENDER_PILOT_SOURCES, looks up the URL, calls
 * renderPage() (renderGate.ts), then runs both site-adapters and the
 * universal-extractor over the rendered HTML.
 *
 * Per CLAUDE.md Generalization Protection Rule: this file does NOT modify
 * C0/C1/C2 logic, IGNORE_PATTERNS, or scoring weights. The pilot is
 * isolated, with its own allowlist and log file.
 */
import { renderPage, type RenderResult, type RenderBehavior } from './renderGate';
import { isPilotSource, RENDER_PILOT_URLS } from './sourceAllowlist';
import { runAdapters } from '../F-eventExtraction/adapters';
import { extractEvents, type ExtractResult } from '../F-eventExtraction/universal-extractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';

export interface PilotOptions {
  /** Override the default URL (must match the source's calendar). */
  url?: string;
  /** Scrapingbee behavior ladder. Default 'premium-only' (5 cr; 25 cr with proxy). */
  behavior?: RenderBehavior;
  /** Page-load timeout in ms. Default 15000. */
  timeout?: number;
}

export interface PilotResult {
  sourceId: string;
  url: string;
  behavior: RenderBehavior;
  durationMs: number;
  renderSuccess: boolean;
  renderError?: string;
  htmlLength: number;
  creditsCharged: number;
  usedStealthFallback: boolean;
  adapterHits: string[];          // which adapter(s) produced events
  events: ParsedEvent[];          // merged adapter + universal events
  universalEventsFound: number;   // count from universal-extractor alone
  exitReason:
    | 'ok'
    | 'source-not-in-allowlist'   // sourceId not in RENDER_PILOT_SOURCES
    | 'render-failed';            // SB returned 4xx/5xx or no HTML
}

/**
 * Run a single pilot source: render + adapter + universal extraction.
 *
 * Returns a structured PilotResult. Never throws — errors are captured
 * in `exitReason` / `renderError` so the API endpoint can respond
 * cleanly.
 */
export async function runPilotSource(
  sourceId: string,
  options: PilotOptions = {}
): Promise<PilotResult> {
  const start = Date.now();
  const url = options.url ?? RENDER_PILOT_URLS[sourceId];
  const behavior: RenderBehavior = options.behavior ?? 'premium-only';

  if (!isPilotSource(sourceId) || !url) {
    return {
      sourceId,
      url: url ?? '<unknown>',
      behavior,
      durationMs: Date.now() - start,
      renderSuccess: false,
      renderError: 'source-not-in-allowlist',
      htmlLength: 0,
      creditsCharged: 0,
      usedStealthFallback: false,
      adapterHits: [],
      events: [],
      universalEventsFound: 0,
      exitReason: 'source-not-in-allowlist',
    };
  }

  const render: RenderResult = await renderPage(url, {
    behavior,
    timeout: options.timeout,
  });

  if (!render.success || !render.html) {
    return {
      sourceId,
      url,
      behavior,
      durationMs: Date.now() - start,
      renderSuccess: false,
      renderError: render.error ?? 'no-html',
      htmlLength: 0,
      creditsCharged: render.metrics?.creditsCharged ?? 0,
      usedStealthFallback: !!render.metrics?.usedStealthFallback,
      adapterHits: [],
      events: [],
      universalEventsFound: 0,
      exitReason: 'render-failed',
    };
  }

  // 1. Try site-specific adapters first (biljettshop, arkdes, etc).
  const adapterResult = runAdapters(render.html, url, sourceId);
  const adapterEvents = adapterResult?.events ?? [];
  const adapterHits = adapterResult ? [adapterResult.adapter] : [];

  // 2. Always run universal-extractor as a baseline. Adapters don't
  //    replace the universal pass; they PRECEDE it for known patterns.
  //    We use a separate variable to avoid double-counting.
  const universal: ExtractResult = extractEvents(render.html, sourceId, url);
  const universalEvents = universal.events;

  // Merge (dedup by fingerprint already happens downstream in importToEventPulse).
  const events: ParsedEvent[] = [...adapterEvents, ...universalEvents];

  return {
    sourceId,
    url,
    behavior: render.metrics?.behavior ?? behavior,
    durationMs: Date.now() - start,
    renderSuccess: true,
    htmlLength: render.html.length,
    creditsCharged: render.metrics?.creditsCharged ?? 0,
    usedStealthFallback: !!render.metrics?.usedStealthFallback,
    adapterHits,
    events,
    universalEventsFound: universalEvents.length,
    exitReason: 'ok',
  };
}
