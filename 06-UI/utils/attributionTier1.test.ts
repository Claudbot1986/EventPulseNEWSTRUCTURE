/**
 * attributionTier1.test.ts — verifierar klient-side attribution-builder.
 */
import { describe, expect, it } from 'vitest';
import { computeTier1Attribution, __test__ } from './attributionTier1';

describe('attributionTier1', () => {
  describe('artist matching (case-insensitive)', () => {
    it('Donovan Woods i title → tier1 + MusicBrainz', () => {
      const r = computeTier1Attribution({ title: 'Donovan Woods' });
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.sources).toContain('musicbrainz');
      expect(r.tier1).toContain('Donovan Woods');
    });

    it('Veronica Maggio i title', () => {
      const r = computeTier1Attribution({ title: 'Veronica Maggio' });
      expect(r.tier1).toContain('Veronica Maggio');
      expect(r.tier1).toContain('MusicBrainz');
    });

    it('Håkan Hellström med alias (utan diakritiskt)', () => {
      const r = computeTier1Attribution({ title: 'Hakan Hellstrom' });
      expect(r.tier1).toContain('MusicBrainz');
    });

    it('Anton Estby + Henrythefreak (multi-artist)', () => {
      const r = computeTier1Attribution({
        title: 'Anton Estby & Henrythefreak - Standup 2026',
      });
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.tier1).toContain('2 artister');
    });

    it('Quidam med 6 artister', () => {
      const r = computeTier1Attribution({
        title: 'Quidam: Helene Berg + Paul Pignon + Ida Lundén + Thomas Bjelkeborn + Eva Lindal + Philippe Moenne-Loccoz',
      });
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.tier1).toContain('6 artister');
    });
  });

  describe('word-boundary safety', () => {
    it('"Hannah" triggar INTE "Anna" (word boundary)', () => {
      const r = computeTier1Attribution({ title: 'Hannah performs tonight' });
      expect(r.tier1).toBeNull();
    });

    it('"Berg" ensamt triggar INTE "Helene Berg"', () => {
      const r = computeTier1Attribution({ title: 'A walk in the berg' });
      // "Helene Berg" ska inte matchas om inte "Helene Berg" som helhet finns
      // Dock kan "Berg" ensamt vara ett annat namn; vi testar bara att "Helene Berg" inte matchas
      expect(r.tier1 === null || !r.tier1.includes('Helene Berg')).toBe(true);
    });

    it('"AI Team" triggar AI-topic (Wikidata)', () => {
      const r = computeTier1Attribution({ title: 'Build your AI Team' });
      expect(r.tier1).toContain('Wikidata');
      expect(r.sources).toContain('wikidata');
    });
  });

  describe('organisation matching (venue)', () => {
    it('"Kungliga Operan" i venue → tier1 + Wikidata', () => {
      const r = computeTier1Attribution({
        title: 'Barnlördag',
        venue_name: 'Kungliga Operan',
      });
      expect(r.tier1).toContain('Wikidata');
      expect(r.tier1).toContain('Kungliga Operan');
    });

    it('"Dramaten" i venue → tier1 + Wikidata', () => {
      const r = computeTier1Attribution({
        title: 'Hamlet',
        venue_name: 'Dramaten',
      });
      expect(r.tier1).toContain('Wikidata');
    });
  });

  describe('topic matching', () => {
    it('"jazz" i title → tier1 + Wikidata', () => {
      const r = computeTier1Attribution({ title: 'Jazz på stan' });
      expect(r.tier1).toContain('Wikidata');
    });

    it('"bokcirkel" i title → tier1 + Wikidata', () => {
      const r = computeTier1Attribution({ title: 'Bokcirkel: Svensk litteratur' });
      expect(r.tier1).toContain('Wikidata');
    });
  });

  describe('edge cases', () => {
    it('null event → null tier1', () => {
      expect(computeTier1Attribution(null).tier1).toBeNull();
    });

    it('tomt event → null tier1', () => {
      expect(computeTier1Attribution({}).tier1).toBeNull();
    });

    it('event utan match → null tier1', () => {
      expect(computeTier1Attribution({ title: 'Okänt event utan artist' }).tier1).toBeNull();
    });

    it('multi-source (artist + topic)', () => {
      const r = computeTier1Attribution({
        title: 'Quidam jazzkväll med Helene Berg',
      });
      expect(r.sources).toContain('musicbrainz');
      expect(r.sources).toContain('wikidata');
      expect(r.tier1).toContain('MusicBrainz');
      expect(r.tier1).toContain('Wikidata');
    });
  });

  describe('test exports', () => {
    it('exponerar CURATED_ARTISTS', () => {
      expect(__test__.CURATED_ARTISTS.length).toBeGreaterThanOrEqual(20);
    });
  });
});
