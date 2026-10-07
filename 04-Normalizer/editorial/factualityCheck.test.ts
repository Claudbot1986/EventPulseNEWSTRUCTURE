/**
 * factualityCheck.test.ts — verifierar claim-detektering + stöd-logik.
 */
import { describe, expect, it } from 'vitest';
import { checkFactuality, extractClaims } from './factualityCheck';
import type { EditorialDraft, EventProfile } from './types';

const baseProfile: EventProfile = {
  event_type: 'music',
  performers: ['Hooligan Bobs'],
  genres: ['rock'],
  content: ['låtar'],
  experience_characteristics: ['live'],
  setting: 'klubb',
  language: ['sv'],
  provenance: {},
};

describe('extractClaims', () => {
  it('extraherar kapitaliserade artist-namn', () => {
    const claims = extractClaims('Hooligan Bobs spelar på Debaser ikväll.');
    expect(claims).toContain('Hooligan Bobs');
  });

  it('extraherar flerordiga kapitaliserade fraser', () => {
    const claims = extractClaims('Kungliga Filharmonikerna bjuder på klassiskt.');
    expect(claims).toContain('Kungliga Filharmonikerna');
  });

  it('extraherar siffror med enhet', () => {
    const claims = extractClaims('Ett set på 90 min följt av 200 kr i entré.');
    expect(claims.some((c) => /90 min/i.test(c))).toBe(true);
    expect(claims.some((c) => /200 kr/i.test(c))).toBe(true);
  });

  it('filtrerar bort meningens inledande kapital (första ordet)', () => {
    const claims = extractClaims('Konserten bjuder på Hooligan Bobs.');
    expect(claims).toContain('Hooligan Bobs');
    // "Konserten" ska INTE vara en claim (inledning).
    expect(claims.some((c) => normalize0(c) === 'konserten')).toBe(false);
  });
});

function normalize0(s: string): string {
  return s.toLowerCase().replace(/\.$/, '').trim();
}

describe('checkFactuality', () => {
  const event = {
    title: 'Hooligan Bobs på Debaser',
    venue_name: 'Debaser',
    city: 'Stockholm',
  };

  it('PASS om alla claims stöds av Profile', () => {
    const draft: EditorialDraft = {
      text: 'Hooligan Bobs intar Debaser med rock från scenen.',
      word_count: 8,
      info_level: 'MEDIUM',
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkFactuality({ draft, profile: baseProfile, event });
    expect(r.pass).toBe(true);
    expect(r.unsupported_claims).toEqual([]);
  });

  it('FAIL om draft nämner artist som inte finns i Profile', () => {
    const draft: EditorialDraft = {
      text: 'Hooligan Bobs delar scen med The Strokes ikväll.',
      word_count: 9,
      info_level: 'MEDIUM',
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkFactuality({ draft, profile: baseProfile, event });
    expect(r.pass).toBe(false);
    expect(r.unsupported_claims).toContain('The Strokes');
  });

  it('stödjs av stämningsord (magiskt, intimt) — räknas inte som claims', () => {
    const draft: EditorialDraft = {
      text: 'En magisk kväll med Hooligan Bobs på Debaser.',
      word_count: 8,
      info_level: 'MEDIUM',
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkFactuality({ draft, profile: baseProfile, event });
    expect(r.pass).toBe(true);
  });

  it('genre från Profile stödjer "rock" som claim', () => {
    const draft: EditorialDraft = {
      text: 'Rock-kvällen bjuder på Hooligan Bobs i ett live-framförande.',
      word_count: 8,
      info_level: 'MEDIUM',
      meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
    };
    const r = checkFactuality({ draft, profile: baseProfile, event });
    expect(r.pass).toBe(true);
  });
});