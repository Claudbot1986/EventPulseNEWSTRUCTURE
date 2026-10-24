import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { load } from 'cheerio';
import { collectLinks, discoverEventCandidates } from './C0-htmlFrontierDiscovery.js';
import { normalizeFetchUrl } from '../../tools/fetchTools.js';

const sandbox = mkdtempSync(join(tmpdir(), 'c0-sitemap-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

// Mock fetchHtml + fetchSitemapEntries så att vi inte gör riktiga nätverksanrop
const fetchHtmlMock = vi.fn();
vi.mock('../../tools/fetchTools.js', () => ({
  fetchHtml: (...args: unknown[]) => fetchHtmlMock(...args),
  normalizeFetchUrl: (url: string) => url.startsWith('http') ? url : `https://${url}`,
}));

const fetchSitemapEntriesMock = vi.fn();
vi.mock('../tools/scrapingBeeDeep.js', () => ({
  fetchSitemapEntries: (...args: unknown[]) => fetchSitemapEntriesMock(...args),
}));

/** Bygg en sitemap-post som fetchSitemapEntries skulle returnera. */
function entry(loc: string, lastmod = '', isSitemapFile = false) {
  return { loc, lastmod, sitemapUrl: 'https://example.com/sitemap.xml', isSitemapFile };
}

afterEach(() => {
  fetchHtmlMock.mockReset();
  fetchSitemapEntriesMock.mockReset();
});

describe('collectLinks', () => {
  it('skips malformed absolute hrefs without aborting C0 discovery', () => {
    const $ = load(`
      <nav>
        <a href="http://[https://ifk.app.link/dO0tCLUq0Cb%5D(https://ifk.app.link/dO0tCLUq0Cb)">App</a>
        <a href="/evenemang">Evenemang</a>
      </nav>
    `);

    const links = collectLinks($, 'https://ifkgoteborg.se/');

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe('https://ifkgoteborg.se/evenemang');
  });

  it('keeps relative event links when the source URL was a bare domain', () => {
    const $ = load('<nav><a href="/evenemang">Evenemang</a></nav>');

    const links = collectLinks($, normalizeFetchUrl('abf.se/'));

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe('https://abf.se/evenemang');
  });
});

/**
 * Fas 2 tester — sitemap-discovery i discoverEventCandidates()
 * Verifierar att sitemap-URL:er INTE bryter befintligt beteende och att de
 * konkurrerar på lika villkor via samma eventDensityScore-formel.
 *
 * Generalization Protection: vi testar BARA additivt (sitemap = extra kandidat-set).
 * Inga nya IGNORE_PATTERNS, inga nya scoringvikter, inga sajtspecifika tester.
 */
describe('discoverEventCandidates — sitemap discovery (Fas 2)', () => {
  it('returns same result when sitemap is empty (graceful degradation)', async () => {
    // Root: inga interna länkar, ingen sitemap
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: '<html><body><p>No links here</p></body></html>',
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [], sitemapFiles: [], attempts: [],
    });
    // Alla measureEventDensity-anrop returnerar tomma sidor (så inga 35-pattern-hits heller)
    fetchHtmlMock.mockResolvedValue({
      success: true, html: '<html><body></body></html>',
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-empty');

    expect(result.candidatesFound).toBe(0);
    expect(result.winner).toBeUndefined();
    expect(['none', 'swedish-patterns']).toContain(result.ruleApplied.source);
  });

  it('sitemap URLs are added as a kandidat-set with sourceRegion=sitemap', async () => {
    // Root: en evenemangslänk
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: '<html><body><a href="/evenemang">Evenemang</a></body></html>',
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [entry('https://example.com/kalender', '2026-11-01')],
      sitemapFiles: ['https://example.com/sitemap.xml'],
      attempts: ['https://example.com/sitemap.xml'],
    });
    // Alla measureEventDensity-anrop — kalender-URL ger datum/time-taggar (score > 0), andra ger 0
    fetchHtmlMock.mockImplementation(async (url: string) => {
      if (url.includes('/kalender')) {
        return { success: true, html: '<html><body><time datetime="2026-11-15"></time><time datetime="2026-11-22"></time><p>2026-11-15 Konsert</p><p>2026-11-22 Teater</p></body></html>' };
      }
      return { success: true, html: '<html><body></body></html>' };
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-sitemap');

    expect(result.candidatesFound).toBeGreaterThanOrEqual(1);
    const sitemapCandidate = result.topCandidates.find((c) => c.url === 'https://example.com/kalender');
    expect(sitemapCandidate).toBeDefined();
    expect(sitemapCandidate?.sourceRegion).toBe('sitemap');
    expect(sitemapCandidate?.eventDensityScore).toBeGreaterThan(0);
  });

  it('sitemap-URL:er som saknar signaler filtreras bort (minskar brus)', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><p>no links</p></body></html>',
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [entry('https://example.com/about'), entry('https://example.com/contact')],
      sitemapFiles: [], attempts: [],
    });
    // Alla measureEventDensity-anrop returnerar tomma sidor (0 signaler)
    fetchHtmlMock.mockResolvedValue({
      success: true, html: '<html><body></body></html>',
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-no-signal');

    const sitemapCandidates = result.topCandidates.filter((c) => c.sourceRegion === 'sitemap');
    expect(sitemapCandidates).toHaveLength(0);
  });

  it('graceful degradation: sitemap-miss ger oförändrat beteende', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><a href="/evenemang">Evenemang</a></body></html>',
    });
    fetchSitemapEntriesMock.mockRejectedValueOnce(new Error('network timeout'));

    // measureEventDensity för root (0 signaler)
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body></body></html>',
    });
    // measureEventDensity för /evenemang (har signaler)
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><time datetime="2026-11-15"></time><p>2026-11-15 Konsert</p></body></html>',
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-fail');

    expect(result.candidatesFound).toBeGreaterThanOrEqual(1);
    expect(result.winner).toBeDefined();
  });

  /**
   * NEGATIV KONTROLL för sitemap-expansionen (2026-10-24).
   *
   * En .xml-rad i sitemapen är en index-pekare, inte en sida. Om den mäts
   * med HTML-formeln measureEventDensity vinner den densitetsloppet (varje
   * <lastmod> räknas som ett datum) → C1 svarar "no <main>" → källan dör.
   *
   * Bevis: 112 av 112 C-gate-traces med .xml som effectiveUrl slutade i
   * C1_NO_MAIN_ARTICLE, noll lyckades.
   */
  it('sitemap-filer (.xml) mäts aldrig som sidor — de kan inte vinna densitetsloppet', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><p>no links</p></body></html>',
    });
    // En .xml-rad som ser ut som en vanlig sitemap-post
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [entry('https://example.com/event-sitemap.xml', '2026-11-01', true)],
      sitemapFiles: ['https://example.com/sitemap.xml'],
      attempts: [],
    });
    // Om .xml:en mäts skulle den få en density på 2 (ett datum) — vi vill se 0 kandidater
    fetchHtmlMock.mockImplementation(async (url: string) => {
      if (url.includes('.xml')) {
        return { success: true, html: '<html><body><lastmod>2026-11-01</lastmod><lastmod>2026-11-02</lastmod></body></html>' };
      }
      return { success: true, html: '<html><body></body></html>' };
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-xml-skip');

    expect(result.topCandidates.filter((c) => c.sourceRegion === 'sitemap')).toHaveLength(0);
    expect(result.topCandidates.some((c) => c.url.includes('.xml'))).toBe(false);
  });

  /**
   * Nyast ändrade först: <lastmod> styr vilka barn som mäts när sitemapen
   * har fler barn än MAX_CANDIDATES_TO_FETCH.
   */
  it('sitemap-barn ordnas på <lastmod> — nyast ändrade mäts först', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><p>no links</p></body></html>',
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [
        entry('https://example.com/gammal', '2026-01-01'),
        entry('https://example.com/ny', '2026-12-01'),
        entry('https://example.com/mellan', '2026-06-01'),
      ],
      sitemapFiles: [], attempts: [],
    });
    const measured: string[] = [];
    fetchHtmlMock.mockImplementation(async (url: string) => {
      measured.push(url);
      return { success: true, html: '<html><body><time datetime="2026-11-15"></time></body></html>' };
    });

    await discoverEventCandidates('https://example.com/', undefined, 'test-lastmod');

    expect(measured).toContain('https://example.com/ny');
    expect(measured.indexOf('https://example.com/ny')).toBeLessThan(measured.indexOf('https://example.com/mellan'));
    expect(measured.indexOf('https://example.com/mellan')).toBeLessThan(measured.indexOf('https://example.com/gammal'));
  });
});

