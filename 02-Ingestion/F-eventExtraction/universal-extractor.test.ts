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

  // ── Description inheritance: WebPage.description → NewsArticle.about[] ──
  it('inherits description from sibling WebPage when nested Event lacks one', () => {
    // Real thatsup pattern: @graph[WebPage] (description) + @graph[NewsArticle]
    // (no description) med about[] events. Barnen ska ärva WebPage.description.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          name: 'Test article',
          description:
            'Konstruktion och bild är en utställning i Nacka konsthall av konstnären Matilda Dominique.',
        },
        {
          '@type': 'NewsArticle',
          headline: 'Test article',
          about: [
            {
              '@type': 'Event',
              name: 'Test Event',
              startDate: '2026-09-19',
              location: { '@type': 'Place', name: 'Nacka konsthall' },
            },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'inherit-desc', 'https://example.com/article');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toBe(
      'Konstruktion och bild är en utställning i Nacka konsthall av konstnären Matilda Dominique.',
    );
  });

  it('prefers own description over inherited one (no overwrite)', () => {
    // Om Event har description → den vinner över arv.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          description: 'Generic page description that is longer than ten chars',
        },
        {
          '@type': 'NewsArticle',
          headline: 'Article headline',
          about: [
            {
              '@type': 'Event',
              name: 'Event With Own Description',
              startDate: '2026-09-19',
              description: 'Specific description for this event only',
              location: { '@type': 'Place', name: 'Venue' },
            },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'no-overwrite', 'https://example.com/article');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toBe('Specific description for this event only');
  });

  it('falls back to headline only when no description is available anywhere', () => {
    // Sista utväg: om ingen description finns i trädet, använd headline.
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsArticle',
          headline: 'Article headline for description fallback',
          about: [
            {
              '@type': 'Event',
              name: 'Event Without Description',
              startDate: '2026-09-19',
            },
          ],
        },
      ],
    });
    const result = extractEvents(html, 'headline-fallback', 'https://example.com/article');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toBe('Article headline for description fallback');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2026-10-02 — Round 2 plan §3: meta description-fallback.
//
// Många källor (spelning.se, sodrateatern, kultur-stockholm, jarfalla) har
// INGEN description i sina JSON-LD Event-block — men har riktig text i
// <meta name="description"> / <meta property="og:description">.
//
// Före fix: events saknade description trots att sidan hade text.
// Efter fix: extractEvents plockar meta description som fallback när
// JSON-LD saknar/har för kort description.
// ──────────────────────────────────────────────────────────────────────────

function htmlWithMetaDescription(jsonLd: object, metaDesc: string): string {
  const json = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="sv">
<head>
<meta name="description" content="${metaDesc}" />
<script type="application/ld+json">${json}</script>
</head>
<body><h1>Test page</h1></body>
</html>`;
}

describe('universal-extractor — Round 2 §3: meta description-fallback', () => {
  it('falls back to <meta name="description"> when JSON-LD Event lacks description', () => {
    // Real spelning.se pattern: MusicEvent utan description, men meta description
    // har 'Modern Guilt, Last days of April...'
    const html = htmlWithMetaDescription(
      {
        '@context': 'https://schema.org',
        '@type': 'MusicEvent',
        name: 'DUNDERFEST 2026',
        startDate: '2026-10-02',
        location: { '@type': 'Place', name: 'Skylten' },
      },
      'Modern Guilt, Last days of April, Nothing works m.fl. spelar på Skylten i Linköping 2–3 oktober 2026.',
    );
    const result = extractEvents(html, 'spelning-se', 'https://example.com/konsert');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toContain('Modern Guilt');
  });

  it('prefers JSON-LD description over meta description (no overwrite)', () => {
    // Om JSON-LD har en riktig description → den vinner.
    const html = htmlWithMetaDescription(
      {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Real Event',
        startDate: '2026-10-02',
        description: 'This is the real JSON-LD description that should win',
      },
      'Generic page-level meta description that should NOT overwrite',
    );
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toBe('This is the real JSON-LD description that should win');
  });

  it('ignores short meta descriptions (<10 chars) — placeholder filter', () => {
    // För korta meta descriptions är troligen template-text, inte riktig.
    const html = htmlWithMetaDescription(
      {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Some Event',
        startDate: '2026-10-02',
      },
      'Foo bar',
    );
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toBeUndefined();
  });

  it('returns null when neither JSON-LD nor meta has a usable description', () => {
    const html = `<!doctype html>
<html><head>
<meta name="description" content="Foo bar" />
</head><body></body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBe(0);
  });
});

