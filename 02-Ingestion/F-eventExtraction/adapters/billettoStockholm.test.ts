/**
 * billettoStockholm adapter tests — synthetic HTML fixtures
 *
 * Verify:
 *  1. matches() correctly identifies Billetto.se URLs (city listing,
 *     category listing, event detail) and rejects foreign hosts
 *  2. extract() parses injected JSON-LD Event blocks (rendered-DOM path
 *     used by C-renderGate) into ParsedEvent[]
 *  3. extract() correctly skips non-Stockholm events
 *  4. extract() returns method='billetto-listings-static' (no events) when
 *     no JSON-LD is found on city/category listings — no fake events
 *  5. extract() returns method='billetto-listings-static' on event-detail
 *     pages without JSON-LD (no synthesised fake dates)
 *  6. Every event has title, date (YYYY-MM-DD), source='billetto-stockholm-aggregator'
 *  7. Schema fields: name, image, date+time, venue, address, city, price,
 *     organizer all preserved when present
 */
import { describe, it, expect } from 'vitest';
import { matches, extract } from './billettoStockholm';
import { ParsedEventSchema } from '../schema';

const SYNTHETIC_JSONLD_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Evenemang i Stockholm | Billetto</title>

  <!-- 3 inline Alpine-injected JSON-LD blocks (one per rendered event card) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Synth Jazz Night",
    "startDate": "2026-09-15T19:30+02:00",
    "endDate": "2026-09-15T22:30+02:00",
    "url": "https://billetto.se/e/synth-jazz-night-aaa111",
    "image": "https://img.example.com/jazz.jpg",
    "description": "En kväll med syntjazz i Stockholm.",
    "location": {
      "@type": "Place",
      "name": "Fasching",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Kungsgatan 18",
        "postalCode": "111 35",
        "addressLocality": "Stockholm",
        "addressCountry": "SE"
      },
      "geo": { "@type": "GeoCoordinates", "latitude": "59.33", "longitude": "18.06" }
    },
    "organizer": { "@type": "Organization", "name": "Stockholm Jazz Society", "url": "https://example.com/jazz" },
    "offers": {
      "@type": "Offer",
      "price": "249",
      "priceCurrency": "SEK",
      "availability": "https://schema.org/InStock",
      "url": "https://billetto.se/e/synth-jazz-night-aaa111"
    }
  }
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Stand-up Showcase",
    "startDate": "2026-10-01",
    "image": "https://img.example.com/standup.jpg",
    "location": {
      "@type": "Place",
      "name": "Södra Teatern",
      "address": { "addressLocality": "Stockholm", "addressCountry": "SE" }
    }
  }
  </script>

  <!-- Non-Stockholm event MUST be skipped -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Should be skipped (not Stockholm)",
    "startDate": "2026-09-15",
    "location": { "name": "Gothenburg Venue", "address": { "addressLocality": "Göteborg" } }
  }
  </script>
</head>
<body>
  <!-- Static markup Billetto uses for SPA shells. Real events are
       populated by Alpine.js from Clerk.io; here the
       <template x-if="event.schema"> tags would render at runtime. -->
  <template x-if="event.schema">
    <script type="application/ld+json" x-text="event.schema"></script>
  </template>
</body>
</html>
`;

const EVENT_DETAIL_WITH_JSONLD_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Synth Jazz Night | Billetto</title>
  <meta property="og:title" content="Synth Jazz Night" />
  <meta property="og:description" content="En kväll med syntjazz i Stockholm." />
  <meta property="og:image" content="https://img.example.com/jazz.jpg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Synth Jazz Night",
    "startDate": "2026-09-15T19:30",
    "url": "https://billetto.se/e/synth-jazz-night-aaa111",
    "location": { "name": "Fasching", "address": { "addressLocality": "Stockholm" } }
  }
  </script>
</head>
<body><h1>Synth Jazz Night</h1></body>
</html>
`;

const EVENT_DETAIL_META_ONLY_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Some Show | Billetto</title>
  <meta property="og:title" content="Some Show Title" />
  <meta property="og:description" content="A show in Stockholm." />
  <meta property="og:image" content="https://img.example.com/show.jpg" />
</head>
<body><h1>Some Show Title</h1></body>
</html>
`;

const LISTING_STATIC_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Evenemang i Stockholm | Billetto</title>
  <meta property="og:description" content="Hitta en mängd olika events i Stockholm." />
</head>
<body>
  <!-- No <script type="application/ld+json"> blocks — Billetto hasn't
       injected any client-rendered schema yet. -->
  <div x-data="clerkWidget('recommendations/popular', '', 'city == &quot;Stockholm&quot;', 16)"></div>
</body>
</html>
`;

