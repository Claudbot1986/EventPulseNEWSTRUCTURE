import { describe, it, expect } from 'vitest';
import {
  parseSitemapXml,
  sitemapCandidates,
  filterEventUrls,
  selectEventUrls,
  buildCandidateUrls,
} from './sitemapDiscovery.mjs';

describe('sitemap-upptäckt', () => {
  it('läser <loc> och <lastmod> ur en urlset', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://aik.se/evenemang/gammalt</loc><lastmod>2021-01-01T00:00:00+01:00</lastmod></url>
        <url><loc>https://aik.se/evenemang/nytt</loc><lastmod>2026-10-20T00:00:00+02:00</lastmod></url>
      </urlset>`;
    const { urls, subSitemaps } = parseSitemapXml(xml);
    expect(urls).toHaveLength(2);
    expect(urls[0].url).toBe('https://aik.se/evenemang/gammalt');
    expect(urls[0].lastmod).toBe('2021-01-01T00:00:00+01:00');
    expect(urls[1].lastmod).toBe('2026-10-20T00:00:00+02:00');
    expect(subSitemaps).toHaveLength(0);
  });

  it('läser en sitemap-index som sub-sitemaps, inte som URL:er', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex>
        <sitemap><loc>https://x.se/sitemap-1.xml</loc><lastmod>2026-01-01</lastmod></sitemap>
        <sitemap><loc>https://x.se/sitemap-2.xml</loc></sitemap>
      </sitemapindex>`;
    const { urls, subSitemaps } = parseSitemapXml(xml);
    expect(urls).toHaveLength(0);
    expect(subSitemaps).toEqual(['https://x.se/sitemap-1.xml', 'https://x.se/sitemap-2.xml']);
  });
});

describe('sitemap-sökväg', () => {
  it('söker vid URSPRUNGET — inte på källans undersida', () => {
    // Mätt 2026-10-24: 133 av 189 spårade källor hittade ingen sitemap,
    // för att /sitemap.xml appendades på hela URL:en. dansenshusse pekar på
    // /sthlm-dans/ — sökvägen /sthlm-dans/sitemap.xml ger 404.
    const cands = sitemapCandidates('https://dansenshus.se/sthlm-dans/');
    expect(cands).toContain('https://dansenshus.se/sitemap.xml');
    expect(cands).toContain('https://dansenshus.se/sitemap_index.xml');
    expect(cands).toContain('https://dansenshus.se/wp-sitemap.xml');
    // Ursprungskandidaterna provar FÖRST. Den gamla sökvägen finns kvar
    // som sista utväg — vissa sajter lägger sin sitemap under undersidan.
    expect(cands.indexOf('https://dansenshus.se/sitemap.xml')).toBeLessThan(
      cands.indexOf('https://dansenshus.se/sthlm-dans/sitemap.xml'),
    );
  });

  it('behåller en sitemap-URL som den är', () => {
    expect(sitemapCandidates('https://x.se/sitemap.xml')).toEqual(['https://x.se/sitemap.xml']);
  });
});

describe('URL-urval', () => {
  const withDates = (urls) =>
    urls.map((u, i) => ({ url: u, lastmod: `2026-01-${String(i + 1).padStart(2, '0')}` }));

  it('väljer de NYASTE via <lastmod>, inte sitemapsens huvud', () => {
    // Negativ kontroll: huvudposten (arkivet) får INTE väljas.
    const entries = withDates([
      'https://aik.se/evenemang/arkiv-2021',
      'https://aik.se/evenemang/arkiv-2022',
      'https://aik.se/evenemang/aktuellt-2026',
    ]);
    const picked = selectEventUrls(entries, 1);
    expect(picked[0].url).toBe('https://aik.se/evenemang/aktuellt-2026');
    expect(picked.map((p) => p.url)).not.toContain('https://aik.se/evenemang/arkiv-2021');
  });

  it('tar slutet av sitemapsen när <lastmod> saknas', () => {
    // sprakmuseet har ingen <lastmod> (mätt). Där är ordningen enda signalen,
    // och de nya posterna ligger sist.
    const entries = [
      { url: 'https://sprakmuseet.se/program/gammalt', lastmod: null },
      { url: 'https://sprakmuseet.se/program/nytt', lastmod: null },
    ];
    const picked = selectEventUrls(entries, 1);
    expect(picked[0].url).toBe('https://sprakmuseet.se/program/nytt');
  });

  it('behåller ordningen när det finns färre poster än max', () => {
    const entries = withDates(['https://aik.se/evenemang/a', 'https://aik.se/evenemang/b']);
    expect(selectEventUrls(entries, 15).map((e) => e.url)).toEqual([
      'https://aik.se/evenemang/a',
      'https://aik.se/evenemang/b',
    ]);
  });

  it('filtrerar bort svarta listan och icke-event-URL:er', () => {
    const entries = [
      { url: 'https://x.se/wp-content/uploads/a.jpg', lastmod: null },
      { url: 'https://x.se/tag/jazz', lastmod: null },
      { url: 'https://x.se/evenemang/konsert', lastmod: null },
      { url: 'https://x.se/om-oss', lastmod: null },
    ];
    expect(filterEventUrls(entries).map((e) => e.url)).toEqual(['https://x.se/evenemang/konsert']);
  });
});

describe('kandidatmängd', () => {
  it('tar MED källans egen URL — en källa kan peka rakt på en event-sida', () => {
    // Mätt 2026-10-24: 124 framtida events ligger på källans egen URL.
    // Utan den regeln är t.ex. nalen.com/sv/konsert/kleerup tom.
    const cands = buildCandidateUrls('https://nalen.com/sv/konsert/kleerup', [
      'https://nalen.com/evenemang/annat',
    ]);
    expect(cands[0]).toBe('https://nalen.com/sv/konsert/kleerup');
    expect(cands).toContain('https://nalen.com/evenemang/annat');
  });

  it('dubblar inte källans URL när sitemapsen också har den', () => {
    const cands = buildCandidateUrls('https://x.se/evenemang/a', [
      'https://x.se/evenemang/a',
      'https://x.se/evenemang/b',
    ]);
    expect(cands).toEqual(['https://x.se/evenemang/a', 'https://x.se/evenemang/b']);
  });

  it('fungerar när sitemapsen gav inget alls', () => {
    expect(buildCandidateUrls('https://x.se/konsert', [])).toEqual(['https://x.se/konsert']);
  });
});
