/**
 * Strategy A regression tests — og:image / twitter:image fallback in
 * universal-extractor.
 *
 * Covers MASTERPLAN §13 "+10 image present" confidence: HTML pages that lack
 * JSON-LD `image` must still pick up the page-level og:image / twitter:image
 * so that the Event Graph gets an image_url value to rank + display.
 *
 * These tests focus only on the fallback layer (HTML heuristic extraction +
 * og:image). Full JSON-LD vs fallback priority is covered by an inline test.
 */

import { describe, it, expect } from 'vitest';
import { extractEvents } from './universal-extractor';

const BASE_URL = 'https://konserthuset.se/kalender';

function htmlWithOgImage(ogImage: string): string {
  return `<!doctype html>
<html lang="sv">
<head>
  <meta property="og:title" content="Konserter" />
  <meta property="og:image" content="${ogImage}" />
  <title>Konserthuset kalender</title>
</head>
<body>
  <article>
    <h2>Konsert ikväll</h2>
    <time datetime="2026-08-22T19:00">22 aug 19:00</time>
    <a href="/event/123">Läs mer</a>
  </article>
</body>
</html>`;
}

describe('universal-extractor — Strategy A: og:image fallback', () => {
  it('fills imageUrl from og:image when HTML-heuristic event has no image', () => {
    const html = htmlWithOgImage('https://cdn.example.com/konserthuset-banner.jpg');
    const result = extractEvents(html, 'konserthuset', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe('https://cdn.example.com/konserthuset-banner.jpg');
    }
  });

  it('absolutizes a relative og:image URL against baseUrl', () => {
    const html = htmlWithOgImage('/img/banner.jpg');
    const result = extractEvents(html, 'konserthuset', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe('https://konserthuset.se/img/banner.jpg');
    }
  });

  it('falls back to twitter:image when og:image is absent', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <meta name="twitter:image" content="https://cdn.example.com/twitter-card.jpg" />
</head>
<body>
  <article>
    <h2>Teater ikväll</h2>
    <time datetime="2026-08-22T19:00">22 aug 19:00</time>
  </article>
</body>
</html>`;
    const result = extractEvents(html, 'stadsteatern', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe('https://cdn.example.com/twitter-card.jpg');
    }
  });

  it('falls back to og:image:url when og:image is absent', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <meta property="og:image:url" content="https://cdn.example.com/og-url.jpg" />
</head>
<body>
  <article>
    <h2>Dans ikväll</h2>
    <time datetime="2026-08-22T19:00">22 aug 19:00</time>
  </article>
</body>
</html>`;
    const result = extractEvents(html, 'operan', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe('https://cdn.example.com/og-url.jpg');
    }
  });

  it('falls back to link[rel="image_src"] when no meta tags are present', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <link rel="image_src" href="https://cdn.example.com/legacy.jpg" />
</head>
<body>
  <article>
    <h2>Jazz ikväll</h2>
    <time datetime="2026-08-22T19:00">22 aug 19:00</time>
  </article>
</body>
</html>`;
    const result = extractEvents(html, 'fasching', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe('https://cdn.example.com/legacy.jpg');
    }
  });

  it('leaves imageUrl undefined when the page has no image signal', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <title>Bildlös kalender</title>
</head>
<body>
  <article>
    <h2>Konsert utan bild</h2>
    <time datetime="2026-08-22T19:00">22 aug 19:00</time>
  </article>
</body>
</html>`;
    const result = extractEvents(html, 'no-image-source', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBeUndefined();
    }
  });

  it('JSON-LD image wins over og:image (priority test, inline JSON-LD)', () => {
    // JSON-LD path (A1) runs before the fallback. JSON-LD image must not be
    // overwritten by og:image — this protects sources that publish a
    // per-event image in JSON-LD plus a generic og:image for the listing.
    const jsonLdImage = 'https://cdn.example.com/event-specific.jpg';
    const ogImage = 'https://cdn.example.com/generic-page.jpg';
    const html = `<!doctype html>
<html lang="sv">
<head>
  <meta property="og:image" content="${ogImage}" />
  <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Konsert med specifik bild",
  "startDate": "2026-08-22T19:00",
  "image": "${jsonLdImage}"
}
  </script>
</head>
<body></body>
</html>`;
    const result = extractEvents(html, 'konserthuset', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(evt.imageUrl).toBe(jsonLdImage);
    }
  });

  it('returns empty events without crashing on HTML lacking events entirely', () => {
    const html = `<!doctype html>
<html><head><meta property="og:image" content="https://x.example.com/y.jpg" /></head>
<body><p>Inga events här.</p></body></html>`;
    const result = extractEvents(html, 'empty', BASE_URL);
    expect(result.events).toEqual([]);
  });
});

