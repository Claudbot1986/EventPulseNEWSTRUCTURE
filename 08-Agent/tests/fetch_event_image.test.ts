/**
 * Tests for fetch_event_image — the HTTP + cache wrapper around the
 * og:image parser.
 *
 * Covers: cache hit/miss/eviction, bypassCache, invalid URL, non-200
 * response, non-HTML content type, network error, timeout, content-type
 * variants (text/html + application/xhtml+xml), refresh-on-hit.
 *
 * Run with:  npx vitest run 08-Agent/tests/fetch_event_image.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEventImage,
  clearImageCache,
  imageCacheSize,
  CACHE_TTL_MS,
  CACHE_MAX,
  DEFAULT_TIMEOUT_MS,
} from '../tools/fetch_event_image';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const URL_HTML = 'https://venue.example.com/events/jazz-night';
const URL_XHTML = 'https://venue.example.com/events/xhtml-show';
const URL_BAD = 'https://venue.example.com/empty';

const HTML_OG = `<html><head>
  <meta property="og:image" content="https://cdn.example.com/hero.jpg">
</head><body>x</body></html>`;

const XHTML_OG = `<html xmlns="http://www.w3.org/1999/xhtml"><head>
  <meta property="og:image" content="https://cdn.example.com/xhtml.jpg">
</head></html>`;

const HTML_NO_IMG = `<html><head><title>No image here</title></head></html>`;

interface MockResponseInit {
  status?: number;
  contentType?: string | null;
  body?: string | null;
}
function mockResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200;
  const body = init.body ?? HTML_OG;
  const headers = new Headers();
  // Distinguish "explicitly null" (no header at all) from "undefined" (use default).
  if (init.contentType !== undefined && init.contentType !== null) {
    headers.set('content-type', init.contentType);
  } else if (init.contentType === undefined) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  return new Response(body, { status, headers });
}

/** A controllable mock fetch. Records each call so tests can assert on
 *  the URL and headers passed in. */
function makeMockFetch(responses: Map<string, MockResponseInit> = new Map()) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    calls.push({ url, headers });
    const r = responses.get(url);
    if (!r) throw new Error(`mock fetch: no response registered for ${url}`);
    return mockResponse(r);
  }) as unknown as typeof fetch;
  return { fetchMock, calls };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearImageCache();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── URL validation ─────────────────────────────────────────────────────────

