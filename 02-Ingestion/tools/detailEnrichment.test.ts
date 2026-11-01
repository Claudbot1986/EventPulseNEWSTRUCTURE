/**
 * detailEnrichment.test.ts — regeln "fyll bara saknade fält".
 *
 * Den här filen fanns INTE, och det kostade oss en tyst bugg: `mergeEnrichment`
 * fyllde ett fält bara när raden redan HADE ett värde, och fyllde aldrig de
 * fält som faktiskt saknades. Hela berikningen var därmed en no-op för
 * beskrivning och plats — precis de uppgifter den finns för att hämta.
 *
 * Negativ kontroll: varje "fyller inte över" har ett "fyller" bredvid sig, så
 * att testet inte kan passera på en regel som alltid ger samma svar.
 */

import { describe, it, expect } from 'vitest';
import {
  extractDetailFacts,
  isDetailUrl,
  isFetchableUrl,
  mergeEnrichment,
  missingEnrichableFields,
  parseJsonLd,
  type DetailFacts,
  type EnrichmentRow,
} from './detailEnrichment.js';

/** Fakta från en typisk evenemangssida. */
const SIDFakta: DetailFacts = {
  title: 'Helgkurs – Improvisationsteater',
  description: 'En riktigt lång beskrivning från evenemangssidan, över fyrtio tecken lång.',
  image: 'https://ex.se/media/riktig-bild.jpg',
  venue: 'Stora Teatern',
  address: 'Götgatan 4, Stockholm',
  startDate: '2026-11-02T19:00:00Z',
  jsonLdTypes: ['event'],
  ogType: 'website',
  declaredArticle: false,
  declaredEvent: true,
};

/** En rad som saknar plats, beskrivning och bild. */
function tomRad(): EnrichmentRow {
  return {
    title: 'Helgkurs – Improvisationsteater',
    url: 'https://ex.se/e/1',
    sourceUrl: 'https://ex.se/listing',
  };
}

describe('missingEnrichableFields — vad räknas som saknat', () => {
  it('en rad utan något räknas som saknad beskrivning, plats och bild', () => {
    expect(missingEnrichableFields(tomRad())).toEqual(['description', 'venue', 'image']);
  });

  it('en kort beskrivning räknas som SAKNAD (<40 tecken)', () => {
    const rad = { ...tomRad(), description: 'kort' };
    expect(missingEnrichableFields(rad)).toContain('description');
  });

  it('en lång beskrivning räknas som INTE saknad', () => {
    const rad = { ...tomRad(), description: SIDFakta.description! };
    expect(missingEnrichableFields(rad)).not.toContain('description');
  });

  it('plats räknas som saknad om varken venue eller venue_name har värde', () => {
    expect(missingEnrichableFields({ ...tomRad(), venue: '', venue_name: '' })).toContain('venue');
    expect(missingEnrichableFields({ ...tomRad(), venue: 'Kungliga Operan' })).not.toContain('venue');
    expect(missingEnrichableFields({ ...tomRad(), venue_name: 'Kungliga Operan' })).not.toContain('venue');
  });

  it('en generisk og-image räknas som SAKNAD bild', () => {
    const rad = { ...tomRad(), imageUrl: 'https://ex.se/media/og-image.jpg' };
    expect(missingEnrichableFields(rad)).toContain('image');
  });

  it('en riktig bild räknas som INTE saknad', () => {
    const rad = { ...tomRad(), imageUrl: 'https://ex.se/media/riktig.jpg' };
    expect(missingEnrichableFields(rad)).not.toContain('image');
  });
});

