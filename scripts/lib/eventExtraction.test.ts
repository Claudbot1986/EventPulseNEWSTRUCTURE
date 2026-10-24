import { describe, it, expect } from 'vitest';
import {
  extractJsonLdEvents,
  isEventType,
  hasEventType,
  EVENT_SUBTYPES,
} from './eventExtraction.mjs';
import { EVENT_SUBTYPES as CANONICAL_EVENT_SUBTYPES } from '../../02-Ingestion/F-eventExtraction/extractor';

const jsonLd = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

describe('event-typer', () => {
  it('accepterar schema.org Event-subtyper', () => {
    // Mätt 2026-10-24: MusicEvent (concerts50.com — 33 framtida events),
    // VisualArtsEvent (konstkalendern.com), ExhibitionEvent
    // (stockholm.fotografiska.com). Utan subtyperna föll alla bort.
    expect(isEventType('Event')).toBe(true);
    expect(isEventType('MusicEvent')).toBe(true);
    expect(isEventType('VisualArtsEvent')).toBe(true);
    expect(isEventType('ExhibitionEvent')).toBe(true);
    expect(isEventType('TheaterEvent')).toBe(true);
  });

  it('avvisar typer som INTE är event', () => {
    // Negativ kontroll: listan får inte bli så generell att sidans egen
    // webbplats-metadata plockas som event.
    for (const t of [
      'WebSite',
      'WebPage',
      'Organization',
      'BreadcrumbList',
      'NewsArticle',
      'Restaurant',
      'TouristInformationCenter',
      'EventSeries',
      'Product',
      '',
    ]) {
      expect(isEventType(t)).toBe(false);
    }
    expect(isEventType(undefined)).toBe(false);
    expect(isEventType(null)).toBe(false);
    expect(isEventType(42)).toBe(false);
  });

  it('accepterar @type som lista', () => {
    expect(hasEventType(['Event'])).toBe(true);
    expect(hasEventType(['WebSite', 'MusicEvent'])).toBe(true);
    expect(hasEventType(['WebSite', 'Organization'])).toBe(false);
    expect(hasEventType([])).toBe(false);
  });

  it('ligger i synk med repo-kanoniska extractorn', () => {
    // Sitemap-scriptet speglar listan (det måste kunna köras med ren node,
    // så det får inte importera en .ts-fil). Parity-gaten här fäller om
    // listorna glider isär.
    expect([...EVENT_SUBTYPES].sort()).toEqual([...CANONICAL_EVENT_SUBTYPES].sort());
  });
});

describe('JSON-LD-extraktion', () => {
  it('plockar ett MusicEvent med startDate, venue och geo', () => {
    // Detta var exakt det som föll bort före fixen: concerts50.com har
    // MusicEvent, inte Event.
    const html = jsonLd({
      '@type': 'MusicEvent',
      name: 'Shinedown',
      startDate: '2026-11-09T19:00:00+01:00',
      url: 'https://concerts50.com/show/shinedown',
      location: {
        name: 'Annexet',
        address: { streetAddress: 'Mäster Samuelsgatan 8', postalCode: '111 57' },
        geo: { latitude: '59.3293', longitude: '18.0611' },
      },
    });
    const events = extractJsonLdEvents(html);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Shinedown');
    expect(events[0].startDate).toBe('2026-11-09T19:00:00+01:00');
    expect(events[0].venue).toBe('Annexet');
    expect(events[0].lat).toBeCloseTo(59.3293, 3);
    expect(events[0].lng).toBeCloseTo(18.0611, 3);
  });

  it('plockar inte en WebSite som event (negativ kontroll)', () => {
    const html = jsonLd({ '@type': 'WebSite', name: 'Något varumärke', url: 'https://x.se' });
    expect(extractJsonLdEvents(html)).toHaveLength(0);
  });

  it('plockar inte en NewsArticle som event (negativ kontroll)', () => {
    const html = jsonLd({
      '@type': 'NewsArticle',
      name: 'En artikel om en utställning',
      startDate: '2026-12-01',
    });
    expect(extractJsonLdEvents(html)).toHaveLength(0);
  });

  it('plockar events ur en ItemList', () => {
    const html = jsonLd({
      '@type': 'ItemList',
      itemListElement: [
        { item: { '@type': 'Event', name: 'A', startDate: '2026-11-01' } },
        { item: { '@type': 'MusicEvent', name: 'B', startDate: '2026-11-02' } },
        { item: { '@type': 'Organization', name: 'C' } },
      ],
    });
    const events = extractJsonLdEvents(html);
    expect(events.map((e) => e.name)).toEqual(['A', 'B']);
  });

  it('överlever trasig JSON-LD utan att krascha', () => {
    const html = '<script type="application/ld+json">{ inte json }</script>';
    expect(() => extractJsonLdEvents(html)).not.toThrow();
    expect(extractJsonLdEvents(html)).toHaveLength(0);
  });
});
