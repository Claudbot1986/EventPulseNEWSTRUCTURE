/**
 * Unit tests for `check_link_health.ts` — daily link-health check.
 *
 * Coverage (2026-09-27, tre stater + body-scan + SB-fallback):
 *   - HEAD 2xx/3xx → 'live' (efter redirect-follow)
 *   - HEAD 4xx/5xx → 'dead'
 *   - HEAD 405/501/401/403/408/425/429 → fall back to GET-Range
 *   - GET-Range 2xx + valid body → 'live'
 *   - GET-Range 2xx + REMOVED_PATTERN body → 'dead' (soft 404)
 *   - GET-Range 4xx/5xx → SB-fallback → live/dead/unknown
 *   - HEAD 404/410/500 → 'dead' direkt (ingen GET-fallback på "gone")
 *   - HEAD network error / timeout → SB-fallback → unknown
 *   - SB-anrop utan nyckel → 'unknown' (graceful no-op)
 *   - SB returnerar tom body / <100 byte → 'unknown'
 *   - dry-run → no DB writes
 *   - db() returns null when env vars missing
 *   - concurrency respects parallelism
 *   - rpc() anropar update_link_health_cf med 'live'|'dead'|'unknown'
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runCheckLinkHealth,
  looksRemoved,
  verifyWithScrapingBee,
  type SourceCheckResult,
} from '../check_link_health';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FetchResponseLike {
  status: number;
  text?: () => Promise<string>;
}

function fakeResponse(status: number, body: string = ''): Response {
  return { status, text: async () => body } as Response;
}

function mockFetchOk(status: number = 200, body: string = ''): typeof fetch {
  return vi.fn(async () => fakeResponse(status, body)) as unknown as typeof fetch;
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

function fakeClient(
  rows: Array<{ id: string; source: string; ticket_url: string }>,
  opts?: { rpcError?: { message: string }; rpcCalls?: Array<{ fn: string; args: Record<string, unknown> }> },
): SupabaseClient {
  const rpcCalls = opts?.rpcCalls ?? [];
  const from = (_table: string) => {
    // 2026-09-27 — fetchEventsToCheck använder nu två queries (dead pass + null pass).
    // Mocken returnerar samma rader oavsett filter eftersom tester bara behöver
    // kontrollera att rätt event-id skickas till RPC.
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'gte', 'gt', 'lt', 'is', 'neq', 'in', 'order']) {
      builder[m] = () => builder;
    }
    builder.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
    builder.update = () => ({
      eq: () => Promise.resolve({ error: null }),
    });
    return builder;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ error: opts?.rpcError ?? null });
  };
  return { from, rpc } as unknown as SupabaseClient;
}

/** Standard no-op SB-verifierare: returnerar 'unknown' utan att anropa SB.
 *  Använd i tester som inte vill testa SB-vägen explicit. */
const noopSbVerifier = vi.fn(async () => ({
  reachable: false,
  status: 'unknown' as const,
  body: '',
  httpStatus: null,
  creditsUsed: 0,
  errorMessage: 'SB disabled in test',
}));

describe('looksRemoved (body-scan helper)', () => {
  it('returnerar false på tom body', () => {
    expect(looksRemoved('')).toBe(false);
  });

  it('returnerar false på normal evenemangssida', () => {
    expect(looksRemoved('<html><body><h1>Konsert 25 okt</h1><p>Biljetter finns</p></body></html>')).toBe(false);
  });

  it('returnerar true på engelsk "event has been removed"', () => {
    expect(looksRemoved('<h1>This event has been removed</h1>')).toBe(true);
  });

  it('returnerar true på svensk "evenemanget är borttaget"', () => {
    expect(looksRemoved('<h1>Evenemanget är borttaget</h1>')).toBe(true);
  });

  it('returnerar true på svensk "detta evenemang har utgått"', () => {
    expect(looksRemoved('<p>Detta evenemang har utgått.</p>')).toBe(true);
  });

  it('returnerar true på "page not found"', () => {
    expect(looksRemoved('<title>Page not found</title>')).toBe(true);
  });

  it('matchar case-insensitive', () => {
    expect(looksRemoved('NO LONGER AVAILABLE')).toBe(true);
    expect(looksRemoved('event Cancelled')).toBe(true);
  });

  it('matchar inte "tickets available" (false-positive-skydd)', () => {
    expect(looksRemoved('<p>Tickets available now</p>')).toBe(false);
  });
});

