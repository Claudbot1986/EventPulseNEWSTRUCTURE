/**
 * Event Service Client for Expo/React Native
 *
 * ARCHITECTURE (aligned with wrapper :7777):
 * - Canonical truth: Supabase `events` WHERE status='published'
 * - Wrapper (api-server.cjs :7777) uses eventsCanonical.cjs
 * - App uses the SAME canonical read path (direct or via wrapper HTTP)
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchCanonicalEvents } = require('./eventsCanonical.cjs');

const PAGE_SIZE = 200;

/** Optional: http://100.x.x.x:7777 when wrapper is reachable from phone */
const EVENTS_API_URL = process.env.EXPO_PUBLIC_EVENTS_API_URL || '';

async function fetchFromWrapper({ limit, offset, days, source, city }) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    days: String(days),
    city: city || 'Stockholm',
  });
  if (source) params.set('source', source);

  const base = EVENTS_API_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/supabase-events?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Wrapper fetch failed: HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchFromCanonical({ limit, offset, days, source, city }) {
  return fetchCanonicalEvents({ limit, offset, days, source, city });
}

/**
 * Fetch events — same contract as GET /supabase-events on wrapper :7777
 */
export async function fetchEvents(options = {}) {
  const {
    page = 0,
    limit = PAGE_SIZE,
    days = 365,
    source = null,
    city = 'Stockholm',
  } = options;

  const offset = page * limit;

  try {
    let result;

    if (EVENTS_API_URL) {
      try {
        result = await fetchFromWrapper({ limit, offset, days, source, city });
        result.metadata = {
          ...result.metadata,
          data_source: 'wrapper',
          wrapper_url: EVENTS_API_URL,
        };
      } catch (wrapperError) {
        console.warn('[EventService] Wrapper failed, using canonical Supabase:', wrapperError.message);
        result = await fetchFromCanonical({ limit, offset, days, source, city });
        result.metadata = {
          ...result.metadata,
          fallback_used: true,
          wrapper_error: wrapperError.message,
        };
      }
    } else {
      result = await fetchFromCanonical({ limit, offset, days, source, city });
    }

    return {
      events: result.events || [],
      sources: result.sources || [],
      source_counts: result.source_counts || {},
      count: result.count || 0,
      total_published_events: result.total_published_events || 0,
      metadata: result.metadata || {
        data_source: result.data_source || 'supabase',
        total_count: result.total_published_events || 0,
      },
    };
  } catch (error) {
    console.error('[EventService] fetch failed:', error.message);
    return {
      events: [],
      sources: [],
      source_counts: {},
      count: 0,
      total_published_events: 0,
      metadata: { error: error.message },
    };
  }
}

export const fetchFromSupabase = fetchEvents;
export const fetchEventsSupabaseOnly = fetchEvents;
export const fetchEventsWithFallback = fetchEvents;
export const fetchAllEventsViaServer = fetchEvents;

export { PAGE_SIZE };
