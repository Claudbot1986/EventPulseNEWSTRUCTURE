/**
 * textualFirewall.test.ts — verifierar brandväggens kontrakt.
 */
import { describe, expect, it } from 'vitest';
import { STYLE_GUIDE, assertFirewallClean, compileWriterInputs } from './textualFirewall';
import { EMPTY_PROFILE } from './types';

describe('textualFirewall', () => {
  const event = {
    title: 'Konsert med X',
    start_time: '2026-10-15T19:00:00+02:00',
    venue_name: 'Konserthuset',
    city: 'Stockholm',
    price_min_sek: 250,
    is_free: false,
    language: 'sv',
  };

  describe('compileWriterInputs', () => {
    it('bygger WriterSafeInputs från Profile + event-data', () => {
      const out = compileWriterInputs({ profile: EMPTY_PROFILE, event });
      expect(out.profile).toBe(EMPTY_PROFILE);
      expect(out.event.title).toBe('Konsert med X');
      expect(out.style_guide.length).toBeGreaterThan(0);
    });

    it('STYLE_GUIDE innehåller ALDRIG "copy" / "parafrasera" / "skriv om"', () => {
      const lower = STYLE_GUIDE.toLowerCase();
      expect(lower).not.toContain('parafrasera');
      expect(lower).not.toContain('skriv om');
      expect(lower).not.toContain('copy');
    });

    it('kastar om source_description smyger in i event-objektet', () => {
      const tampered = {
        ...event,
        source_description: 'Detta är en scraperad beskrivning',
      };
      expect(() =>
        compileWriterInputs({ profile: EMPTY_PROFILE, event: tampered as any }),
      ).toThrow(/source_description/);
    });

    it('kastar om raw_description skickas med', () => {
      const tampered = { ...event, raw_description: 'original text' };
      expect(() =>
        compileWriterInputs({ profile: EMPTY_PROFILE, event: tampered as any }),
      ).toThrow(/raw_description/);
    });

    it('kastar om html_source skickas med', () => {
      const tampered = { ...event, html_source: '<p>html</p>' };
      expect(() =>
        compileWriterInputs({ profile: EMPTY_PROFILE, event: tampered as any }),
      ).toThrow(/html_source/);
    });
  });

  describe('assertFirewallClean', () => {
    it('släpper igenom tomt objekt', () => {
      expect(() => assertFirewallClean({})).not.toThrow();
    });

    it('släpper igenom null', () => {
      expect(() => assertFirewallClean(null)).not.toThrow();
    });

    it('kastar om source_description finns', () => {
      expect(() =>
        assertFirewallClean({ source_description: 'x' }),
      ).toThrow(/source_description/);
    });

    it('tillåter null-värden på forbidden-fält', () => {
      // Null är OK — det är ju därför fälten finns i ForbiddenWriterInputs.
      expect(() =>
        assertFirewallClean({
          source_description: null,
          raw_description: null,
        }),
      ).not.toThrow();
    });
  });
});