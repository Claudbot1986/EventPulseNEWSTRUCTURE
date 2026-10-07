/**
 * Editorial types — regression tests.
 *
 * Säkrar att P7-typerna (EventProfile, WriterSafeInputs, ForbiddenWriterInputs)
 * är strukturellt konsistenta. När eventUnderstanding.ts börjar returnera
 * EventProfile-objekt kommer dessa tester att utökas med shape-validering
 * mot riktiga profiler.
 *
 * Steg 1.2/15 i P7 Definition of Done.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROFILE,
  type EventProfile,
  type ForbiddenWriterInputs,
  type WriterSafeInputs,
} from './types';

describe('Editorial types', () => {
  it('EMPTY_PROFILE är en giltig EventProfile', () => {
    const p: EventProfile = EMPTY_PROFILE;
    expect(p.event_type).toBe('community');
    expect(p.performers).toEqual([]);
    expect(p.genres).toEqual([]);
    expect(p.content).toEqual([]);
    expect(p.experience_characteristics).toEqual([]);
    expect(p.language).toEqual(['sv']);
    expect(p.provenance).toEqual({});
  });

  it('WriterSafeInputs tillåter ENDAST Profile + EventPulse-data + style guide', () => {
    // Typkontroll — om någon lägger till ett source-fält i event-companion
    // eller style_guide-brödtext kommer TS ge fel.
    const sample: WriterSafeInputs = {
      profile: EMPTY_PROFILE,
      event: {
        title: 'Konsert',
        start_time: '2026-10-15T19:00:00+02:00',
        venue_name: 'Konserthuset',
        city: 'Stockholm',
        price_min_sek: 250,
        is_free: false,
        language: 'sv',
      },
      style_guide: 'Kort, sansad svenska. Inga superlativer.',
    };
    expect(sample.style_guide.length).toBeGreaterThan(0);
  });

  it('ForbiddenWriterInputs listar exakt de fält Writer ALDRIG får se', () => {
    const forbidden: ForbiddenWriterInputs = {
      source_description: null,
      raw_description: null,
      original_title: null,
      html_source: null,
      scraped_copy: null,
    };
    expect(forbidden.source_description).toBeNull();
    expect(forbidden.raw_description).toBeNull();
    expect(forbidden.html_source).toBeNull();
    expect(forbidden.scraped_copy).toBeNull();
  });
});