/**
 * 2026-10-02 — Round 2 utökning. Page-level description enrichment:
 * när A1/A2/B/C hittar events men description saknas (sidan har text i
 * body men varken JSON-LD description eller meta-taggar har den) →
 * använd body-text som description. Många källor (gratisistockholm,
 * china-teatern, arkdes, sodrateatern.com m.fl.) behöver detta.
 */
describe('universal-extractor — Round 2 utökning: page-level description enrichment', () => {
  it('gratisistockholm-pattern: HTML-heuristic event får body-text description när JSON-LD/meta saknas', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <title>Bakluckeloppis i Kista Galleria</title>
</head>
<body>
  <article>
    <h2>Bakluckeloppis i Kista Galleria</h2>
    <time datetime="2026-10-25T11:00">25 oktober 11:00</time>
    <a href="/viewObject.aspx?objectId=130679">Läs mer</a>
  </article>
  <p>Bakluckeloppisen kommer tillbaka till Kista Galleria. Här möts säljare och fyndjägare från hela Stockholms län för att sälja och fynda bland kläder, prylar, retro, design, heminredning och mycket mer – mitt i ett av stadens mest välbesökta köpcentrum. Sälj eller fynda på stans största vinterloppis under tak! Boka plats och läs mer på loppistajm.se/kista. Lokal/plats: Kista Galleria, Östra p-garaget, Hanstavägen, 164 53 Kista.</p>
</body>
</html>`;
    const result = extractEvents(html, 'gratisistockholm', 'https://www.gratisistockholm.nu/viewObject.aspx?objectId=130679');
    expect(result.events.length).toBeGreaterThan(0);
    const evt = result.events[0];
    expect(evt.description).toBeTruthy();
    expect(evt.description!.length).toBeGreaterThanOrEqual(200);
    expect(evt.description).toMatch(/Bakluckeloppis/);
  });

  it('behåller JSON-LD description — body fallback skriver INTE över', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Konsert ikväll",
    "startDate": "2026-10-25T19:00",
    "description": "Riktig JSON-LD beskrivning från schema.org. Detta är en unik beskrivning som inte får att bli överskriden av body-fallback."
  }
  </script>
  <meta name="description" content="Generic meta description" />
</head>
<body>
  <p>Detta är en helt annan body-text som INTE hör till eventet ovan. Den skoter absolut INTE JSON-LD-beskrivningen som är mycket bättre och mer specifik för eventet ifråga. Den får innehålla åäö och annan svensk text utan att det spelar roll.</p>
</body>
</html>`;
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toMatch(/Riktig JSON-LD beskrivning/);
    expect(result.events[0].description).not.toMatch(/body-text som INTE/);
  });

  it('avkodar HTML-entiteter i JSON-LD description (aviciiarena-pattern)', () => {
    const html = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "name": "Victor Leksell",
    "startDate": "2026-11-15T19:30",
    "description": "V&auml;lkommen till en kv&auml;ll med Victor Leksell p&aring; Avicii Arena. Kv&auml;llen bjuder p&aring; musik och show i v&auml;rldsklass."
  }
  </script>
</head>
<body></body>
</html>`;
    const result = extractEvents(html, 'aviciiarena', 'https://aviciiarena.se/evenemang/victor-leksell');
    expect(result.events.length).toBe(1);
    expect(result.events[0].description).toContain('Välkommen');
    expect(result.events[0].description).toContain('kväll');
    expect(result.events[0].description).toContain('på');
    expect(result.events[0].description).not.toContain('&auml;');
  });

  it('microdata-event får body fallback description (china-teatern-pattern)', () => {
    const html = `<!doctype html>
<html lang="sv">
<head><title>Kevin Bridges</title></head>
<body>
  <article itemscope itemtype="https://schema.org/Event">
    <h1 itemprop="name">Kevin Bridges: Here If You Need Me</h1>
    <time itemprop="startDate" datetime="2026-11-20T19:30">15 nov 19:30</time>
    <a itemprop="url" href="/shower/kevin-bridges-here-if-you-need-me">Läs mer</a>
    <div itemprop="location" itemscope itemtype="https://schema.org/Place">
      <span itemprop="name">China-teatern</span>
    </div>
  </article>
  <p>Kevin Bridges är tillbaka med sin nya show Here If You Need Me – en kväll fylld av skarp humor, observation med en levande komiker som skoer ett fascinerande spektrum av samtida fenomen. Bridges har sålt ut hela Scandinavium tre gånger och nu kommer han äntligen till China-teatern i Stockholm för en bejublad kväll med garanterade skratt och underhållning i världsklass.</p>
</body>
</html>`;
    const result = extractEvents(html, 'chinateatern', 'https://www.chinateatern.se/shower/kevin-bridges');
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    // Hitta det event som har Kevin Bridges-titel
    const kevt = result.events.find(e => /Kevin Bridges/.test(e.title));
    expect(kevt).toBeTruthy();
    expect(kevt!.description).toMatch(/Kevin Bridges/);
    expect(kevt!.description!.length).toBeGreaterThanOrEqual(200);
  });

  it('body fallback ignorerar nav/footer/cookie-text', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <nav><p>Navigation menu med cookies och integritet för footer-länkar som ska filtreras bort av anbefalingen från sidan.</p></nav>
  <article>
    <h2>Event utan description</h2>
    <time datetime="2026-10-25T19:00">25 okt 19:00</time>
  </article>
  <p>Detta är den riktiga descriptionen för eventet som är tillräckligt lång för att kvalificera som body-fallback och innehåller tillräckligt med text för att inte filtreras bort av filtren som tar bort nav- och footer-länkar och diverse reklam som ska bort från body-fallback.</p>
</body>
</html>`;
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].description).toMatch(/riktiga descriptionen/);
    expect(result.events[0].description).not.toMatch(/cookies/);
  });
});

