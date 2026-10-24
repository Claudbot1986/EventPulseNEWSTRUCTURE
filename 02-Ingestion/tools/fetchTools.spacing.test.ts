import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { fetchHtml } from './fetchTools';

/**
 * Per-värd-spacing (2026-10-24).
 *
 * Rotorsaken till 429:en är C0:s svenska-mönster-fallback, som testar upp till
 * 30 URL-mönster mot samma värd i följd. Mätt på blekholmen.se: 7 anrop inom
 * ~6 s ger 429 med `Retry-After: 10`; 14 anrop med 2 s mellanrum ger 0 st
 * 429. Sju orelaterade domäner visar samma mönster.
 *
 * Negativa kontroller:
 *   - Anrop mot OLIKA värd blockeras inte av spacingen — annars skulle
 *     hela C-gaten köpa tid i onödan.
 *   - Ett 404 får INTE försökas om (verkligt fel, ska begravas).
 */

let server: Server;
let baseUrl: string;
/** Tre extra värdar — anrop mot dem ska inte blockera varandra. */
const otherServers: Server[] = [];
const otherBaseUrls: string[] = [];

/** Ankomsttider, så vi kan mäta avståndet mellan anrop mot samma värd. */
const arrivals: number[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    arrivals.push(Date.now());
    const path = req.url ?? '/';
    if (path === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body>saknas</body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>hej</body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (let i = 0; i < 3; i++) {
    const s = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>hej</body></html>');
    });
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    otherServers.push(s);
    otherBaseUrls.push(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const s of otherServers) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('fetchHtml — per-värd-spacing', () => {
  it('håller minst ~2 s mellan anrop mot samma värd', async () => {
    arrivals.length = 0;

    for (let i = 0; i < 3; i++) {
      const result = await fetchHtml(`${baseUrl}/paced`, { timeout: 5000 });
      expect(result.success).toBe(true);
    }

    expect(arrivals).toHaveLength(3);
    const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]);
    for (const gap of gaps) {
      // Lite under 2 s för att inte flaga klock-jitter, men långt över
      // "direkt i rad" (som är ~5 ms).
      expect(gap).toBeGreaterThan(1800);
    }
  }, 30_000);

  it('NEGATIV KONTROLL — blockerar inte anrop mot andra värd', async () => {
    const started = Date.now();

    await Promise.all(
      otherBaseUrls.map((url) => fetchHtml(`${url}/a`, { timeout: 5000 })),
    );

    const elapsed = Date.now() - started;
    // Tre anrop mot tre olika värd tar ~10 ms. Om spacingen vore global
    // skulle de ta 4 s. Under 2 s = spacingen gäller per värd, inte globalt.
    expect(elapsed).toBeLessThan(2000);
  }, 30_000);

  it('NEGATIV KONTROLL — 404 försöks inte om', async () => {
    const before = arrivals.length;
    const result = await fetchHtml(`${baseUrl}/missing`, { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
    // Bara ETT anrop — 404 är ett verkligt fel, inte throttling.
    expect(arrivals.length).toBe(before + 1);
    expect(result.throttleAttempts).toBe(0);
  }, 30_000);
});
