/**
 * HTTP Fetch Tool - Unified fetcher for all ingestion methods
 * Used by all non-API sources (WordPress, JSON-LD, HTML scraping)
 */

import axios from 'axios';
import type { RawEventInput } from '@eventpulse/shared';

export interface FetchResult {
  success: boolean;
  html?: string;
  data?: any;
  error?: string;
  statusCode?: number;
  /** Final URL after following redirects (for debugging/auditing) */
  finalUrl?: string;
  /** Redirect chain for auditing: ['301:/path', '308:/other'] */
  redirectChain?: string[];
}

/**
 * Fetch HTML content from a URL.
 * Follows 301/302/307/308 redirects up to MAX_REDIRECTS.
 * Same-domain redirects only for security.
 * Returns content from the final non-redirect URL.
 */
const MAX_REDIRECTS = 3;

export async function fetchHtml(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
} = {}): Promise<FetchResult> {
  let currentUrl = url.replace(/\/+$/, '') || '/';
  const redirectChain: string[] = [];
  const seenUrls = new Set<string>();

  while (true) {
    // Loop detection (uses normalized URLs)
    if (seenUrls.has(currentUrl)) {
      return {
        success: false,
        error: `Redirect loop detected: ${currentUrl}`,
        finalUrl: currentUrl,
        redirectChain,
      };
    }
    seenUrls.add(currentUrl);

    try {
      const response = await axios.get(currentUrl, {
        headers: {
          'User-Agent': 'EventPulse/1.0 (event-ingestion)',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          ...options.headers,
        },
        timeout: options.timeout || 30000,
        validateStatus: (status) => status < 500,
        maxRedirects: 0, // we handle redirects manually to capture final URL
        signal: options.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers['location'];
        if (!location) {
          return {
            success: false,
            error: `HTTP ${response.status} without Location header`,
            statusCode: response.status,
            finalUrl: currentUrl,
            redirectChain,
          };
        }

        // Resolve relative Location against current URL
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).href;
        } catch {
          return {
            success: false,
            error: `Invalid redirect Location: ${location}`,
            statusCode: response.status,
            finalUrl: currentUrl,
            redirectChain,
          };
        }

        // Cross-domain redirect detected — follow it for discovery purposes.
        // Many Swedish sites use cross-domain redirects for event content (e.g. vega.nu → tobiasnygren.se).
        // Continue to the next URL, record the cross-domain hop in redirectChain.
        const currentUrlObj = new URL(currentUrl);
        const nextUrlObj = new URL(nextUrl);
        redirectChain.push(`XDOMAIN:${currentUrlObj.hostname}→${nextUrlObj.hostname}`);
        currentUrl = nextUrl;

        // Normalize trailing slashes before loop detection and before next iteration.
        // /events/ and /events are the same URL — prevents /path ↔ /path/ oscillation.
        const normalizedNext = nextUrl.replace(/\/+$/, '') || '/';

        redirectChain.push(`${response.status}:${normalizedNext}`);
        currentUrl = normalizedNext;

        if (redirectChain.length >= MAX_REDIRECTS) {
          return {
            success: false,
            error: `Exceeded ${MAX_REDIRECTS} redirects`,
            finalUrl: currentUrl,
            redirectChain,
          };
        }
        continue;
      }

      if (response.status !== 200) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          statusCode: response.status,
          finalUrl: currentUrl,
          redirectChain,
        };
      }

      return {
        success: true,
        html: response.data,
        statusCode: response.status,
        finalUrl: currentUrl,
        redirectChain,
      };
    } catch (err: any) {
      // Network-level errors (DNS, timeout, etc.) — fail immediately
      return {
        success: false,
        error: err.message,
        finalUrl: currentUrl,
        redirectChain,
      };
    }
  }
}

/**
 * Fetch JSON from an API endpoint
 */
export async function fetchJson(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
  method?: 'GET' | 'POST';
  body?: any;
} = {}): Promise<FetchResult> {
  try {
    const config: any = {
      headers: {
        'User-Agent': 'EventPulse/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || 30000,
    };

    if (options.body) {
      config.data = options.body;
    }

    const response = await axios({
      url,
      method: options.method || 'GET',
      ...config,
    });

    return {
      success: true,
      data: response.data,
      statusCode: response.status,
    };
  } catch (err: any) {
    if (err.response) {
      return {
        success: false,
        error: `HTTP ${err.response.status}: ${err.message}`,
        statusCode: err.response.status,
      };
    }
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Queue an event to the raw events queue
 */
export async function queueEvent(
  source: string,
  eventId: string,
  rawEvent: RawEventInput
): Promise<boolean> {
  try {
    // Lazy import to avoid initializing Redis/ioredis for batch scripts
    // that only use fetchHtml/fetchJson without queueing events
    const { rawEventsQueue } = await import('../../03-Queue/queue.js');
    const sanitizedEventId = eventId.replace(/:/g, '-');
    await rawEventsQueue.add(`${source}:${eventId}`, rawEvent, {
      jobId: sanitizedEventId,
    });
    return true;
  } catch (err: any) {
    console.error(`[${source}] Failed to queue event ${eventId}:`, err.message);
    return false;
  }
}

/**
 * Queue multiple events
 */
export async function queueEvents(
  source: string,
  events: RawEventInput[]
): Promise<{ queued: number; failed: number }> {
  let queued = 0;
  let failed = 0;

  for (const event of events) {
    const success = await queueEvent(source, event.source_id || String(Math.random()), event);
    if (success) queued++;
    else failed++;
  }

  return { queued, failed };
}