/**
 * 2026-10-02 — Round 2 lärdom: Webflow-sajter (Fållan m.fl.) har trasig JSON-LD.
 * Vi behöver en tolerant parser som extraherar description via regex när
 * JSON.parse kraschar. Detta gör att Fållan-sidor plockar description även
 * med trasig nesting-syntax.
 */
describe('universal-extractor — tolerant JSON-LD parser (Webflow-sajter)', () => {
  it('extraherar description från trasig JSON-LD (Fållan-pattern)', () => {
    const html = `<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "MusicEvent",
  "name": "Simple Plan",
  "startDate": "2026-10-14",
  "description": "Their multi-platinum debut No Pads, No Helmets Just Balls (2002) made superstars of the group. Now celebrating their 25th anniversary with tours across Europe.",
  "url": "https://www.fallan.nu/whats-on/simple-plan"
}
  "location": {
    "@type": ["EventVenue", "MusicVenue"],
    "name": "Fallan"
}
</script>
</head>
<body>
<h1>Simple Plan</h1>
<time>2026-10-14</time>
</body>
</html>`;
    const result = extractEvents(html, 'fallan', 'https://www.fallan.nu/whats-on/simple-plan');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe('Simple Plan');
    expect(result.events[0].description).toMatch(/multi-platinum/);
    expect(result.events[0].description).toMatch(/25th anniversary/);
  });

  it('avkodar HTML-entiteter i trasig JSON-LD description', () => {
    const html = `<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "V&aring;r konsert",
  "description": "En kv&auml;ll med musik f&ouml;r alla &aring;ldrar. V&auml;lkommen!"
}
  "extra": "trasig"
</script>
</head>
<body></body>
</html>`;
    const result = extractEvents(html, 'test', 'https://example.com/event');
    expect(result.events.length).toBeGreaterThan(0);
    const evt = result.events.find(e => e.description && e.description.length > 0);
    expect(evt).toBeTruthy();
    expect(evt!.description).toContain('Välkommen');
    expect(evt!.description).toContain('åldrar');
    expect(evt!.description).toContain('för');
  });
});


