/**
 * Tests for the og:image / JSON-LD fallback image extractor.
 *
 * Covers: meta tags (og:image, og:image:url, twitter:image), relative URL
 * resolution, JSON-LD Event.image (string, ImageObject, array, @graph),
 * rejection of non-image URLs, cheerio parse failures, cycle guard.
 *
 * Run with:  npx vitest run 08-Agent/tests/event_image.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  extractImageFromHtml,
  resolveUrl,
  looksLikeImage,
} from '../tools/event_image';

// ─── resolveUrl ─────────────────────────────────────────────────────────────

describe('resolveUrl', () => {
  it('passes through absolute http URLs unchanged', () => {
    expect(resolveUrl('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
  });
  it('passes through absolute http URLs (not just https)', () => {
    expect(resolveUrl('http://example.com/img.jpg')).toBe('http://example.com/img.jpg');
  });
  it('resolves a relative URL against the page base', () => {
    expect(resolveUrl('/img/hero.jpg', 'https://venue.example.com/events/foo'))
      .toBe('https://venue.example.com/img/hero.jpg');
  });
  it('resolves a protocol-relative URL against the page base', () => {
    expect(resolveUrl('//cdn.example.com/hero.jpg', 'https://venue.example.com/events/foo'))
      .toBe('https://cdn.example.com/hero.jpg');
  });
  it('returns null for relative URL with no base', () => {
    expect(resolveUrl('/img/hero.jpg')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(resolveUrl('')).toBeNull();
  });
  it('returns null for data: URIs (we do not follow those)', () => {
    expect(resolveUrl('data:image/png;base64,xxx')).toBeNull();
  });
});

// ─── looksLikeImage ─────────────────────────────────────────────────────────

describe('looksLikeImage', () => {
  it('accepts common image extensions', () => {
    expect(looksLikeImage('https://x.com/a.jpg')).toBe(true);
    expect(looksLikeImage('https://x.com/a.jpeg')).toBe(true);
    expect(looksLikeImage('https://x.com/a.png')).toBe(true);
    expect(looksLikeImage('https://x.com/a.webp')).toBe(true);
    expect(looksLikeImage('https://x.com/a.gif')).toBe(true);
    expect(looksLikeImage('https://x.com/a.avif')).toBe(true);
    expect(looksLikeImage('https://x.com/a.svg')).toBe(true);
  });
  it('accepts query strings and fragments on image URLs', () => {
    expect(looksLikeImage('https://x.com/a.jpg?v=2&w=600')).toBe(true);
    expect(looksLikeImage('https://x.com/a.png#hero')).toBe(true);
  });
  it('rejects non-image extensions', () => {
    expect(looksLikeImage('https://x.com/page.html')).toBe(false);
    expect(looksLikeImage('https://x.com/event')).toBe(false);
    expect(looksLikeImage('https://x.com/a.pdf')).toBe(false);
  });
  it('case-insensitive', () => {
    expect(looksLikeImage('https://x.com/A.JPG')).toBe(true);
  });
});

// ─── extractImageFromHtml ───────────────────────────────────────────────────

describe('extractImageFromHtml', () => {
  it('extracts og:image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    </head><body>x</body></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/hero.jpg');
  });

  it('extracts og:image:url when og:image absent', () => {
    const html = `<html><head>
      <meta property="og:image:url" content="https://cdn.example.com/hero.png">
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/hero.png');
  });

  it('extracts twitter:image as fallback', () => {
    const html = `<html><head>
      <meta name="twitter:image" content="https://cdn.example.com/twit.jpg">
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/twit.jpg');
  });

  it('extracts twitter:image:src as another fallback', () => {
    const html = `<html><head>
      <meta name="twitter:image:src" content="https://cdn.example.com/twit.jpg">
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/twit.jpg');
  });

  it('prefers og:image over twitter:image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/twit.jpg">
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/og.jpg');
  });

  it('resolves relative og:image URL against pageUrl', () => {
    const html = `<html><head>
      <meta property="og:image" content="/img/hero.jpg">
    </head></html>`;
    expect(extractImageFromHtml(html, 'https://venue.example.com/events/foo'))
      .toBe('https://venue.example.com/img/hero.jpg');
  });

  it('extracts JSON-LD Event.image as string', () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Event","name":"Jazz","image":"https://cdn.example.com/jazz.jpg"}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/jazz.jpg');
  });

  it('extracts JSON-LD Event.image as array of strings', () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Event","image":["https://cdn.example.com/1.jpg","https://cdn.example.com/2.jpg"]}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/1.jpg');
  });

  it('extracts JSON-LD Event.image as ImageObject', () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Event","image":{"@type":"ImageObject","url":"https://cdn.example.com/obj.jpg"}}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/obj.jpg');
  });

  it('walks JSON-LD @graph to find image', () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"WebPage","name":"About"},
          {"@type":"Event","name":"Concert","image":"https://cdn.example.com/concert.jpg"}
        ]}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/concert.jpg');
  });

  it('prefers og:image over JSON-LD Event.image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <script type="application/ld+json">
        {"@type":"Event","image":"https://cdn.example.com/jazz.jpg"}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/og.jpg');
  });

  it('falls back to JSON-LD when og:image URL has no image extension', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/landing">
      <script type="application/ld+json">
        {"@type":"Event","image":"https://cdn.example.com/jazz.jpg"}
      </script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/jazz.jpg');
  });

  it('returns null when no image signal is present', () => {
    const html = `<html><head><title>Concert</title></head><body>Hello</body></html>`;
    expect(extractImageFromHtml(html)).toBeNull();
  });

  it('returns null on invalid JSON-LD (does not throw)', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ this is not valid JSON</script>
    </head></html>`;
    expect(extractImageFromHtml(html)).toBeNull();
  });

  it('trims whitespace from meta content', () => {
    const html = `<html><head>
      <meta property="og:image" content="  https://cdn.example.com/hero.jpg  ">
    </head></html>`;
    expect(extractImageFromHtml(html)).toBe('https://cdn.example.com/hero.jpg');
  });

  it('handles cycle guard in JSON-LD walker (depth > 5)', () => {
    // Build a deeply nested @graph that exceeds the cycle guard.
    let nested: Record<string, unknown> = { '@type': 'Event', image: 'https://deep.example.com/img.jpg' };
    for (let i = 0; i < 10; i++) {
      nested = { '@graph': [nested] };
    }
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify(nested)}</script>
    </head></html>`;
    // Should return null without hanging (cycle guard kicks in at depth 5)
    expect(extractImageFromHtml(html)).toBeNull();
  });

  it('returns null on completely invalid HTML (cheerio handles gracefully)', () => {
    // cheerio is forgiving; just confirm we don't throw
    expect(() => extractImageFromHtml('<<<<>>>>')).not.toThrow();
  });
});
