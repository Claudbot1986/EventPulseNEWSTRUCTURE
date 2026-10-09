/**
 * verify_event_sources — Stream C.1 (Agent Trust Plan 2026-10-09).
 *
 * Täcker:
 *   1. headless_fetch_ok — pass / fail / timeout
 *   2. jsonld_valid — pass / fail / skip (non-html content)
 *   3. image_loads — pass / fail / skip (non-image content)
 *   4. date_in_future — pass / past / too-far-future / missing / unparseable
 *   5. canonical_id_stable — pass / missing / duplicate-in-batch
 *   6. overall-resultat — pass / partial / fail
 *   7. verifyEventBatch — kör canonical_id korrekt över batchen
 *   8. Edge cases — saknad fetcher, saknad URL, parallellitet
 *
 * Mockning:
 *   - globalThis.fetch stubbas per test. På det sättet kan vi testa hur
 *     toolen reagerar på olika URL-headers/bodies utan att faktiskt nå
 *     internet.
 *   - `now` skickas in explicit så att datum-checks är deterministiska.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  verifyEventSources,
  verifyEventBatch,
  type SourceRef,
  type VerifyCheck,
} from '../tools/verify_event_sources';

// ── Hjälpare ───────────────────────────────────────────────────────────────

/** En minimal Response-liknande som uppfyller det toolen använder. */
function makeResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  body?: string;
}): Response {
  const status = opts.status ?? (opts.ok ? 200 : 500);
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'content-type') return opts.contentType ?? null;
        return null;
      },
    },
    text: async () => opts.body ?? '',
  } as unknown as Response;
}

/** Stub-fetcher som mappar URL → Response. */
function installFetchMock(
  byUrl: Record<string, Response | (() => Response | Promise<Response>)>,
): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const entry = byUrl[url];
    if (!entry) return makeResponse({ ok: false, status: 404 });
    if (typeof entry === 'function') return await entry();
    return entry;
  }) as unknown as typeof fetch;
  return { calls };
}

/** Plocka ut en check av en viss kind. */
function findCheck(checks: VerifyCheck[], kind: string): VerifyCheck | undefined {
  return checks.find((c) => c.kind === kind);
}

// ── Grunddata ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-09T12:00:00Z');
const eventBase = {
  id: 'evt-1',
  start_time: '2026-10-15T19:00:00Z', // 6 dagar framåt
  image_url: 'https://example.com/img.jpg',
  ticket_url: 'https://example.com/event',
};

// ── headless_fetch_ok ──────────────────────────────────────────────────────

describe('headless_fetch_ok', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass: 200-OK', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({ ok: true, status: 200 }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'headless_fetch_ok');
    expect(c?.status).toBe('pass');
    expect(r.overall === 'pass' || r.overall === 'partial').toBe(true);
  });

  it('fail: 500-svar', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({ ok: false, status: 500 }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'headless_fetch_ok');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('http-500');
  });

  it('fail: network error / abort', async () => {
    globalThis.fetch = (async () => {
      throw new Error('simulated network down');
    }) as unknown as typeof fetch;
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'headless_fetch_ok');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toContain('simulated network down');
  });

  it('skip: url är tom/null', async () => {
    installFetchMock({});
    const r = await verifyEventSources(eventBase, [{ url: '' }], { now: NOW });
    const c = findCheck(r.checks, 'headless_fetch_ok');
    expect(c?.status).toBe('skip');
    expect(c?.reason).toBe('missing-url');
  });
});

// ── jsonld_valid ───────────────────────────────────────────────────────────