describe('billettoStockholm adapter', () => {
  describe('matches()', () => {
    it('accepts billetto.se city listing URLs', () => {
      expect(matches('https://billetto.se/c/stockholm-l')).toBe(true);
      expect(matches('https://www.billetto.se/c/stockholm-l')).toBe(true);
    });

    it('accepts billetto.se category listing URLs', () => {
      expect(matches('https://billetto.se/c/concert-t')).toBe(true);
      expect(matches('https://billetto.se/c/music-c/classical-sc')).toBe(true);
      expect(matches('https://billetto.se/c/festival-t?page=2')).toBe(true);
    });

    it('accepts billetto.se event detail URLs', () => {
      expect(matches('https://billetto.se/e/synth-jazz-night-aaa111')).toBe(true);
      expect(matches('https://www.billetto.se/e/some-slug-12345/')).toBe(true);
    });

    it('rejects foreign hosts and non-Billetto URLs', () => {
      expect(matches('https://www.eventbrite.com/d/sweden--stockholm/events/')).toBe(
        false
      );
      expect(matches('https://billetto.dk/c/stockholm-l')).toBe(false);
      expect(matches('https://billetto.com/c/stockholm-l')).toBe(false);
      expect(matches('https://example.com/c/stockholm-l')).toBe(false);
      expect(matches('not a url')).toBe(false);
    });
  });

  describe('extract() — rendered-listing JSON-LD path', () => {
    it('parses JSON-LD Event blocks into ParsedEvent[]', () => {
      const r = extract(
        SYNTHETIC_JSONLD_HTML,
        'https://billetto.se/c/stockholm-l'
      );

      expect(r.method).toBe('billetto-rendered-listing');
      expect(r.events.length).toBe(2); // non-Stockholm skipped

      for (const ev of r.events) {
        expect(() => ParsedEventSchema.parse(ev)).not.toThrow();
        expect(ev.source).toBe('billetto-stockholm-aggregator');
        expect(ev.city).toBe('Stockholm');
        expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(ev.title.length).toBeGreaterThan(0);
      }
    });

    it('preserves all JSON-LD fields when present', () => {
      const r = extract(
        SYNTHETIC_JSONLD_HTML,
        'https://billetto.se/c/stockholm-l'
      );
      const jazz = r.events.find((e) => e.title === 'Synth Jazz Night');
      expect(jazz).toBeDefined();
      expect(jazz!.date).toBe('2026-09-15');
      expect(jazz!.time).toBe('19:30');
      expect(jazz!.endDate).toBe('2026-09-15');
      expect(jazz!.endTime).toBe('22:30');
      expect(jazz!.venue).toBe('Fasching');
      expect(jazz!.address).toContain('Kungsgatan 18');
      expect(jazz!.address).toContain('111 35');
      expect(jazz!.city).toBe('Stockholm');
      expect(jazz!.priceMin).toBe(249);
      expect(jazz!.organizer).toBe('Stockholm Jazz Society');
      expect(jazz!.imageUrl).toBe('https://img.example.com/jazz.jpg');
      expect(jazz!.url).toBe('https://billetto.se/e/synth-jazz-night-aaa111');
      expect(jazz!.ticketUrl).toBe(
        'https://billetto.se/e/synth-jazz-night-aaa111'
      );
    });

    it('handles events with date-only startDate (no time)', () => {
      const r = extract(
        SYNTHETIC_JSONLD_HTML,
        'https://billetto.se/c/stockholm-l'
      );
      const standup = r.events.find((e) => e.title === 'Stand-up Showcase');
      expect(standup).toBeDefined();
      expect(standup!.date).toBe('2026-10-01');
      expect(standup!.time).toBeUndefined();
    });

    it('skips non-Stockholm events', () => {
      const r = extract(
        SYNTHETIC_JSONLD_HTML,
        'https://billetto.se/c/stockholm-l'
      );
      const gothenburg = r.events.find((e) =>
        e.title.includes('not Stockholm')
      );
      expect(gothenburg).toBeUndefined();
    });

    it('returns method=none for non-billetto.se URLs', () => {
      const r = extract(
        SYNTHETIC_JSONLD_HTML,
        'https://www.eventbrite.com/d/sweden--stockholm/events/'
      );
      expect(r.method).toBe('none');
      expect(r.events).toEqual([]);
    });
  });

  describe('extract() — event detail page', () => {
    it('parses detail-page JSON-LD into a single event', () => {
      const r = extract(
        EVENT_DETAIL_WITH_JSONLD_HTML,
        'https://billetto.se/e/synth-jazz-night-aaa111'
      );
      expect(r.method).toBe('billetto-event-detail');
      expect(r.events.length).toBe(1);
      expect(r.events[0].title).toBe('Synth Jazz Night');
      expect(r.events[0].venue).toBe('Fasching');
      expect(r.events[0].date).toBe('2026-09-15');
      expect(r.events[0].time).toBe('19:30');
      expect(r.events[0].city).toBe('Stockholm');
    });

    it('returns billetto-listings-static when JSON-LD is missing (no fake dates)', () => {
      // Meta-only event-detail pages have no machine-readable date. Per
      // "no fake data" rule, we do NOT synthesise a date — we return the
      // same signal as an under-rendered listing page so the orchestrator
      // can re-fetch via render-gate.
      const r = extract(
        EVENT_DETAIL_META_ONLY_HTML,
        'https://billetto.se/e/some-show-bbb222'
      );
      expect(r.method).toBe('billetto-listings-static');
      expect(r.events).toEqual([]);
      expect(r.showUrls).toEqual([]);
    });
  });

  describe('extract() — static listing page (no JSON-LD)', () => {
    it('returns method=billetto-listings-static with empty events', () => {
      const r = extract(
        LISTING_STATIC_HTML,
        'https://billetto.se/c/stockholm-l'
      );
      expect(r.method).toBe('billetto-listings-static');
      expect(r.events).toEqual([]);
      expect(r.showUrls).toEqual([]);
    });

    it('returns method=billetto-listings-static for category pages too', () => {
      const r = extract(
        LISTING_STATIC_HTML,
        'https://billetto.se/c/concert-t'
      );
      expect(r.method).toBe('billetto-listings-static');
      expect(r.events).toEqual([]);
    });

    it('returns method=none for out-of-scope Billetto URLs', () => {
      const r = extract(LISTING_STATIC_HTML, 'https://billetto.se/');
      expect(r.method).toBe('none');
      expect(r.events).toEqual([]);

      const r2 = extract(
        LISTING_STATIC_HTML,
        'https://billetto.se/organiser/sign_up'
      );
      expect(r2.method).toBe('none');
    });
  });
});
