/**
 * 02-Ingestion/tools/etagCache.test.ts
 *
 * P2B tester (2026-09-10): verifierar conditionalFetch + cache-beteende.
 * Använder node-fetch mock.
 *
 * Run: npx vitest run 02-Ingestion/tools/etagCache.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.join(__dirname, '../../runtime');
const CACHE_FILE = path.join(RUNTIME_DIR, 'etag-cache.json');

// ── Mocks ──────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Importera EFTER mock
const { conditionalFetch, refreshCache, getCacheStats } = await import('./etagCache.js');

beforeEach(() => {
  fetchMock.mockReset();
  if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE);
  if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('etagCache — conditionalFetch', () => {
  test('första fetch: 200, sparar etag + body-hash', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>hello</html>', {
      status: 200,
      headers: { 'etag': '"abc123"', 'last-modified': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    }));

    const result = await conditionalFetch('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.notModified).toBe(false);
    expect(result.body).toBe('<html>hello</html>');
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verifiera att If-None-Match skickades på nästa anrop
    const callHeaders = fetchMock.mock.calls[0][1].headers;
    // Första anrop: inga conditional headers
    expect(callHeaders['If-None-Match']).toBeUndefined();
  });

  test('andra fetch: 304, cacheHit=true, body tom', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>v1</html>', {
      status: 200,
      headers: { 'etag': '"v1"' },
    }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const r1 = await conditionalFetch('https://example.com');
    const r2 = await conditionalFetch('https://example.com');

    expect(r1.cacheHit).toBe(false);
    expect(r2.cacheHit).toBe(true);
    expect(r2.notModified).toBe(true);
    expect(r2.body).toBe('');

    // Andra anropet ska ha skickat If-None-Match
    const secondHeaders = fetchMock.mock.calls[1][1].headers;
    expect(secondHeaders['If-None-Match']).toBe('"v1"');
  });

  test('body-hash cache hit även utan ETag-stöd', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>same</html>', {
      status: 200,
      // Ingen etag-header
    }));
    fetchMock.mockResolvedValueOnce(new Response('<html>same</html>', {
      status: 200,
    }));

    const r1 = await conditionalFetch('https://example.com');
    const r2 = await conditionalFetch('https://example.com');

    expect(r1.cacheHit).toBe(false);
    expect(r2.cacheHit).toBe(true);
    expect(r2.body).toBe('<html>same</html>');
  });

  test('bypass=true → skippa conditional headers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>v1</html>', {
      status: 200,
      headers: { 'etag': '"x"' },
    }));
    fetchMock.mockResolvedValueOnce(new Response('<html>v2</html>', {
      status: 200,
      headers: { 'etag': '"x"' },
    }));

    await conditionalFetch('https://example.com');
    await conditionalFetch('https://example.com', { bypass: true });

    const secondHeaders = fetchMock.mock.calls[1][1].headers;
    expect(secondHeaders['If-None-Match']).toBeUndefined();
  });

  test('fetch-fel → error returneras, cache inte uppdaterad', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    const result = await conditionalFetch('https://example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network error');
    expect(result.statusCode).toBe(0);

    // Cache ska vara tom
    const stats = getCacheStats();
    expect(stats.entries).toBe(0);
  });
});

describe('etagCache — refreshCache (batch)', () => {
  test('refreshCache parallell med 5 URLs', async () => {
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(new Response(`<html>v${i}</html>`, {
        status: 200,
        headers: { 'etag': `"e${i}"` },
      }));
    }

    const stats = await refreshCache(
      ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com'],
      3,
    );

    expect(stats.totalChecked).toBe(5);
    expect(stats.cacheMisses).toBe(5); // alla var första-fetch
    expect(stats.errors).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test('refreshCache räknar cacheHits korrekt', async () => {
    // Första fetch: 200 med etag
    fetchMock.mockResolvedValueOnce(new Response('<html>v1</html>', {
      status: 200,
      headers: { 'etag': '"v1"' },
    }));
    // Andra fetch: 304 (cache hit)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const stats1 = await refreshCache(['https://x.com'], 1);
    const stats2 = await refreshCache(['https://x.com'], 1);

    expect(stats1.cacheMisses).toBe(1);
    expect(stats2.cacheHits).toBe(1);
  });
});
