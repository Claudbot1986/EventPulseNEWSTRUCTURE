/**
 * D-renderGate — Headless browser renderer for JS-heavy pages
 * 
 * Fallback path for sources where:
 * - raw HTML lacks meaningful event content
 * - C1 detected likelyJsRendered=true
 * - HTML candidate discovery was attempted but produced weak results
 */

import puppeteer from 'puppeteer';
import axios from 'axios';
import { fetchHtml } from '../tools/fetchTools.js';

export interface RenderResult {
  url: string;
  success: boolean;
  html?: string;
  error?: string;
  metrics?: {
    renderTimeMs: number;
    htmlLength: number;
    hasEventContent: boolean;
  };
}

export interface RenderOptions {
  timeout?: number;  // page load timeout in ms (default: 15000)
  waitForSelector?: string;  // optional selector to wait for before returning
  evaluateFn?: string;  // optional JS to evaluate in page context
}

/**
 * Render a URL using headless Chrome (puppeteer)
 * Returns the fully rendered HTML after JS execution
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const timeout = options.timeout || 15000;
  const startTime = Date.now();
  const scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;

  // Primary path: ScrapingBee JS render (as requested for Tool D).
  if (scrapingBeeKey) {
    try {
      const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
        params: {
          api_key: scrapingBeeKey,
          url,
          render_js: 'true',
          block_resources: 'true',
          premium_proxy: 'true',
          country_code: 'se',
          wait: '2500',
        },
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
            hasEventContent: false
          }
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
          hasEventContent: checkForEventContent(html)
        }
      };
    } catch {
      // Fall through to Puppeteer fallback below.
    }
  }

  // Fallback path: local Puppeteer.
  let browser = null;
  
  try {
    // Launch headless browser
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
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Block only heavy resources; allow document/scripts/XHR so JS apps can render.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) return request.abort();
      return request.continue();
    });
    
    // Navigate to URL
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
          hasEventContent: false
        }
      };
    }
    
    // Wait for optional selector
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: 5000 });
      } catch {
        // Selector not found, continue anyway
      }
    }
    
    // Evaluate optional JS
    if (options.evaluateFn) {
      await page.evaluate(options.evaluateFn);
    }
    
    // Get rendered HTML
    const html = await page.content();
    const renderTimeMs = Date.now() - startTime;
    
    return {
      url,
      success: true,
      html,
      metrics: {
        renderTimeMs,
        htmlLength: html.length,
        hasEventContent: checkForEventContent(html)
      }
    };
    
  } catch (error: any) {
    return {
      url,
      success: false,
      error: error.message || 'Unknown error',
      metrics: {
        renderTimeMs: Date.now() - startTime,
        htmlLength: 0,
        hasEventContent: false
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
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
