/**
 * event_image — fallback image extraction from event source pages.
 *
 * Many events in events_public have NULL image_url. For the magic-slice
 * UI cards, an image dramatically increases engagement. This module
 * extracts an image URL from the event's source page as a fallback.
 *
 * Research basis (2026-08-19):
 *  - Open Graph Protocol (ogp.me). The canonical meta tags social
 *    platforms use. Most venue/organizer sites populate og:image for
 *    Facebook/Twitter/LinkedIn sharing, so it's the highest-yield
 *    fallback. https://ogp.me/#structured
 *  - schema.org/Event JSON-LD. Many sites embed structured Event data
 *    via <script type="application/ld+json">. The .image property can
 *    be a string URL, an ImageObject, or an array. https://schema.org/Event
 *  - Twitter Cards specification (developer.twitter.com/en/docs/twitter-for-websites/cards/overview/markup)
 *    Fallback when og:image is absent.
 *
 * Design choices for EventPulse:
 *  - Pure parsing function in event_image.ts (testable, no I/O).
 *  - Priority order: og:image > og:image:url > twitter:image > JSON-LD Event.image.
 *    og:image wins because it's the most universal signal.
 *  - Resolve relative URLs against the page URL (organizers sometimes use
 *    /img/foo.jpg instead of full URLs).
 *  - Reject URLs that don't look like images (file extension or og:type=image).
 *  - Never throw — return null on parse failure. /agent/chat must not break.
 *
 * Status 2026-08-25: previously wrapped by fetch_event_image.ts for og:image
 * runtime fallback. That wrapper is removed (källbilder är inte längre
 * tillåtna — alla bilder är AI-genererade). This parser is kept for tests
 * and potential future safe-by-design use (e.g. trusted internal sources).
 *
 * Out of scope (v1):
 *  - Vision-language model image selection (picks best of N images on page).
 *  - Image URL rewriting to a CDN. We trust whatever the organizer serves.
 *  - Storing the resolved image back to events_public. Add later if we
 *    want the fallback to persist across cache restarts.
 */

import * as cheerio from 'cheerio';

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Allowed image file extensions. Sites occasionally link to HTML pages
 *  as og:image by mistake; this catches those. */
const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i;

/** Reject URLs that don't look like absolute http(s). We don't follow
 *  data: URIs (privacy risk, large payloads) or protocol-relative URLs. */
function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

// ─── Pure parsing ───────────────────────────────────────────────────────────

/**
 * Resolve a possibly-relative URL against a base URL. Returns null on
 * failure (relative URL with no base, invalid URL, etc).
 */
export function resolveUrl(maybe: string, base?: string): string | null {
  if (!maybe) return null;
  // Already absolute http(s).
  if (isHttpUrl(maybe)) return maybe;
  if (!base) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

/**
 * Does this URL look like it points to an image? We require either a
 * recognized image file extension OR an og:type=image marker. We do NOT
 * trust URLs without either — sites occasionally point og:image at
 * landing pages, which would render broken in the card.
 */
export function looksLikeImage(url: string): boolean {
  return IMAGE_EXTS.test(url);
}

/** Pick the first non-empty meta content matching one of the given
 *  property OR name attribute values. */
function pickMeta(
  $: cheerio.CheerioAPI,
  attrs: Array<{ prop?: string; name?: string }>,
): string | null {
  for (const { prop, name } of attrs) {
    let found: string | null = null;
    if (prop) {
      found = $(`meta[property="${prop}"]`).attr('content')?.trim() ?? null;
    }
    if (!found && name) {
      found = $(`meta[name="${name}"]`).attr('content')?.trim() ?? null;
    }
    if (found) return found;
  }
  return null;
}

/**
 * Walk a parsed JSON-LD graph and find any value at key `image`.
 * Handles the schema.org spec: image can be a string URL, an
 * ImageObject {url}, or an array of either. Respects @graph.
 */
function findImageInJsonLd(node: unknown, depth: number = 0): string | null {
  if (depth > 5) return null; // cycle guard
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageInJsonLd(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  // Direct image field
  if (typeof obj.image === 'string') return obj.image;
  if (Array.isArray(obj.image) && typeof obj.image[0] === 'string') {
    return obj.image[0] as string;
  }
  if (obj.image && typeof obj.image === 'object') {
    const img = obj.image as Record<string, unknown>;
    if (typeof img.url === 'string') return img.url;
  }

  // Walk @graph (schema.org convention for connected nodes)
  if (Array.isArray(obj['@graph'])) {
    return findImageInJsonLd(obj['@graph'], depth + 1);
  }

  return null;
}

/**
 * Extract an image URL from a page's HTML. Pure function — no I/O,
 * no network. The caller passes already-fetched HTML.
 *
 * Priority:
 *   1. <meta property="og:image" content="...">
 *   2. <meta property="og:image:url" content="...">
 *   3. <meta name="twitter:image" content="...">
 *   4. JSON-LD <script type="application/ld+json"> with Event.image
 *
 * Returns the absolute URL (resolved against `pageUrl` if needed) or
 * null if no image was found.
 */
export function extractImageFromHtml(
  html: string,
  pageUrl?: string,
): string | null {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }

  // 1-3. Open Graph + Twitter cards. Try in priority order.
  const metaCandidate = pickMeta($, [
    { prop: 'og:image' },
    { prop: 'og:image:url' },
    { name: 'twitter:image' },
    { name: 'twitter:image:src' },
  ]);
  if (metaCandidate) {
    const resolved = resolveUrl(metaCandidate, pageUrl);
    if (resolved && looksLikeImage(resolved)) return resolved;
    // Some sites serve og:image without a file extension (rare but
    // happens with signed CDN URLs). Fall through to JSON-LD rather
    // than returning a non-image — JSON-LD is usually more reliable.
  }

  // 4. JSON-LD Event.image
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    const raw = $(el).contents().text();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidate = findImageInJsonLd(parsed);
    if (!candidate) continue;
    const resolved = resolveUrl(candidate, pageUrl);
    if (resolved && looksLikeImage(resolved)) return resolved;
  }

  return null;
}
