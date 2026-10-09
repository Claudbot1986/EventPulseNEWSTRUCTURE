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

  it('teater utan end_time → duration_minutes = undefined (ingen typical-fallback)', () => {
    // [KORRIGERAD 2026-10-08] category-typical är INTE ett FACT.
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
    expect(p.duration_minutes).toBeUndefined(); // null, INTE 150
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

  it('barn-kategori → duration_minutes = undefined (ingen typical-fallback)', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'kids',
      venue_name: 'Junibacken',
    };
    const p = buildEventProfile(input);
    expect(p.target_audience).toContain('barn');
    expect(p.duration_minutes).toBeUndefined(); // null, INTE 60
  });

  it('electronic → duration_minutes = undefined (ingen typical-fallback)', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'electronic',
      venue_type: 'club',
    };
    const p = buildEventProfile(input);
    expect(p.event_type).toBe('music');
    expect(p.genres).toContain('elektroniskt');
    expect(p.duration_minutes).toBeUndefined(); // null, INTE 240
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

  // [KORRIGERAD 2026-10-08 efter P8-granskning]
  // Duration-fallback till category-typical är en deterministisk hallucination.
  // Felaktiga duration-värden ska INTE ersättas med kategoritypiska värden —
  // de ska bli null. UI/Writer får då utelämna duration.
  it('multi-day calendar span (1440 min = 24h) → duration_minutes = null, INTE category-typical', () => {
    // Chicago: musical-theatre, start=2026-10-09T19:30, end=2026-10-10T19:30
    //  → rawDuration = 1440 min (24h calendar span). Inte aktivitetstid.
    const input: EventUnderstandingInput = {
      category_slug: 'musical-theatre',
      venue_type: 'theater',
      start_time: '2026-10-09T19:30:00+02:00',
      end_time: '2026-10-10T19:30:00+02:00',
    };
    const p = buildEventProfile(input);
    // Varken 1440 (calendar span) eller 180 (typical) — null är korrekt.
    expect(p.duration_minutes).toBeUndefined();
    expect(p.provenance['duration_minutes']).toEqual(
      expect.arrayContaining([expect.stringMatching(/calendar_span/)])
    );
  });

  it('multi-day 72h calendar span → duration_minutes = null', () => {
    // Bak & Choklad: 72h festival-span över 3 dygn
    const input: EventUnderstandingInput = {
      category_slug: 'food',
      venue_type: 'studio',
      start_time: '2026-10-09T08:00:00+02:00',
      end_time: '2026-10-12T08:00:00+02:00', // 4320 min = 72h
    };
    const p = buildEventProfile(input);
    expect(p.duration_minutes).toBeUndefined();
  });

  it('rimlig 2h duration (120 min) → behålls från start+end', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'music',
      venue_type: 'club',
      start_time: '2026-10-09T20:00:00+02:00',
      end_time: '2026-10-09T22:00:00+02:00', // 120 min
    };
    const p = buildEventProfile(input);
    expect(p.duration_minutes).toBe(120);
    expect(p.provenance['duration_minutes']).toEqual(['events_row:start+end']);
  });

  it('rimlig 11h duration (660 min) → behålls, FÅR vara > 600', () => {
    // Festival / heldagsekonsert kan vara 11h utan att vara fel.
    // Vi sätter INTE hård 600-gräns.
    const input: EventUnderstandingInput = {
      category_slug: 'festival',
      venue_type: 'park',
      start_time: '2026-10-09T10:00:00+02:00',
      end_time: '2026-10-09T21:00:00+02:00', // 660 min = 11h, single day
    };
    const p = buildEventProfile(input);
    expect(p.duration_minutes).toBe(660); // behålls — single-day
    expect(p.provenance['duration_minutes']).toEqual(['events_row:start+end']);
  });

  it('duration utan end_time → null (inte heller category-typical)', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'music',
      venue_type: 'club',
      start_time: '2026-10-09T20:00:00+02:00',
      // No end_time
    };
    const p = buildEventProfile(input);
    expect(p.duration_minutes).toBeUndefined();
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