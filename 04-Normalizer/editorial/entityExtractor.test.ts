/**
 * entityExtractor.test.ts — testar FAS 2 entity extractor mot både positiva
 * (VI SKA extrahera) och negativa (VI SKA INTE extrahera) exempel.
 *
 * Korrigering 7 (2026-10-08): "Testa negativa exempel. False-positive entity
 * roles kan annars skapa hallucinationer redan i Evidence Pack."
 *
 * Detta är en separat FAS 2-test som INTE är samma som semanticExtractor.
 */

import { describe, expect, it } from 'vitest';
import { extractEntities } from './entityExtractor';

// ─── POSITIVA EXEMPEL — VI SKA extrahera ─────────────────────────────────────

describe('Positiva exempel — vi SKA extrahera entiteter', () => {
  it('Anton Estby och Henrythefreak (humor/category) → 2 comedians', () => {
    const e = extractEntities({
      title: 'Anton Estby och Henrythefreak - Standup 2026, Stockholm',
      raw_description: null,
      category_slug: 'humor',
      venue_name: 'Troll Stockholm',
    });
    const names = e.map(x => x.name).sort();
    expect(names).toContain('Anton Estby');
    expect(names).toContain('Henrythefreak');
    const antonEstby = e.find(x => x.name === 'Anton Estby');
    expect(antonEstby?.role).toBe('comedian');
    expect(antonEstby?.evidence.field).toBe('title');
  });

  it('Stratifierat musik: "Veronica Maggio - Sommarturné 2026" → artist', () => {
    const e = extractEntities({
      title: 'Veronica Maggio - Sommarturné 2026',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Gröna Lund',
    });
    const mag = e.find(x => x.name === 'Veronica Maggio');
    expect(mag).toBeDefined();
    expect(mag?.role).toBe('artist');
    expect(mag?.confidence).toBe('SUPPORTED');
  });

  it('Sport: "AIK - Djurgården" → 2 teams', () => {
    const e = extractEntities({
      title: 'AIK - Djurgården',
      raw_description: null,
      category_slug: 'sports',
      venue_name: null,
    });
    const aik = e.find(x => x.name === 'AIK');
    const dif = e.find(x => x.name === 'Djurgården');
    expect(aik?.role).toBe('team');
    expect(dif?.role).toBe('team');
  });

  it('Sport: "AIK vs BIK Karlskoga" → 2 teams (vs)', () => {
    const e = extractEntities({
      title: 'AIK vs BIK Karlskoga',
      raw_description: null,
      category_slug: 'sports',
      venue_name: null,
    });
    expect(e.length).toBeGreaterThanOrEqual(2);
    expect(e.find(x => x.name === 'AIK')?.role).toBe('team');
    expect(e.some(x => x.name.includes('BIK'))).toBe(true);
  });

  it('Standup: "Standup med Özz Nûjen" → 1 comedian', () => {
    const e = extractEntities({
      title: 'Standup med Özz Nûjen',
      raw_description: null,
      category_slug: 'humor',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Özz Nûjen')?.role).toBe('comedian');
  });

  it('Föreläsning: "Föreläsning med Anders Hansen" → 1 speaker', () => {
    const e = extractEntities({
      title: 'Föreläsning med Anders Hansen',
      raw_description: null,
      category_slug: 'talks-lectures',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Anders Hansen')?.role).toBe('speaker');
  });

  it('DJ: "DJ-set med Adam Beyer" → 1 dj', () => {
    const e = extractEntities({
      title: 'DJ-set med Adam Beyer',
      raw_description: null,
      category_slug: 'electronic',
      venue_name: 'Trädgården',
    });
    expect(e.find(x => x.name === 'Adam Beyer')?.role).toBe('dj');
  });

  it('Structured input performers → VERIFIED confidence', () => {
    const e = extractEntities({
      title: 'Konsert med överraskning',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
      structured_performers: ['Kungliga Filharmonikerna'],
    });
    const f = e.find(x => x.name === 'Kungliga Filharmonikerna');
    expect(f?.role).toBe('artist');
    expect(f?.confidence).toBe('VERIFIED');
    expect(f?.evidence.field).toBe('structured_input');
  });

  it('Description: "Medverkande: Anton Estby, Henrythefreak" → performers', () => {
    const e = extractEntities({
      title: 'Standup 2026',
      raw_description: 'Medverkande: Anton Estby, Henrythefreak. En kväll med standup.',
      category_slug: 'humor',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Anton Estby')?.role).toBe('performer');
    expect(e.find(x => x.name === 'Henrythefreak')?.role).toBe('performer');
  });
});

// ─── NEGATIVA EXEMPEL — vi SKA INTE extrahera artists/performer ──────────────

describe('Negativa exempel — vi SKA INTE skapa performers', () => {
  it('"Chicago - the Musical" → Chicago är work, INTE performer', () => {
    const e = extractEntities({
      title: 'Chicago - the Musical',
      raw_description: null,
      category_slug: 'musical-theatre',
      venue_name: 'Oscarsteatern',
    });
    const chicago = e.find(x => x.name === 'Chicago');
    if (chicago) {
      expect(chicago.role).not.toBe('artist');
      expect(chicago.role).not.toBe('performer');
      expect(chicago.role).toBe('work');
    }
    // Inga performers (vi vet inte vilka skådespelare som är med)
    expect(e.filter(x => ['artist', 'performer', 'band', 'comedian'].includes(x.role))).toHaveLength(0);
  });

  it('"Michael Jackson Tribute" → Michael Jackson är referenced, INTE performer', () => {
    const e = extractEntities({
      title: 'Michael Jackson Tribute',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    const mj = e.find(x => x.name.includes('Michael Jackson'));
    if (mj) {
      expect(mj.role).not.toBe('artist');
      expect(mj.role).not.toBe('performer');
      expect(mj.role).toBe('referenced');
    }
  });

  it('"ABBA The Museum" → ABBA är referenced, INTE performer', () => {
    const e = extractEntities({
      title: 'ABBA The Museum',
      raw_description: null,
      category_slug: 'exhibition',
      venue_name: null,
    });
    const abba = e.find(x => x.name === 'ABBA');
    if (abba) {
      expect(abba.role).not.toBe('artist');
      expect(abba.role).not.toBe('performer');
      expect(abba.role).toBe('referenced');
    }
  });

  it('"Taylor Swift Party" → Taylor Swift är theme, INTE performer', () => {
    const e = extractEntities({
      title: 'Taylor Swift Party',
      raw_description: null,
      category_slug: 'nightlife',
      venue_name: null,
    });
    const ts = e.find(x => x.name.includes('Taylor Swift'));
    if (ts) {
      expect(ts.role).not.toBe('artist');
      expect(ts.role).not.toBe('performer');
      expect(ts.role).toBe('theme');
    }
  });

  it('"En kväll med Mozart" → Mozart är theme/composer context, INTE performer', () => {
    const e = extractEntities({
      title: 'En kväll med Mozart',
      raw_description: null,
      category_slug: 'classical',
      venue_name: null,
    });
    const mozart = e.find(x => x.name.includes('Mozart'));
    if (mozart) {
      expect(mozart.role).not.toBe('artist');
      expect(mozart.role).not.toBe('performer');
      // En kväll med [kompositör] — work/composer-context är OK
      expect(['composer', 'work', 'theme', 'referenced']).toContain(mozart.role);
    }
  });

  it('"Chicago the Musical 2026" (utan - separator) → work', () => {
    const e = extractEntities({
      title: 'Chicago the Musical 2026',
      raw_description: null,
      category_slug: 'musical-theatre',
      venue_name: null,
    });
    const chicago = e.find(x => x.name === 'Chicago');
    if (chicago) {
      expect(chicago.role).not.toBe('artist');
      expect(chicago.role).toBe('work');
    }
  });

  it('"Hamlet" (work title) → INTE artist', () => {
    const e = extractEntities({
      title: 'Hamlet',
      raw_description: null,
      category_slug: 'theatre-drama',
      venue_name: null,
    });
    const hamlet = e.find(x => x.name === 'Hamlet');
    if (hamlet) {
      expect(hamlet.role).not.toBe('artist');
      expect(hamlet.role).not.toBe('performer');
      expect(hamlet.role).toBe('work');
    }
  });

  it('Tom title + tom description → ingen entitet', () => {
    const e = extractEntities({
      title: null,
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    expect(e).toHaveLength(0);
  });

  it('Ospecifikt eventnamn → ingen falsk artist', () => {
    const e = extractEntities({
      title: 'Öppen förskola fredag',
      raw_description: null,
      category_slug: 'barn-familj',
      venue_name: null,
    });
    // "Öppen" / "förskola" / "fredag" är alla icke-entiteter
    expect(e.filter(x => x.role === 'artist' || x.role === 'performer')).toHaveLength(0);
  });

  it('Veronica Maggio på Gröna Lund (utan "och") → 1 artist + venue nämns', () => {
    // Testar att vi INTE får "Gröna Lund" som artist.
    const e = extractEntities({
      title: 'Veronica Maggio på Gröna Lund',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Gröna Lund',
    });
    const mag = e.find(x => x.name === 'Veronica Maggio');
    expect(mag).toBeDefined();
    expect(mag?.role).toBe('artist');
    // "Gröna Lund" ska INTE vara en performer
    expect(e.find(x => x.name === 'Gröna Lund')).toBeUndefined();
  });
});

// ─── SPECIFIKA SCENARION från live-sample ────────────────────────────────────

describe('Scenarion från live-sample (runtime/live-sample-2026-10-08)', () => {
  it('Event 4: "Big in Japan 2026 — Konsertsalen" → inga entiteter', () => {
    // "Big in Japan" är ett tema/programnamn, inte en artist
    const e = extractEntities({
      title: 'Big in Japan 2026 — Konsertsalen, Stockholm',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Konsertsalen',
    });
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });

  it('Event 5: "Quidam" (ovrigt/community) → inga entiteter', () => {
    const e = extractEntities({
      title: 'Quidam',
      raw_description: null,
      category_slug: 'community',
      venue_name: null,
    });
    // Quidam är ett verk/programnamn — inte person
    const quidam = e.find(x => x.name === 'Quidam');
    if (quidam) {
      expect(quidam.role).not.toBe('artist');
      expect(quidam.role).not.toBe('performer');
    }
  });

  it('Event 7: "Fejk" (teater) → inga entiteter (work-title)', () => {
    const e = extractEntities({
      title: 'Fejk',
      raw_description: null,
      category_slug: 'theatre-comedy',
      venue_name: null,
    });
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });

  it('Event 14: "Lunchtrav" (sport) → ingen artist', () => {
    const e = extractEntities({
      title: 'Lunchtrav',
      raw_description: null,
      category_slug: 'sport',
      venue_name: 'Solvalla',
    });
    // "Lunchtrav" är ett program/event-namn
    expect(e.filter(x => x.role === 'artist')).toHaveLength(0);
  });
});
