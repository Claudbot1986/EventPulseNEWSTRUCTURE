/**
 * D-renderGate — Headless browser renderer for JS-heavy pages
 *
 * Fallback path for sources where:
 * - raw HTML lacks meaningful event content
 * - C1 detected likelyJsRendered=true
 * - HTML candidate discovery was attempted but produced weak results
 *
 * Scrapingbee behavior ladder (credit-cost aware):
 *   auto         → mode=auto, max_cost=10 (default; tries 1→5→10→25→75 cr)
 *   static-only  → render_js=false, premium_proxy=true, country=se (1 cr)
 *   premium-only → render_js=true,  premium_proxy=true, country=se (5 cr; default for JS-SPA)
 *   stealth      → stealth_proxy=true, render_js=true, country=se (75 cr; last resort)
 */

import puppeteer from 'puppeteer';
import axios from 'axios';
import { fetchHtml } from '../tools/fetchTools.js';

export type RenderBehavior = 'auto' | 'static-only' | 'premium-only' | 'stealth';

/**
 * Estimated max credit cost per behavior (Scrapingbee HTML API):
 * - auto: ladder 1→5→10→25→75 cr; billed at winning tier; max_cost=10 caps it
 * - static-only: 1 cr (classic) or 10 cr (premium_proxy=true; we always use premium for geo)
 * - premium-only: 5 cr (classic+JS) or 25 cr (premium+JS)
 * - stealth: 75 cr (stealth+JS; stealth requires render_js=true)
 */
export const BEHAVIOR_MAX_CREDITS: Record<RenderBehavior, number> = {
  'auto': 10,
  'static-only': 10,
  'premium-only': 25,
  'stealth': 75,
};

export function estimateBehaviorCost(behavior: RenderBehavior): number {
  return BEHAVIOR_MAX_CREDITS[behavior];
}

export interface RenderResult {
  url: string;
  success: boolean;
  html?: string;
  error?: string;
  metrics?: {
    renderTimeMs: number;
    htmlLength: number;
    hasEventContent: boolean;
    behavior?: RenderBehavior;
    creditsCharged?: number;
    usedStealthFallback?: boolean;
  };
}

export interface RenderOptions {
  timeout?: number;  // page load timeout in ms (default: 15000)
  waitForSelector?: string;  // optional selector to wait for before returning
  evaluateFn?: string;  // optional JS to evaluate in page context
  behavior?: RenderBehavior;  // Scrapingbee behavior (default: 'auto')
}

/**
 * Build the Scrapingbee request params for a given behavior + options.
 * Exposed for unit testing.
 *
 * Note: Scrapingbee is mutually exclusive between `mode=auto` and explicit
 * `render_js`/`premium_proxy`/`stealth_proxy`. We never mix them.
 */
export function buildScrapingbeeParams(
  url: string,
  options: RenderOptions = {}
): { params: Record<string, string | number | boolean>; behavior: RenderBehavior } {
  const behavior: RenderBehavior = options.behavior ?? 'auto';
  const base: Record<string, string | number | boolean> = {
    api_key: '__SCRAPINGBEE_KEY__',  // placeholder; replaced by axios call
    url,
    country_code: 'se',
    block_resources: 'true',
  };

  switch (behavior) {
    case 'auto':
      return {
        behavior,
        params: {
          ...base,
          mode: 'auto',
          max_cost: BEHAVIOR_MAX_CREDITS.auto,
        },
      };

    case 'static-only':
      return {
        behavior,
        params: {
          ...base,
          render_js: 'false',
          premium_proxy: 'true',
        },
      };

    case 'premium-only':
      return {
        behavior,
        params: {
          ...base,
          render_js: 'true',
          premium_proxy: 'true',
          wait: '2500',
          ...(options.waitForSelector ? { wait_for: options.waitForSelector } : {}),
        },
      };

    case 'stealth':
      return {
        behavior,
        params: {
          ...base,
          stealth_proxy: 'true',
          render_js: 'true',
          // NOTE: Scrapingbee forbids custom headers/cookies/timeout with stealth_proxy
          // (it runs in stealth mode only). Selector-wait still allowed via wait_for.
          ...(options.waitForSelector ? { wait_for: options.waitForSelector } : {}),
        },
      };
  }
}

/**
 * Decide if a RenderResult should escalate to stealth-proxy retry.
 * Trigger when at least 2 of the 3 bot-detection signals are present:
 *   1. HTTP 403/429 in status
 *   2. HTML shorter than 500 chars (empty / JS-only)
 *   3. CF / DataDome markers in body
 */
export function shouldEscalateToStealth(result: RenderResult): boolean {
  if (!result || result.success === undefined) return false;
  // If render succeeded with substantial HTML and event-like content, no need.
  const html = result.html ?? '';
  const len = html.length;
  const hasEvents = result.metrics?.hasEventContent ?? false;
  if (result.success && len >= 500 && hasEvents) return false;

  let signals = 0;

  // signal 1: short / empty HTML
  if (len < 500) signals += 1;

  // signal 2: CF / DataDome markers
  const cfRx = /cf-mitigated|cf-chl-bypass|Attention Required|cf-error-code|dd-token|datadome|captcha/i;
  if (cfRx.test(html)) signals += 1;

  // signal 3: error string hints at bot-detection (best-effort)
  const err = (result.error ?? '').toLowerCase();
  if (/403|429|access denied|blocked|forbidden/i.test(err)) signals += 1;

  return signals >= 2;
}

