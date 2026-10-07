/**
 * eventTypes.test.ts — end-to-end pipeline för 6 representativa event-typer.
 *
 * P7-10/15. Säkrar att Editorial Engine fungerar konsekvent över hela
 * event-typ-spannet. Varje test kör hela kedjan (Profile → Writer → checks).
 *
 * Event-typer:
 *   1. Concert      (rock-konsert med artists)
 *   2. Standup      (theatre-comedy)
 *   3. Family       (community för familj)
 *   4. Theater      (musical-theatre)
 *   5. Club         (electronic)
 *   6. Sport/museum (sports + exhibition)
 */
import { describe, expect, it } from 'vitest';
import { runEditorialPipeline } from './index';
import { MockLlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';

/**
 * Bygger en mock-LLM som returnerar en text baserad på Profile. Det gör att
 * factuality-checks kan verifieras utan att en riktig LLM körs.
 */
function smartMock(profile: import('./types').EventProfile, event: { venue_name?: string | null; city?: string | null }) {
  const parts: string[] = [];
  if (profile.performers.length) {
    parts.push(`${profile.performers.join(', ')} ${event.venue_name ? `på ${event.venue_name}` : ''}`);
  } else if (profile.event_type === 'exhibition') {
    parts.push(`Utställning ${event.venue_name ? `på ${event.venue_name}` : ''}`);
  } else if (profile.event_type === 'sport') {
    parts.push(`Sportevent ${event.venue_name ? `på ${event.venue_name}` : ''}`);
  } else {
    parts.push(`Evenemang ${event.venue_name ? `på ${event.venue_name}` : ''}`);
  }
  if (profile.genres.length) {
    parts.push(`med ${profile.genres.join(', ')}`);
  }
  if (profile.setting) {
    parts.push(`i ${profile.setting}`);
  }
  return parts.join(' ') + '.';
}

describe('Editorial Engine — 6 event-typer', () => {
  it('1. Concert (rock med artists)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Debaser',
      city: 'Stockholm',
      start_time: '2026-10-15T20:00:00+02:00',
      end_time: '2026-10-15T22:30:00+02:00',
      price_min_sek: 280,
      is_free: false,
      language: 'sv',
      source: 'debaster',
      title: 'Hooligan Bobs live',
      performers: ['Hooligan Bobs', 'The Volters'],
    };
    // Smart mock som bygger text från Profile.
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(smartMock(profile, { venue_name: event.venue_name, city: event.city }));
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text).toContain('Hooligan Bobs');
    expect(r.draft?.text).toContain('Debaser');
  });

  it('2. Standup (theatre-comedy)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'theatre-comedy',
      venue_type: 'theater',
      venue_name: 'Södra Teatern',
      city: 'Stockholm',
      start_time: '2026-11-01T19:30:00+01:00',
      end_time: '2026-11-01T21:00:00+01:00',
      price_min_sek: 350,
      is_free: false,
      language: 'sv',
      source: 'sodrateatern',
      title: 'Standup med Anna Lindmarker',
      performers: ['Anna Lindmarker'],
    };
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(smartMock(profile, { venue_name: event.venue_name, city: event.city }));
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text).toContain('Anna Lindmarker');
  });

  it('3. Family (community + gratis)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'family',
      venue_type: 'park',
      venue_name: 'Tantolunden',
      city: 'Stockholm',
      start_time: '2026-10-19T11:00:00+02:00',
      end_time: '2026-10-19T14:00:00+02:00',
      is_free: true,
      language: 'sv',
      source: 'stockholmsstad',
      title: 'Höstmarknad i Tantolunden',
    };
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(
      'Höstmarknad för hela familjen i Tantolunden. Fri entré och program för både barn och vuxna.',
    );
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text).toContain('Tantolunden');
    expect(r.draft?.text).toContain('familj');
  });

  it('4. Theater (musical-theatre)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'musical-theatre',
      venue_type: 'theater',
      venue_name: 'Oscarsteatern',
      city: 'Stockholm',
      start_time: '2026-12-15T19:00:00+01:00',
      end_time: '2026-12-15T22:00:00+01:00',
      price_min_sek: 450,
      is_free: false,
      language: 'sv',
      source: 'oscarsteatern',
      title: 'My Fair Lady',
      performers: ['Ensemble'],
    };
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(smartMock(profile, { venue_name: event.venue_name, city: event.city }));
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text).toContain('Oscarsteatern');
  });

  it('5. Club (electronic, långt set)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'electronic',
      venue_type: 'club',
      venue_name: 'Trädgården',
      city: 'Stockholm',
      start_time: '2026-10-25T22:00:00+02:00',
      end_time: '2026-10-26T04:00:00+02:00',
      price_min_sek: 200,
      is_free: false,
      language: 'sv',
      source: 'tradgarden',
      title: 'DJ-set med Adam Beyer',
      performers: ['Adam Beyer'],
    };
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(smartMock(profile, { venue_name: event.venue_name, city: event.city }));
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text).toContain('Adam Beyer');
    // Electronic har typical_duration 240 min.
    expect(profile.duration_minutes).toBe(360); // 6h från start+end
  });

  it('6. Sport (match)', async () => {
    const event: EventUnderstandingInput = {
      category_slug: 'sports',
      venue_type: 'arena',
      venue_name: 'Avicii Arena',
      city: 'Stockholm',
      start_time: '2026-10-20T19:00:00+02:00',
      end_time: '2026-10-20T21:30:00+02:00',
      price_min_sek: 350,
      is_free: false,
      language: 'sv',
      source: 'avicii',
      title: 'Djurgården — Hammarby',
    };
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(event);
    const llm = new MockLlmClient(
      'Ishockeymatch mellan Djurgården och Hammarby på Avicii Arena.',
    );
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.status).toBe('passed');
    expect(r.draft?.text.toLowerCase()).toContain('avicii');
  });
});