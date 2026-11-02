/**
 * 04-Normalizer/editorial/editorialWriter.retry.test.ts
 *
 * Regressionstester för MiniMax-klientens retry-policy (2026-10-31).
 *
 * Bakgrund: nattkörningen loggade ~14 "DEGRADED event ... MiniMax 429" —
 * events som sparades utan LLM-beskrivning för att RPM-taket var nått.
 * Klienten kastade direkt på 429; nu väntar den ut taket och försöker igen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MiniMaxM3LlmClient,
  isRetryableMiniMaxError,
  retryDelayMs,
  MINIMAX_MAX_ATTEMPTS,
  RpmGuard,
  __resetSharedRpmGuard,
  __getSharedRpmGuard,
} from './editorialWriter.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  __resetSharedRpmGuard();
});

describe('isRetryableMiniMaxError', () => {
  it('429 (rate limit) är retrybart', () => {
    expect(isRetryableMiniMaxError(new Error('MiniMax 429: {"type":"error"}'))).toBe(true);
  });

  it('5xx är retrybart', () => {
    expect(isRetryableMiniMaxError(new Error('MiniMax 503: overloaded'))).toBe(true);
  });

  it('401/403/400 är INTE retrybara', () => {
    expect(isRetryableMiniMaxError(new Error('MiniMax 401: unauthorized'))).toBe(false);
    expect(isRetryableMiniMaxError(new Error('MiniMax 403: forbidden'))).toBe(false);
    expect(isRetryableMiniMaxError(new Error('MiniMax 400: bad request'))).toBe(false);
  });

  it('okänt fel är inte retrybart', () => {
    expect(isRetryableMiniMaxError(new Error('fetch failed'))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('Retry-After vinner över backoff', () => {
    const err = new Error('MiniMax 429: rate limited retry-after=7');
    expect(retryDelayMs(err, 1)).toBe(7000);
  });

  it('backoff växer exponentiellt', () => {
    expect(retryDelayMs(new Error('MiniMax 429: x'), 1)).toBe(2000);
    expect(retryDelayMs(new Error('MiniMax 429: x'), 2)).toBe(4000);
    expect(retryDelayMs(new Error('MiniMax 429: x'), 3)).toBe(8000);
  });

  it('delayn takas vid', () => {
    expect(retryDelayMs(new Error('MiniMax 429: x'), 10)).toBe(20000);
  });
});

describe('MiniMaxM3LlmClient.generate', () => {
  it('försöker igen efter 429 och returnerar texten', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '0' }),
        text: async () => '{"type":"error"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'En bra beskrivning.' }, finish_reason: 'stop' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MiniMaxM3LlmClient({ apiKey: 'k' });
    const text = await client.generate({ systemPrompt: 's', userPrompt: 'u' });

    expect(text).toContain('En bra beskrivning.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ger upp efter maxAttempts på ihållande 429', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': '0' }),
      text: async () => '{"type":"error"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MiniMaxM3LlmClient({ apiKey: 'k' });
    await expect(client.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(/MiniMax 429/);
    expect(fetchMock).toHaveBeenCalledTimes(MINIMAX_MAX_ATTEMPTS);
  });

  it('401 kastas direkt utan retry', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      text: async () => '{"type":"error"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MiniMaxM3LlmClient({ apiKey: 'k' });
    await expect(client.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(/MiniMax 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── RPM-guard (2026-11-02) ──────────────────────────────────────────────────
//
// Bakgrund: nattens worker-drain 2026-11-02 körde 1 304 events i 18 minuter.
// Varje event gör upp till 3 MiniMax-anrop (skrivning + 2 regenereringar),
// dvs ~217 anrop/min — över kontots RPM-tak. 271 körningar föll på
// "rate limit exceeded(RPM)" och de eventsen sparades UTAN beskrivning.
//
// Guarden är en MODUL-LEVEL singleton: `maybeRunEditorial` skapar en ny
// klient per event, så en per-instans guard skulle aldrig se taket.

describe('RpmGuard', () => {
  it('släpper igenom max anrop i fönstret utan att vänta', async () => {
    const guard = new RpmGuard(5);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await guard.acquire();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('väntar när fönstret är fullt (kort fönster för testet)', async () => {
    const guard = new RpmGuard(2, 400);
    await guard.acquire();
    await guard.acquire();
    const t0 = Date.now();
    await guard.acquire();
    // Väntar tills fönstret (400 ms) släpper en plats — bevisar att den bromsar.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  it('max = 0 släpper igenom allt (guard avstängd)', async () => {
    const guard = new RpmGuard(0);
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) await guard.acquire();
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('klienten använder den DELADE guarden — två klienter delar samma fönster', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'En bra beskrivning.' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // `maybeRunEditorial` skapar en NY klient per event. Om guarden vore
    // per-instans skulle varje klint ha ett eget tomt fönster och taket
    // skulle aldrig märkas. Beviset: båda klienterna pekar på SAMMA guard.
    const a = new MiniMaxM3LlmClient({ apiKey: 'k', rpm: 50 });
    await a.generate({ systemPrompt: 's', userPrompt: 'u' });
    const guardAfterA = __getSharedRpmGuard();

    const b = new MiniMaxM3LlmClient({ apiKey: 'k', rpm: 7 });
    await b.generate({ systemPrompt: 's', userPrompt: 'u' });

    expect(guardAfterA).not.toBeNull();
    expect(__getSharedRpmGuard()).toBe(guardAfterA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rpm = 0 stänger av guarden (ingen fördröjning)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'En bra beskrivning.' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MiniMaxM3LlmClient({ apiKey: 'k', rpm: 0 });
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) await client.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
