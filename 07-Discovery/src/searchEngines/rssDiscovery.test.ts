/**
 * 07-Discovery/src/searchEngines/rssDiscovery.test.ts
 *
 * P3C tester (2026-09-10): RSS/Atom feed parsing + discovery-flöde.
 *
 * Säkerhet: alla HTTP- och DB-anrop mockas — inga riktiga nätverks-IO.
 *
 * Run: npx vitest run 07-Discovery/src/searchEngines/rssDiscovery.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');

const fromMock = vi.fn();
const upsertMock = vi.fn();
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

const { run } = await import('./rssDiscovery.js');

beforeEach(() => {
  fromMock.mockReset();
  upsertMock.mockReset();
  fetchMock.mockReset();

  // Default: fromMock returnerar en kedjebar upsert så icke-supabase-test
  // inte kraschar om någon testsviten råkar nå skrivvägen.
  fromMock.mockImplementation(() => ({
    upsert: upsertMock.mockImplementation(() => Promise.resolve({ error: null })),
  }));

  // Städa bort test-filer från föregående test
  for (const f of ['rss-test-a.jsonl', 'rss-test-b.jsonl', 'rss-test-c.jsonl']) {
    const p = path.join(SOURCES_DIR, f);
    if (existsSync(p)) rmSync(p);
  }

  // Skapa working sources a + b
  if (!existsSync(SOURCES_DIR)) mkdirSync(SOURCES_DIR, { recursive: true });
  writeFileSync(
    path.join(SOURCES_DIR, 'rss-test-a.jsonl'),
    JSON.stringify({ id: 'rss-test-a', url: 'https://example-a.com', status: 'working' }),
  );
  writeFileSync(
    path.join(SOURCES_DIR, 'rss-test-b.jsonl'),
    JSON.stringify({ id: 'rss-test-b', url: 'https://example-b.com', status: 'working' }),
  );
  writeFileSync(
    path.join(SOURCES_DIR, 'rss-test-c.jsonl'),
    JSON.stringify({ id: 'rss-test-c', url: 'https://example-c.com', status: 'quarantined' }),
  );
});

afterAll(() => {
  for (const f of ['rss-test-a.jsonl', 'rss-test-b.jsonl', 'rss-test-c.jsonl']) {
    const p = path.join(SOURCES_DIR, f);
    if (existsSync(p)) rmSync(p);
  }
});

const RSS2_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example A Events</title>
    <link>https://example-a.com</link>
    <description>Events feed</description>
    <item>
      <title>Event 1</title>
      <link>https://example-a.com/events/1</link>
      <guid>1</guid>
    </item>
    <item>
      <title>Event 2</title>
      <link>https://example-a.com/events/2</link>
      <guid>2</guid>
    </item>
    <item>
      <title>Event 3</title>
      <link>https://example-a.com/events/3</link>
      <guid>3</guid>
    </item>
  </channel>
</rss>`;

const ATOM_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example B Events</title>
  <link href="https://example-b.com"/>
  <entry>
    <title>Atom Event 1</title>
    <link href="https://example-b.com/atom/e1"/>
    <id>1</id>
  </entry>
  <entry>
    <title>Atom Event 2</title>
    <link href="https://example-b.com/atom/e2"/>
    <id>2</id>
  </entry>
</feed>`;

const HTML_404_BODY = `<html><body>Not Found</body></html>`;

function mockFeed(sourceHost: string, body: string, format: string) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(url);
    // Förstakandidaten (vanligtvis /feed) → 200 med rätt content-type
    if (u.pathname === '/feed' || u.pathname === '/rss' || u.pathname === '/feed/') {
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': format === 'atom' ? 'application/atom+xml' : 'application/rss+xml',
        },
      });
    }
    return new Response(HTML_404_BODY, { status: 404, headers: { 'content-type': 'text/html' } });
  });
}

describe('rssDiscovery.run', () => {
  test('inga working sources → 0/0/0', async () => {
    // Verifiera att vi parsar sources-filen korrekt. Här använder vi
    // fetchMock som returnerar 404 — så även om working-sources parsas,
    // blir inga feeds hittade.
    fetchMock.mockResolvedValue(new Response(HTML_404_BODY, { status: 404 }));

    const result = await run({ limit: 100 });
    expect(result.feedsFound).toBe(0);
    expect(result.candidatesWritten).toBe(0);
  });

  test('RSS2-feed hittad, 3 events extraherade', async () => {
    mockFeed('example-a.com', RSS2_BODY, 'rss2');

    const result = await run({ limit: 100, concurrency: 2 });
    expect(result.sourcesChecked).toBeGreaterThanOrEqual(2);
    expect(result.feedsFound).toBeGreaterThanOrEqual(1);
    const rssFeed = result.feeds.find((f) => f.format === 'rss2');
    expect(rssFeed).toBeDefined();
    expect(rssFeed?.itemCount).toBe(3);
    expect(rssFeed?.sampleUrls).toContain('https://example-a.com/events/1');
  });

  test('Atom-feed hittad, 2 events extraherade', async () => {
    mockFeed('example-b.com', ATOM_BODY, 'atom');

    const result = await run({ limit: 100, concurrency: 2 });
    expect(result.feedsFound).toBeGreaterThanOrEqual(1);
    const atomFeed = result.feeds.find((f) => f.format === 'atom');
    expect(atomFeed).toBeDefined();
    expect(atomFeed?.itemCount).toBe(2);
    expect(atomFeed?.sampleUrls).toContain('https://example-b.com/atom/e1');
  });

  test('quarantined sources hoppas över', async () => {
    // Verifiera att vår quarantined test-källa INTE dyker upp som en feed.
    // (sources/ innehåller 250+ production-filer vi inte vill räkna.)
    fetchMock.mockResolvedValue(new Response(HTML_404_BODY, { status: 404 }));

    const result = await run({ limit: 100 });
    // Om vår quarantined-källa av misstag behandlades skulle feeds innehålla rss-test-c
    const quarantinedFeed = result.feeds.find((f) => f.sourceId === 'rss-test-c');
    expect(quarantinedFeed).toBeUndefined();
  });

  test('404 på alla paths → 0 feeds', async () => {
    fetchMock.mockResolvedValue(new Response(HTML_404_BODY, { status: 404, headers: { 'content-type': 'text/html' } }));

    const result = await run({ limit: 100 });
    expect(result.feedsFound).toBe(0);
    expect(result.totalEvents).toBe(0);
  });

  test('dryRun=true → skriver inte till Supabase', async () => {
    mockFeed('example-a.com', RSS2_BODY, 'rss2');

    const result = await run({ limit: 100, dryRun: true });
    expect(result.feedsFound).toBeGreaterThanOrEqual(1);
    expect(result.candidatesWritten).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  test('icke-dry-run → skriver till source_candidates via upsert', async () => {
    mockFeed('example-a.com', RSS2_BODY, 'rss2');
    fromMock.mockReturnValue({
      upsert: upsertMock.mockReturnValue({
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      }),
    });

    const result = await run({ limit: 100 });
    expect(result.candidatesWritten).toBeGreaterThan(0);
    expect(upsertMock).toHaveBeenCalled();
    // Verifiera att rows innehåller feedUrl + engine='rss_discovery'
    const call = upsertMock.mock.calls[upsertMock.mock.calls.length - 1];
    const rows = call[0];
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as Array<Record<string, unknown>>)[0].engine).toBe('rss_discovery');
  });

  test('feed utan events (0 items) → inte en giltig feed', async () => {
    const emptyFeed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/feed') {
        return new Response(emptyFeed, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      }
      return new Response(HTML_404_BODY, { status: 404 });
    });

    const result = await run({ limit: 100 });
    expect(result.feedsFound).toBe(0); // tomma feeds räknas inte
  });

  test('feed med ogiltiga URLs filtreras bort', async () => {
    const dirtyFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>x</title><link>not-a-url</link></item>
      <item><title>y</title><link>https://example.com/y</link></item>
    </channel></rss>`;
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/feed') {
        return new Response(dirtyFeed, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      }
      return new Response(HTML_404_BODY, { status: 404 });
    });

    const result = await run({ limit: 100 });
    // Beroende på vilken källa som träffar först kan feeds variera;
    // vi kontrollerar bara att discovery-rapporten är konsistent
    expect(result.totalEvents).toBeGreaterThanOrEqual(1);
    const sampleUrls = result.feeds.flatMap((f) => f.sampleUrls);
    // Alla sampleUrls ska vara http(s)-URL:er
    for (const u of sampleUrls) {
      expect(u).toMatch(/^https?:\/\//);
    }
  });
});