/**
 * Render a URL using headless Chrome (puppeteer) or Scrapingbee.
 * Returns the fully rendered HTML after JS execution.
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const timeout = options.timeout || 15000;
  const startTime = Date.now();
  const scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;
  const requestedBehavior: RenderBehavior = options.behavior ?? 'auto';

  // Primary path: ScrapingBee render (preferred for Tool D).
  if (scrapingBeeKey) {
    let result = await runScrapingbee(url, scrapingBeeKey, { ...options, behavior: requestedBehavior }, timeout);

    // Auto-escalate to stealth if blocked detection signals are present.
    if (requestedBehavior !== 'stealth' && shouldEscalateToStealth(result)) {
      const stealthResult = await runScrapingbee(url, scrapingBeeKey, { ...options, behavior: 'stealth' }, timeout);
      if (stealthResult.success) {
        if (stealthResult.metrics) {
          stealthResult.metrics = { ...stealthResult.metrics, usedStealthFallback: true };
        }
        return stealthResult;
      }
    }

    return result;
  }

  // Fallback path: local Puppeteer (only used if SCRAPINGBEE_API_KEY is missing).
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) return request.abort();
      return request.continue();
    });

    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: timeout
    });

    const status = response?.status() || 0;

    if (status >= 400) {
      return {
        url,
        success: false,
        error: `HTTP ${status}`,
        metrics: {
          renderTimeMs: Date.now() - startTime,
          htmlLength: 0,
          hasEventContent: false,
        },
      };
    }

    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: 5000 });
      } catch {
        // Selector not found, continue anyway
      }
    }

    if (options.evaluateFn) {
      await page.evaluate(options.evaluateFn);
    }

    const html = await page.content();
    const renderTimeMs = Date.now() - startTime;

    return {
      url,
      success: true,
      html,
      metrics: {
        renderTimeMs,
        htmlLength: html.length,
        hasEventContent: checkForEventContent(html),
      },
    };

  } catch (error: any) {
    return {
      url,
      success: false,
      error: error.message || 'Unknown error',
      metrics: {
        renderTimeMs: Date.now() - startTime,
        htmlLength: 0,
        hasEventContent: false,
      },
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Internal: run a single Scrapingbee request for a specific behavior.
 */
async function runScrapingbee(
  url: string,
  apiKey: string,
  options: RenderOptions,
  timeout: number,
): Promise<RenderResult> {
  const startTime = Date.now();
  const { params, behavior } = buildScrapingbeeParams(url, options);
  params.api_key = apiKey;

  try {
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params,
      timeout,
      responseType: 'text',
      validateStatus: (s) => s < 500,
    });

    if (response.status >= 400) {
      return {
        url,
        success: false,
        error: `ScrapingBee HTTP ${response.status}`,
        metrics: {
          renderTimeMs: Date.now() - startTime,
          htmlLength: 0,
          hasEventContent: false,
          behavior,
          creditsCharged: estimateBehaviorCost(behavior),
        },
      };
    }

    const html = String(response.data || '');
    return {
      url,
      success: true,
      html,
      metrics: {
        renderTimeMs: Date.now() - startTime,
        htmlLength: html.length,
        hasEventContent: checkForEventContent(html),
        behavior,
        creditsCharged: estimateBehaviorCost(behavior),
      },
    };
  } catch (err: any) {
    return {
      url,
      success: false,
      error: err?.message || 'ScrapingBee request failed',
      metrics: {
        renderTimeMs: Date.now() - startTime,
        htmlLength: 0,
        hasEventContent: false,
        behavior,
        creditsCharged: 0,  // failed requests not charged per Scrapingbee docs
      },
    };
  }
}

/**
 * Check if HTML likely contains event-like content
 */
function checkForEventContent(html: string): boolean {
  const eventPatterns = [
    /kalender/i,
    /evenemang/i,
    /event/i,
    /program/i,
    /schema/i,
    /datum/i,
    /tid/i,
    /biljett/i,
    /ticket/i
  ];

  return eventPatterns.some(pattern => pattern.test(html));
}

/**
 * Quick smoke test — check if a URL needs rendering
 * Returns true if the page appears to need headless rendering
 */
export async function needsRendering(url: string): Promise<boolean> {
  // Try a quick fetch first
  const quickFetch = await fetchHtml(url, { timeout: 5000 });

  if (!quickFetch.html || quickFetch.html.length < 1000) {
    // Very small or empty HTML — likely JS-rendered
    return true;
  }

  // Check for common JS-framework indicators
  const jsIndicators = [
    '<div id="__next"',  // Next.js
    '<div data-react',   // React
    '<div id="app"',      // Vue/Angular generic
    'ng-app',            // Angular
    'w-dyn-list',        // Webflow
    'data-v-',           // Vue SFC
  ];

  const hasJsIndicator = jsIndicators.some(indicator =>
    quickFetch.html!.includes(indicator)
  );

  if (hasJsIndicator) return true;

  // Check if content is suspiciously sparse
  const textLength = quickFetch.html.replace(/<[^>]*>/g, '').length;
  if (textLength < 500) return true;

  return false;
}