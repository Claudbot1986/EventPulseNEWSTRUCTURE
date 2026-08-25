import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { collectLinks } from './C0-htmlFrontierDiscovery.js';
import { normalizeFetchUrl } from '../../tools/fetchTools.js';

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
