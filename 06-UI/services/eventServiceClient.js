/**
 * Event Service Client — same read path as wrapper :7777 / eventsCanonical.js
 */

import { fetchCanonicalEvents, countPublishedEvents } from './eventsCanonical.js';

export const PAGE_SIZE = 200;

const EVENTS_API_URL =
  process.env.EXPO_PUBLIC_EVENTS_API_URL ||
  process.env.EXPO_PUBLIC_WRAPPER_URL ||
  '';

/** Fetch total published count once — not tied to pagination */
export async function fetchPublishedEventTotal() {
  const base = EVENTS_API_URL.replace(/\/$/, '');
  if (base) {
    try {
      const response = await fetch(`${base}/health`, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.total_published_events === 'number' && data.total_published_events > 0) {
          return data.total_published_events;
        }
      }
    } catch (error) {
      console.warn('[EventService] wrapper health failed:', error.message);
    }
  }

  return countPublishedEvents();
}

async function fetchFromWrapper({ limit, offset, source, city }) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
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

export async function fetchEvents(options = {}) {
  const {
    page = 0,
    limit = PAGE_SIZE,
    source = null,
    city = 'Stockholm',
    skipTotalCount = page > 0,
  } = options;
  const offset = page * limit;

  try {
    let result;

    if (EVENTS_API_URL) {
      try {
        result = await fetchFromWrapper({ limit, offset, source, city });
        if (skipTotalCount) {
          delete result.total_published_events;
        }
      } catch (wrapperError) {
        console.warn('[EventService] Wrapper failed, using Supabase:', wrapperError.message);
        result = await fetchCanonicalEvents({ limit, offset, source, city, skipTotalCount });
        result.metadata = { fallback_used: true, wrapper_error: wrapperError.message };
      }
    } else {
      result = await fetchCanonicalEvents({ limit, offset, source, city, skipTotalCount });
    }

    return {
      events: result.events || [],
      sources: result.sources || [],
      source_counts: result.source_counts || {},
      count: result.count || 0,
      total_published_events: result.total_published_events,
      metadata: result.metadata || {},
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
