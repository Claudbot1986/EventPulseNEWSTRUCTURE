/**
 * VisitStockholm.com adapter tests — uses synthetic HTML fixtures
 * modelled on the real CSS-module structure of visitstockholm.com (verified 2026-08-21).
 */
import { describe, it, expect } from 'vitest';
import * as visitstockholm from './visitstockholm';
import { ParsedEventSchema } from '../schema';

const LISTING_HTML = `
<!doctype html>
<html lang="en">
<head><title>Events in Stockholm — Visit Stockholm</title></head>
<body>
  <div class="CardEvent_CardEvent__krQlj CardEvent_CardEvent--White__W1mpg">
    <a class="CardEvent_CardEvent__Link__djuiF" href="https://www.visitstockholm.com/events/summer-at-konserthuset-stockholm/next/">
      <span class="sr-only">Summer at Konserthuset Stockholm</span>
    </a>
    <div class="CardEvent_CardEventPicture__caj5t">
      <span class="CardEvent_CardEventPicture__CategoryText__vT9pL">Music</span>
    </div>
    <h3 class="CardEvent_CardEvent__Title__62k9h">Summer at Konserthuset Stockholm</h3>
    <div class="CardEvent_CardEvent__Meta__dRH1L">
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Calendar icon</span><span>Aug 21 - Aug 23</span>
      </div>
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Location icon</span><span>Konserthuset Stockholm</span>
      </div>
    </div>
  </div>

  <div class="CardEvent_CardEvent__krQlj CardEvent_CardEvent--White__W1mpg">
    <a class="CardEvent_CardEvent__Link__djuiF" href="https://www.visitstockholm.com/events/guided-kayak-tour/next/">
      <span class="sr-only">Guided Kayak Tour</span>
    </a>
    <div class="CardEvent_CardEventPicture__caj5t">
      <span class="CardEvent_CardEventPicture__CategoryText__vT9pL">Guided tours</span>
    </div>
    <h3 class="CardEvent_CardEvent__Title__62k9h">Guided Kayak Tour in Central Stockholm</h3>
    <div class="CardEvent_CardEvent__Meta__dRH1L">
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Calendar icon</span><span>Aug 21 - Sep 30</span>
      </div>
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Location icon</span><span>Stockholm Nature</span>
      </div>
    </div>
  </div>

  <div class="CardEvent_CardEvent__krQlj">
    <a class="CardEvent_CardEvent__Link__djuiF" href="https://www.visitstockholm.com/events/single-day-event/next/">
      <span class="sr-only">Single Day Event</span>
    </a>
    <div class="CardEvent_CardEventPicture__caj5t">
      <span class="CardEvent_CardEventPicture__CategoryText__vT9pL">Festivals</span>
    </div>
    <h3 class="CardEvent_CardEvent__Title__62k9h">Single Day Event</h3>
    <div class="CardEvent_CardEvent__Meta__dRH1L">
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Calendar icon</span><span>Sep 5</span>
      </div>
      <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
        <span class="sr-only">Location icon</span><span>Some Venue</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

const DETAIL_HTML_WITH_JSONLD = `
<!doctype html>
<html lang="en">
<head>
  <title>Summer at Konserthuset Stockholm — Visit Stockholm</title>
  <meta property="og:title" content="Summer at Konserthuset Stockholm" />
  <meta property="og:description" content="Free mini-concerts at Konserthuset." />
  <meta property="og:image" content="https://www.visitstockholm.com/media/images/summer.jpg" />
  <script type="application/ld+json">
  [
    {"@context":"https://schema.org","@type":"Organization","name":"Visit Stockholm"},
    {"@context":"https://schema.org","@type":"Event","name":"Summer at Konserthuset Stockholm","startDate":"2026-08-21","endDate":"2026-08-23","url":"https://www.visitstockholm.com/events/summer-at-konserthuset-stockholm/next/","description":"Free mini-concerts.","location":{"@type":"Place","name":"Konserthuset Stockholm","address":{"@type":"PostalAddress","streetAddress":"Konserthuset, Hötorget, Stockholm, Sweden"}},"organizer":{"@type":"Organization","name":"Konserthuset Stockholm"},"offers":{"@type":"Offer","url":"https://www.visitstockholm.com/events/summer-at-konserthuset-stockholm/next/"}}
  ]
  </script>
</head>
<body>
  <h1>Summer at Konserthuset Stockholm</h1>
</body>
</html>
`;

const DETAIL_HTML_FALLBACK = `
<!doctype html>
<html lang="en">
<head>
  <title>Some Event — Visit Stockholm</title>
  <meta property="og:title" content="Some Event" />
  <meta property="og:description" content="An event without JSON-LD." />
</head>
<body>
  <div class="CardEvent_CardEvent__Meta__dRH1L">
    <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
      <span class="sr-only">Calendar icon</span><span>Sep 5 - Sep 7</span>
    </div>
    <div class="CardEvent_CardEvent__MetaRow__CE9Ly">
      <span class="sr-only">Location icon</span><span>Somewhere in Stockholm</span>
    </div>
  </div>
