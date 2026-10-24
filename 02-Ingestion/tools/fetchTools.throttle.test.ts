import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchHtml } from './fetchTools';

/**
 * Throttling-retry (2026-10-24).
 *
 * Flera svenska sajter svarar 429 när de anropas för tätt. C-gaten gör många
 * anrop mot samma värd i samma körning, och WAF:en räknade det som en burst.
 * Utan retry skrev C-gaten 429 som ett extraktionsfel och begravde levande
 * källor.
 *
 * Mätning (blekholmen.se): 429-svaret bär `Retry-After: 10`, och header
 * räknar ned en sekund i taget. Vi följer den headern.
 *
 * Negativ kontroll: ett 404 får INTE försökas om — det är ett verkligt fel
 * och ska begravas korrekt.
 */

let server: Server;
let baseUrl: string;

/** Antal anrop per path — så kan testet kräva att ett anrop INTE gjordes om. */
const hits = new Map<string, number>();
/** Svar-status per path. 'throttle-twice' svarar 429 två gånger sedan 200. */
const routes = new Map<string, () => number>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const status = routes.get(path)?.() ?? 404;
    if (status === 429) {
      // Retry-After: 1 — realistiskt och håller testet snabbt.
      res.writeHead(429, { 'Retry-After': '1' });
      res.end('slow down');
      return;
    }
    res.writeHead(status, { 'Content-Type': 'text/html' });
    res.end('<html><body>hej</body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('fetchHtml — throttling-retry', () => {
  it('försöker igen efter 429 och lyckas när sajten svarar 200', async () => {
    const path = '/throttle-twice';
    let remaining = 2;
    routes.set(path, () => (remaining-- > 0 ? 429 : 200));

    const started = Date.now();
    const result = await fetchHtml(`${baseUrl}${path}`, { timeout: 5000 });
    const elapsed = Date.now() - started;

    expect(result.success).toBe(true);
    expect(result.html).toContain('hej');
    expect(result.throttleAttempts).toBe(2);
    expect(hits.get(path)).toBe(3);
    // Retry-After: 1 → minst 1 s väntan. Utan väntan vore det ~10 ms.
    expect(elapsed).toBeGreaterThan(1000);
  }, 40_000);

  it('NEGATIV KONTROLL — försöker inte om ett 404', async () => {
    const path = '/not-found';
    routes.set(path, () => 404);

    const result = await fetchHtml(`${baseUrl}${path}`, { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
    // Bara ETT anrop — 404 är ett verkligt fel, inte throttling.
    expect(hits.get(path)).toBe(1);
    expect(result.throttleAttempts).toBe(0);
  }, 40_000);

  it('NEGATIV KONTROLL — ger upp efter max antal försök när sajten fortsätter svara 429', async () => {
    const path = '/always-throttled';
    routes.set(path, () => 429);

    const result = await fetchHtml(`${baseUrl}${path}`, { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(hits.get(path)).toBe(3); // 1 + 2 retry
    expect(result.throttleAttempts).toBe(2);
  }, 60_000);
});
