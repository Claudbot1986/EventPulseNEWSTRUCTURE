/**
 * Folkoperan.se adapter tests — synthetic HTML fixtures
 */
import { describe, it, expect } from 'vitest';
import * as folkoperan from './folkoperan';

const BUYINGFLOW_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Folkoperan - Jag är Ulla Winblad - Biljetter</title>
  <meta property="og:title" content="Folkoperan" />
  <meta property="og:description" content="Opera" />
  <meta property="og:image" content="https://folkoperan.se/wp-content/uploads/ulla.jpg" />
</head>
<body>
  <script>
    var items = [
      {"item_name": "Jag är Ulla Winblad-2026-09-19 18:00:00", "item_id": 111, "price": 210.0},
      {"item_name": "Jag är Ulla Winblad-2026-09-20 15:00:00", "item_id": 112, "price": 160.0},
      {"item_name": "Jag är Ulla Winblad URPREMIÄR-2026-09-17 19:00:00", "item_id": 110, "price": 210.0},
      {"item_name": "Jag är Ulla Winblad-2026-09-19 18:00:00", "item_id": 111, "price": 210.0}
    ];
  </script>
</body>
</html>
`;

const LISTING_HTML = `
<!doctype html>
<html lang="sv">
<head><title>På scen - Folkoperan</title></head>
<body>
  <article>
    <h3>Jag är Ulla Winblad</h3>
    <a href="https://biljetter.folkoperan.se/sv/buyingflow/tickets/28108/">Köp biljetter</a>
  </article>
  <article>
    <h3>Nietzsche kontra Wagner</h3>
    <a href="https://biljetter.folkoperan.se/sv/buyingflow/tickets/28109/">Köp biljetter</a>
  </article>
  <article>
    <h3>Die Stadt ohne Juden</h3>
    <a href="https://biljetter.folkoperan.se/sv/buyingflow/tickets/29150/">Köp biljetter</a>
  </article>
  <article>
    <h3>Die Stadt ohne Juden dup</h3>
    <a href="https://biljetter.folkoperan.se/sv/buyingflow/tickets/29150">Köp biljetter</a>
  </article>
</body>
</html>
`;

describe('folkoperan adapter', () => {
  describe('matches', () => {
    it('matches folkoperan.se URLs', () => {
      expect(folkoperan.matches('https://folkoperan.se/pa-scen/')).toBe(true);
      expect(folkoperan.matches('https://www.folkoperan.se/uppsattningar/foo/')).toBe(true);
    });
    it('rejects other domains', () => {
      expect(folkoperan.matches('https://example.com/pa-scen/')).toBe(false);
      expect(folkoperan.matches('not-a-url')).toBe(false);
    });
  });

  describe('buyingflow extraction', () => {
    it('extracts individual performances from item_name JSON', () => {
      const r = folkoperan.extract(
        BUYINGFLOW_HTML,
        'https://biljetter.folkoperan.se/sv/buyingflow/tickets/28108/'
      );
      expect(r.method).toBe('folkoperan-tickets');
      expect(r.events.length).toBe(3); // 4 entries, 1 dedup
      expect(r.events[0].title).toBe('Jag är Ulla Winblad');
      expect(r.events[0].date).toBe('2026-09-19');
      expect(r.events[0].time).toBe('18:00');
      expect(r.events[0].venue).toBe('Folkoperan');
      expect(r.events[0].city).toBe('Stockholm');
      expect(r.events[0].priceMin).toBe(210);
      expect(r.events[0].category).toBe('opera');
      // All three dates represented
      expect(r.events.map((e) => e.date).sort()).toEqual([
        '2026-09-17',
        '2026-09-19',
        '2026-09-20',
      ]);
    });

    it('returns method=none for non-folkoperan URL', () => {
      const r = folkoperan.extract(
        BUYINGFLOW_HTML,
        'https://example.com/buyingflow/tickets/28108/'
      );
      expect(r.method).toBe('none');
    });
  });

  describe('listing extraction', () => {
    it('extracts buyingflow URLs from /pa-scen/ (deduped)', () => {
      const r = folkoperan.extract(LISTING_HTML, 'https://folkoperan.se/pa-scen/');
      expect(r.method).toBe('folkoperan-listing');
      expect(r.showUrls.length).toBe(3);
      expect(r.showUrls).toContain('https://biljetter.folkoperan.se/sv/buyingflow/tickets/28108/');
    });
  });

  // 2026-09-27 regression tests — site-specific bundle page where <title> is
  // generic ("Folkoperan") and item_name is the only source of real titles.
  // Without per-item title extraction, all events get title="Folkoperan".
  describe('subscription bundle page (regression: title=Folkoperan)', () => {
    const BUNDLE_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Folkoperan - Folkoperan - Biljetter</title>
  <meta property="og:title" content="Folkoperan" />
</head>
<body>
  <script>
    var items = [
      {"item_name": "Nietzsche kontra Wagner-2026-09-27 15:00:00", "price": 210.0},
      {"item_name": "Die Stadt ohne Juden-2026-09-29 19:00:00", "price": 210.0},
      {"item_name": "Jag är Ulla Winblad-2026-09-30 18:00:00", "price": 210.0}
    ];
  </script>
</body>
</html>`;

    it('uses per-item title from item_name, not the generic <title>', () => {
      const r = folkoperan.extract(
        BUNDLE_HTML,
        'https://biljetter.folkoperan.se/sv/buyingflow/tickets/20311/'
      );
      expect(r.method).toBe('folkoperan-tickets');
      expect(r.events.length).toBe(3);
      const titles = r.events.map((e) => e.title).sort();
      expect(titles).toEqual([
        'Die Stadt ohne Juden',
        'Jag är Ulla Winblad',
        'Nietzsche kontra Wagner',
      ]);
      // None should have title="Folkoperan" (the page title)
      expect(r.events.every((e) => e.title !== 'Folkoperan')).toBe(true);
    });
  });

  describe('HTML entity decoding in item_name (regression)', () => {
    const ENTITY_HTML = `
<!doctype html>
<html lang="sv">
<head><title>Folkoperan - Test - Biljetter</title></head>
<body>
  <script>
    var items = [
      {"item_name": "Den ljusa natten &#8211; premi&#228;r-2026-11-02 19:00:00", "price": 250.0},
      {"item_name": "Caf&#233; &amp; opera &#8211; gala-2026-11-03 18:00:00", "price": 250.0}
    ];
  </script>
</body>
</html>`;

    it('decodes numeric HTML entities in item_name titles', () => {
      const r = folkoperan.extract(
        ENTITY_HTML,
        'https://biljetter.folkoperan.se/sv/buyingflow/tickets/28150/'
      );
      expect(r.method).toBe('folkoperan-tickets');
      expect(r.events.length).toBe(2);
      const titles = r.events.map((e) => e.title).sort();
      // &#8211; = en-dash, &#228; = ä, &#233; = é, &amp; = &
      expect(titles).toEqual([
        'Café & opera – gala',
        'Den ljusa natten – premiär',
      ]);
    });
  });
});
