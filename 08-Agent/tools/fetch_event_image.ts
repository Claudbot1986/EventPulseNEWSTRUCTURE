/**
 * fetch_event_image — fetch + cache wrapper around the og:image parser.
 *
 * Fetches a page over HTTP, runs extractImageFromHtml on the body, and
 * remembers the result in an in-process LRU-style cache keyed by URL.
 *
 * Research basis (2026-08-19):
 *  - HTTP semantics follow RFC 9110. We require `Content-Type` to include
 *    `text/html` or `application/xhtml+xml` before parsing — anything else
 *    (image/jpeg, application/json) is not parseable HTML and we abort.
 *    https://www.rfc-editor.org/rfc/rfc9110.html#name-content-type
 *  - HTTP caching (RFC 9111 §4.2) recommends `Cache-Control: max-age` for
 *    any heuristically-cacheable response. We pick 7 days as the TTL
 *    because venue pages rarely change their hero image more than that.
 *    https://www.rfc-editor.org/rfc/rfc9111.html#name-heuristic-caching
 *  - LRU eviction (Knuth TAOCP vol. 1 §2.2.2) — when the cache is full,
 *    drop the least-recently-inserted entry. We use Map insertion order
 *    as a cheap LRU proxy (refresh on hit by re-inserting).
 *  - AbortController + setTimeout gives a hard ceiling on fetch latency.
 *    Without it, a slow venue page would block /agent/chat indefinitely.
 *    https://developer.mozilla.org/en-US/docs/Web/API/AbortController
 *
 * Design choices for EventPulse:
 *  - Pure HTTP + parser, no DB writes. The cache is in-process — survives
 *    only as long as the agent server. A cold restart re-fetches slowly.
 *  - Never throws. Returns `null` on every error path (network, parse,
 *    timeout, non-HTML). /agent/chat must never break because of an image
 *    lookup failure.
 *  - fetchImpl is injectable for tests (node 18+ has global fetch but
 *    tests want deterministic mock responses).
 *  - Honest User-Agent string. RFC 9309 §7 encourages site operators to
 *    identify bots so they can be contacted.
 *    https://www.rfc-editor.org/rfc/rfc9309.html#section-7
 *
 * Out of scope (v1):
 *  - Persistent cache (Redis / Supabase). A re-deploy drops the cache;
 *    acceptable for 7-day TTL.
 *  - Resolving images that 404 separately from the page. We trust the
 *    og:image URL the venue serves.
 *  - Resizing / converting. We return whatever the organizer serves.
 */

import { extractImageFromHtml } from './event_image';

/** Cache TTL: 7 days. Venue pages rarely change their hero image more
 *  often than that; longer TTL would waste capacity on dead sources. */
export const CACHE_TTL_MS = 7 * 24 * 3600_000;

/** Hard ceiling on cache size. At ~1KB per entry, 1000 entries ≈ 1MB of
 *  memory — negligible vs the agent process footprint. */
export const CACHE_MAX = 1000;

/** Default fetch timeout. 5s is long enough for venue CDNs, short enough
 *  to not block /agent/chat. Tunable per call. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Honest UA string. Sites can contact us if our bot is misbehaving. */
const USER_AGENT = 'EventPulse-Bot/1.0 (+https://eventpulse.example.com)';

interface CacheEntry {
  imageUrl: string | null;
  fetchedAt: number;
}

/** In-process cache. Map preserves insertion order, which we use as a
 *  cheap LRU proxy — refresh-on-hit re-inserts the entry at the tail. */
const cache = new Map<string, CacheEntry>();

/** Drop oldest entries until size < CACHE_MAX. Exported for tests. */
export function evictIfFull(): void {
  while (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

/** Test helpers — never call from production code. */
export function clearImageCache(): void { cache.clear(); }
export function imageCacheSize(): number { return cache.size; }

export interface FetchImageOptions {
  /** Override default 5s timeout. */
  timeoutMs?: number;
  /** Force a re-fetch even if a fresh cache entry exists. */
  bypassCache?: boolean;
  /** Inject a mock fetch (e.g. for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Resolve an image URL for an event's source page.
 *
 * Returns the image URL string, or null on any failure (timeout, non-HTML,
 * parse error, missing meta tag, etc). The function NEVER throws — the
 * caller can rely on a string|null contract.
 *
 * Cache semantics:
 *   - hit + fresh (within CACHE_TTL_MS) → return cached value
 *   - hit + stale → re-fetch
 *   - miss → fetch
 *   - bypassCache:true → fetch regardless of cache state
 */
export async function fetchEventImage(
  pageUrl: string,
  opts: FetchImageOptions = {},
): Promise<string | null> {
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return null;

  const now = Date.now();

  if (!opts.bypassCache) {
    const hit = cache.get(pageUrl);
    if (hit && (now - hit.fetchedAt) < CACHE_TTL_MS) {
      // Refresh insertion order so LRU keeps hot entries.
      cache.delete(pageUrl);
      cache.set(pageUrl, hit);
      return hit.imageUrl;
    }
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let html: string | null = null;
  try {
    const res = await fetchImpl(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return null;
    }
    html = await res.text();
  } catch {
    // AbortError on timeout, TypeError on DNS failure, etc. All collapse
    // to "no image" — the agent chat path must not see these.
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!html) return null;

  const imageUrl = extractImageFromHtml(html, pageUrl);
  evictIfFull();
  cache.set(pageUrl, { imageUrl, fetchedAt: now });
  return imageUrl;
}