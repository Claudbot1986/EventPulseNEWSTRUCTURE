/**
 * 09-DiscoveryAgent/tests/exaLookup.test.ts — Per-source Exa URL discovery (Fas 4).
 *
 * Covers:
 *  - buildQueries: name + host extraction, suffix stripping
 *  - safeHost: www normalization, lowercase, invalid input
 *  - lookupSourceUrl: graceful empty when EXA_API_KEY missing
 *  - lookupSourceUrl: same-domain filter, dedup, skip-own-url
 *  - lookupSourceUrl: HTTP error → empty urls, error set
 *  - lookupSourceUrl: multiple queries → results concatenated, dedup applied
 *
 * Network is mocked via global fetch — no live Exa calls.
 */

import { test, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  buildQueries,
  lookupSourceUrl,
  safeHost,
} from '../exaLookup.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  })) as unknown as typeof fetch;
}

function mockFetchSequence(bodies: Array<{ body: unknown; status?: number }>): void {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const next = bodies[i++] ?? bodies[bodies.length - 1];
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      statusText: next.status === 200 ? 'OK' : 'Error',
      json: async () => next.body,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, EXA_API_KEY: 'test-key' };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

// ─── buildQueries ──────────────────────────────────────────────────────────

test('buildQueries → includes name+evenemang and site:host query', () => {
  const queries = buildQueries({ id: 'riks', url: 'https://riksarkivet.se/evenemang', name: 'Riksarkivet' });
  expect(queries).toContain('Riksarkivet evenemang kalender');
  expect(queries).toContain('Riksarkivet program foreställning');
  expect(queries.some((q) => q.includes('site:riksarkivet.se'))).toBe(true);
});

test('buildQueries → strips AB/HB/KB suffix from name', () => {
  const queries = buildQueries({ id: 'abc', url: 'https://abc.se/', name: 'Evenemangsföretaget AB' });
  expect(queries[0]).toBe('Evenemangsföretaget evenemang kalender');
});

test('buildQueries → falls back to host query when name missing', () => {
  const queries = buildQueries({ id: 'x', url: 'https://example.com/' });
  expect(queries.some((q) => q.includes('site:example.com'))).toBe(true);
  expect(queries.length).toBeGreaterThanOrEqual(1);
});

test('buildQueries → strips parenthetical content', () => {
  const queries = buildQueries({ id: 'k', url: 'https://konserthuset.se/', name: 'Konserthuset (Stockholm)' });
  expect(queries[0]).toBe('Konserthuset evenemang kalender');
});

// ─── safeHost ──────────────────────────────────────────────────────────────

test('safeHost → strips www and lowercases', () => {
  expect(safeHost('https://WWW.Riksarkivet.se/evenemang')).toBe('riksarkivet.se');
});

test('safeHost → null for invalid url', () => {
  expect(safeHost('not a url')).toBeNull();
  expect(safeHost('')).toBeNull();
});

test('safeHost → keeps port-stripped host', () => {
  // URL.host includes port only if non-default; for https it's stripped.
  expect(safeHost('https://example.com/path')).toBe('example.com');
});

// ─── lookupSourceUrl: graceful empty ───────────────────────────────────────

test('lookupSourceUrl → empty result when EXA_API_KEY missing', async () => {
  delete process.env.EXA_API_KEY;
  // Spy first so we can assert it wasn't called.
  const spy = vi.fn();
  globalThis.fetch = spy as unknown as typeof fetch;
  const r = await lookupSourceUrl({ id: 'x', url: 'https://example.com/' });
  expect(r.urls).toEqual([]);
  expect(r.exaAvailable).toBe(false);
  expect(r.error).toContain('EXA_API_KEY');
  expect(spy).not.toHaveBeenCalled();
});

test('lookupSourceUrl → empty result when EXA_API_KEY empty string', async () => {
  process.env.EXA_API_KEY = '   ';
  const r = await lookupSourceUrl({ id: 'x', url: 'https://example.com/' });
  expect(r.urls).toEqual([]);
  expect(r.exaAvailable).toBe(false);
});

// ─── lookupSourceUrl: same-domain filter ───────────────────────────────────

