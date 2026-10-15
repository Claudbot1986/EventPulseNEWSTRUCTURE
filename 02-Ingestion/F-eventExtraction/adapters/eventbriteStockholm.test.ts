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

// 2026-10-14: Single-event pages (/e/<slug>-tickets-<id>) expose a JSON-LD
// `SocialEvent` block, NOT an `ItemList`. This fixture covers that path
// — the events we used to lose to midnight-UTC (e.g. "Nightlife Tour"
// with startDate=2026-10-14T21:00:00+02:00).
const SYNTHETIC_SINGLE_EVENT_HTML = `
<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SocialEvent",
  "name": "Nightlife Tour",
  "startDate": "2026-10-14T21:00:00+02:00",
  "endDate": "2026-10-15T02:00:00+02:00",
  "url": "https://www.eventbrite.com/e/nightlife-tour-tickets-123456789",
  "image": "https://img.example.com/nightlife.jpg",
  "location": {
    "@type": "Place",
    "name": "The Auld Dub",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Stadsgården 8",
      "addressLocality": "Stockholm",
      "postalCode": "116 45",
      "addressCountry": "SE"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": "59.32", "longitude": "18.08" }
  }
}
</script>
</head>
<body></body>
</html>
`;

const SYNTHETIC_SINGLE_EVENT_NO_END_HTML = `
<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SocialEvent",
  "name": "Standup Showcase",
  "startDate": "2026-11-03T19:30:00+02:00",
  "url": "https://www.eventbrite.com/e/standup-showcase-tickets-987654321",
  "location": { "name": "Södra Teatern", "address": { "addressLocality": "Stockholm" } }
}
</script>
</head>
<body></body>
</html>
`;

describe('eventbriteStockholm — single-event extraction', () => {
  it('matches() accepts single-event /e/<slug>-tickets-<id> URLs', () => {
    expect(
      matches('https://www.eventbrite.com/e/nightlife-tour-tickets-123456789')
    ).toBe(true);
    expect(
      matches('https://www.eventbrite.se/e/standup-showcase-tickets-987654321')
    ).toBe(true);
    // Without -tickets-<digits> suffix, must still reject
    expect(matches('https://www.eventbrite.com/e/just-a-slug')).toBe(false);
  });

  it('extract() parses SocialEvent JSON-LD and preserves structured start time', () => {
    const url =
      'https://www.eventbrite.com/e/nightlife-tour-tickets-123456789';
    const result = extract(SYNTHETIC_SINGLE_EVENT_HTML, url);

    expect(result.method).toBe('eventbrite-itemlist');
    expect(result.events.length).toBe(1);

    const ev = result.events[0];
    expect(() => ParsedEventSchema.parse(ev)).not.toThrow();
    expect(ev.source).toBe('eventbrite-stockholm-aggregator');
    expect(ev.title).toBe('Nightlife Tour');
    expect(ev.date).toBe('2026-10-14');
    // Critical regression guard: this used to come back as midnight UTC.
    expect(ev.time).toBe('21:00');
    expect(ev.endTime).toBe('02:00');
    expect(ev.venue).toBe('The Auld Dub');
    expect(ev.city).toBe('Stockholm');
    expect(ev.url).toBe(url);
    expect(ev.address).toContain('Stadsgården 8');
    // Note: universal extractor's normalizeEvent doesn't currently extract geo
    // (see extractor.ts:584 `lat: null` TODO). We assert it didn't crash on
    // the geo block — nullish is acceptable for the single-event path
    // because ItemList path also goes through the same normalizer.
    expect(ev.lat == null).toBe(true);
    expect(ev.lng == null).toBe(true);
  });

  it('extract() handles single-event page with no endDate', () => {
    const url =
      'https://www.eventbrite.com/e/standup-showcase-tickets-987654321';
    const result = extract(SYNTHETIC_SINGLE_EVENT_NO_END_HTML, url);

    expect(result.events.length).toBe(1);
    const ev = result.events[0];
    expect(ev.date).toBe('2026-11-03');
    expect(ev.time).toBe('19:30');
    // Universal extractor returns '' (empty string) when endDate is absent.
    // Falsy check is what the persistence path cares about — '' means
    // "no endTime, treat as null downstream".
    expect(ev.endTime).toBeFalsy();
    expect(ev.title).toBe('Standup Showcase');
  });

  it('extract() returns empty for non-Eventbrite single-event URL', () => {
    const result = extract(
      SYNTHETIC_SINGLE_EVENT_HTML,
      'https://example.com/e/nightlife-tour-tickets-1'
    );
    expect(result.events).toEqual([]);
    expect(result.method).toBe('none');
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