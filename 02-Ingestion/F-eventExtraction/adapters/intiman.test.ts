/**
 * Intiman.se adapter tests — uses synthetic HTML fixtures (no production data).
 */
import { describe, it, expect } from 'vitest';
import * as intiman from './intiman';

const DETAIL_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Emil i Lönneberga | Intiman</title>
  <meta property="og:title" content="Emil i Lönneberga" />
  <meta property="og:description" content="En klassisk barnteater om Emil från Lönneberga." />
</head>
<body>
  <article>
    <h1>Emil i Lönneberga</h1>
    <p>Spelas 19 sep - 29 nov 2026</p>
    <p>Föreställningslängd: Ca 2 timmar inkl</p>
    <p>Pris: från 395 kr</p>
    <p>Lördag 19 sep, 18:00 • Intiman, Stockholm från 395 kr / person</p>
    <p>Söndag 20 sep, 14:00 • Intiman, Stockholm från 395 kr / person</p>
    <p>Söndag 27 sep, 11:30 • Intiman, Stockholm från 395 kr / person</p>
    <p>Söndag 27 sep, 15:00 • Intiman, Stockholm från 395 kr / person</p>
  </article>
</body>
</html>
`;

const LISTING_HTML = `
<a href="https://www.intiman.se/shower/oss-swingers-emellan">Oss Swingers Emellan</a>
<a href="https://www.intiman.se/shower/emil-i-lonneberga ">Emil</a>
<a href="https://www.intiman.se/shower/marika-carlsson-och-klimakteriet ">Marika</a>
<a href="https://www.intiman.se/shower/emil-i-lonneberga ">Emil duplicate</a>
`;

describe('intiman adapter', () => {
  describe('matches', () => {
    it('matches intiman.se URLs', () => {
      expect(intiman.matches('https://www.intiman.se/forestallningar/')).toBe(true);
      expect(intiman.matches('https://intiman.se/shower/foo')).toBe(true);
    });
    it('rejects other domains', () => {
      expect(intiman.matches('https://example.com/forestallningar/')).toBe(false);
      expect(intiman.matches('not-a-url')).toBe(false);
    });
  });

  describe('detail page extraction', () => {
    it('extracts multiple performance dates from "Spelas" range', () => {
      const r = intiman.extract(DETAIL_HTML, 'https://www.intiman.se/shower/emil-i-lonneberga');
      expect(r.method).toBe('intiman-detail');
      expect(r.events.length).toBe(4);
      expect(r.events[0].date).toBe('2026-09-19');
      expect(r.events[0].time).toBe('18:00');
      expect(r.events[0].title).toBe('Emil i Lönneberga');
      expect(r.events[0].venue).toBe('Intiman');
      expect(r.events[0].city).toBe('Stockholm');
      expect(r.events[0].priceMin).toBe(395);
      expect(r.events[0].category).toBe('theater');
    });

    it('dedupes (time,date) pairs', () => {
      const dup = DETAIL_HTML.replace(
        '<p>Lördag 19 sep, 18:00 • Intiman, Stockholm från 395 kr / person</p>',
        '<p>Lördag 19 sep, 18:00 • Intiman, Stockholm från 395 kr / person</p><p>Lördag 19 sep, 18:00 • dup</p>'
      );
      const r = intiman.extract(dup, 'https://www.intiman.se/shower/emil-i-lonneberga');
      const keys = r.events.map((e) => `${e.date}|${e.time}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('falls back to current year if no Spelas line', () => {
      const html = DETAIL_HTML.replace(/<p>Spelas[\s\S]*?2026<\/p>/, '');
      const r = intiman.extract(html, 'https://www.intiman.se/shower/emil-i-lonneberga');
      const expectedYear = new Date().getFullYear();
      expect(r.events[0]?.date.startsWith(`${expectedYear}-`)).toBe(true);
    });

    it('returns method=none for non-intiman URLs', () => {
      const r = intiman.extract(DETAIL_HTML, 'https://example.com/shower/x');
      expect(r.method).toBe('none');
      expect(r.events.length).toBe(0);
    });
  });

  describe('listing page extraction', () => {
    it('extracts show URLs from /forestallningar/', () => {
      const r = intiman.extract(LISTING_HTML, 'https://www.intiman.se/forestallningar/');
      expect(r.method).toBe('intiman-listing');
      expect(r.showUrls.length).toBe(3);
      expect(r.showUrls).toContain('https://www.intiman.se/shower/emil-i-lonneberga');
    });
  });
});
