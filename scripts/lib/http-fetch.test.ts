/**
 * http-fetch.mjs — skilj på "servern svarade nej" och "servern svarade inte".
 *
 * Negativa kontroller (de som faktiskt fångade felet):
 *   - ett 4xx/5xx-svar kastar INTE — det är en vägran, inte ett transportfel
 *   - ett verkligt transportfel (fetch kastar) kastas VIDARE — det får aldrig
 *     sväljas till "nej, servern nekade"
 *   - vägrans text får INTE klassas som transport (då går kedjan röd med
 *     exit 69 medan nätet är friskt) och inte som auth (då går kedjan röd med
 *     exit 77 — vår förfrågan nekades, men det var inte en auktorisationsfråga)
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchText, describeRefusal, DEFAULT_TIMEOUT_MS } from './http-fetch.mjs';
import { classifyMessage, classifyError } from './net-error.mjs';

/** Bygg ett svar som en fejk fetch kan returnera. */
function response(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('fetchText', () => {
  it('2xx ⇒ ok med texten', async () => {
    const fetchImpl = vi.fn(async () => response(200, '<html>hej</html>'));
    const res = await fetchText('https://example.test', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: true, text: '<html>hej</html>', status: 200 });
  });

  it('4xx ⇒ vägran (refused), INTE ett kast', async () => {
    // Mätt 2026-10-28: 10 av 139 källor svarade 403/406/429. De svarade —
    // de nekade. Skriptet skrev "fetch failed", kedjan klassade det som
    // transportfel och gick röd med exit 69 medan nätet var friskt.
    const fetchImpl = vi.fn(async () => response(403, 'forbidden'));
    const res = await fetchText('https://example.test', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: false, kind: 'refused', status: 403 });
  });

  it('5xx ⇒ vägran (refused), INTE ett kast', async () => {
    const fetchImpl = vi.fn(async () => response(503, 'busy'));
    const res = await fetchText('https://example.test', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: false, kind: 'refused', status: 503 });
  });

  it('ETT VERKLIGT TRANSPORTFEL kastas vidare — det får aldrig bli en vägran', async () => {
    // Nätverket nådde inte fram. Om detta sväljs till "refused" så går
    // kedjan grön medan nätet är dött — den gröna ljugen.
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause });
    });
    await expect(
      fetchText('https://example.test', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('fetch failed');
  });

  it('timeout ⇒ ETIMEDOUT (transport), aldrig en vägran', async () => {
    // Node kastar AbortError ("This operation was aborted"). Lämnas den som
    // den är blir den ett 'logic'-fel (exit 70) — men en förfrågan som
    // avbröts av timeout är ett transportfel (exit 69).
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = fetchText('https://example.test', {
        timeoutMs: 50,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('ett timeout klassas som TRANSPORT av kedjan egen klassificator', async () => {
    // Kedjan klassar fel på text och på errno. ETIMEDOUT finns i
    // TRANSPORT_ERRNOS — så "timeout" ska räknas som transportfel.
    const err = Object.assign(new Error('timeout efter 50 ms — förfrågan avbröts'), { code: 'ETIMEDOUT' });
    expect(classifyError(err)).toBe('transport');
  });

  it('skickar headers och följer redirects', async () => {
    const fetchImpl = vi.fn(async () => response(200, 'ok'));
    await fetchText('https://example.test', {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0][1] as unknown as { headers: Record<string, string>; redirect: string };
    expect(init.headers['User-Agent']).toBe('EventPulse-Bot/1.0');
    expect(init.redirect).toBe('follow');
  });
});

describe('describeRefusal', () => {
  it('beskriver vägran utan att kunna misstas för transport- eller auth-fel', () => {
    // Detta är den viktigaste raden i modulen. Kedjan klassar barnprocessers
    // stderr på TEXT. "HTTP 403" ⇒ auth ⇒ exit 77. "fetch failed" ⇒
    // transport ⇒ exit 69. Båda är FEL för en offentlig webbsida som
    // blockerar en bot — den svarade, vi fick bara nej.
    const text = describeRefusal(403);
    expect(text).not.toMatch(/fetch failed/i);
    expect(text).not.toMatch(/\bhttp\b/i);
    expect(classifyMessage(text)).not.toBe('transport');
    expect(classifyMessage(text)).not.toBe('auth');
  });

  it('NEGATIV KONTROLL — råa "HTTP 403" och "fetch failed" FÅR klassas fel', () => {
    // Kontrollen ovan är meningslös om den inte är falsk för de felaktiga
    // formerna. Detta bevisar att klassifikatorn alls kan se dem.
    expect(classifyMessage('HTTP 403')).toBe('auth');
    expect(classifyMessage('fetch failed')).toBe('transport');
  });

  it('vägran innehåller svarskod så att operatören kan se vad servern sade', () => {
    expect(describeRefusal(429)).toContain('429');
    expect(describeRefusal(429)).toContain('vägrade');
  });
});

describe('standardvärden', () => {
  it('standard-timeout är 12 s', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(12_000);
  });
});
