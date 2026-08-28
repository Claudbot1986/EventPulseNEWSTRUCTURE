/**
 * Billetto Stockholm adapter — billetto.se Stockholm city listing
 *
 * Site-specific pattern (verified 2026-08-21 from billetto.se/c/stockholm-l):
 *
 * - /c/{city}-l pages are SPA / Turbo-driven. Static HTML contains ZERO event
 *   data. Events arrive client-side via Alpine.js templates populated by
 *   Clerk.io ("recommendations/popular" with filter "city == "Stockholm" …"),
 *   and the static markup only carries `<template x-if="event.schema">`
 *   which renders a schema.org/Event JSON-LD block per event card.
 *   Fields available on each `event` object (from x-text bindings):
 *     - id, name_truncated, image, location, starts_at, ends_at
 *     - kind ('scheduled' | 'subscription')
 *     - organizer_id, organizer_image, badge, brand
 *     - schema (stringified JSON-LD blob injected at runtime)
 * - /c/{type}-{t} (categories like /c/concert-t, /c/festival-t) and
 *   /c/{type}-c and /c/{type}-c/{subtype}-sc follow the same pattern.
 * - /e/{slug} event detail pages render server-side and DO contain meta
 *   og:title / og:description / og:image, plus a JSON-LD Event block.
 * - Billetto requires a real browser User-Agent; direct server fetches with
 *   minimal UAs (curl/axios default) return HTTP 403.
 * - B-gate path per BACKLOG.md Stockholm Density Plan: rate-limit 1 req / 3s,
 *   UA = real Safari desktop, no bypass. The adapter here is the
 *   prioritisation hook for F-eventExtraction; the actual fetch happens at
 *   B-gate (or later C-renderGate when JS-render is required).
 *
 * Adapter is intentionally narrow (only billetto.se). Per CLAUDE.md
 * Generalization Protection Rule, site-specific quirks must not influence
 * C0/C1/C2 — they live here.
 *
 * This adapter exists so:
 *   1. `matches()` flags billetto.se URLs upstream so the orchestrator can
 *      apply correct fetch + render strategy (browser-style UA,
 *      JS-render-gate) instead of the text-extractor path.
 *   2. `extract()` parses the JSON-LD `<script type="application/ld+json">`
 *      blocks once Alpine has populated them — this is the path used by
 *      C-renderGate when it hands back the rendered DOM.
 *   3. City / category listing pages return `method: 'billetto-listings-static'`
 *      with empty events when no JSON-LD is found in the static HTML.
 *      This is the documented behaviour for sites where the events are
 *      fully client-rendered — no fake events are produced.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'billetto-stockholm-aggregator';
const CITY = 'Stockholm';

// Billetto only operates on billetto.se (and country TLDs like billetto.dk
// for Denmark, billetto.de for Germany, etc.). For our ingestion mandate we
// explicitly scope to billetto.se since the rest of EventPulse is
// Stockholm-only.
export const BILLETTO_HOSTNAMES = new Set([
  'billetto.se',
  'www.billetto.se',
]);

// Patterns Billetto uses for routing pages:
const CITY_LISTING_RE = /^\/c\/[a-z0-9_-]+-l\/?(?:\?|#|$)/i;
const CATEGORY_LISTING_RE = /^\/c\/[a-z0-9_-]+-[ct]\/?(?:\?|#|$)/i;
const EVENT_DETAIL_RE = /^\/e\/[a-z0-9_-]+\/?(?:\?|#|$)/i;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return BILLETTO_HOSTNAMES.has(u.hostname);
  } catch {
    return false;
  }
}

function isCityListing(url: string): boolean {
  try {
    const path = new URL(url).pathname + new URL(url).search;
    return CITY_LISTING_RE.test(path);
  } catch {
    return false;
  }
}

function isCategoryListing(url: string): boolean {
  try {
    const path = new URL(url).pathname + new URL(url).search;
    return CATEGORY_LISTING_RE.test(path);
  } catch {
    return false;
  }
}

function isEventDetail(url: string): boolean {
  try {
    const path = new URL(url).pathname + new URL(url).search;
    return EVENT_DETAIL_RE.test(path);
  } catch {
    return false;
  }
}

interface RawJsonLdEvent {
  '@type'?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string | string[];
  description?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
    geo?: { latitude?: string | number; longitude?: string | number };
  };
  organizer?: { name?: string; url?: string };
  offers?:
    | {
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
        url?: string;
      }
    | Array<{
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
        url?: string;
      }>;
  eventAttendanceMode?: string;
  eventStatus?: string;
}

function normalizeDatePart(s: string): string {
  // "2026-09-15T18:00" -> "2026-09-15"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function normalizeTimePart(s: string): string {
  // "2026-09-15T18:00:00+02:00" -> "18:00"
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function normalizeEndTimePart(s: string): string | undefined {
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

function parsePrice(offerPrice?: string | number): number | undefined {
  if (offerPrice === undefined || offerPrice === null) return undefined;
  const n = typeof offerPrice === 'string' ? parseFloat(offerPrice) : offerPrice;
  if (isNaN(n) || n < 0) return undefined;
  return Math.round(n);
}

function extractEventsFromJsonLd(
  data: RawJsonLdEvent,
  url: string
): ParsedEvent | null {
  const name = data.name;
  const start = data.startDate;
  if (!name || !start) return null;

  const loc = data.location || {};
  const venueName = loc.name || undefined;
  const locality = loc.address?.addressLocality;
  const country = loc.address?.addressCountry;

  // Stockholm-only mandate: only skip when we have a non-Stockholm marker.
  // Default to CITY when locality is absent (Billetto's /c/stockholm-l page
  // already filters server-side; any event that reaches us is Stockholm).
  let city: string | undefined;
  if (locality) {
    if (!/stockholm/i.test(locality)) return null;
    city = locality;
  } else if (country === 'SE') {
    city = CITY;
  } else {
    // No explicit locality and not SE — accept with Stockholm default since
    // we are routed from /c/stockholm-l
    city = CITY;
  }

  const date = normalizeDatePart(start);
  const time = normalizeTimePart(start);
  const endDate = data.endDate ? normalizeDatePart(data.endDate) : undefined;
  const endTime = data.endDate ? normalizeEndTimePart(data.endDate) : undefined;

  const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
  const priceMin = parsePrice(offer?.price);

  const address =
    [loc.address?.streetAddress, loc.address?.postalCode, loc.address?.addressLocality]
      .filter(Boolean)
      .join(', ') || undefined;

  const ticketUrl =
    (typeof offer?.url === 'string' && offer.url) ||
    (typeof data.url === 'string' && data.url) ||
    undefined;

  try {
    return ParsedEventSchema.parse({
      title: name,
      date,
      time: time || undefined,
      endDate,
      endTime,
      venue: venueName,
      address,
      city,
      priceMin,
      description:
        typeof data.description === 'string'
          ? data.description.slice(0, 500)
          : undefined,
      url: data.url || undefined,
      ticketUrl,
      imageUrl:
        typeof data.image === 'string'
          ? data.image
          : Array.isArray(data.image)
          ? data.image[0]
          : undefined,
      organizer: data.organizer?.name || undefined,
      source: SOURCE_ID,
      sourceUrl: url,
      confidence: {
        score: 0.85,
        hasTitle: true,
        hasDate: true,
        hasVenue: !!venueName,
        hasUrl: !!data.url,
        hasDescription: !!data.description,
        hasTicketInfo: priceMin !== undefined,
        signals: [
          'billetto-jsonld',
          isEventDetail(url) ? 'billetto-event-detail' : 'billetto-rendered-listing',
        ],
      },
    });
  } catch {
    return null;
  }
}

function parseJsonLdScripts(html: string, url: string): ParsedEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      return;
    }

    if (!data || typeof data !== 'object') return;
    const obj = data as { '@type'?: string; '@graph'?: unknown; subEvent?: unknown };
    const type = obj['@type'];

    if (type === 'Event') {
      const evt = extractEventsFromJsonLd(obj as RawJsonLdEvent, url);
      if (evt) events.push(evt);
      return;
    }

    if (Array.isArray(obj['@graph'])) {
      for (const node of obj['@graph']) {
        if (
          node &&
          typeof node === 'object' &&
          (node as RawJsonLdEvent)['@type'] === 'Event'
        ) {
          const evt = extractEventsFromJsonLd(node as RawJsonLdEvent, url);
          if (evt) events.push(evt);
        }
      }
      return;
    }

    if (type === 'EventSeries') {
      const series = data as {
        name?: string;
        url?: string;
        image?: string;
        description?: string;
        location?: RawJsonLdEvent['location'];
        subEvent?: RawJsonLdEvent | RawJsonLdEvent[];
      };
      const subs = Array.isArray(series.subEvent)
        ? series.subEvent
        : series.subEvent
        ? [series.subEvent]
        : [];
      for (const sub of subs) {
        const withDefaults: RawJsonLdEvent = { ...sub };
        if (!withDefaults.name && series.name) withDefaults.name = series.name;
        if (!withDefaults.url && series.url) withDefaults.url = series.url;
        if (!withDefaults.image && series.image)
          withDefaults.image = series.image;
        if (!withDefaults.description && series.description)
          withDefaults.description = series.description;
        if (!withDefaults.location && series.location)
          withDefaults.location = series.location;
        const evt = extractEventsFromJsonLd(withDefaults, url);
        if (evt) events.push(evt);
      }
    }
  });

  return events;
}

export interface BillettoStockholmExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method:
    | 'billetto-rendered-listing'
    | 'billetto-event-detail'
    | 'billetto-listings-static'
    | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): BillettoStockholmExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  // 1. JSON-LD scan — covers all rendered DOMs (Alpine-injected in listing
  //    pages, server-rendered on event detail pages).
  const events = parseJsonLdScripts(html, url);
  if (events.length > 0) {
    if (isEventDetail(url)) {
      return { showUrls: [], events, method: 'billetto-event-detail' };
    }
    return {
      showUrls: events.length > 0 ? [url] : [],
      events,
      method: 'billetto-rendered-listing',
    };
  }

  // 2. Event-detail fallback when JSON-LD is absent: we don't have a date,
  //    so we cannot construct a valid ParsedEvent (date is required). Signal
  //    the same way we do for under-rendered listing pages.
  if (isEventDetail(url)) {
    // No JSON-LD → no date. Be honest about missing data instead of
    // synthesising a fake date. Return listings-static to signal that the
    // orchestrator should try a render-gated fetch.
    return { showUrls: [], events: [], method: 'billetto-listings-static' };
  }

  // 3. Listing pages without rendered JSON-LD: signal render-gate needed.
  //    Do NOT invent events.
  if (isCityListing(url) || isCategoryListing(url)) {
    return { showUrls: [], events: [], method: 'billetto-listings-static' };
  }

  // 4. Other Billetto URLs (/organiser/*, /ticket_buyer/*, /, etc.)
  //    out of scope.
  return { showUrls: [], events: [], method: 'none' };
}