/**
 * Steg 4 tester — inlänk-räkning som tiebreaker.
 * Verifierar att:
 * - Kandidater har inboundCount och finalScore satta
 * - Kandidater med samma eventDensityScore men fler inlänkar vinner
 * - Kandidater med 0 inlänkar fortfarande är giltiga (log2(1)=0 → oförändrat)
 * - Sitemap-URL:er utan inlänkar konkurrerar rättvist
 *
 * Generalization Protection: vi testar BARA additivt (inboundCount + finalScore
 * är nya fält, ingen befintlig sortering ändras om inlänkar=0).
 */
describe('discoverEventCandidates — inlänk-räkning (Steg 4)', () => {
  it('kandidater har inboundCount + finalScore satta (default 0 / oförändrat)', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: '<html><body><a href="/evenemang">Evenemang</a></body></html>',
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [], sitemapFiles: [], attempts: [],
    });
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body></body></html>', // root density
    });
    fetchHtmlMock.mockResolvedValueOnce({
      success: true, html: '<html><body><time datetime="2026-11-15"></time><p>2026-11-15 Konsert</p></body></html>',
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-inbound-default');

    const c = result.topCandidates.find((c) => c.url === 'https://example.com/evenemang');
    expect(c).toBeDefined();
    expect(c?.inboundCount).toBe(1); // länken finns 1 gång på root
    expect(c?.finalScore).toBeGreaterThan(c!.eventDensityScore); // log2(1+1)=1, så finalScore = score + 1
  });

  it('kandidat med fler inlänkar vinner tiebreak vid samma eventDensityScore', async () => {
    // Root med TVÅ evenemangslänkar — den ena länkas 3 ggr (populär), den andra 1 gång
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: `
        <html><body>
          <a href="/popular">Populär evenemang</a>
          <a href="/popular">Populär</a>
          <a href="/popular">Populär igen</a>
          <a href="/niche">Nisch evenemang</a>
        </body></html>
      `,
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [], sitemapFiles: [], attempts: [],
    });
    // Mät density: alla returnerar samma innehåll → samma eventDensityScore
    fetchHtmlMock.mockImplementation(async () => ({
      success: true,
      html: '<html><body><time datetime="2026-11-15"></time><p>2026-11-15 Konsert</p></body></html>',
    }));

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-tiebreak');

    expect(result.winner).toBeDefined();
    // Vinnaren ska vara den populära (3 inlänkar) eftersom eventDensityScore är identisk
    expect(result.winner?.url).toBe('https://example.com/popular');
    expect(result.winner?.inboundCount).toBe(3);
  });

  it('sitemap-URL med 0 inlänkar får finalScore = eventDensityScore (log2(1)=0)', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: '<html><body></body></html>', // root utan några evenemangslänkar
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [entry('https://example.com/kalender')],
      sitemapFiles: ['https://example.com/sitemap.xml'],
      attempts: ['https://example.com/sitemap.xml'],
    });
    fetchHtmlMock.mockImplementation(async (url: string) => {
      if (url.includes('/kalender')) {
        return {
          success: true,
          html: '<html><body><time datetime="2026-11-15"></time><time datetime="2026-11-22"></time><p>2026-11-15 Konsert</p><p>2026-11-22 Teater</p></body></html>',
        };
      }
      return { success: true, html: '<html><body></body></html>' };
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-sitemap-inbound');

    const c = result.topCandidates.find((c) => c.sourceRegion === 'sitemap');
    expect(c).toBeDefined();
    expect(c?.inboundCount).toBe(0); // sitemap-URL finns inte på root
    expect(c?.finalScore).toBe(c!.eventDensityScore); // log2(0+1)=0
  });

  it('inlänk-räkning ignorerar externa länkar (same-origin check)', async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      success: true,
      html: `
        <html><body>
          <a href="https://external.com/foo">External</a>
          <a href="https://external.com/foo">External 2</a>
          <a href="https://external.com/foo">External 3</a>
          <a href="/evenemang">Evenemang</a>
        </body></html>
      `,
    });
    fetchSitemapEntriesMock.mockResolvedValueOnce({
      entries: [], sitemapFiles: [], attempts: [],
    });
    fetchHtmlMock.mockImplementation(async (url: string) => {
      if (url.includes('/evenemang')) {
        return { success: true, html: '<html><body><time datetime="2026-11-15"></time><p>2026-11-15 Konsert</p></body></html>' };
      }
      return { success: true, html: '<html><body></body></html>' };
    });

    const result = await discoverEventCandidates('https://example.com/', undefined, 'test-external');

    const c = result.topCandidates.find((c) => c.url === 'https://example.com/evenemang');
    expect(c).toBeDefined();
    expect(c?.inboundCount).toBe(1); // bara den interna länken räknas
  });
});
