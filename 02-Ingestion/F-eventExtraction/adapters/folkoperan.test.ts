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
});