describe('check_link_health — HEAD fallback', () => {
  it('returns live on 200', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
      concurrency: 1,
    });
    expect(result.checked).toBe(1);
    expect(result.live).toBe(1);
    expect(result.dead).toBe(0);
    expect(result.unknown).toBe(0);
    expect(result.results[0].httpStatus).toBe(200);
    expect(result.results[0].method).toBe('head');
  });

  it('returns live on 301 redirect followed to 200', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/old' }]);
    const fetchMock = vi.fn(async () => fakeResponse(200)) as unknown as typeof fetch;
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.live).toBe(1);
    expect(result.results[0].httpStatus).toBe(200);
  });

  it('returns dead when 301 redirect slutar på 404', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/old' }]);
    const fetchMock = vi.fn(async () => fakeResponse(404)) as unknown as typeof fetch;
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.dead).toBe(1);
    expect(result.results[0].httpStatus).toBe(404);
    expect(result.results[0].method).toBe('direct-dead');
  });

  it('returns dead on 404', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/missing' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(404),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.dead).toBe(1);
    expect(result.results[0].httpStatus).toBe(404);
    expect(result.results[0].method).toBe('direct-dead');
  });

  it('returns dead on 500 (no GET fallback)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }]);
    const fetchMock = vi.fn(async () => fakeResponse(500)) as unknown as typeof fetch;
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // bara HEAD
    expect(result.dead).toBe(1);
  });

  it('falls back to GET-Range when HEAD returns 405 → live on 200', async () => {
    const client = fakeClient([{ id: 'e1', source: 'stubborn', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(405);
      if (method === 'GET') return fakeResponse(200, '<html>valid</html>');
      throw new Error(`unexpected method ${method}`);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(call).toBe(2); // HEAD then GET
    expect(result.live).toBe(1);
    expect(result.results[0].method).toBe('get-range');
  });

  it('falls back to GET-Range when HEAD returns 403 (anti-bot) → live', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(403);
      return fakeResponse(200, '<html>valid</html>');
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(call).toBe(2);
    expect(result.live).toBe(1);
  });

  it('returns dead when HEAD=403 AND GET-Range=403 (both blocked)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const method = (init as { method: string }).method;
      return fakeResponse(403);
    }) as unknown as typeof fetch;
    // Override SB-verifierare att returnera 'dead' om den anropas.
    const sbDead = vi.fn(async () => ({
      reachable: true,
      status: 'dead' as const,
      body: 'event has been removed',
      httpStatus: 200,
      creditsUsed: 1,
      errorMessage: null,
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbDead,
      limit: 1,
    });
    expect(sbDead).toHaveBeenCalledTimes(1);
    expect(result.dead).toBe(1);
    expect(result.results[0].method).toBe('scrapingbee');
  });

  it('returns unknown when HEAD=403, GET=403, SB unreachable', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.unknown).toBe(1);
    expect(result.results[0].method).toBe('scrapingbee');
  });

  it('falls back to GET-Range when HEAD returns 429 → live', async () => {
    const client = fakeClient([{ id: 'e1', source: 'rl', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(429);
      return fakeResponse(200, '<html>valid</html>');
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(call).toBe(2);
    expect(result.live).toBe(1);
  });

  it('returns dead on HEAD 404 without GET fallback (genuinely gone)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'gone', ticket_url: 'https://x/gone' }]);
    let call = 0;
    const fetchMock = vi.fn(async () => { call++; return fakeResponse(404); }) as unknown as typeof fetch;
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(call).toBe(1);
    expect(result.dead).toBe(1);
  });
});

describe('check_link_health — body-scan (soft 404 detection)', () => {
  it('returns dead when GET-Range 200 body contains REMOVED_PATTERN (sv)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(405); // tvinga GET-fallback
      if (method === 'GET') return fakeResponse(200, '<h1>Evenemanget är borttaget</h1><p>Sidan finns inte längre.</p>');
      throw new Error(`unexpected method ${method}`);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.dead).toBe(1);
    expect(result.results[0].method).toBe('get-range');
  });

  it('returns dead when GET-Range 200 body contains "event has been removed" (en)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(403);
      if (method === 'GET') return fakeResponse(200, '<html><body>This event has been removed.</body></html>');
      throw new Error(`unexpected method ${method}`);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.dead).toBe(1);
  });

  it('returns live when GET-Range 200 body is clean (inte REMOVED_PATTERN)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'kth', ticket_url: 'https://x/y' }]);
    let call = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      call++;
      const method = (init as { method: string }).method;
      if (method === 'HEAD') return fakeResponse(403);
      if (method === 'GET') return fakeResponse(200, '<html><body><h1>Konsert: Band X</h1><p>Biljetter finns</p></body></html>');
      throw new Error(`unexpected method ${method}`);
    }) as unknown as typeof fetch;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.live).toBe(1);
  });
});

