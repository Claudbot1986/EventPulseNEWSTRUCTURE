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
