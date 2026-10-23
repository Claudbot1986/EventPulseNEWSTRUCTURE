/**
 * Regressionstester för objektfält i JSON-LD (2026-10-23).
 *
 * Bakgrund: JSON-LD anger ofta ett OBJEKT där vi väntar en sträng —
 *   organizer: { "@type": "Organization", "name": "Stockholm Live" }
 *   location: { "@type": "Place", "name": "Oscarsteatern" }
 *   address:  { "@type": "PostalAddress", "streetAddress": "…" }
 *
 * `norm()` gjorde `String(obj)` → '[object Object]'. Mätt på riktiga
 * körningar: 599 rader i 21 orelaterade källor bar det i venue/address/
 * organizer/performers, varav 250 var framtida events som landade i
 * databasen med skräp i stället för källans egna värden.
 *
 * Mönstret är General (21 domäner, inte en sajt) — därför får fixen sitta i
 * den generella normaliseringen och inte i någon källspecifik adapter.
 *
 * Testerna använder INTE verkliga sajter: JSON-LD-blocket nedan är en
 * syntetisk men schema.org-korrekt representation av formen ovan.
 */

import { describe, it, expect } from 'vitest';
import { extractEvents } from './universal-extractor';

// Neutral domän: källspecifika adaptrar (biljettshop, folkoperan, ...) fångar
// sina egna värdar först. Här vill vi den GENERELLA JSON-LD-vägen.
const BASE_URL = 'https://exempel-venue.se/kalender';

/**
 * JSON-LD där venue/organizer/address är objekt — formen som förekommer på
 * biljettshop.se, lokalhelhet.se, formex.se, downtown-2, globen-3 m.fl.
 */
const OBJECT_FIELDS_JSONLD = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Chicago - the Musical",
    "startDate": "2026-11-14T19:30",
    "url": "https://biljettshop.se/sv/chicago-the-musical-2026-11-14/",
    "organizer": {
      "@type": "Organization",
      "name": "Stockholm Live",
      "url": "https://www.stockholmlive.se"
    },
    "location": {
      "@type": "Place",
      "name": "Oscarsteatern",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Birger Jarlsgatan 57",
        "addressLocality": "Stockholm"
      }
    }
  }
  </script>
</head>
<body></body>
</html>`;

/**
 * JSON-LD där adressen ligger direkt på eventet (inte under location) —
 * formen som gav address: '[object Object]' i de äldre filerna.
 */
const FLAT_ADDRESS_JSONLD = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Formex trender",
    "startDate": "2026-11-20",
    "venue": { "@type": "Place", "name": "Formex scen, A20" },
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Kistagatan 4",
      "addressLocality": "Stockholm"
    }
  }
  </script>
</head>
<body></body>
</html>`;

describe('universal-extractor — objektfält i JSON-LD', () => {
  it('läser location.name som venue i stället för [object Object]', () => {
    const result = extractEvents(OBJECT_FIELDS_JSONLD, 'exempel-venue', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.venue).toBe('Oscarsteatern');
      expect(evt.venue).not.toContain('[object Object]');
    }
  });

  it('läser location.address.streetAddress som address', () => {
    const result = extractEvents(OBJECT_FIELDS_JSONLD, 'exempel-venue', BASE_URL);
    for (const evt of result.events) {
      expect(evt.address).toBe('Birger Jarlsgatan 57');
    }
  });

  it('läser organizer.name som organizer i stället för [object Object]', () => {
    const result = extractEvents(OBJECT_FIELDS_JSONLD, 'exempel-venue', BASE_URL);
    for (const evt of result.events) {
      expect(evt.organizer).toBe('Stockholm Live');
    }
  });

  it('läser venue-objekt på eventnivå och behåller gatanadressen', () => {
    const result = extractEvents(FLAT_ADDRESS_JSONLD, 'exempel-venue', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.venue).toBe('Formex scen, A20');
      expect(evt.address).toBe('Kistagatan 4');
      expect(evt.city).toBe('Stockholm');
    }
  });

  it('lämnar fält tomma (inte [object Object]) när objektet saknar name', () => {
    const html = `<!doctype html>
<html><head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Evenemang utan venue",
    "startDate": "2026-11-20",
    "location": { "@type": "Place", "address": { "@type": "PostalAddress" } }
  }
  </script>
</head><body></body></html>`;
    const result = extractEvents(html, 'saknar-venue', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.venue ?? '').not.toContain('[object Object]');
      expect(evt.address ?? '').not.toContain('[object Object]');
    }
  });

  it('ingen rad i något av fälten innehåller [object Object]', () => {
    // Negativ kontroll på hela raden: fångar även fält vi inte tänkt på.
    for (const html of [OBJECT_FIELDS_JSONLD, FLAT_ADDRESS_JSONLD]) {
      const result = extractEvents(html, 'exempel-venue', BASE_URL);
      for (const evt of result.events) {
        expect(JSON.stringify(evt)).not.toContain('[object Object]');
      }
    }
  });

  it('multi-value itemprop (array) behåller sitt värde', () => {
    // Regression 2026-10-23: objekt-fixen behandlade arrayer som objekt →
    // url'en blev tom. Microdata ger arrays när samma itemprop förekommer
    // flera gånger.
    const html = `<!doctype html>
<html><body>
<div itemscope itemtype="https://schema.org/Event">
  <span itemprop="name">Festival</span>
  <a itemprop="url" href="/day1">Dag 1</a>
  <a itemprop="url" href="/day2">Dag 2</a>
</div>
</body></html>`;
    const result = extractEvents(html, 'festival', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    const evt = result.events[0];
    expect(typeof evt.url).toBe('string');
    expect(evt.url).not.toBe('');
  });
});
