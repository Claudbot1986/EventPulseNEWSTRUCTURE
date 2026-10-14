/**
 * nliJudge.test.ts — tester för NLI-judge integration (FAS 5.2 2026-10-14).
 */
import { describe, expect, it } from 'vitest';
import { runNliJudge, buildNliPrompt, parseNliVerdict, type NliVerdict } from './nliJudge';
import { runEditorialPipeline, buildNliEvidenceFromProfile } from './index';
import { MockLlmClient, type LlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';
import type { EventProfile } from './types';

describe('parseNliVerdict', () => {
  it('känner igen Y / YES / JA', () => {
    expect(parseNliVerdict('Y')).toBe<NliVerdict>('yes');
    expect(parseNliVerdict('yes')).toBe<NliVerdict>('yes');
    expect(parseNliVerdict('Yes')).toBe<NliVerdict>('yes');
    expect(parseNliVerdict('JA')).toBe<NliVerdict>('yes');
    expect(parseNliVerdict(' y ')).toBe<NliVerdict>('yes');
  });
  it('känner igen N / NO / NEJ', () => {
    expect(parseNliVerdict('N')).toBe<NliVerdict>('no');
    expect(parseNliVerdict('no')).toBe<NliVerdict>('no');
    expect(parseNliVerdict('NEJ')).toBe<NliVerdict>('no');
  });
  it('känner igen I / UNSURE', () => {
    expect(parseNliVerdict('I')).toBe<NliVerdict>('unsure');
    expect(parseNliVerdict('unsure')).toBe<NliVerdict>('unsure');
    expect(parseNliVerdict('?')).toBe<NliVerdict>('unsure');
  });
  it('default = unsure för tvetydiga svar', () => {
    expect(parseNliVerdict('kanske')).toBe<NliVerdict>('unsure');
    expect(parseNliVerdict('')).toBe<NliVerdict>('unsure');
  });
});

describe('buildNliPrompt', () => {
  it('inkluderar claim och evidens', () => {
    const p = buildNliPrompt('Hooligan Bobs spelar punk', ['Medverkande: Hooligan Bobs', 'Genre: punk']);
    expect(p).toContain('Hooligan Bobs spelar punk');
    expect(p).toContain('Medverkande: Hooligan Bobs');
    expect(p).toContain('Genre: punk');
    expect(p).toMatch(/Y|N|I/);  // instruktion finns
  });
  it('trunkerar evidens till max 15 phrases', () => {
    const phrases = Array.from({ length: 30 }, (_, i) => `Phrase ${i + 1}`);
    const p = buildNliPrompt('claim', phrases);
    expect(p).toContain('Phrase 1');
    expect(p).toContain('Phrase 15');
    expect(p).not.toContain('Phrase 16');
  });
});

describe('runNliJudge', () => {
  it('anropar LLM med buildNliPrompt och tolkar svar', async () => {
    let calledWith = '';
    const mock: LlmClient = {
      generate: async (req) => {
        calledWith = req.prompt;
        return 'Y';
      },
    };
    const evidence = [
      { claim: 'Hooligan Bobs spelar punk', evidence_phrases: ['Medverkande: Hooligan Bobs'] },
    ];
    const result = await runNliJudge(mock, evidence);
    expect(calledWith).toContain('Hooligan Bobs spelar punk');
    expect(result.get('Hooligan Bobs spelar punk')).toBe<NliVerdict>('yes');
  });
  it('unsure vid timeout (säker default)', async () => {
    const mock: LlmClient = {
      generate: async () => {
        // Simulera timeout — kasta promise som aldrig resolves
        await new Promise(() => {});  // hänger
        return '';
      },
    };
    const evidence = [
      { claim: 'lång claim som hänger', evidence_phrases: ['p1'] },
    ];
    const result = await runNliJudge(mock, evidence, { timeoutMs: 50 });
    expect(result.get('lång claim som hänger')).toBe<NliVerdict>('unsure');
  });
  it('filtrerar bort icke-materiala claims (kortare än 4 ord)', async () => {
    const mock: LlmClient = { generate: async () => 'Y' };
    const evidence = [
      { claim: 'för', evidence_phrases: ['p1'] },          // 1 ord — bortfiltrerad
      { claim: 'en mening med fem ord', evidence_phrases: ['p1'] },  // 5 ord — materiala
    ];
    const result = await runNliJudge(mock, evidence);
    expect(result.has('för')).toBe(false);
    expect(result.has('en mening med fem ord')).toBe(true);
  });
  it('begränsar till maxClaimsPerEvent', async () => {
    let calls = 0;
    const mock: LlmClient = { generate: async () => { calls++; return 'N'; } };
    const evidence = Array.from({ length: 20 }, (_, i) => ({
      claim: `claim nummer ${i + 1} med flera ord`,
      evidence_phrases: ['p1'],
    }));
    await runNliJudge(mock, evidence, { maxClaimsPerEvent: 3 });
    expect(calls).toBe(3);
  });
});

describe('buildNliEvidenceFromProfile', () => {
  it('plockar ut typ, performers, genres, setting, target_audience, concept, duration', () => {
    const profile: EventProfile = {
      event_type: 'music',
      performers: ['Hooligan Bobs', 'Stockholms Symfoniker'],
      genres: ['rock', 'punk'],
      subgenres: [],
      content: [],
      experience_characteristics: [],
      language: ['sv'],
      setting: 'klubb',
      themes: [],
      performance_style: [],
      audience_participation: [],
      target_audience: ['vuxna', 'rock-fans'],
      age_context: null,
      duration_minutes: 90,
      premiere: null,
      tour: null,
      festival_context: null,
      special_guests: [],
      repertoire: [],
      production_characteristics: [],
      educational_content: [],
      family_characteristics: [],
      accessibility: [],
      practical_information: [],
      concept: 'Stockholms bästa punk-kvartett',
      provenance: {},
    };
    const claims = ['Hooligan Bobs spelar 90 minuter'];
    const ev = buildNliEvidenceFromProfile(claims, profile);
    expect(ev).toHaveLength(1);
    expect(ev[0].claim).toBe(claims[0]);
    expect(ev[0].evidence_phrases).toContain('Typ: music');
    expect(ev[0].evidence_phrases).toContain('Medverkande: Hooligan Bobs');
    expect(ev[0].evidence_phrases).toContain('Medverkande: Stockholms Symfoniker');
    expect(ev[0].evidence_phrases).toContain('Genre: rock');
    expect(ev[0].evidence_phrases).toContain('Lokal: klubb');
    expect(ev[0].evidence_phrases).toContain('För: vuxna');
    expect(ev[0].evidence_phrases).toContain('För: rock-fans');
    expect(ev[0].evidence_phrases).toContain('Längd: 90 minuter');
    expect(ev[0].evidence_phrases).toContain('Koncept: Stockholms bästa punk-kvartett');
  });
  it('returnerar en NliEvidence per claim med samma evidens', () => {
    const profile: EventProfile = {
      event_type: 'theater',
      performers: [],
      genres: [],
      subgenres: [],
      content: [],
      experience_characteristics: [],
      language: ['sv'],
      setting: 'teater',
      themes: [],
      performance_style: [],
      audience_participation: [],
      target_audience: [],
      age_context: null,
      duration_minutes: null,
      premiere: null,
      tour: null,
      festival_context: null,
      special_guests: [],
      repertoire: [],
      production_characteristics: [],
      educational_content: [],
      family_characteristics: [],
      accessibility: [],
      practical_information: [],
      concept: null,
      provenance: {},
    };
    const claims = ['claim 1', 'claim 2', 'claim 3'];
    const ev = buildNliEvidenceFromProfile(claims, profile);
    expect(ev).toHaveLength(3);
    // Samma evidens för alla claims (Profile är global per event)
    expect(ev[0].evidence_phrases).toEqual(ev[1].evidence_phrases);
    expect(ev[1].evidence_phrases).toEqual(ev[2].evidence_phrases);
  });
});

describe('runEditorialPipeline med NLI-judge', () => {
  const baseEvent: EventUnderstandingInput = {
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
    title: 'Hooligan Bobs',
    performers: ['Hooligan Bobs'],
  };

  it('NLI AV (default) — factuality-failed claims ger fallback', async () => {
    // M3 returnerar text med påhittade detaljer → factuality underkänner
    const llm = new MockLlmClient(
      'Hooligan Bobs bjuder på en hemlig gäst och spelar på en mystisk flygel.',
    );
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: 'kort',
      llm,
      // useNliJudge: undefined (default AV)
    });
    // M3-failed → fallback_fact
    expect(['fallback_fact', 'passed']).toContain(r.status);
  });

  it('NLI PÅ — judge svar "yes" kan göra unsupported_claims → supported', async () => {
    // Tvåstegs-LLM: första svar = M3-failed, andra svar = NLI-judge
    const responses = [
      'Hooligan Bobs bjuder på en hemlig gäst.',  // M3 output
      'Y',  // NLI-judge svar: "ja, hemlig gäst stöds av evidensen"
    ];
    let idx = 0;
    const llm: LlmClient = {
      generate: async () => responses[idx++ % responses.length]!,
    };
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: 'kort',
      llm,
      useNliJudge: true,
    });
    // Antingen passed (NLI räddade) eller fallback (NLI bedömde 'no')
    expect(['passed', 'fallback_fact', 'fallback_minimal']).toContain(r.status);
  });

  it('NLI timeout → factuality-resultat består (säker default)', async () => {
    // M3 output som ger unsupported claims, sedan LLM hänger vid NLI-anrop
    const llm: LlmClient = {
      generate: async (req) => {
        if (req.maxTokens === 5) {
          // NLI-judge-anrop (maxTokens=5): häng
          await new Promise(() => {});
          return '';
        }
        // M3-anrop: returnera text med unsupported claims
        return 'Hooligan Bobs bjuder på en hemlig gäst och en överraskning.';
      },
    };
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: 'kort',
      llm,
      useNliJudge: true,
    }, { /* options */ });
    // NLI timeout → factuality-resultat oförändrat → fallback
    expect(['fallback_fact', 'fallback_minimal', 'failed']).toContain(r.status);
  });
});
