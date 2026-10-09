/**
 * biljettshop.test.ts — verifierar biljettshop.se adapter (Flaskhals 3 follow-up)
 *
 * Testar mot syntetisk HTML som modellerar biljettshop.se JSON-LD-struktur
 * (verifierad 2026-10-09 från 4 ticket-detail URLs).
 */
import { describe, it, expect } from 'vitest';
import { matches, extract } from './biljettshop';

function htmlWithEvents(events: Array<{
  name: string;
  startDate: string;
  venue: string;
  url?: string;
}>): string {
  const ld = {
    '@context': 'https://schema.org',
    '@graph': events.map((e) => ({
      '@type': 'MusicEvent',
      name: e.name,
      startDate: e.startDate,
      location: { '@type': 'Place', name: e.venue },
      url: e.url || 'https://biljettshop.se/sv/sven-ingvars-2026-04-19/',
    })),
  };
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="sv">
<head>
<script type="application/ld+json">${json}</script>
</head>
<body><h1>Biljettshop ticket detail</h1></body>
</html>`;
}

describe('biljettshop adapter — matches()', () => {
  it('matches biljettshop.se URLs (sv)', () => {
    expect(matches('https://biljettshop.se/sv/sven-ingvars-2026-04-19/')).toBe(true);
  });
  it('matches biljettshop.se URLs (en)', () => {
    expect(matches('https://biljettshop.se/en/sven-ingvars-2026-04-19/')).toBe(true);
  });
  it('matches www.biljettshop.se', () => {
    expect(matches('https://www.biljettshop.se/sv/x/')).toBe(true);
  });
  it('rejects other domains', () => {
    expect(matches('https://example.com/sv/x/')).toBe(false);
    expect(matches('https://fallan.nu/whats-on')).toBe(false);
  });
});

describe('biljettshop adapter — extract()', () => {
  it('extracts events from JSON-LD @graph array', () => {
    const html = htmlWithEvents([
      { name: 'Sven Ingvars Kungsbacka Teater 2026-10-09 19:00', startDate: '2026-10-09T19:00', venue: 'Kungsbacka Teater' },
      { name: 'Sven Ingvars Malmö Live 2026-10-10 19:30', startDate: '2026-10-10T19:30', venue: 'Malmö Live' },
    ]);
    const result = extract(html, 'https://biljettshop.se/sv/sven-ingvars-2026-04-19/');
    expect(result.events.length).toBe(2);
    expect(result.method).toBe('biljettshop-jsonld');
    expect(result.events[0].title).toContain('Sven Ingvars');
    expect(result.events[0].date).toBe('2026-10-09');
    expect(result.events[0].time).toBe('19:00');
    expect(result.events[0].venue).toBe('Kungsbacka Teater');
    expect(result.events[0].source).toBe('biljettshop');
  });

  it('deduplicates identical events (same name+date+venue)', () => {
    const html = htmlWithEvents([
      { name: 'Sven Ingvars Kungsbacka 2026-10-09 19:00', startDate: '2026-10-09T19:00', venue: 'Kungsbacka Teater' },
      { name: 'Sven Ingvars Kungsbacka 2026-10-09 19:00', startDate: '2026-10-09T19:00', venue: 'Kungsbacka Teater' },
    ]);
    const result = extract(html, 'https://biljettshop.se/sv/x/');
    expect(result.events.length).toBe(1);
  });

  it('returns empty + method=none when no JSON-LD', () => {
    const html = `<!doctype html><html><body><h1>No events</h1></body></html>`;
    const result = extract(html, 'https://biljettshop.se/sv/x/');
    expect(result.events.length).toBe(0);
    expect(result.method).toBe('none');
  });

  it('returns empty + method=none for non-biljettshop URLs', () => {
    const html = htmlWithEvents([{ name: 'X', startDate: '2026-10-09T19:00', venue: 'Y' }]);
    const result = extract(html, 'https://example.com/sv/x/');
    expect(result.events.length).toBe(0);
    expect(result.method).toBe('none');
  });

  it('skips malformed JSON-LD blocks', () => {
    const html = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org",}</script>
</head><body></body></html>`;
    const result = extract(html, 'https://biljettshop.se/sv/x/');
    expect(result.events.length).toBe(0);
    expect(result.method).toBe('none');
  });

  it('handles top-level JSON-LD Event (no @graph wrapper)', () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: 'Niklas Strömstedt - Tyck OM mig Härnösands Teater 2026-10-22 19:00',
      startDate: '2026-10-22T19:00',
      location: { '@type': 'Place', name: 'Härnösands Teater' },
    }).replace(/</g, '\\u003c');
    const html = `<!doctype html><html><head>
<script type="application/ld+json">${json}</script>
</head><body></body></html>`;
    const result = extract(html, 'https://biljettshop.se/sv/niklas-stromstedt-2026-04-19/');
    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toContain('Niklas Strömstedt');
    expect(result.events[0].venue).toBe('Härnösands Teater');
  });

  it('confidence signals include biljettshop-jsonld', () => {
    const html = htmlWithEvents([
      { name: 'Test Event', startDate: '2026-10-09T19:00', venue: 'Test Venue' },
    ]);
    const result = extract(html, 'https://biljettshop.se/sv/test/');
    expect(result.events[0].confidence.signals).toContain('biljettshop-jsonld');
    expect(result.events[0].confidence.score).toBe(0.95);
  });
});