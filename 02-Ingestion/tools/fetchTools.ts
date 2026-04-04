/**
 * HTTP Fetch Tool - Unified fetcher for all ingestion methods
 * Used by all non-API sources (WordPress, JSON-LD, HTML scraping)
 */

import axios from 'axios';
import { rawEventsQueue } from '../../03-Queue/queue';
import type { RawEventInput } from '@eventpulse/shared';

export interface FetchResult {
  success: boolean;
  html?: string;
  data?: any;
  error?: string;
  statusCode?: number;
}

/**
 * Fetch HTML content from a URL
 */
export async function fetchHtml(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
} = {}): Promise<FetchResult> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'EventPulse/1.0 (event-ingestion)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        ...options.headers,
      },
      timeout: options.timeout || 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status !== 200) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    return {
      success: true,
      html: response.data,
      statusCode: response.status,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
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
    // Sanitize job ID: BullMQ doesn't allow colons in custom job IDs
    // Tixly API returns IDs like "124187:1" with colons
    // Note: eventId may already contain sourceId (e.g. "berwaldhallen-124187:1")
    // so we only sanitize, don't add source prefix again
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