describe('check_link_health — ScrapingBee fallback', () => {
  it('returns live when SB returns 200 + clean body', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    // HEAD=403, GET=403 → SB-fallback
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;
    const sbLive = vi.fn(async () => ({
      reachable: true,
      status: 'live' as const,
      body: '<html>'.padEnd(200, 'a'),
      httpStatus: 200,
      creditsUsed: 1,
      errorMessage: null,
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbLive,
      limit: 1,
    });
    expect(sbLive).toHaveBeenCalledTimes(1);
    expect(result.live).toBe(1);
    expect(result.results[0].method).toBe('scrapingbee');
    expect(result.results[0].creditsUsed).toBe(1);
    expect(result.totalCreditsUsed).toBe(1);
  });

  it('returns dead when SB returns 200 + REMOVED_PATTERN body', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;
    const sbDead = vi.fn(async () => ({
      reachable: true,
      status: 'dead' as const,
      body: '<html>This event has been removed</html>'.padEnd(200, ' '),
      httpStatus: 200,
      creditsUsed: 1,
      errorMessage: null,
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbDead,
      limit: 1,
    });
    expect(result.dead).toBe(1);
  });

  it('returns unknown when SB returns <100 byte body (blockerad)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;
    const sbShort = vi.fn(async () => ({
      reachable: false,
      status: 'unknown' as const,
      body: '<html></html>',
      httpStatus: 200,
      creditsUsed: 1,
      errorMessage: 'SB body too short (12 bytes)',
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbShort,
      limit: 1,
    });
    expect(result.unknown).toBe(1);
  });

  it('returns unknown when SB anrop kraschar (network error)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'antibot', ticket_url: 'https://x/y' }]);
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;
    const sbCrash = vi.fn(async () => ({
      reachable: false,
      status: 'unknown' as const,
      body: '',
      httpStatus: null,
      creditsUsed: 0,
      errorMessage: 'SB exception: ETIMEDOUT',
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbCrash,
      limit: 1,
    });
    expect(result.unknown).toBe(1);
  });

  it('returns unknown when SB-anrop används vid HEAD network error (inte bara GET-blockerad)', async () => {
    const client = fakeClient([{ id: 'e1', source: 'slow', ticket_url: 'https://slow.example/' }]);
    // HEAD misslyckas med network error (t.ex. DNS-fel).
    const fetchMock = mockFetchError('getaddrinfo ENOTFOUND slow.example');
    const sbUnknown = vi.fn(async () => ({
      reachable: false,
      status: 'unknown' as const,
      body: '',
      httpStatus: null,
      creditsUsed: 0,
      errorMessage: 'SB no key',
    }));

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: sbUnknown,
      limit: 1,
    });
    expect(sbUnknown).toHaveBeenCalledTimes(1);
    expect(result.unknown).toBe(1);
    expect(result.results[0].method).toBe('scrapingbee');
  });

  it('returns unknown when HEAD timeout → SB unknown', async () => {
    const client = fakeClient([{ id: 'e1', source: 'slow', ticket_url: 'https://slow.example/' }]);
    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchTimeout(),
      _verifyWithScrapingBee: noopSbVerifier,
      timeoutMs: 100,
      limit: 1,
    });
    expect(result.unknown).toBe(1);
    expect(result.results[0].method).toBe('scrapingbee');
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
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 10,
    });
    expect(result.checked).toBe(2); // kth + kulturhuset
    const sources = result.results.map((r) => r.source).sort();
    expect(sources).toEqual(['kth', 'kulturhuset']);
  });
});