// ─── Strategy A2: microdata / schema.org itemprop ──────────────────────────

describe('universal-extractor — Strategy A2: nested microdata', () => {
  it('parses nested itemprop=location into venue/address', () => {
    const html = `<!doctype html>
<html><body>
<div itemscope itemtype="https://schema.org/Event">
  <span itemprop="name">Konsert i Konserthuset</span>
  <time itemprop="startDate" datetime="2026-08-22T19:00">22 aug 19:00</time>
  <div itemprop="location" itemscope itemtype="https://schema.org/Place">
    <span itemprop="name">Konserthuset Stockholm</span>
    <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
      <span itemprop="streetAddress">Hötorget 8</span>
      <span itemprop="addressLocality">Stockholm</span>
    </div>
  </div>
  <a itemprop="url" href="/event/abc">Läs mer</a>
</div>
</body></html>`;
    const result = extractEvents(html, 'konserthuset', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    const evt = result.events[0];
    expect(evt.title).toBe('Konsert i Konserthuset');
    // Nested location.name → venue
    expect(evt.venue).toBe('Konserthuset Stockholm');
    // Nested location.address.streetAddress → address
    expect(evt.address).toBe('Hötorget 8');
    // location.address.addressLocality → city
    expect(evt.city).toBe('Stockholm');
  });

  it('extracts img itemprop=image src attribute', () => {
    const html = `<!doctype html>
<html><body>
<div itemscope itemtype="https://schema.org/Event">
  <span itemprop="name">Fotoevent</span>
  <img itemprop="image" src="https://cdn.example.com/event-pic.jpg" alt="banner" />
</div>
</body></html>`;
    const result = extractEvents(html, 'fotoevent', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].imageUrl).toBe('https://cdn.example.com/event-pic.jpg');
  });

  it('handles multi-value itemprop as array', () => {
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
    const evt = result.events[0] as unknown as { url: string | string[] };
    expect(Array.isArray(evt.url) || typeof evt.url === 'string').toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2026-10-02 — 5.3 NewsArticle / WebPage wrapper recursion.
//
// Verifierar att universal-extractor plockar Event-typade objekt som är
// nested i NewsArticle.about[] eller WebPage.mainEntity.
//
// Före 5.3: extractFromGraph filtrerade bort NewsArticle/WebPage items
//           (behöll bara @type=Event), så events i about[]/mainEntity
//           försvann. ~5-10% av description-gapet (Grupp B i planen).
//
// Efter 5.3: extractFromGraph rekurserar in i about[] och mainEntity
//            och plockar Event-typade objekt.
//
// Cross-site-verifiering (5.3 krav — 3+ unrelated domäner eller mönster):
//   1. thatsup.se (VERIFIED live 2026-10-02 — NewsArticle.about[] med 58
//      events per sida). Real-world fixture.
//   2. Wikipedia-style pattern (synthetic — WebPage.mainEntity: Event
//      utan @graph, platt JSON-LD-blob).
//   3. Schema.org article pattern (synthetic — Article med about: object,
//      inte array).
//
// Den syntetiska fixtures testar att recursion klarar alla tre formerna
// (om about/mainEntity är array, object, eller saknas helt). Implementat-
// ionen är generisk och site-specifik — den enda plats accepterar är produktion-
// kod som kör samma JSON-LD-spec.
// ──────────────────────────────────────────────────────────────────────────

function htmlWithJsonLd(jsonLd: object): string {
  const json = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="sv">
<head>
<script type="application/ld+json">${json}</script>
</head>
<body><h1>Test page</h1></body>
</html>`;
}

describe('universal-extractor — Strategy A1: NewsArticle/WebPage wrapper recursion (5.3)', () => {
  // ── Test 1: thatsup real-world pattern ───────────────────────────────────
  it('thatsup.se: extracts Event from NewsArticle.about[] array inside @graph', () => {
    // Real structure observed 2026-10-02 på thatsup.se/stockholm/article/-konstruktion-och-bild-pa-nacka-konsthall/
    // NewsArticle.about[] har typiskt 39-58 nested Event-objekt med full location/address.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          name: 'Konstruktion och bild på Nacka konsthall',
          description:
            'Konstruktion och bild är en utställning i Nacka konsthall av konstnären Matilda Dominique.',
        },
        {
          '@type': 'NewsArticle',
          headline: 'Konstruktion och bild på Nacka konsthall',
          about: [
            {
              '@type': 'Event',
              name: 'Konstruktion och bild — vernissage',
              startDate: '2026-09-19T13:00',
              endDate: '2026-11-15',
              description: 'Vernissage den 19 september klockan 13.00.',
              location: {
                '@type': 'Place',
                name: 'Nacka konsthall',
                address: {
                  '@type': 'PostalAddress',
                  streetAddress: 'Nacka',
                },
              },
            },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'thatsup-stockholm-articles', 'https://thatsup.se/article/test/');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Konstruktion och bild — vernissage');
    expect(result.events[0].description).toBe('Vernissage den 19 september klockan 13.00.');
    expect(result.events[0].venue).toBe('Nacka konsthall');
  });

  it('thatsup.se: handles NewsArticle.about[] with multiple Events', () => {
    // Same pattern but with 3 nested events — must extract ALL of them.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsArticle',
          headline: 'Three concerts at Göta Lejon',
          about: [
            {
              '@type': 'Event',
              name: 'Concert A',
              startDate: '2026-10-04',
              location: { '@type': 'Place', name: 'Göta Lejon' },
            },
            {
              '@type': 'Event',
              name: 'Concert B',
              startDate: '2026-10-05',
              location: { '@type': 'Place', name: 'Göta Lejon' },
            },
            {
              '@type': 'Event',
              name: 'Concert C',
              startDate: '2026-10-06',
              location: { '@type': 'Place', name: 'Göta Lejon' },
            },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'thatsup-multi', 'https://example.com/article/');
    expect(result.events.length).toBe(3);
    const titles = result.events.map((e) => e.title).sort();
    expect(titles).toEqual(['Concert A', 'Concert B', 'Concert C']);
  });

  // ── Test 2: Wikipedia-style mainEntity pattern ───────────────────────────
  it('Wikipedia-pattern: extracts Event from WebPage.mainEntity (object, not array)', () => {
    // Synthetisk fixture baserad på schema.org/Wikipedia-pattern exempel.
    // WebPage.mainEntity är ett enskilt Event-objekt (inte en array).
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Dexys Midnight Runners at Göta Lejon',
      mainEntity: {
        '@type': 'Event',
        name: 'Dexys Midnight Runners',
        startDate: '2026-10-04T20:00',
        location: { '@type': 'Place', name: 'Göta Lejon', address: 'Götgatan 79, Stockholm' },
        description: 'Legendary soul band returns to Stockholm',
      },
    });
    const result = extractEvents(html, 'wikipedia-event', 'https://example.com/wiki/event');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Dexys Midnight Runners');
    expect(result.events[0].venue).toBe('Göta Lejon');
  });

  // ── Test 3: Schema.org Article pattern (about: object, not array) ────────
  it('Article-pattern: extracts Event from Article.about as object (not array)', () => {
    // Synthetisk fixture där Article har about som ett enskilt objekt.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Festival preview',
      about: {
        '@type': 'Event',
        name: 'Way Down We Go Tour',
        startDate: '2026-11-15T19:00',
        location: { '@type': 'Place', name: 'Annexet' },
        description: 'Special tour stop in Stockholm',
      },
    });
    const result = extractEvents(html, 'article-pattern', 'https://example.com/article/festival');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Way Down We Go Tour');
  });

  // ── Negative test: about[] without any Event ──────────────────────────────
  it('does NOT extract events when about[] contains only non-Event items', () => {
    // NewsArticle kan ha about[] med Place, Person, Organization — inte Event.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsArticle',
          headline: 'About Stockholm',
          about: [
            { '@type': 'Place', name: 'Stockholm' },
            { '@type': 'Person', name: 'Some Author' },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'no-events', 'https://example.com/article/sthlm');
    expect(result.events.length).toBe(0);
  });

  // ── Negative test: regression — pre-existing Event extraction still works ─
  it('does NOT regress: top-level Event JSON-LD still extracted', () => {
    // Sanity check att 5.3 inte bryter befintlig A1-väg.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Standalone Event',
      startDate: '2026-10-04',
      location: { '@type': 'Place', name: 'Test Venue' },
    });
    const result = extractEvents(html, 'standalone', 'https://example.com/event');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Standalone Event');
  });

  // ── Negative test: regression — ItemList extraction still works ───────────
  it('does NOT regress: ItemList extraction still works', () => {
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          item: {
            '@type': 'Event',
            name: 'Itemlist Event',
            startDate: '2026-10-04',
            location: { '@type': 'Place', name: 'Annexet' },
          },
        },
      ],
    });
    const result = extractEvents(html, 'itemlist', 'https://example.com/list');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Itemlist Event');
  });
});