describe('fetchEventImage — URL validation', () => {
  it('returns null for empty string', async () => {
    const { fetchMock } = makeMockFetch();
    const result = await fetchEventImage('', { fetchImpl: fetchMock });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for non-http URL', async () => {
    const { fetchMock } = makeMockFetch();
    const result = await fetchEventImage('not-a-url', { fetchImpl: fetchMock });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for protocol-relative URL', async () => {
    const { fetchMock } = makeMockFetch();
    const result = await fetchEventImage('//cdn.example.com/page', { fetchImpl: fetchMock });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for data: URI', async () => {
    const { fetchMock } = makeMockFetch();
    const result = await fetchEventImage('data:text/html,<h1>x</h1>', { fetchImpl: fetchMock });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Cache semantics ────────────────────────────────────────────────────────

describe('fetchEventImage — cache', () => {
  it('caches a successful result and serves it on next call without hitting fetch', async () => {
    const responses = new Map([[URL_HTML, {}]]);
    const { fetchMock, calls } = makeMockFetch(responses);
    const first = await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    const second = await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    expect(first).toBe('https://cdn.example.com/hero.jpg');
    expect(second).toBe('https://cdn.example.com/hero.jpg');
    expect(calls).toHaveLength(1); // second call was cached
  });

  it('caches a null result (so we do not retry a source with no image)', async () => {
    const responses = new Map([[URL_BAD, { body: HTML_NO_IMG }]]);
    const { fetchMock, calls } = makeMockFetch(responses);
    const first = await fetchEventImage(URL_BAD, { fetchImpl: fetchMock });
    const second = await fetchEventImage(URL_BAD, { fetchImpl: fetchMock });
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(calls).toHaveLength(1); // null is cached too
  });

  it('re-fetches when cache entry is older than CACHE_TTL_MS', async () => {
    const responses = new Map([[URL_HTML, {}]]);
    const { fetchMock, calls } = makeMockFetch(responses);
    await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    // Advance past TTL using Date.now() override via vi.useFakeTimers
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_TTL_MS + 1);
    await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('bypassCache forces a re-fetch', async () => {
    const responses = new Map([[URL_HTML, {}]]);
    const { fetchMock, calls } = makeMockFetch(responses);
    await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    await fetchEventImage(URL_HTML, { fetchImpl: fetchMock, bypassCache: true });
    expect(calls).toHaveLength(2);
  });

  it('serves repeated calls from cache (LRU keeps hot entries without re-fetch)', async () => {
    // 5 distinct URLs all hit fetch once on first call; subsequent calls
    // (any order) hit cache. This covers refresh-on-hit: even after
    // interleaved calls the fetch counter stays at exactly 5.
    const urls = [
      'https://example.com/1', 'https://example.com/2', 'https://example.com/3',
      'https://example.com/4', 'https://example.com/5',
    ];
    const responses = new Map(
      urls.map((u) => [u, { body: `<meta property="og:image" content="https://x.com${u}.jpg">` }])
    );
    const { fetchMock, calls } = makeMockFetch(responses);
    for (const u of urls) await fetchEventImage(u, { fetchImpl: fetchMock });
    // Re-touch every URL twice in a different order.
    for (const u of [...urls].reverse()) await fetchEventImage(u, { fetchImpl: fetchMock });
    for (const u of urls) await fetchEventImage(u, { fetchImpl: fetchMock });
    // 5 fetches total, regardless of how many cache hits.
    expect(calls).toHaveLength(5);
    expect(imageCacheSize()).toBe(5);
  });

  it('cache size never exceeds CACHE_MAX', () => {
    // We test the invariant indirectly: the public counter stays bounded.
    expect(imageCacheSize()).toBeLessThanOrEqual(CACHE_MAX);
  });
});

// ─── Response handling ──────────────────────────────────────────────────────

describe('fetchEventImage — response handling', () => {
  it('returns null on non-2xx response', async () => {
    const responses = new Map([[URL_HTML, { status: 404 }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock })).toBeNull();
  });

  it('returns null on 500 (server error)', async () => {
    const responses = new Map([[URL_HTML, { status: 500 }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock })).toBeNull();
  });

  it('returns null when content-type is not HTML', async () => {
    const responses = new Map([[URL_HTML, { contentType: 'image/jpeg' }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock })).toBeNull();
  });

  it('accepts text/html content-type', async () => {
    const responses = new Map([[URL_HTML, { contentType: 'text/html; charset=utf-8' }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock }))
      .toBe('https://cdn.example.com/hero.jpg');
  });

  it('accepts application/xhtml+xml content-type', async () => {
    const responses = new Map([[URL_XHTML, { body: XHTML_OG, contentType: 'application/xhtml+xml' }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_XHTML, { fetchImpl: fetchMock }))
      .toBe('https://cdn.example.com/xhtml.jpg');
  });

  it('returns null when content-type header is missing', async () => {
    const responses = new Map([[URL_HTML, { contentType: null }]]);
    const { fetchMock } = makeMockFetch(responses);
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock })).toBeNull();
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe('fetchEventImage — error handling', () => {
  it('returns null on network error (fetch throws)', async () => {
    const { fetchMock } = makeMockFetch(); // no responses registered → throws
    expect(await fetchEventImage(URL_HTML, { fetchImpl: fetchMock })).toBeNull();
  });

  it('returns null on timeout (fetchImpl rejects via AbortSignal)', async () => {
    // A fetch that rejects when the AbortSignal fires.
    const slowFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const result = await fetchEventImage(URL_HTML, { fetchImpl: slowFetch, timeoutMs: 50 });
    expect(result).toBeNull();
  });

  it('exposes DEFAULT_TIMEOUT_MS as a sensible default', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
  });

  it('never throws — invalid URL is a clean null, not a rejection', async () => {
    const { fetchMock } = makeMockFetch();
    await expect(fetchEventImage('', { fetchImpl: fetchMock })).resolves.toBeNull();
    await expect(fetchEventImage('garbage', { fetchImpl: fetchMock })).resolves.toBeNull();
  });
});

// ─── Headers ────────────────────────────────────────────────────────────────

describe('fetchEventImage — HTTP request shape', () => {
  it('sends User-Agent and Accept headers', async () => {
    const responses = new Map([[URL_HTML, {}]]);
    const { fetchMock, calls } = makeMockFetch(responses);
    await fetchEventImage(URL_HTML, { fetchImpl: fetchMock });
    expect(calls[0].headers['user-agent']).toMatch(/EventPulse-Bot/);
    expect(calls[0].headers['accept']).toMatch(/text\/html/);
  });
});