</body>
</html>
`;

describe('visitstockholm adapter', () => {
  describe('matches', () => {
    it('matches visitstockholm.com URLs', () => {
      expect(
        visitstockholm.matches('https://www.visitstockholm.com/events/')
      ).toBe(true);
      expect(
        visitstockholm.matches(
          'https://visitstockholm.com/events/foo/2026-08-21/1100/1700/'
        )
      ).toBe(true);
    });
    it('rejects other domains', () => {
      expect(
        visitstockholm.matches('https://example.com/events/')
      ).toBe(false);
      expect(visitstockholm.matches('not-a-url')).toBe(false);
    });
  });

  describe('listing page extraction', () => {
    it('extracts all cards with title/date/url/venue/category', () => {
      const r = visitstockholm.extract(
        LISTING_HTML,
        'https://www.visitstockholm.com/events/'
      );
      expect(r.method).toBe('visitstockholm-listing');
      expect(r.events.length).toBe(3);

      for (const ev of r.events) {
        expect(() => ParsedEventSchema.parse(ev)).not.toThrow();
        expect(ev.source).toBe('visitstockholm');
        expect(ev.title.length).toBeGreaterThan(0);
        expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(ev.city).toBe('Stockholm');
        expect(ev.url).toMatch(/^https:\/\/www\.visitstockholm\.com\/events\//);
      }
    });

    it('parses date ranges into start + endDate', () => {
      const r = visitstockholm.extract(
        LISTING_HTML,
        'https://www.visitstockholm.com/events/'
      );
      const evt = r.events.find((e) => e.title.includes('Summer at'));
      expect(evt).toBeDefined();
      const year = new Date().getFullYear();
      expect(evt!.date).toBe(`${year}-08-21`);
      expect(evt!.endDate).toBe(`${year}-08-23`);
      expect(evt!.venue).toBe('Konserthuset Stockholm');
      expect(evt!.category).toBe('music');
    });

    it('parses cross-month ranges', () => {
      const r = visitstockholm.extract(
        LISTING_HTML,
        'https://www.visitstockholm.com/events/'
      );
      const evt = r.events.find((e) => e.title.includes('Kayak'));
      expect(evt).toBeDefined();
      const year = new Date().getFullYear();
      expect(evt!.date).toBe(`${year}-08-21`);
      expect(evt!.endDate).toBe(`${year}-09-30`);
      expect(evt!.venue).toBe('Stockholm Nature');
      expect(evt!.category).toBe('guided tours');
    });

    it('handles single-day events (no endDate)', () => {
      const r = visitstockholm.extract(
        LISTING_HTML,
        'https://www.visitstockholm.com/events/'
      );
      const evt = r.events.find((e) => e.title.includes('Single Day'));
      expect(evt).toBeDefined();
      const year = new Date().getFullYear();
      expect(evt!.date).toBe(`${year}-09-05`);
      expect(evt!.endDate).toBeUndefined();
    });

    it('returns method=none for non-listing URLs', () => {
      const r = visitstockholm.extract(
        LISTING_HTML,
        'https://example.com/events/'
      );
      expect(r.method).toBe('none');
      expect(r.events.length).toBe(0);
    });
  });

  describe('detail page extraction (JSON-LD)', () => {
    it('extracts full event from JSON-LD Event entry', () => {
      const r = visitstockholm.extract(
        DETAIL_HTML_WITH_JSONLD,
        'https://www.visitstockholm.com/events/summer-at-konserthuset-stockholm/next/'
      );
      expect(r.method).toBe('visitstockholm-detail');
      expect(r.events.length).toBe(1);
      const ev = r.events[0];
      expect(ev.title).toBe('Summer at Konserthuset Stockholm');
      expect(ev.date).toBe('2026-08-21');
      expect(ev.endDate).toBe('2026-08-23');
      expect(ev.venue).toBe('Konserthuset Stockholm');
      expect(ev.address).toContain('Hötorget');
      expect(ev.organizer).toBe('Konserthuset Stockholm');
      expect(ev.city).toBe('Stockholm');
      expect(ev.ticketUrl).toContain('visitstockholm.com');
      expect(ev.imageUrl).toContain('visitstockholm.com');
      expect(ev.confidence.score).toBe(0.95);
    });

    it('falls back to og:* + meta rows when JSON-LD is absent', () => {
      const r = visitstockholm.extract(
        DETAIL_HTML_FALLBACK,
        'https://www.visitstockholm.com/events/some-event/next/'
      );
      expect(r.method).toBe('visitstockholm-detail');
      expect(r.events.length).toBe(1);
      const ev = r.events[0];
      expect(ev.title).toBe('Some Event');
      const year = new Date().getFullYear();
      expect(ev.date).toBe(`${year}-09-05`);
      expect(ev.endDate).toBe(`${year}-09-07`);
      expect(ev.venue).toBe('Somewhere in Stockholm');
      expect(ev.confidence.score).toBeLessThan(0.8);
    });

    it('returns method=none for visitstockholm URL without extractable content', () => {
      const html = '<html><body><h1>nothing</h1></body></html>';
      const r = visitstockholm.extract(
        html,
        'https://www.visitstockholm.com/events/orphan/next/'
      );
      expect(r.method).toBe('none');
      expect(r.events.length).toBe(0);
    });
  });
});