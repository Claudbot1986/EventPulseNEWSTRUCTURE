import { describe, it, expect } from 'vitest';
import { resolveEntryUrls } from './sourceEntryUrls';

const NOW = new Date('2026-10-24T12:00:00Z');

describe('resolveEntryUrls', () => {
  it('returnerar null för källor utan särskild hantering', () => {
    expect(resolveEntryUrls('cirkus', 'https://www.cirkus.se/')).toBeNull();
  });

  it('momentsapp: månadsvyer framåt + dagar i innevarande månad', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender/2026-10-04',
      NOW
    );
    // Månadsvyer först (flest events per credit), sedan dagsidor.
    expect(urls?.[0]).toBe('https://momentsapp.no/events/stockholm/kalender/2026-11');
    expect(urls?.[1]).toBe('https://momentsapp.no/events/stockholm/kalender/2026-12');
    expect(urls?.[2]).toBe('https://momentsapp.no/events/stockholm/kalender/2026-10-24');
    expect(urls?.[urls.length - 1]).toBe(
      'https://momentsapp.no/events/stockholm/kalender/2026-10-30'
    );
    // 2 månadsvyer + 7 dagsidor (24–30)
    expect(urls).toHaveLength(9);
  });

  it('momentsapp: stabil URL ger samma ingångar', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender',
      NOW
    );
    expect(urls?.[0]).toBe('https://momentsapp.no/events/stockholm/kalender/2026-11');
  });

  it('momentsapp: månadsbyte och årsskifte hanteras', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender',
      new Date('2026-12-15T12:00:00Z')
    );
    expect(urls?.[0]).toBe('https://momentsapp.no/events/stockholm/kalender/2027-01');
    expect(urls?.[1]).toBe('https://momentsapp.no/events/stockholm/kalender/2027-02');
    expect(urls?.[2]).toBe('https://momentsapp.no/events/stockholm/kalender/2026-12-15');
  });

  it('momentsapp: sista dagen i månaden ger månadsvyer + just den dagen', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender',
      new Date('2026-10-31T12:00:00Z')
    );
    // 31 oktober är INTE med i november-vyn (mätning: den täcker
    // 2026-11-01…2026-11-30), så dagsidan behövs.
    expect(urls).toEqual([
      'https://momentsapp.no/events/stockholm/kalender/2026-11',
      'https://momentsapp.no/events/stockholm/kalender/2026-12',
      'https://momentsapp.no/events/stockholm/kalender/2026-10-31',
    ]);
  });

  it('momentsapp: dagsfönstret klipper vid månadens slut', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender',
      new Date('2026-10-28T12:00:00Z')
    );
    // 28, 29, 30, 31 — fönstret (7 dagar) fylls men slutar vid månadsskiftet.
    expect(urls?.slice(2)).toEqual([
      'https://momentsapp.no/events/stockholm/kalender/2026-10-28',
      'https://momentsapp.no/events/stockholm/kalender/2026-10-29',
      'https://momentsapp.no/events/stockholm/kalender/2026-10-30',
      'https://momentsapp.no/events/stockholm/kalender/2026-10-31',
    ]);
  });

  it('momentsapp: dagsidor även när månaden inte är innevarande', () => {
    const urls = resolveEntryUrls(
      'momentsapp-stockholm',
      'https://momentsapp.no/events/stockholm/kalender',
      new Date('2026-11-02T12:00:00Z')
    );
    expect(urls).toEqual([
      'https://momentsapp.no/events/stockholm/kalender/2026-12',
      'https://momentsapp.no/events/stockholm/kalender/2027-01',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-02',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-03',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-04',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-05',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-06',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-07',
      'https://momentsapp.no/events/stockholm/kalender/2026-11-08',
    ]);
  });

  it('NEGATIV KONTROLL — främmande domän ger ingen ingångs-URL', () => {
    expect(
      resolveEntryUrls('momentsapp-stockholm', 'https://example.com/kalender/2026-10-04', NOW)
    ).toBeNull();
  });

  it('NEGATIV KONTROLL — annan sourceId med momentsapp-URL ger ingen ingångs-URL', () => {
    expect(
      resolveEntryUrls('cirkus', 'https://momentsapp.no/events/stockholm/kalender/2026-10-04', NOW)
    ).toBeNull();
  });
});