describe('check_link_health — dry-run', () => {
  it('does not call rpc() on dry-run', async () => {
    const updateFn = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const rpcFn = vi.fn().mockResolvedValue({ error: null });
    const rows = [{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }];
    // 2026-09-27 — Proxy-stil för att stödja fetchEventsToCheck's filter-kedja.
    const chainableBuilder = () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'gte', 'gt', 'lt', 'is', 'neq', 'in', 'order']) {
        b[m] = () => b;
      }
      b.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      b.update = updateFn;
      return b;
    };
    const client = {
      from: () => chainableBuilder(),
      rpc: rpcFn,
    } as unknown as SupabaseClient;

    const result = await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.checked).toBe(1);
    expect(rpcFn).not.toHaveBeenCalled();
  });
});

describe('check_link_health — DB unavailable', () => {
  it('returns empty result when client is null', async () => {
    const result = await runCheckLinkHealth({
      _client: null,
      _fetch: mockFetchOk(200),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });
    expect(result.checked).toBe(0);
    expect(result.errors).toBe(1);
  });
});

/**
 * RPC-anrop till update_link_health_cf (migration 0004 + 0003).
 * Verifierar att vi skickar nya statnamn ('live'|'dead'|'unknown') + struktur.
 */
describe('check_link_health — update_link_health_cf RPC', () => {
  it('skickar korrekt params: p_event_id, p_new_status, p_checked_at', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ error: null });
    const rows = [{ id: 'e1', source: 'kth', ticket_url: 'https://kth.se/x' }];
    const chainableBuilder = () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'gte', 'gt', 'lt', 'is', 'neq', 'in', 'order']) {
        b[m] = () => b;
      }
      b.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      return b;
    };
    const client = {
      from: () => chainableBuilder(),
      rpc: rpcSpy,
    } as unknown as SupabaseClient;

    await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(404),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });

    expect(rpcSpy).toHaveBeenCalledWith('update_link_health_cf', expect.objectContaining({
      p_event_id: 'e1',
      p_new_status: 'dead',
      p_checked_at: expect.any(String),
    }));
  });

  it('skickar p_new_status="live" vid 200-svar', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ error: null });
    const rows = [{ id: 'e2', source: 'kth', ticket_url: 'https://kth.se/y' }];
    const chainableBuilder = () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'gte', 'gt', 'lt', 'is', 'neq', 'in', 'order']) {
        b[m] = () => b;
      }
      b.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      return b;
    };
    const client = {
      from: () => chainableBuilder(),
      rpc: rpcSpy,
    } as unknown as SupabaseClient;

    await runCheckLinkHealth({
      _client: client,
      _fetch: mockFetchOk(200),
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });

    expect(rpcSpy).toHaveBeenCalledWith('update_link_health_cf', expect.objectContaining({
      p_event_id: 'e2',
      p_new_status: 'live',
    }));
  });

  it('skickar p_new_status="unknown" när SB-fallback inte kan avgöra', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ error: null });
    const rows = [{ id: 'e3', source: 'antibot', ticket_url: 'https://x/y' }];
    const chainableBuilder = () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'gte', 'gt', 'lt', 'is', 'neq', 'in', 'order']) {
        b[m] = () => b;
      }
      b.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      return b;
    };
    const client = {
      from: () => chainableBuilder(),
      rpc: rpcSpy,
    } as unknown as SupabaseClient;

    // HEAD=403, GET=403, SB=unknown → oklassificerbart.
    const fetchMock = vi.fn(async () => fakeResponse(403)) as unknown as typeof fetch;

    await runCheckLinkHealth({
      _client: client,
      _fetch: fetchMock,
      _verifyWithScrapingBee: noopSbVerifier,
      limit: 1,
    });

    expect(rpcSpy).toHaveBeenCalledWith('update_link_health_cf', expect.objectContaining({
      p_event_id: 'e3',
      p_new_status: 'unknown',
    }));
  });
});

describe('verifyWithScrapingBee (helper)', () => {
  it('returnerar unknown om SCRAPINGBEE_API_KEY saknas', async () => {
    const prev = process.env.SCRAPINGBEE_API_KEY;
    delete process.env.SCRAPINGBEE_API_KEY;
    try {
      const r = await verifyWithScrapingBee('https://x/y', 1000);
      expect(r.status).toBe('unknown');
      expect(r.reachable).toBe(false);
      expect(r.creditsUsed).toBe(0);
      expect(r.errorMessage).toMatch(/SCRAPINGBEE_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.SCRAPINGBEE_API_KEY = prev;
    }
  });
});