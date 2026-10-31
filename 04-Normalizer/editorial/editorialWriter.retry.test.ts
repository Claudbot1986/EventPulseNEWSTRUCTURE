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
} from './editorialWriter.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
