/**
 * regression.test.ts — 8 regressionstester för Editorial Engine.
 *
 * P7-11/15. Säkrar att pipeline-kontraktet inte regresserar vid framtida
 * ändringar. Varje test fångar en specifik bug-typ som har diskuterats
 * eller skulle kunna smyga in.
 */
import { describe, expect, it } from 'vitest';
import { buildEventProfile, type EventUnderstandingInput } from './eventUnderstanding';
import { compileWriterInputs, assertFirewallClean } from './textualFirewall';
import { runEditorialPipeline, buildStoredProfile, buildStoredEditorialDescription } from './index';
import { checkIndependence } from './independenceCheck';
import { checkFactuality } from './factualityCheck';
import { MockLlmClient } from './editorialWriter';
import type { EventProfile } from './types';

describe('Editorial Engine — regressioner', () => {
  // 1. Profile får ALDRIG innehålla description-härlitna data
  it('REGR-1: Profile.experience_characteristics kommer från kategori, inte source', () => {
    const profile = buildEventProfile({ category_slug: 'jazz', venue_type: 'club' });
    expect(profile.experience_characteristics).toEqual(['improviserat', 'intimt', 'lyssning']);
    expect(profile.experience_characteristics).not.toContain('');
  });

  // 2. Profile.special_guests är ALLTID undefined (kräver source-text)
  it('REGR-2: Profile.special_guests = undefined även när input har artister', () => {
    const profile = buildEventProfile({
      category_slug: 'rock',
      performers: ['Hooligan Bobs'],
      support_acts: ['The Volters'],
    });
    expect(profile.special_guests).toBeUndefined();
    expect(profile.performers).toContain('Hooligan Bobs');
  });

  // 3. compileWriterInputs kastar på alla 5 förbjudna fält
  it('REGR-3: compileWriterInputs kastar på alla 5 förbjudna fält', () => {
    const base = { title: 'T', start_time: '2026-10-15T20:00:00+02:00' };
    const forbidden = ['source_description', 'raw_description', 'original_title', 'html_source', 'scraped_copy'];
    for (const key of forbidden) {
      expect(() =>
        compileWriterInputs({
          profile: buildEventProfile({}),
          event: { ...base, [key]: 'x' } as any,
        }),
      ).toThrow(new RegExp(key));
    }
  });

  // 4. assertFirewallClean accepterar null-värden på förbjudna fält
  it('REGR-4: assertFirewallClean släpper igenom null på förbjudna fält', () => {
    expect(() =>
      assertFirewallClean({
        source_description: null,
        raw_description: null,
        original_title: null,
        html_source: null,
        scraped_copy: null,
      }),
    ).not.toThrow();
  });

  // 5. Independence check fångar parafraserad text (inte bara ordagrann)
  it('REGR-5: Independence fångar parafras med gemensam 4-gram', () => {
    // Parafras med 4-gram från source bevarat.
    const source = 'Klassisk musik med stråkar och piano i Konserthuset ikväll';
    const draft = {
      text: 'Klassisk musik med stråkar och piano bjuds ut till en magisk kväll.',
      word_count: 11,
      info_level: 'MEDIUM' as const,
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkIndependence({ draft, sourceDescription: source });
    expect(r.matched_phrases.length).toBeGreaterThan(0);
  });

  // 6. Factuality fail rapporterar unsupported_claims med original-form
  it('REGR-6: Factuality fail rapporterar unsupported_claims tydligt', () => {
    const profile: EventProfile = {
      event_type: 'music',
      performers: ['Hooligan Bobs'],
      genres: ['rock'],
      content: [],
      experience_characteristics: [],
      language: [],
      provenance: {},
    };
    const draft = {
      text: 'Hooligan Bobs spelar med The Strokes ikväll.',
      word_count: 7,
      info_level: 'MEDIUM' as const,
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkFactuality({
      draft,
      profile,
      event: { title: 'Konsert', venue_name: null, city: null },
    });
    expect(r.unsupported_claims).toContain('The Strokes');
    expect(r.supported_claims).toContain('Hooligan Bobs');
  });

  // 7. Pipeline rapporterar attempts korrekt
  it('REGR-7: Pipeline rapporterar attempts=0 vid PASS på första försöket', async () => {
    const llm = new MockLlmClient('Hooligan Bobs intar Debaser.');
    const event: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_name: 'Debaser',
      title: 'Hooligan Bobs',
      performers: ['Hooligan Bobs'],
      start_time: '2026-10-15T20:00:00+02:00',
    };
    const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
    expect(r.attempts).toBe(0);
    expect(r.status).toBe('passed');
  });

  // 8. Storage helpers bevarar alla viktiga fält
  it('REGR-8: Storage helpers bevarar alla viktiga fält round-trip', () => {
    const profile: EventProfile = {
      event_type: 'music',
      performers: ['A', 'B'],
      genres: ['rock'],
      content: ['låtar'],
      experience_characteristics: ['live'],
      setting: 'klubb',
      language: ['sv'],
      target_audience: ['vuxna'],
      duration_minutes: 120,
      provenance: {},
    };
    const sp = buildStoredProfile(profile, { src1: 'hash1' });
    expect(sp.profile.performers).toEqual(['A', 'B']);
    expect(sp.profile.duration_minutes).toBe(120);
    expect(sp.version).toBe(1);
    expect(sp.source_hashes['src1']).toBe('hash1');

    const draft = {
      text: 'Bra text.',
      word_count: 2,
      info_level: 'RICH' as const,
      meta: { model: 'minimax-M3', prompt_version: 'v1', generated_at: '2026-10-07T00:00:00Z' },
    };
    const sed = buildStoredEditorialDescription(draft, true, true);
    expect(sed.text).toBe('Bra text.');
    expect(sed.info_level).toBe('RICH');
    expect(sed.model).toBe('minimax-M3');
    expect(sed.factuality_pass).toBe(true);
    expect(sed.independence_pass).toBe(true);
  });
});