describe('jsonld_valid', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass: HTML-sida med application/ld+json och @type=Event', async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "Event", "name": "Konsert" }
        </script>
      </head></html>
    `;
    installFetchMock({
      'https://example.com/event': makeResponse({
        ok: true,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html,
      }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'jsonld_valid');
    expect(c?.status).toBe('pass');
  });

  it('pass: ren JSON-LD-dokument', async () => {
    const json = JSON.stringify({ '@type': 'Event', name: 'Konsert' });
    installFetchMock({
      'https://example.com/event.jsonld': makeResponse({
        ok: true,
        status: 200,
        contentType: 'application/ld+json',
        body: json,
      }),
    });
    const r = await verifyEventSources(
      { ...eventBase, ticket_url: 'https://example.com/event.jsonld' },
      [{ url: 'https://example.com/event.jsonld' }],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'jsonld_valid');
    expect(c?.status).toBe('pass');
  });

  it('fail: HTML utan JSON-LD Event', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({
        ok: true,
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Hej</body></html>',
      }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'jsonld_valid');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('no-jsonld-event');
  });

  it('skip: icke-html/icke-json content-type', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({
        ok: true,
        status: 200,
        contentType: 'application/pdf',
      }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    const c = findCheck(r.checks, 'jsonld_valid');
    expect(c?.status).toBe('skip');
  });
});

// ── image_loads ────────────────────────────────────────────────────────────

describe('image_loads', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass: image/jpeg', async () => {
    installFetchMock({
      'https://example.com/img.jpg': makeResponse({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
      }),
    });
    const sources: SourceRef[] = [{ url: 'https://example.com/img.jpg', kind: 'image' }];
    const r = await verifyEventSources(eventBase, sources, { now: NOW });
    const c = findCheck(r.checks, 'image_loads');
    expect(c?.status).toBe('pass');
  });

  it('fail: text/html content-type', async () => {
    installFetchMock({
      'https://example.com/img': makeResponse({
        ok: true,
        status: 200,
        contentType: 'text/html',
      }),
    });
    const r = await verifyEventSources(
      eventBase,
      [{ url: 'https://example.com/img', kind: 'image' }],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'image_loads');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toMatch(/not-image/);
  });
});

// ── date_in_future ─────────────────────────────────────────────────────────

describe('date_in_future', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass: framtida datum', async () => {
    installFetchMock({});
    const r = await verifyEventSources(
      { ...eventBase, start_time: '2026-12-31T19:00:00Z' },
      [],
      { now: NOW },
    );
    expect(findCheck(r.checks, 'date_in_future')?.status).toBe('pass');
  });

  it('fail: datum i dåtid', async () => {
    installFetchMock({});
    const r = await verifyEventSources(
      { ...eventBase, start_time: '2025-01-01T19:00:00Z' },
      [],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'date_in_future');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('past-date');
  });

  it('fail: > 2 år framåt', async () => {
    installFetchMock({});
    const r = await verifyEventSources(
      { ...eventBase, start_time: '2030-01-01T19:00:00Z' },
      [],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'date_in_future');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toMatch(/too-far-future/);
  });

  it('fail: saknar start_time', async () => {
    installFetchMock({});
    const r = await verifyEventSources(
      { ...eventBase, start_time: '' as unknown as string },
      [],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'date_in_future');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('missing-start_time');
  });

  it('fail: oparsbar sträng', async () => {
    installFetchMock({});
    const r = await verifyEventSources(
      { ...eventBase, start_time: 'not-a-date' },
      [],
      { now: NOW },
    );
    const c = findCheck(r.checks, 'date_in_future');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('unparseable-start_time');
  });
});

// ── canonical_id_stable ────────────────────────────────────────────────────

describe('canonical_id_stable', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass: enskilt event med id', async () => {
    installFetchMock({});
    const r = await verifyEventSources(eventBase, [], { now: NOW });
    expect(findCheck(r.checks, 'canonical_id_stable')?.status).toBe('pass');
  });

  it('fail: saknar id', async () => {
    installFetchMock({});
    const r = await verifyEventSources({ ...eventBase, id: '' }, [], { now: NOW });
    const c = findCheck(r.checks, 'canonical_id_stable');
    expect(c?.status).toBe('fail');
    expect(c?.reason).toBe('missing-id');
  });
});

// ── overall-resultat ──────────────────────────────────────────────────────

describe('overall-beslut', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('pass när alla checks är pass eller skip', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({ ok: true, status: 200 }),
    });
    const r = await verifyEventSources(eventBase, [{ url: 'https://example.com/event' }], { now: NOW });
    expect(r.overall).toBe('pass');
  });

  it('partial när minst en fail men också en pass', async () => {
    // En källa: primär returnerar 200 + html utan JSON-LD → jsonld fail
    installFetchMock({
      'https://example.com/event': makeResponse({
        ok: true,
        status: 200,
        contentType: 'text/html',
        body: '<html>no ld</html>',
      }),
      'https://example.com/img.jpg': makeResponse({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
      }),
    });
    const r = await verifyEventSources(
      eventBase,
      [
        { url: 'https://example.com/event', kind: 'primary' },
        { url: 'https://example.com/img.jpg', kind: 'image' },
      ],
      { now: NOW },
    );
    expect(r.overall).toBe('partial');
  });

  it('fail när alla aktiva checks fail', async () => {
    installFetchMock({
      'https://example.com/event': makeResponse({ ok: false, status: 500 }),
    });
    // Start i dåtid + utan id → alla checks fail (canonical_id blir fail,
    // date_in_future blir fail, headless_fetch blir fail). Endast jsonld
    // skip:as eftersom fetch failade.
    const r = await verifyEventSources(
      { ...eventBase, id: '', start_time: '1999-01-01T00:00:00Z' },
      [{ url: 'https://example.com/event', kind: 'primary' }],
      { now: NOW },
    );
    expect(r.overall).toBe('fail');
    expect(r.summary).toMatch(/^pass=\d+ fail=\d+ skip=\d+$/);
  });
});

// ── verifyEventBatch ──────────────────────────────────────────────────────

describe('verifyEventBatch', () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('markerar duplicate-id som fail i canonical_id', async () => {
    installFetchMock({});
    const events = [
      { id: 'dup', start_time: '2026-12-31T19:00:00Z', image_url: null, ticket_url: null },
      { id: 'dup', start_time: '2026-12-31T19:00:00Z', image_url: null, ticket_url: null },
      { id: 'unique', start_time: '2026-12-31T20:00:00Z', image_url: null, ticket_url: null },
    ];
    const results = await verifyEventBatch(events, () => [], { now: NOW });
    expect(results).toHaveLength(3);

    const dupResults = results.filter((_r, i) => events[i].id === 'dup');
    for (const r of dupResults) {
      const c = findCheck(r.checks, 'canonical_id_stable');
      expect(c?.status).toBe('fail');
      expect(c?.reason).toMatch(/duplicate-in-batch/);
    }

    const unique = results.find((_r, i) => events[i].id === 'unique')!;
    expect(findCheck(unique.checks, 'canonical_id_stable')?.status).toBe('pass');
  });

  it('returnerar ett resultat per event', async () => {
    installFetchMock({});
    const events = [
      { id: 'a', start_time: '2026-12-31T19:00:00Z', image_url: null, ticket_url: null },
      { id: 'b', start_time: '2026-12-31T20:00:00Z', image_url: null, ticket_url: null },
    ];
    const results = await verifyEventBatch(events, () => [], { now: NOW });
    expect(results).toHaveLength(2);
    expect(results[0].summary).toMatch(/^pass=\d+ fail=\d+ skip=\d+$/);
    expect(results[1].summary).toMatch(/^pass=\d+ fail=\d+ skip=\d+$/);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('no-fetcher (Node <18 eller glömd injicering) → overall fail', async () => {
    delete (globalThis as { fetch?: unknown }).fetch;
    // Force "no fetcher" by overriding the fetch check. The tool reads
    // globalThis.fetch at call time, so we need to make sure it's undefined.
    const origFetch = globalThis.fetch;
    // @ts-expect-error — avsiktligt sätta till undefined
    delete globalThis.fetch;
    try {
      const r = await verifyEventSources(eventBase, [], { now: NOW });
      expect(r.overall).toBe('fail');
      expect(r.summary).toContain('no-fetcher');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('skickar authHeader till fetch när source har det', async () => {
    const { calls } = installFetchMock({
      'https://example.com/secret': makeResponse({ ok: true, status: 200 }),
    });
    await verifyEventSources(
      { ...eventBase, ticket_url: 'https://example.com/secret' },
      [{ url: 'https://example.com/secret', authHeader: 'Bearer test-token' }],
      { now: NOW },
    );
    // Två fetch-anrop förväntas — headless_fetch_ok + jsonld_valid kör båda.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const headeredCall = calls.find((c) => {
      const h = c.init?.headers as Record<string, string> | undefined;
      return h?.Authorization === 'Bearer test-token';
    });
    expect(headeredCall).toBeDefined();
  });

  it('skickar INGEN Authorization-header när source saknar authHeader', async () => {
    const { calls } = installFetchMock({
      'https://example.com/public': makeResponse({ ok: true, status: 200 }),
    });
    await verifyEventSources(
      { ...eventBase, ticket_url: 'https://example.com/public' },
      [{ url: 'https://example.com/public' }],
      { now: NOW },
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('kör alla source-checks parallellt (timeout-resolution bekräftas indirekt)', async () => {
    // 3 källor, varje med 50ms delay — om seriell skulle totalt ta ≥150ms.
    const slow = (delayMs: number, status = 200) => () =>
      new Promise<Response>((resolve) =>
        setTimeout(
          () => resolve(makeResponse({ ok: true, status })),
          delayMs,
        ),
      );

    installFetchMock({
      'https://a.test': slow(50),
      'https://b.test': slow(50),
      'https://c.test': slow(50),
    });

    const t0 = Date.now();
    await verifyEventSources(
      { ...eventBase, ticket_url: 'https://a.test' },
      [
        { url: 'https://a.test' },
        { url: 'https://b.test' },
        { url: 'https://c.test' },
      ],
      { now: NOW, fetchTimeoutMs: 1000 },
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(140); // < 3 × 50ms (margin för overhead)
  });

  it('summary är deterministisk och innehåller inga URL:er', async () => {
    installFetchMock({
      'https://secret.example.com/very/long/path?token=abc': makeResponse({
        ok: true,
        status: 200,
      }),
    });
    const r = await verifyEventSources(
      { ...eventBase, ticket_url: 'https://secret.example.com/very/long/path?token=abc' },
      [{ url: 'https://secret.example.com/very/long/path?token=abc' }],
      { now: NOW },
    );
    expect(r.summary).not.toContain('example.com');
    expect(r.summary).not.toContain('token');
    expect(r.summary).toMatch(/^pass=\d+ fail=\d+ skip=\d+$/);
  });
});
