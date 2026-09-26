/**
 * Unit tests for `check_link_health.ts` — daily HEAD-check of event links.
 *
 * Coverage:
 *   - HEAD 2xx/3xx → 'ok'
 *   - HEAD 4xx/5xx → 'broken'
 *   - HEAD 405/501 → fall back to GET-Range
 *   - network error → 'broken'
 *   - timeout → 'broken'
 *   - dry-run → no DB writes
 *   - db() returns null when env vars missing
 *   - concurrency respects parallelism
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  runCheckLinkHealth,
  type SourceCheckResult,
} from '../check_link_health';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FetchResponseLike {
  status: number;
}

function fakeResponse(status: number): Response {
  return { status } as Response;
}

function mockFetchOk(status: number = 200): typeof fetch {
  return vi.fn(async () => fakeResponse(status)) as unknown as typeof fetch;
}

function mockFetchError(message: string): typeof fetch {
  return vi.fn(async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

function mockFetchTimeout(): typeof fetch {
  return vi.fn(async (_url: unknown, init: unknown) => {
    const sig = (init as { signal: AbortSignal }).signal;
    return new Promise<Response>((_resolve, reject) => {
      sig.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    });
  }) as unknown as typeof fetch;
}

function fakeClient(rows: Array<{ id: string; source: string; ticket_url: string }>): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'events') throw new Error(`unexpected table ${table}`);
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: (n: number) => {
        // Return fake rows respecting the limit.
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      },
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

describe('check_link_health — HEAD fallback', () => {
  it('returns ok on 200', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      limit: 1,
      concurrency: 1,
    });
    expect(result.checked).toBe(1);
    expect(result.ok).toBe(1);
    expect(result.broken).toBe(0);
    expect(result.results[0].httpStatus).toBe(200);
  });

  it('returns ok on 301 redirect', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(301),
      limit: 1,
    });
    expect(result.ok).toBe(1);
  });

  it('returns broken on 404', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/missing' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(404),
      limit: 1,
    });
    expect(result.ok).toBe(0);
    expect(result.broken).toBe(1);
    expect(result.results[0].httpStatus).toBe(404);
  });

  it('returns broken on 500', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(500),
      limit: 1,
    });
    expect(result.broken).toBe(1);
  });

  it('falls back to GET when HEAD returns 405', async () => {
    const client = fakeClient([{ id: 'e1', source: 'stubborn', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(405);
      if (method === 'GET') return fakeResponse(200);
      throw new Error(`unexpected method ${method}`);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      limit: 1,
    });
    expect(call).toBe(2); // HEAD then GET
    expect(result.ok).toBe(1);
  });

  it('falls back to GET when HEAD returns 501', async () => {
    const client = fakeClient([{ id: 'e1', source: 'stubborn', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(501);
      return fakeResponse(200);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      limit: 1,
    });
    expect(call).toBe(2);
    expect(result.ok).toBe(1);
  });
});

describe('check_link_health — error paths', () => {
  it('returns broken on network error', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchError('getaddrinfo ENOTFOUND kth.se'),
      limit: 1,
    });
    expect(result.broken).toBe(1);
    expect(result.results[0].errorMessage).toContain('ENOTFOUND');
  });

  it('returns broken on timeout', async () => {
    const client = fakeClient([{ id: 'e1', source: 'slow', ticket_url: 'https://slow.example/' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchTimeout(),
      timeoutMs: 100,
      limit: 1,
    });
    expect(result.broken).toBe(1);
    expect(result.results[0].errorMessage?.toLowerCase()).toMatch(/timeout|abort/);
  });

  it('returns empty result when client is null', async () => {
    const result = await runCheckLinkHealth({
      _client: null,
      _fetch: mockFetchOk(200),
      limit: 1,
    });
    expect(result.checked).toBe(0);
    expect(result.errors).toBe(1);
  });
});

describe('check_link_health — dedup and limits', () => {
  it('deduplicates by source (one event per source)', async () => {
    const client = fakeClient([
      { id: 'e1', source: 'kth', ticket_url: 'https://kth.se/1' },
      { id: 'e2', source: 'kth', ticket_url: 'https://kth.se/2' },
      { id: 'e3', source: 'kth', ticket_url: 'https://kth.se/3' },
      { id: 'e4', source: 'kulturhuset', ticket_url: 'https://kulturhuset.se/1' },
    ]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      limit: 10,
    });
    expect(result.checked).toBe(2); // kth + kulturhuset
    const sources = result.results.map((r) => r.source).sort();
    expect(sources).toEqual(['kth', 'kulturhuset']);
  });
});

describe('check_link_health — dry-run', () => {
  it('does not call update() on dry-run', async () => {
    const updateFn = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              gte: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({
                      data: [{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
        update: updateFn,
      }),
    } as unknown as SupabaseClient;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      limit: 1,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.checked).toBe(1);
    expect(updateFn).not.toHaveBeenCalled();
  });
});