test('lookupSourceUrl → returns only same-domain URLs', async () => {
  mockFetchSequence([
    {
      body: {
        results: [
          { url: 'https://riksarkivet.se/kalendarium', title: 'Kalendarium' },
          { url: 'https://other-domain.se/evenemang', title: 'Other' },
          { url: 'https://www.riksarkivet.se/kalender', title: 'Kalender' },
        ],
      },
    },
  ]);

  const r = await lookupSourceUrl({
    id: 'riks',
    url: 'https://riksarkivet.se/evenemang',
    name: 'Riksarkivet',
  });

  expect(r.urls).toContain('https://riksarkivet.se/kalendarium');
  expect(r.urls).toContain('https://www.riksarkivet.se/kalender');
  expect(r.urls).not.toContain('https://other-domain.se/evenemang');
});

test('lookupSourceUrl → skips the source own URL', async () => {
  mockFetchSequence([
    {
      body: {
        results: [
          { url: 'https://riksarkivet.se/evenemang', title: 'Same as source' },
          { url: 'https://riksarkivet.se/kalendarium', title: 'Better path' },
        ],
      },
    },
  ]);

  const r = await lookupSourceUrl({
    id: 'riks',
    url: 'https://riksarkivet.se/evenemang',
    name: 'Riksarkivet',
  });

  expect(r.urls).toEqual(['https://riksarkivet.se/kalendarium']);
});

test('lookupSourceUrl → dedups URLs across queries', async () => {
  // First query returns a URL, second query returns the same URL plus a new one.
  mockFetchSequence([
    { body: { results: [{ url: 'https://x.se/kal' }] } },
    { body: { results: [{ url: 'https://x.se/kal' }, { url: 'https://x.se/program' }] } },
  ]);

  const r = await lookupSourceUrl({ id: 'x', url: 'https://x.se/evenemang' });

  expect(r.urls).toEqual(['https://x.se/kal', 'https://x.se/program']);
});

test('lookupSourceUrl → respects maxUrls cap', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    url: `https://x.se/page-${i}`,
  }));
  mockFetchSequence([{ body: { results: many } }]);

  const r = await lookupSourceUrl({ id: 'x', url: 'https://x.se/' }, { maxUrls: 2 });

  expect(r.urls).toHaveLength(2);
});

test('lookupSourceUrl → empty urls when Exa returns cross-domain only', async () => {
  mockFetchSequence([
    {
      body: {
        results: [
          { url: 'https://foreign1.se/x' },
          { url: 'https://foreign2.se/y' },
        ],
      },
    },
  ]);

  const r = await lookupSourceUrl({ id: 'x', url: 'https://source.se/' });
  expect(r.urls).toEqual([]);
  expect(r.exaAvailable).toBe(true);
  expect(r.error).toBeUndefined();
});

// ─── lookupSourceUrl: error paths ──────────────────────────────────────────

test('lookupSourceUrl → returns error on HTTP 500', async () => {
  mockFetchOnce({}, 500);

  const r = await lookupSourceUrl({ id: 'x', url: 'https://x.se/' });
  expect(r.urls).toEqual([]);
  expect(r.exaAvailable).toBe(true);
  expect(r.error).toContain('HTTP 500');
});

test('lookupSourceUrl → tolerates malformed Exa response (no results field)', async () => {
  mockFetchOnce({ unexpected: 'shape' });

  const r = await lookupSourceUrl({ id: 'x', url: 'https://x.se/' });
  expect(r.urls).toEqual([]);
  expect(r.rawHitCount).toBe(0);
});

test('lookupSourceUrl → skips entries with non-string url', async () => {
  mockFetchSequence([
    {
      body: {
        results: [
          { url: 42, title: 'malformed' },
          { url: 'https://x.se/ok' },
        ],
      },
    },
  ]);

  const r = await lookupSourceUrl({ id: 'x', url: 'https://x.se/' });
  expect(r.urls).toEqual(['https://x.se/ok']);
});

// ─── lookupSourceUrl: queries echoed for audit ─────────────────────────────

test('lookupSourceUrl → echoes queries in result', async () => {
  mockFetchSequence([
    { body: { results: [] } },
    { body: { results: [] } },
    { body: { results: [] } },
  ]);

  const r = await lookupSourceUrl({
    id: 'x',
    url: 'https://x.se/evenemang',
    name: 'X Konserthus',
  });

  expect(r.queries.length).toBeGreaterThanOrEqual(2);
  expect(r.queries.some((q) => q.includes('evenemang kalender'))).toBe(true);
});
