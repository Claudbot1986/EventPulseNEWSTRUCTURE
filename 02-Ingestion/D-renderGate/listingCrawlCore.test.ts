/**
 * Enhetstester för D-gatens listing-crawl-logik.
 *
 * Bakgrund 2026-10-24. Billettos listningssidor är JS-renderade och
 * innehåller turnerande evenemang från hela landet.Två saker måste stämma:
 *   1. event-länkarna hittas i den renderade listningssidan
 *   2. scope-filtret släpper bara igenom Stockholms-events
 *
 * Testerna är negativa kontroller: de kan faila. Utan dem vore scopefiltret
 * en gata som bara kan ge grönt.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EVENT_HREF_PATTERN,
  NO_SCOPE,
  extractEventUrlsFromCategory,
  extractPostalCode,
  extractStockholm,
  findJsonLdEvent,
  isInScope,
  normalizeEventUrl,
  pickOffer,
  splitDateTime,
} from './listingCrawlCore';

const BILL = {
  eventHrefPattern: DEFAULT_EVENT_HREF_PATTERN,
  eventUrlPrefix: 'https://billetto.se/',
};

describe('extractPostalCode', () => {
  it('läser postnummer ur adress', () => {
    expect(extractPostalCode('Vasagatan 41, 41136 Göteborg')).toBe('41136');
    expect(extractPostalCode('Götgatan 12, 118 62 Stockholm')).toBe('11862');
  });

  it('läser postnummer ur ett explicit postnummer-fält', () => {
    expect(extractPostalCode(undefined, '12162')).toBe('12162');
    expect(extractPostalCode(undefined, 'SE-12162')).toBe('12162');
  });

  it('returnerar null när adressen saknar postnummer', () => {
    expect(extractPostalCode('Okänd plats')).toBeNull();
    expect(extractPostalCode(undefined)).toBeNull();
  });
});

describe('isInScope', () => {
  const stockholm = { postalPrefixes: ['1'], cities: ['Stockholm'] };

  it('släpper igenom Stockholms postnummer', () => {
    expect(isInScope(stockholm, '12162', 'Stockholm')).toBe(true);
    expect(isInScope(stockholm, '17231', 'Sundbyberg')).toBe(true);
  });

  it('stoppar Göteborg och Norrköping', () => {
    expect(isInScope(stockholm, '41136', 'Göteborg')).toBe(false);
    expect(isInScope(stockholm, '60221', 'Norrköping')).toBe(false);
  });

  it('faller tillbaka på ortnamnet när postnumret saknas', () => {
    expect(isInScope(stockholm, null, 'Stockholm')).toBe(true);
    expect(isInScope(stockholm, null, 'Göteborg')).toBe(false);
  });

  it('släpper igenom allt när filtret är tomt', () => {
    expect(isInScope(NO_SCOPE, '41136', 'Göteborg')).toBe(true);
    expect(isInScope(NO_SCOPE, null, undefined)).toBe(true);
  });

  it('stoppar okänt läge när filtret är aktivt', () => {
    expect(isInScope(stockholm, null, undefined)).toBe(false);
  });
});

describe('extractEventUrlsFromCategory', () => {
  const html = `
    <a href="/e/lunar-fest-2026-biljetter-1986127">Lunar Fest</a>
    <a href="https://billetto.se/e/hostsalongen-i-goteborg-2026-biljetter-1964390">Höstsalongen</a>
    <a href="/kategori/musik">Musik</a>
    <a href="/e/berlin-best-biljetter-1980024?bref=abc">Berlin Best</a>
  `;

  it('hittar event-länkar men inte kategorilänkar', () => {
    const urls = extractEventUrlsFromCategory(html, BILL);
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => u.includes('/e/'))).toBe(true);
  });

  it('gör relativa länkar absoluta', () => {
    const urls = extractEventUrlsFromCategory(html, BILL);
    expect(urls).toContain('https://billetto.se/e/lunar-fest-2026-biljetter-1986127');
  });

  it('tar bort query-strängen så dedup blir stabil', () => {
    const urls = extractEventUrlsFromCategory(html, BILL);
    expect(urls).toContain('https://billetto.se/e/berlin-best-biljetter-1980024');
    expect(urls.some((u) => u.includes('bref='))).toBe(false);
  });

  it('hittar ingenting i en sida utan event-länkar', () => {
    expect(extractEventUrlsFromCategory('<a href="/kategori/musik">Musik</a>', BILL)).toEqual([]);
  });
});

describe('normalizeEventUrl', () => {
  it('tar bort query och avslutande slash', () => {
    expect(normalizeEventUrl('https://billetto.se/e/x-biljetter-1?a=1')).toBe(
      'https://billetto.se/e/x-biljetter-1',
    );
    expect(normalizeEventUrl('https://billetto.se/e/x-biljetter-1/')).toBe(
      'https://billetto.se/e/x-biljetter-1',
    );
  });
});

describe('findJsonLdEvent', () => {
  it('hittar JSON-LD Event', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Lunar Fest 2026',
      startDate: '2026-12-04T18:00:00+01:00',
    })}</script>`;
    const event = findJsonLdEvent(html);
    expect(event).not.toBeNull();
    expect(event?.name).toBe('Lunar Fest 2026');
  });

  it('hittar Event i en @graph', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [{ '@type': 'WebPage' }, { '@type': 'Event', name: 'Natt' }],
    })}</script>`;
    expect(findJsonLdEvent(html)?.name).toBe('Natt');
  });

  it('returnerar null när det inte finns något Event', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Organization',
      name: 'Billetto',
    })}</script>`;
    expect(findJsonLdEvent(html)).toBeNull();
    expect(findJsonLdEvent('<p>inget</p>')).toBeNull();
  });
});

describe('splitDateTime', () => {
  it('delar upp ISO-datum och tid', () => {
    expect(splitDateTime('2026-12-04T18:30:00+01:00')).toEqual({
      date: '2026-12-04',
      time: '17:30',
    });
  });

  it('hanterar saknat värde', () => {
    expect(splitDateTime(undefined)).toEqual({ date: '' });
  });
});

describe('pickOffer', () => {
  it('plockar pris och biljettlänk', () => {
    const offer = pickOffer({ price: '250', url: 'https://billetto.se/kop/1' });
    expect(offer.priceMin).toBe(250);
    expect(offer.ticketUrl).toBe('https://billetto.se/kop/1');
    expect(offer.isFree).toBeUndefined();
  });

  it('känner igen gratis', () => {
    expect(pickOffer({ price: 0 }).isFree).toBe(true);
  });

  it('tar min/max ur flera offers', () => {
    const offer = pickOffer([{ price: '300' }, { price: '150' }]);
    expect(offer.priceMin).toBe(150);
    expect(offer.priceMax).toBe(300);
  });
});

describe('extractStockholm', () => {
  it('läser ort, venue och postnummer ur JSON-LD location', () => {
    const place = extractStockholm({
      name: 'Södra Teatern',
      address: {
        streetAddress: 'Södra scenen 4',
        postalCode: '116 43',
        addressLocality: 'Stockholm',
      },
      geo: { latitude: 59.3, longitude: 18.07 },
    });
    expect(place.venue).toBe('Södra Teatern');
    expect(place.city).toBe('Stockholm');
    expect(place.postalCode).toBe('116 43');
    expect(place.lat).toBe(59.3);
  });

  it('faller tillbaka på Stockholm när location saknas', () => {
    expect(extractStockholm(undefined).city).toBe('Stockholm');
  });
});
