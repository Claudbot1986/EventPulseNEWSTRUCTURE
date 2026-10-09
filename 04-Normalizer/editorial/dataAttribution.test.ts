/**
 * dataAttribution.test.ts — verifierar attribution-builder.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAttribution,
  licenseLabel,
  licenseShortLabel,
  sourceLabel,
} from './dataAttribution';
import type { EventProfile } from './types';

describe('dataAttribution', () => {
  describe('buildAttribution', () => {
    it('null Profile → fallback-meddelande', () => {
      const r = buildAttribution(null);
      expect(r.hasOpenData).toBe(false);
      expect(r.tier1).toContain('Ingen öppen data');
      expect(r.tier2Sources).toEqual([]);
    });

    it('Profile utan metadata → tom attribution', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: [],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
      };
      const r = buildAttribution(profile);
      expect(r.hasOpenData).toBe(false);
      expect(r.tier2Sources).toEqual([]);
    });

    it('Profile med performer_metadata → tier1 nämner MusicBrainz', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA', genres: ['folk'], type: 'Person' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.hasOpenData).toBe(true);
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.tier1).toContain('öppna datakällor');
    });

    it('Profile med subject_metadata → tier1 nämner Wikidata', () => {
      const profile: EventProfile = {
        event_type: 'theater',
        performers: [],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        subject_metadata: {
          Hamlet: { kind: 'work', author: 'William Shakespeare' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.hasOpenData).toBe(true);
      expect(r.tier1).toContain('Wikidata');
    });

    it('Profile med både performer + subject → tier1 nämner båda', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA', genres: ['folk'] },
        },
        subject_metadata: {
          Kungliga_Operan: { kind: 'organization', country: 'SE' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.tier1).toContain('Wikidata');
    });
  });

  describe('tier 2 (disclosure-kort)', () => {
    it('listar unika performers + subjects med käll-URL', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA', genres: ['folk'], type: 'Person' },
        },
        subject_metadata: {
          Hamlet: { kind: 'work', author: 'William Shakespeare', wikidata_id: 'Q41567' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.tier2Sources.length).toBe(2);
      const names = r.tier2Sources.map((s) => s.name);
      expect(names).toContain('Donovan Woods');
      expect(names).toContain('Hamlet');
    });

    it('attribution-URL pekar på Wikidata-Q-id', () => {
      const profile: EventProfile = {
        event_type: 'theater',
        performers: [],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        subject_metadata: {
          Hamlet: { kind: 'work', wikidata_id: 'Q41567' },
        },
      };
      const r = buildAttribution(profile);
      const hamlet = r.tier2Sources.find((s) => s.name === 'Hamlet');
      expect(hamlet?.url).toBe('https://www.wikidata.org/wiki/Q41567');
    });

    it('license_label är svensk och pedagogisk, inte juridisk', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      const dw = r.tier2Sources.find((s) => s.name === 'Donovan Woods');
      expect(dw?.license_label).toContain('public domain');
      expect(dw?.license_label).toContain('fri att använda');
      // Inte rå juridisk kod
      expect(dw?.license_label).not.toBe('CC0');
    });
  });

  describe('tier 3 (full förklaring)', () => {
    it('innehåller inga juridiska förkortningar (CC0, BY-SA)', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      // Inte juridiska förkortningar i full text
      // (vi tillåter 'public domain' som begrepp)
      expect(r.tier3FullText).not.toContain('CC-BY-SA');
      expect(r.tier3FullText).not.toContain('CC BY-SA');
    });

    it('nämner Stockholm/EU (lokal ankning)', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.tier3FullText.toLowerCase()).toMatch(/stockholm|europeisk|eu/);
    });

    it('förklarar "vem som helst får använda"', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.tier3FullText.toLowerCase()).toContain('vem som helst får använda');
    });

    it('innehåller "community"', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.tier3FullText.toLowerCase()).toContain('community');
    });
  });

  describe('license helpers', () => {
    it('licenseLabel("CC0") → svensk pedagogisk', () => {
      expect(licenseLabel('CC0')).toContain('public domain');
      expect(licenseLabel('CC0')).toContain('fri att använda');
    });

    it('licenseLabel("CC-BY-SA-4.0") → svensk pedagogisk', () => {
      expect(licenseLabel('CC-BY-SA-4.0')).toContain('erkänn');
      expect(licenseLabel('CC-BY-SA-4.0')).toContain('dela lika');
    });

    it('licenseShortLabel("CC0") → kort etikett', () => {
      expect(licenseShortLabel('CC0')).toBe('fri att använda');
    });

    it('sourceLabel("wikidata") → "Wikidata"', () => {
      expect(sourceLabel('wikidata')).toBe('Wikidata');
      expect(sourceLabel('musicbrainz')).toBe('MusicBrainz');
      expect(sourceLabel('curated')).toBe('curerad av oss');
    });
  });

  describe('uniqueLicenses', () => {
    it('rapporterar CC0 när performer_metadata finns', () => {
      const profile: EventProfile = {
        event_type: 'music',
        performers: ['Donovan Woods'],
        genres: [],
        content: [],
        experience_characteristics: [],
        language: ['sv'],
        provenance: {},
        performer_metadata: {
          'Donovan Woods': { country: 'CA' },
        },
      };
      const r = buildAttribution(profile);
      expect(r.uniqueLicenses).toContain('CC0');
    });
  });
});
