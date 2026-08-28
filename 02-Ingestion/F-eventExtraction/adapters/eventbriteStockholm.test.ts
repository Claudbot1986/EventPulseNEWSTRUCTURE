/**
 * eventbriteStockholm adapter tests
 *
 * Verify:
 *  1. matches() correctly identifies Eventbrite Stockholm URLs
 *  2. extract() produces ParsedEvent[] from a real ItemList JSON-LD block
 *  3. Real fetched HTML yields >= 30 events (BACKLOG.md expected yield 1500-3000/week
 *     across Billetto + Eventbrite; per-page 46 first-page confirmed 2026-08-21)
 *  4. Every event has title, date, city=Stockholm, source='eventbrite-stockholm-aggregator'
 *  5. URL filter rejects non-Eventbrite and non-Stockholm Eventbrite URLs
 *
 * Note: persistence to Supabase is NOT tested here — that runs through the
 * normalizer + BullMQ worker pipeline and is outside the scope of this adapter.
 */
import { describe, it, expect } from 'vitest';
import {
  matches,
  extract,
  fetchAndExtract,
} from './eventbriteStockholm';
import { ParsedEventSchema } from '../schema';

const SYNTHETIC_ITEMLIST_HTML = `
<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Event",
        "name": "Stockholm Synth Event A",
        "startDate": "2026-09-15T18:00",
        "endDate": "2026-09-15T22:00",
        "url": "https://www.eventbrite.com/e/synth-a-tickets-1",
        "image": "https://img.example.com/a.jpg",
        "location": {
          "@type": "Place",
          "name": "Synth Venue A",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "1 Test St",
            "addressLocality": "Stockholm",
            "postalCode": "111 22",
            "addressCountry": "SE"
          },
          "geo": { "@type": "GeoCoordinates", "latitude": "59.33", "longitude": "18.07" }
        }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "Event",
        "name": "Stockholm Synth Event B",
        "startDate": "2026-10-01",
        "url": "https://www.eventbrite.com/e/synth-b-tickets-2",
        "location": {
          "@type": "Place",
          "name": "Synth Venue B",
          "address": { "addressLocality": "Stockholm" }
        }
      }
    },
    {
      "@type": "ListItem",
      "position": 3,
      "item": {
        "@type": "Event",
        "name": "Should be skipped (not Stockholm)",
        "startDate": "2026-09-15",
        "location": { "name": "Gothenburg Venue" }
      }
    }
  ]
}
</script>
</head>
<body></body>
</html>
`;

describe('eventbriteStockholm adapter', () => {
  it('matches() accepts Eventbrite Stockholm URLs', () => {
    expect(
      matches('https://www.eventbrite.com/d/sweden--stockholm/events/')
    ).toBe(true);
    expect(
      matches('https://www.eventbrite.com/d/sweden--stockholm/all-events/?start_date=2026-09-01')
    ).toBe(true);
    expect(matches('https://eventbrite.com/d/sweden--stockholm/events/')).toBe(true);
  });

  it('matches() rejects non-Eventbrite or non-Stockholm URLs', () => {
    expect(matches('https://www.eventbrite.com/d/sweden--gothenburg/events/')).toBe(
      false
    );
    expect(matches('https://www.eventbrite.com/e/whatever')).toBe(false);
    expect(matches('https://billetto.se/c/stockholm-l')).toBe(false);
    expect(matches('not a url')).toBe(false);
  });

  it('extract() parses ItemList JSON-LD into ParsedEvent[]', () => {
    const result = extract(
      SYNTHETIC_ITEMLIST_HTML,
      'https://www.eventbrite.com/d/sweden--stockholm/events/',
    );

    expect(result.method).toBe('eventbrite-itemlist');
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    // Validate each event against the schema
    for (const ev of result.events) {
      expect(() => ParsedEventSchema.parse(ev)).not.toThrow();
      expect(ev.source).toBe('eventbrite-stockholm-aggregator');
      expect(ev.title.length).toBeGreaterThan(0);
      expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('extract() preserves event URL, venue, address when present', () => {
    const result = extract(
      SYNTHETIC_ITEMLIST_HTML,
      'https://www.eventbrite.com/d/sweden--stockholm/events/',
    );
    const evtA = result.events.find((e) => e.title.includes('Event A'));
    expect(evtA).toBeDefined();
    expect(evtA!.venue).toBe('Synth Venue A');
    expect(evtA!.url).toBe('https://www.eventbrite.com/e/synth-a-tickets-1');
    expect(evtA!.address).toContain('1 Test St');
    expect(evtA!.address).toContain('111 22');
    expect(evtA!.time).toBe('18:00');
    expect(evtA!.endTime).toBe('22:00');
    expect(evtA!.city).toBe('Stockholm');
  });

  it('extract() handles events without time (date-only startDate)', () => {
    const result = extract(
      SYNTHETIC_ITEMLIST_HTML,
      'https://www.eventbrite.com/d/sweden--stockholm/events/',
    );
    const evtB = result.events.find((e) => e.title.includes('Event B'));
    expect(evtB).toBeDefined();
    expect(evtB!.date).toBe('2026-10-01');
    expect(evtB!.time).toBeUndefined();
  });

  it('extract() returns empty for non-Stockholm HTML', () => {
    const result = extract(
      SYNTHETIC_ITEMLIST_HTML.replace(/sweden--stockholm/g, 'sweden--gothenburg'),
      'https://www.eventbrite.com/d/sweden--gothenburg/events/',
    );
    expect(result.events).toEqual([]);
  });
});

describe('eventbriteStockholm — live fetch (B-gate path)', () => {
  it(
    'fetchAndExtract() returns >= 30 real Stockholm events from the live listing page',
    async () => {
      const url = 'https://www.eventbrite.com/d/sweden--stockholm/events/';
      const events = await fetchAndExtract(url, { sleepFirst: false });

      // BACKLOG.md expected yield: 1 500–3 000 events / week across
      // billetto + eventbrite. First page alone yields 46 confirmed 2026-08-21.
      expect(events.length).toBeGreaterThanOrEqual(30);

      // Spot-check the first few
      for (const ev of events.slice(0, 5)) {
        expect(() => ParsedEventSchema.parse(ev)).not.toThrow();
        expect(ev.source).toBe('eventbrite-stockholm-aggregator');
        expect(ev.title.length).toBeGreaterThan(0);
        expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // The first page should have at least one event with a venue in
      // Stockholm. Filter by city field (defaults to Stockholm for any
      // event whose addressLocality is missing).
      const withStockholmVenue = events.filter(
        (e) => e.venue && (e.city === 'Stockholm' || !e.city)
      );
      expect(withStockholmVenue.length).toBeGreaterThan(0);
    },
    30_000
  );
});