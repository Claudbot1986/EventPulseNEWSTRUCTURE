/**
 * Tests for Step 2 (sitemap + robots.txt discovery).
 *
 * Covers:
 *   - parseXmlSitemap: standard XML, multi-loc, malformed
 *   - fetchRobotsSitemaps: extracts Sitemap: directives, case-insensitive
 *   - discoverSitemaps: union of robots-directiv + SITEMAP_VARIANTS, dedup
 *   - fetchAllSitemaps: end-to-end (with mocked fetchHtml) — returns deduped URLs
 *
 * Uses real tmpdir + EVENTPULSE_SANDBOX_ROOT so the path resolution goes through
 * the same code path as production. Network access is mocked via fetchHtml shim
 * by injecting a fake fetchHtml before the tests run.
 *
 * Generalization Protection: Inga IGNORE_PATTERNS- eller scoring-ändringar —
 * vi testar additivt på befintlig kod.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const sandbox = mkdtempSync(join(tmpdir(), 'scrapingbee-sitemap-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

// Mock fetchHtml INNAN import av scrapingBeeDeep
// Detta gör att vi inte gör riktiga nätverksanrop i tester.
const fetchHtmlMock = vi.fn();
vi.mock('../../../02-Ingestion/tools/fetchTools.js', () => ({
  fetchHtml: (...args: unknown[]) => fetchHtmlMock(...args),
}));

// Importera EFTER mock
const {
  parseXmlSitemap,
  fetchRobotsSitemaps,
  discoverSitemaps,
  fetchAllSitemaps,
  _clearRobotsCache,
} = await import('./scrapingBeeDeep.js');

afterEach(() => {
  fetchHtmlMock.mockReset();
  _clearRobotsCache();
});

describe('Step 2 — sitemap + robots.txt discovery', () => {
  describe('parseXmlSitemap', () => {
    it('extracts single <loc>', () => {
      const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>`;
      expect(parseXmlSitemap(xml)).toEqual(['https://example.com/']);
    });

    it('extracts multiple <loc> URLs in order', () => {
      const xml = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
  <url><loc>https://example.com/c</loc></url>
</urlset>`;
      expect(parseXmlSitemap(xml)).toEqual([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]);
    });

    it('returns empty array for empty XML', () => {
      expect(parseXmlSitemap('')).toEqual([]);
    });

    it('returns empty array for XML without <loc>', () => {
      const xml = `<?xml version="1.0"?><urlset></urlset>`;
      expect(parseXmlSitemap(xml)).toEqual([]);
    });

    it('handles mixed case and whitespace in <loc> tag', () => {
      const xml = `<URLSet><URL><LOC>https://x.com/1</LOC></URL></URLSet>`;
      expect(parseXmlSitemap(xml)).toEqual(['https://x.com/1']);
    });
  });

  describe('fetchRobotsSitemaps', () => {
    it('extracts Sitemap: directive from robots.txt', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\n`,
      });

      const result = await fetchRobotsSitemaps('https://example.com/');
      expect(result.success).toBe(true);
      expect(result.urls).toEqual(['https://example.com/sitemap.xml']);
      expect(result.robotsUrl).toBe('https://example.com/robots.txt');
    });

    it('extracts multiple Sitemap: directives', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `User-agent: *\nSitemap: https://example.com/sitemap-main.xml\nSitemap: https://example.com/sitemap-events.xml\n`,
      });

      const result = await fetchRobotsSitemaps('https://example.com/');
      expect(result.urls).toEqual([
        'https://example.com/sitemap-main.xml',
        'https://example.com/sitemap-events.xml',
      ]);
    });

    it('is case-insensitive for Sitemap: keyword', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `SITEMAP: https://x.com/sitemap.xml\nsitemap: https://x.com/sitemap-2.xml\n`,
      });

      const result = await fetchRobotsSitemaps('https://x.com/');
      expect(result.urls).toEqual([
        'https://x.com/sitemap.xml',
        'https://x.com/sitemap-2.xml',
      ]);
    });

    it('returns empty when robots.txt has no Sitemap:', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `User-agent: *\nDisallow: /private\nAllow: /\n`,
      });

      const result = await fetchRobotsSitemaps('https://x.com/');
      expect(result.success).toBe(true);
      expect(result.urls).toEqual([]);
    });

    it('returns success=false when robots.txt fetch fails', async () => {
      fetchHtmlMock.mockResolvedValueOnce({ success: false, html: '' });

      const result = await fetchRobotsSitemaps('https://x.com/');
      expect(result.success).toBe(false);
      expect(result.urls).toEqual([]);
    });

    it('skips invalid Sitemap: URLs', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `Sitemap: not-a-url\nSitemap: ftp://wrong.com/sitemap.xml\nSitemap: https://valid.com/sitemap.xml\n`,
      });

      const result = await fetchRobotsSitemaps('https://valid.com/');
      // Ogiltiga URLs filtreras bort; endast http/https behålls
      expect(result.urls).toEqual(['https://valid.com/sitemap.xml']);
    });

    it('skips comment lines and blank lines', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `# This is a comment\n\nUser-agent: *\n# Sitemap: https://commented.com/sitemap.xml\nSitemap: https://real.com/sitemap.xml\n`,
      });

      const result = await fetchRobotsSitemaps('https://real.com/');
      expect(result.urls).toEqual(['https://real.com/sitemap.xml']);
    });
  });

  describe('discoverSitemaps', () => {
    it('returns union of robots-directiv + SITEMAP_VARIANTS, deduplicated', async () => {
      // robots.txt anger 1 unik sitemap
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `Sitemap: https://example.com/extra-sitemap.xml\n`,
      });

      const result = await discoverSitemaps('https://example.com/');
      // Förväntar: 1 robots-URL + 4 standard-varianter (sitemap.xml,
      // sitemap-index.xml, wp-sitemap.xml, sitemap.xml.gz)
      expect(result.urls.length).toBe(5);
      expect(result.urls).toContain('https://example.com/extra-sitemap.xml');
      expect(result.urls).toContain('https://example.com/sitemap.xml');
      expect(result.urls).toContain('https://example.com/sitemap-index.xml');
      expect(result.urls).toContain('https://example.com/wp-sitemap.xml');
      expect(result.urls).toContain('https://example.com/sitemap.xml.gz');
      expect(result.robotsSuccess).toBe(true);
    });

    it('handles robots.txt failure gracefully (returns just variants)', async () => {
      fetchHtmlMock.mockResolvedValueOnce({ success: false, html: '' });

      const result = await discoverSitemaps('https://example.com/');
      expect(result.robotsSuccess).toBe(false);
      expect(result.urls.length).toBe(4); // bara standard-varianter
    });

    it('deduplicates when robots-directiv overlaps with a standard variant', async () => {
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `Sitemap: https://example.com/sitemap.xml\n`, // overlappar med variant
      });

      const result = await discoverSitemaps('https://example.com/');
      // Räkna unika URLs
      const unique = new Set(result.urls);
      expect(unique.size).toBe(result.urls.length);
      expect(result.urls).toContain('https://example.com/sitemap.xml');
    });
  });

  describe('fetchAllSitemaps', () => {
    it('fetches and combines URLs from robots-sitemap + standard variants', async () => {
      // Först: robots.txt
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `Sitemap: https://example.com/from-robots.xml\n`,
      });
      // Sedan: försök hämta från-robots.xml → 2 URLs
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `<?xml version="1.0"?><urlset><url><loc>https://example.com/robots-a</loc></url><url><loc>https://example.com/robots-b</loc></url></urlset>`,
      });
      // Standard sitemap.xml → 2 URLs
      fetchHtmlMock.mockResolvedValueOnce({
        success: true,
        html: `<?xml version="1.0"?><urlset><url><loc>https://example.com/std-a</loc></url><url><loc>https://example.com/std-b</loc></url></urlset>`,
      });
      // Övriga standard-varianter → tomma/misslyckade
      fetchHtmlMock.mockResolvedValue({ success: false, html: '' });

      const result = await fetchAllSitemaps('https://example.com/');
      expect(result.found).toBe(true);
      expect(result.urls).toContain('https://example.com/robots-a');
      expect(result.urls).toContain('https://example.com/robots-b');
      expect(result.urls).toContain('https://example.com/std-a');
      expect(result.urls).toContain('https://example.com/std-b');
      expect(result.urls.length).toBe(4); // deduped
      expect(result.sources).toContain('https://example.com/from-robots.xml');
      expect(result.sources).toContain('https://example.com/sitemap.xml');
    });

    it('returns found=false when nothing succeeds', async () => {
      fetchHtmlMock.mockResolvedValueOnce({ success: false, html: '' }); // robots
      fetchHtmlMock.mockResolvedValue({ success: false, html: '' }); // all variants

      const result = await fetchAllSitemaps('https://example.com/');
      expect(result.found).toBe(false);
      expect(result.urls).toEqual([]);
    });
  });
});
