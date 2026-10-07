/**
 * eventUnderstanding.test.ts — verifierar att Profile byggs UTAN source-text.
 *
 * Säkrar tre kärninvarianter:
 *   1. Profile får ALDRIG innehålla fält som kräver description-tolkning
 *      (themes, concept, special_guests, repertoire).
 *   2. Tom input → tom profile (vi hittar ALDRIG på).
 *   3. Strukturerade inputs → profile med rätt kategorimappning.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEventProfile,
  profileInfoLevel,
  type EventUnderstandingInput,
} from './eventUnderstanding';

describe('buildEventProfile', () => {
  it('tom input → community-profile, inga påhitt', () => {
    const p = buildEventProfile({});
    expect(p.event_type).toBe('community');
    expect(p.performers).toEqual([]);
    expect(p.genres).toEqual([]);
    expect(p.content).toEqual([]);
    expect(p.experience_characteristics).toEqual([]);
    // Fält som KRÄVER description-text får ALDRIG vara satta.
    expect(p.themes).toBeUndefined();
    expect(p.concept).toBeUndefined();
    expect(p.special_guests).toBeUndefined();
    expect(p.repertoire).toBeUndefined();
  });

  it('konsert med performers + duration → RICH info_level', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Debaser',
      city: 'Stockholm',
      start_time: '2026-10-15T20:00:00+02:00',
      end_time: '2026-10-15T22:00:00+02:00',
      price_min_sek: 250,
      is_free: false,
      language: 'sv',
      source: 'debaster',
      performers: ['Hooligan Bobs'],
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('music');
    expect(p.genres).toContain('rock');
    expect(p.performers).toEqual(['Hooligan Bobs']);
    expect(p.duration_minutes).toBe(120); // beräknat från start+end
    expect(p.setting).toBe('klubb');
    expect(p.practical_information).toContain('Biljett från 250 kr');
    expect(p.experience_characteristics.length).toBeGreaterThan(0);
    expect(p.target_audience?.length).toBeGreaterThan(0);
    expect(profileInfoLevel(p)).toBe('RICH');
    expect(p.provenance['performers']).toContain('artist_resolver');
    expect(p.provenance['event_type']).toContain('category:rock');
  });

  it('teater utan end_time → typical_duration från kategori', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'theatre-drama',
      venue_type: 'theater',
      venue_name: 'Dramaten',
      language: 'sv',
      source: 'dramaten',
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('theater');
    expect(p.genres).toContain('drama');
    expect(p.duration_minutes).toBe(150); // typical_duration för theatre-drama
    expect(p.setting).toBe('teater');
    expect(p.themes).toBeUndefined();
  });

  it('gratis evenemang → family_characteristics sätts', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'community',
      venue_type: 'park',
      is_free: true,
      language: 'sv',
    };
    const p = buildEventProfile(input);
    expect(p.family_characteristics).toContain('tillgängligt utan biljettkrav');
    expect(p.practical_information).toContain('Fri entré');
  });

  it('barn-kategori får barnanpassad duration', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'kids',
      venue_name: 'Junibacken',
    };
    const p = buildEventProfile(input);
    expect(p.target_audience).toContain('barn');
    expect(p.duration_minutes).toBe(60); // kort för barn
  });

  it('electronic → 240 min default (långt DJ-set)', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'electronic',
      venue_type: 'club',
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('music');
    expect(p.genres).toContain('elektroniskt');
    expect(p.duration_minutes).toBe(240);
    expect(p.audience_participation).toContain('dans');
  });

  it('exhibition → curaterad upplevelse, ingen duration från end-time', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'exhibition',
      venue_type: 'gallery',
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('exhibition');
    expect(p.experience_characteristics).toContain('visuell');
    expect(p.setting).toBe('galleri');
  });

  it('ukänd kategori → fallback till community, inga påhittade genres', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'okänd-kategori-123',
      venue_name: 'Någonstans',
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('community');
    expect(p.genres).toEqual([]);
    expect(p.content).toEqual([]);
  });

  it('themes/concept/special_guests/repertoire är ALLTID undefined (kräver source-text)', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'classical',
      venue_type: 'concert_hall',
      venue_name: 'Konserthuset',
      performers: ['Kungliga Filharmonikerna'],
    };
    const p = buildEventProfile(input);
    expect(p.themes).toBeUndefined();
    expect(p.concept).toBeUndefined();
    expect(p.special_guests).toBeUndefined();
    expect(p.repertoire).toBeUndefined();
    expect(p.subgenres).toBeUndefined();
    expect(p.ensemble).toBeUndefined();
    expect(p.tour).toBeUndefined();
    expect(p.festival_context).toBeUndefined();
    expect(p.premiere).toBeUndefined();
  });
});

describe('profileInfoLevel', () => {
  it('tom profile → VERY_LOW', () => {
    expect(profileInfoLevel({
      event_type: 'community',
      performers: [],
      genres: [],
      content: [],
      experience_characteristics: [],
      language: [],
      provenance: {},
    })).toBe('VERY_LOW');
  });

  it('kategori + setting + 1 karaktäristik → LOW', () => {
    expect(profileInfoLevel({
      event_type: 'music',
      performers: [],
      genres: ['rock'],
      content: ['låtar'],
      experience_characteristics: ['live'],
      setting: 'klubb',
      language: [],
      provenance: {},
    })).toBe('LOW');
  });
});