describe('mergeEnrichment — REGRESSION: fyller SAKNADE fält', () => {
  it('fyller beskrivning, plats och bild på en tom rad', () => {
    const { row, filled } = mergeEnrichment(tomRad(), SIDFakta);
    expect(filled).toContain('description');
    expect(filled).toContain('venue');
    expect(filled).toContain('image');
    expect(row.description).toBe(SIDFakta.description);
    expect(row.venue).toBe('Stora Teatern');
    expect(row.imageUrl).toBe(SIDFakta.image);
  });

  it('sätter BÅDE venue och venue_name (importen läser venue_name)', () => {
    const { row } = mergeEnrichment(tomRad(), SIDFakta);
    expect(row.venue).toBe('Stora Teatern');
    expect(row.venue_name).toBe('Stora Teatern');
  });

  it('fyller adress och starttid när de saknas', () => {
    const { row, filled } = mergeEnrichment(tomRad(), SIDFakta);
    expect(filled).toContain('venue_address');
    expect(filled).toContain('startTime');
    expect(row.venue_address).toBe('Götgatan 4, Stockholm');
    expect(row.startTime).toBe('2026-11-02T19:00:00Z');
  });

  it('skriver INTE över en beskrivning som redan har värde', () => {
    const egen = 'Min egen beskrivning som är längre än fyrtio tecken och därför räknas som användbar.';
    const { row, filled } = mergeEnrichment({ ...tomRad(), description: egen }, SIDFakta);
    expect(filled).not.toContain('description');
    expect(row.description).toBe(egen);
  });

  it('skriver INTE över plats som redan har värde', () => {
    const { row, filled } = mergeEnrichment({ ...tomRad(), venue: 'Kungliga Operan' }, SIDFakta);
    expect(filled).not.toContain('venue');
    expect(row.venue).toBe('Kungliga Operan');
  });

  it('skriver INTE över en riktig bild', () => {
    const egen = 'https://ex.se/media/keep.jpg';
    const { row, filled } = mergeEnrichment({ ...tomRad(), imageUrl: egen }, SIDFakta);
    expect(filled).not.toContain('image');
    expect(row.imageUrl).toBe(egen);
  });

  it('ERSÄTTER en generisk og-image med sidans riktiga bild', () => {
    const { row, filled } = mergeEnrichment(
      { ...tomRad(), imageUrl: 'https://ex.se/media/og-image.jpg' },
      SIDFakta,
    );
    expect(filled).toContain('image');
    expect(row.imageUrl).toBe(SIDFakta.image);
  });

  it('skriver INTE över starttid som redan finns (startTime eller time)', () => {
    const medStart = { ...tomRad(), startTime: '2026-01-01T10:00:00Z' };
    expect(mergeEnrichment(medStart, SIDFakta).filled).not.toContain('startTime');
    const medTime = { ...tomRad(), time: '10:00' };
    expect(mergeEnrichment(medTime, SIDFakta).filled).not.toContain('startTime');
  });

  it('lämnar raden orörd när inget fattas', () => {
    const komplett: EnrichmentRow = {
      ...tomRad(),
      description: SIDFakta.description!,
      venue: 'Stora Teatern',
      venue_name: 'Stora Teatern',
      imageUrl: 'https://ex.se/media/keep.jpg',
      startTime: '2026-01-01T10:00:00Z',
      venue_address: 'Götgatan 4, Stockholm',
    };
    const { filled } = mergeEnrichment(komplett, SIDFakta);
    expect(filled).toEqual([]);
  });

  it('hittar inte på uppgifter — en tom facts ger inga fält', () => {
    const tommaFakta: DetailFacts = {
      ...SIDFakta,
      description: null, image: null, venue: null, address: null, startDate: null,
    };
    const { filled } = mergeEnrichment(tomRad(), tommaFakta);
    expect(filled).toEqual([]);
  });

  it('skriver en audit-spår i raw_payload.enrichment', () => {
    const { row } = mergeEnrichment(tomRad(), SIDFakta);
    const audit = (row.raw_payload as Record<string, Record<string, unknown>>).enrichment;
    expect(audit.detailUrl).toBe('https://ex.se/e/1');
    expect(audit.fields).toContain('description');
    expect(audit.declaredEvent).toBe(true);
    expect(audit.declaredArticle).toBe(false);
  });

  it('muterar inte den rad som skickas in', () => {
    const rad = tomRad();
    mergeEnrichment(rad, SIDFakta);
    expect(rad.description).toBeUndefined();
    expect(rad.venue).toBeUndefined();
  });
});

