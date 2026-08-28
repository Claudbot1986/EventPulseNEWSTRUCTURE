/**
 * normalize-url tests — guard against the "link to listing page" bug.
 *
 * Background: a previous version of `normalizeEvent` did
 *   `url: event.url || sourceUrl`
 * so any JSON-LD Event missing `url` was silently assigned the scraped
 * page's URL — which is a listing of many events, not the specific event.
 * The mobile UI then rendered that as the "external event link", sending
 * users to a page full of unrelated events instead of the one they tapped.
 *
 * These tests lock the new contract using only the public surface
 * (pickEventUrl, extractFromJsonLd, toRawEventInput):
 *   - `@id` (IRI identifier) wins over `url` when both are valid http(s).
 *   - `url` is used when only it is present.
 *   - `sourceUrl` is NEVER used as a fallback (the bug).
 *   - Non-URL `@id` (e.g. `"evt_123"`) is ignored.
 *   - `toRawEventInput` propagates the missing URL → `ticket_url: null`,
 *     so the UI hides the external-link chip instead of misleading users.
 */

import { describe, it, expect } from 'vitest';
import { pickEventUrl, extractFromJsonLd, toRawEventInput } from './extractor';
import type { JsonLdEvent } from './schema';

const SOURCE = 'kulturhuset';
const SOURCE_URL = 'https://kulturhuset.se/kalender';

function mkEvent(overrides: Partial<JsonLdEvent> = {}): JsonLdEvent {
  return {
    '@type': 'Event',
    name: 'Jazzkväll',
    startDate: '2026-09-15T19:30:00+02:00',
    location: { '@type': 'Place', name: 'Kulturhuset' },
    ...overrides,
  };
}

/** Build a JSON-LD HTML page containing a single @graph with one Event. */
function htmlWithEvents(events: JsonLdEvent[]): string {
  const payload = { '@context': 'https://schema.org', '@graph': events };
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

describe('pickEventUrl', () => {
  it('prefers @id when it is an http(s) URL', () => {
    const event = mkEvent({
      '@id': 'https://kulturhuset.se/events/jazzkvallen-2026',
      url: 'https://kulturhuset.se/kalender/jazzkvallen-2026',
    });
    expect(pickEventUrl(event)).toBe('https://kulturhuset.se/events/jazzkvallen-2026');
  });

  it('falls back to url when @id is missing', () => {
    const event = mkEvent({
      url: 'https://kulturhuset.se/events/jazzkvallen-2026',
    });
    expect(pickEventUrl(event)).toBe('https://kulturhuset.se/events/jazzkvallen-2026');
  });

  it('falls back to url when @id is non-URL (e.g. "evt_123")', () => {
    const event = mkEvent({
      '@id': 'evt_jazz_2026_09',
      url: 'https://kulturhuset.se/events/jazzkvallen-2026',
    });
    expect(pickEventUrl(event)).toBe('https://kulturhuset.se/events/jazzkvallen-2026');
  });

  it('returns undefined when both are missing (NEVER falls back to sourceUrl)', () => {
    const event = mkEvent({});
    expect(pickEventUrl(event)).toBeUndefined();
  });

  it('returns undefined when only a non-http(s) @id is present', () => {
    const event = mkEvent({ '@id': 'javascript:alert(1)' });
    expect(pickEventUrl(event)).toBeUndefined();
  });

  it('returns undefined when url is a non-http(s) scheme', () => {
    const event = mkEvent({ url: 'mailto:foo@bar' });
    expect(pickEventUrl(event)).toBeUndefined();
  });
});

describe('extractFromJsonLd — url field never leaks sourceUrl', () => {
  it('uses event.url when present', () => {
    const html = htmlWithEvents([
      mkEvent({ url: 'https://kulturhuset.se/events/x' }),
    ]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    expect(result.events.length).toBe(1);
    expect(result.events[0].url).toBe('https://kulturhuset.se/events/x');
  });

  it('uses @id when url is missing', () => {
    const html = htmlWithEvents([
      mkEvent({ '@id': 'https://kulturhuset.se/events/y' }),
    ]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    expect(result.events[0].url).toBe('https://kulturhuset.se/events/y');
    expect(result.events[0].url).not.toBe(SOURCE_URL);
  });

  it('returns url=undefined when JSON-LD has neither @id nor url', () => {
    const html = htmlWithEvents([mkEvent({})]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    expect(result.events[0].url).toBeUndefined();
    expect(result.events[0].url).not.toBe(SOURCE_URL);
  });

  it('regression: previously assigned sourceUrl as fallback — must NOT', () => {
    // The exact scenario from the bug report: a venue page lists many
    // events, each JSON-LD Event block omits `url`. Old code did
    // `url: event.url || sourceUrl` → every event linked to the listing.
    const html = htmlWithEvents([
      mkEvent({ name: 'Show A' }),
      mkEvent({ name: 'Show B', startDate: '2026-09-16T19:30:00+02:00' }),
    ]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    expect(result.events.length).toBe(2);
    for (const e of result.events) {
      expect(e.url).toBeUndefined();
      expect(e.url).not.toBe(SOURCE_URL);
    }
  });
});

describe('toRawEventInput — ticket_url is null when no specific event URL exists', () => {
  it('propagates a specific event URL into ticket_url', () => {
    const html = htmlWithEvents([
      mkEvent({ url: 'https://kulturhuset.se/events/x' }),
    ]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    const raw = toRawEventInput(result.events[0]);
    expect(raw.ticket_url).toBe('https://kulturhuset.se/events/x');
  });

  it('sets ticket_url=null (not sourceUrl) when no specific URL exists', () => {
    const html = htmlWithEvents([mkEvent({})]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    const raw = toRawEventInput(result.events[0]);
    expect(raw.ticket_url).toBeNull();
  });

  it('prefers offers.url (ticketUrl) over event.url when both are present', () => {
    const html = htmlWithEvents([
      mkEvent({
        url: 'https://kulturhuset.se/events/x',
        offers: {
          '@type': 'Offer',
          price: '150',
          priceCurrency: 'SEK',
          url: 'https://ticketing.example.com/buy/x',
        },
      }),
    ]);
    const result = extractFromJsonLd(html, SOURCE, SOURCE_URL);
    const raw = toRawEventInput(result.events[0]);
    expect(raw.ticket_url).toBe('https://ticketing.example.com/buy/x');
  });
});