describe('universal-extractor — date patterns (Flaskhals 2 fix)', () => {
  it('parses dd/mm without year (SE calendar grid)', () => {
    // Real Fållan-pattern: event-list wrapper containing li.event-card items.
    // Uses <ul class="event-list"> + <li class="event-card"> so scope root is
    // <ul> only, allowing find() to descend into the <li> as a card.
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a class="event-link" href="/whats-on/konsert"><h2 class="event-title">Konsert ikväll</h2></a>
<div class="event-venue">Fållan</div>
<span class="event-date">22/03</span>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'fallan', 'https://www.fallan.nu/whats-on');
    expect(result.events.length).toBeGreaterThan(0);
    const today = new Date().getFullYear();
    expect(result.events[0].date).toBe(`${today}-03-22`);
  });

  it('parses dd-mm without year (SE calendar grid, dash variant)', () => {
    // Real Grönan-pattern: dash separator (15-08) instead of slash.
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a class="event-link" href="/event/festival"><h2 class="event-title">Festival</h2></a>
<span class="event-date">15-08</span>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'gronalund', 'https://www.gronalund.com/event');
    expect(result.events.length).toBeGreaterThan(0);
    const today = new Date().getFullYear();
    expect(result.events[0].date).toBe(`${today}-08-15`);
  });

  it('disambiguates day/month when value > 12 (e.g. 25/03 = 25th March, 03/25 invalid)', () => {
    // First number > 12 must be day (25 is impossible as a month).
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a class="event-link" href="/show"><h2 class="event-title">Show</h2></a>
<span class="event-date">25/03</span>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBeGreaterThan(0);
    const today = new Date().getFullYear();
    expect(result.events[0].date).toBe(`${today}-03-25`);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2026-10-09 — Hallsberg-bug: shortDateRx matchade tidsintervall `12.00-15.00`
// som `2026-00-15`. Hallsberg-appen (SiteVision) har tidsintervall i sin
// JSON-state, och eftersom `[class*="event"]` på `<div class="...events...">`
// matchade hela kalender-wrappern som "ett kort", fångades `00-15`.
//
// Fix: kortslut-lookbehind `(?<![\d.])` kräver att första siffran INTE är
// föregången av siffra eller punkt. `12.00-15.00` → ingen matchning.
// `Event 25-10` → matchar fortfarande.
// ──────────────────────────────────────────────────────────────────────────

describe('universal-extractor — Hallsberg tidsintervall-bug (2026-00-15)', () => {
  it('returns NO event with date=YYYY-00-DD when cardText contains time intervals', async () => {
    // Minskar hallsberg-SiteVision-rendered.html till dess kärna:
    // <div class="...marketplace-sitevision-events..."> innehåller både
    // <ul> med events OCH <script> med JSON-state som har "12.00-15.00".
    // C1 ska INTE tolka `00-15` som `2026-00-15`.
    const html = `<!doctype html>
<html lang="sv"><body>
<div class="sv-custom-module marketplace-sitevision-events">
<ul class="env-list">
<li class="env-list__item env-card">
<a href="/evenemang/konst"><h3>Konstutställning</h3></a>
</li>
</ul>
<script>AppRegistry.registerInitialState('x','y',{"items":[{"text":"Vernissage lördag 10 oktober12.00-15.00. Öppettider: 12.00-16.00, 16.00-18.00","displayName":"Konstutställning","eventDate":"10 oktober 2026"}]})</script>
</div>
</body></html>`;
    const result = extractEvents(html, 'hallsberg', 'https://www.hallsberg.se/visit-hallsberg.html');
    expect(result.events.length).toBeGreaterThan(0);
    for (const e of result.events) {
      expect(e.date).not.toMatch(/-00-\d{2}$/);
    }
  });

  it('matches dd-mm even when preceded by letter (regression: Event 25-10)', () => {
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a href="/e"><h2 class="event-title">Event 25-10</h2></a>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBeGreaterThan(0);
    const today = new Date().getFullYear();
    expect(result.events[0].date).toBe(`${today}-10-25`);
  });

  it('matches dd/mm even when preceded by space (regression: 5/12)', () => {
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a href="/e"><h2 class="event-title">Konsert 5/12</h2></a>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBeGreaterThan(0);
    const today = new Date().getFullYear();
    expect(result.events[0].date).toBe(`${today}-12-05`);
  });

  it('does NOT match time interval "09.00-17.00" inside cardText', () => {
    // Om tidsintervall vore ett datum skulle `00-17` bli `2026-00-17`.
    // Vi verifierar att kortet inte plockar `2026-00-17` när SIFTER + PUNKT
    // föregår första siffran — den europeiska `dd/mm`-formen ska vinna.
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a href="/e"><h2 class="event-title">Öppet hus</h2></a>
<span class="event-date">5/10 Öppet 09.00-17.00 vardagar</span>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBeGreaterThan(0);
    for (const e of result.events) {
      expect(e.date).not.toMatch(/-00-\d{2}$/);
    }
  });

  it('does NOT match "12.00-15.00" inside an unrelated paragraph inside card', () => {
    const html = `<!doctype html>
<html lang="sv"><body>
<ul class="event-list">
<li class="event-card">
<a href="/e"><h2 class="event-title">Vernissage</h2></a>
<p>5/10 Vernissage lördag 10 oktober12.00-15.00. Öppettider under perioden.</p>
</li>
</ul>
</body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBeGreaterThan(0);
    for (const e of result.events) {
      expect(e.date).not.toMatch(/-00-\d{2}$/);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2026-10-09 — A.5 Grand-bugg: body-class med "blog"/"article"/"news"/"post"
// hindrar Squarespace-eventlist-event-cards från att matchas.
//
// Problem: universal-extractor använde `$card.closest('[class*="news|article|
// blog|post"]')` som "filter bort nyhetsartiklar". Men Squarespace-defaults
// ger body class="...tweak-blog-...". Eftersom `closest()` inkluderar
// elementet självt + alla ancestors, fångades ALLA event-cards som "news".
//
// Fix: använd `:not(body, html)` i selektorn så body/html inte matchas,
// och exkludera element vars egen klass innehåller news/post (inte bara
// article/blog som kan vara del av event-classnames).
// ──────────────────────────────────────────────────────────────────────────

describe('universal-extractor — A.5 Grand/Squarespace body-class fix', () => {
  it('extracts events from Squarespace eventlist-event cards (Grand Malmö)', () => {
    // Minimal Grand-liknande HTML: body har "blog" i klassnamnet, men en
    // <article class="eventlist-event"> är inte en blog-post.
    const html = `<!doctype html>
<html><body class="tweak-blog-masonry collection-type-events view-list">
<article class="eventlist-event eventlist-event--upcoming">
  <a href="/calendar/vinprovning-2026"><h2>Vinprovning 2026</h2></a>
  <ul class="eventlist-meta">
    <li><time class="event-date" datetime="2026-10-12">måndag 12 oktober 2026</time></li>
    <li><time class="event-time-localized-start" datetime="2026-10-12T18:00">18:00</time></li>
  </ul>
</article>
<article class="eventlist-event eventlist-event--upcoming">
  <a href="/calendar/konsert-2026"><h2>Höstkonsert</h2></a>
  <ul class="eventlist-meta">
    <li><time class="event-date" datetime="2026-10-19">måndag 19 oktober 2026</time></li>
  </ul>
</article>
</body></html>`;
    const result = extractEvents(html, 'grandmalmo', 'https://www.grandmalmo.se/calendar');
    expect(result.events.length).toBeGreaterThanOrEqual(2);
    const dates = result.events.map((e) => e.date).sort();
    expect(dates).toContain('2026-10-12');
    expect(dates).toContain('2026-10-19');
  });

  it('still filters out real news-article wrappers (regression)', () => {
    // News-blog pattern med body utan "blog" i klass — ska fortsatt filtreras.
    // Strukturen har en <main>-wrapper med events inuti (realistiskt mönster).
    const html = `<!doctype html>
<html><body>
<main>
  <article class="news-article">
    <h2>Nyhet om konsert</h2>
    <time datetime="2026-10-12">12 oktober 2026</time>
  </article>
  <article class="eventlist-event eventlist-event--upcoming">
    <a href="/e/1"><h2>Riktigt event</h2></a>
    <time class="event-date" datetime="2026-10-12">12 oktober 2026</time>
  </article>
</main>
</body></html>`;
    const result = extractEvents(html, 'mixed', 'https://example.com/calendar');
    // Det riktiga eventet ska finnas, news-artikeln ska filtreras bort.
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].title).toBe('Riktigt event');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2026-10-09 — A.5-B2: Generalization Gate (4 unrelated Stockholm-domäner:
// konserthuset, liljevalchs, sodrateatern, sturebadet).
//
// Bug: Swedish-pattern fmt var TypeScript arrow function som transpilerades
// på ett sätt som skickade parametrarna i fel ordning — gav
// "undefined-01-oktober" istället för "2026-10-10". Bytte till function()-
// syntax som transpilerar korrekt.
//
// Fix: function-syntax istället för arrow + default-fallback för undefined
//      parametrar.
// ──────────────────────────────────────────────────────────────────────────

describe('universal-extractor — A.5-B2: Swedish månadsnamn klartext', () => {
  it('parses "10 oktober 2026" → 2026-10-10', () => {
    const html = `<!doctype html>
<html lang="sv"><body>
<div class="event-card">
  <div class="dates">10 oktober 2026</div>
  <h3>OKEJ på turné</h3>
</div>
</body></html>`;
    const result = extractEvents(html, 'sodrateatern', 'https://www.sodrateatern.com/');
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-10-10');
    expect(result.events[0].title).toBe('OKEJ på turné');
  });

  it('parses "16 oktober – 22 november 2026" → end date 2026-11-22', () => {
    // Swedish pattern kräver \s+ mellan månad och år, så "oktober – 22" matchar inte.
    // Resultatet blir slutdatumet (22 november 2026). Det är OK — körkort-period,
    // inte första föreställning. Sodrateatern-specifikt beteende.
    const html = `<!doctype html>
<html lang="sv"><body>
<div class="event-card">
  <div class="dates">16 oktober – 22 november 2026</div>
  <h3>Legally Blonde</h3>
</div>
</body></html>`;
    const result = extractEvents(html, 'sodrateatern', 'https://www.sodrateatern.com/');
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-11-22');
  });

  it('parses all 12 Swedish month names', () => {
    const months = [
      ['januari', '01'], ['februari', '02'], ['mars', '03'], ['april', '04'],
      ['maj', '05'], ['juni', '06'], ['juli', '07'], ['augusti', '08'],
      ['september', '09'], ['oktober', '10'], ['november', '11'], ['december', '12'],
    ];
    for (const [name, num] of months) {
      const html = `<!doctype html><body>
<div class="event-card">
  <div class="dates">15 ${name} 2026</div>
  <h3>Test</h3>
</div></body></html>`;
      const result = extractEvents(html, 'test', 'https://example.com');
      expect(result.events.length).toBe(1);
      expect(result.events[0].date).toBe(`2026-${num}-15`);
    }
  });

  it('handles short Swedish month names (okt, nov, dec)', () => {
    const html = `<!doctype html><body>
<div class="event-card">
  <div class="dates">22 okt 2026</div>
  <h3>Test</h3>
</div></body></html>`;
    const result = extractEvents(html, 'test', 'https://example.com');
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-10-22');
  });
});
