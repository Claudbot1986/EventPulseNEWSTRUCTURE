/**
 * ArkDes.se adapter tests — synthetic HTML fixtures
 */
import { describe, it, expect } from 'vitest';
import * as arkdes from './arkdes';

const DETAIL_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Design-bar: Sjukhus, fängelser och SiS-hem - ArkDes</title>
  <meta property="og:title" content="Design-bar: Sjukhus, fängelser och SiS-hem - ArkDes" />
  <meta property="og:description" content="Design-bar om utformning av vårdmiljöer." />
  <meta property="og:image" content="https://arkdes.se/wp-content/uploads/2024/12/example.jpg" />
</head>
<body>
  <article>
    <h1>Design-bar: Sjukhus, fängelser och SiS-hem</h1>
    <div id="content-nar">
      <p>Tisdag, 8 december 2026</p>
      <p>Klockan 17:30–19:00</p>
    </div>
    <div id="content-var">
      <p>Torget</p>
    </div>
  </article>
</body>
</html>
`;

const DETAIL_HTML_KLOCKAN_COLON = `
<!doctype html>
<html lang="sv">
<head>
  <meta property="og:title" content="Lansering av NORA 2026 - ArkDes" />
</head>
<body>
  <article>
    <h1>Lansering av NORA 2026</h1>
    <div id="content-nar">
      <p>Lördag, 2 maj 2026</p>
      <p>Klockan: 13:00–14:00</p>
    </div>
    <div id="content-var">
      <p>ArkDes Studio</p>
    </div>
  </article>
</body>
</html>
`;

const LISTING_HTML = `
<a href="/kalender/design-bar-sjukhus-fangelser-och-sis-hem">Design-bar</a>
<a href="/kalender/visning-av-worldglimpsing">Visning</a>
<a href="/kalender/design-bar-sjukhus-fangelser-och-sis-hem">dup</a>
<a href="/kalender/?week_offset=1">Paginate</a>
`;

describe('arkdes adapter', () => {
  describe('matches', () => {
    it('matches arkdes.se URLs', () => {
      expect(arkdes.matches('https://www.arkdes.se/kalender/')).toBe(true);
      expect(arkdes.matches('https://arkdes.se/kalender/foo/')).toBe(true);
    });
    it('rejects other domains', () => {
      expect(arkdes.matches('https://example.com/kalender/')).toBe(false);
      expect(arkdes.matches('not-a-url')).toBe(false);
    });
  });

  describe('detail extraction', () => {
    it('extracts single date + Klockan range + Var', () => {
      const r = arkdes.extract(DETAIL_HTML, 'https://www.arkdes.se/kalender/design-bar-sjukhus-fangelser-och-sis-hem/');
      expect(r.method).toBe('arkdes-detail');
      expect(r.events.length).toBe(1);
      expect(r.events[0].date).toBe('2026-12-08');
      expect(r.events[0].time).toBe('17:30');
      expect(r.events[0].endTime).toBe('19:00');
      expect(r.events[0].title).toBe('Design-bar: Sjukhus, fängelser och SiS-hem');
      expect(r.events[0].venue).toBe('ArkDes – Torget');
      expect(r.events[0].city).toBe('Stockholm');
      expect(r.events[0].category).toBe('design');
    });

    it('parses Klockan: HH:MM–HH:MM (with colon after Klockan)', () => {
      const r = arkdes.extract(DETAIL_HTML_KLOCKAN_COLON, 'https://www.arkdes.se/kalender/lansering-av-nora-2026/');
      expect(r.events[0].date).toBe('2026-05-02');
      expect(r.events[0].time).toBe('13:00');
      expect(r.events[0].endTime).toBe('14:00');
      expect(r.events[0].venue).toBe('ArkDes – ArkDes Studio');
    });

    it('returns method=none for non-arkdes URL', () => {
      const r = arkdes.extract(DETAIL_HTML, 'https://example.com/kalender/x/');
      expect(r.method).toBe('none');
      expect(r.events.length).toBe(0);
    });

    it('returns method=none for arkdes URL without När section', () => {
      const html = '<html><body><h1>No dates</h1></body></html>';
      const r = arkdes.extract(html, 'https://www.arkdes.se/kalender/no-dates/');
      expect(r.method).toBe('none');
    });
  });

  describe('listing extraction', () => {
    it('extracts /kalender/{slug}/ URLs (deduped)', () => {
      const r = arkdes.extract(LISTING_HTML, 'https://www.arkdes.se/kalender/');
      expect(r.method).toBe('arkdes-listing');
      expect(r.showUrls.length).toBe(2);
      expect(r.showUrls).toContain('https://www.arkdes.se/kalender/design-bar-sjukhus-fangelser-och-sis-hem');
    });
  });
});