describe('isDetailUrl — vilka rader är detaljrader', () => {
  it('en listningsrad (url === sourceUrl) är INTE en detaljrad', () => {
    expect(isDetailUrl({ url: 'https://ex.se/listing', sourceUrl: 'https://ex.se/listing' })).toBe(false);
  });

  it('en detaljrad (url ≠ sourceUrl) ÄR en detaljrad', () => {
    expect(isDetailUrl({ url: 'https://ex.se/e/1', sourceUrl: 'https://ex.se/listing' })).toBe(true);
  });

  it('en rad utan sourceUrl är INTE en detaljrad', () => {
    expect(isDetailUrl({ url: 'https://ex.se/e/1' })).toBe(false);
  });

  it('en mailto-rad är INTE en detaljrad', () => {
    expect(isDetailUrl({ url: 'mailto:a@b.se', sourceUrl: 'https://ex.se/listing' })).toBe(false);
  });

  it('trailing slash räknas som samma sida', () => {
    expect(isDetailUrl({ url: 'https://ex.se/listing/', sourceUrl: 'https://ex.se/listing' })).toBe(false);
  });
});

describe('isFetchableUrl — vad går att hämta', () => {
  it('http och https går att hämta', () => {
    expect(isFetchableUrl('http://ex.se/a')).toBe(true);
    expect(isFetchableUrl('https://ex.se/a')).toBe(true);
  });

  it('mailto, tel och ankare går INTE att hämta', () => {
    expect(isFetchableUrl('mailto:a@b.se')).toBe(false);
    expect(isFetchableUrl('tel:+46701234567')).toBe(false);
    expect(isFetchableUrl('#anchor')).toBe(false);
    expect(isFetchableUrl('')).toBe(false);
    expect(isFetchableUrl(undefined)).toBe(false);
  });
});

describe('extractDetailFacts — vad sidan själv säger', () => {
  it('läser JSON-LD, og:type og og:description', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Event', name: 'Nietzsche kontra Wagner', description: 'En beskrivning som är längre än fyrtio tecken så att den räknas.',
      })}</script>
      <meta property="og:type" content="website" />
      <meta property="og:image" content="https://ex.se/media/real.jpg" />
    </head><body></body></html>`;
    const facts = extractDetailFacts(html);
    expect(facts.jsonLdTypes).toContain('event');
    expect(facts.declaredEvent).toBe(true);
    expect(facts.declaredArticle).toBe(false);
    expect(facts.ogType).toBe('website');
    expect(facts.image).toBe('https://ex.se/media/real.jpg');
  });

  it('en Article-deklaration är ett BEVIS för artikel', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', name: 'En artikel' })}</script>
    </head><body></body></html>`;
    const facts = extractDetailFacts(html);
    expect(facts.declaredArticle).toBe(true);
    expect(facts.declaredEvent).toBe(false);
  });

  it('og:type=article ensamt är INTE ett bevis för artikel', () => {
    const html = '<html><head><meta property="og:type" content="article" /></head><body></body></html>';
    expect(extractDetailFacts(html).declaredArticle).toBe(false);
  });

  it('läser JSON-LD ur @graph', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@graph': [{ '@type': 'WebPage' }, { '@type': 'Event', name: 'Ett evenemang' }],
    })}</script></head><body></body></html>`;
    const facts = extractDetailFacts(html);
    expect(facts.jsonLdTypes).toContain('event');
    expect(facts.declaredEvent).toBe(true);
  });

  it('avkodar HTML-entiteter i beskrivningen', () => {
    const html = '<html><head><meta property="og:description" content="Match &#8211; AIK &amp; mer" /></head><body></body></html>';
    expect(extractDetailFacts(html).description).toBe('Match – AIK & mer');
  });

  it('en trasig JSON-LD kraschar inte parsningen', () => {
    const html = '<html><head><script type="application/ld+json">{ trasig json </script></head><body></body></html>';
    expect(() => extractDetailFacts(html)).not.toThrow();
    expect(parseJsonLd(html)).toEqual([]);
  });

  it('en sida utan JSON-LD ger inga typer', () => {
    const facts = extractDetailFacts('<html><body><p>Hej</p></body></html>');
    expect(facts.jsonLdTypes).toEqual([]);
    expect(facts.declaredArticle).toBe(false);
    expect(facts.declaredEvent).toBe(false);
  });
});
