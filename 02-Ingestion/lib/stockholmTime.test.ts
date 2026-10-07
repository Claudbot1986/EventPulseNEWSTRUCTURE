/**
 * stockholmTime.test.ts — Unit-test för timezone-helper.
 *
 * Kör med: npx vitest run 02-Ingestion/lib/stockholmTime.test.ts
 */
import { describe, it, expect } from 'vitest';
import { toUtcIsoFromStockholm, toUtcIso, hasTimeZone, stockholmOffsetMinutes } from './stockholmTime.js';

describe('stockholmTime', () => {
  describe('hasTimeZone', () => {
    it('returns true för Z-suffix', () => {
      expect(hasTimeZone('2026-10-14T19:30:00Z')).toBe(true);
    });
    it('returns true för explicit offset', () => {
      expect(hasTimeZone('2026-10-14T19:30:00+02:00')).toBe(true);
      expect(hasTimeZone('2026-10-14T19:30:00-05:00')).toBe(true);
    });
    it('returns false för naive', () => {
      expect(hasTimeZone('2026-10-14T19:30')).toBe(false);
      expect(hasTimeZone('2026-10-14')).toBe(false);
    });
    it('returns false för null/empty', () => {
      expect(hasTimeZone(null)).toBe(false);
      expect(hasTimeZone('')).toBe(false);
    });
  });

  describe('toUtcIsoFromStockholm', () => {
    it('sommar (CEST +02:00): 19:30 Stockholm → 17:30 UTC', () => {
      expect(toUtcIsoFromStockholm('2026-10-14', '19:30')).toBe('2026-10-14T17:30:00.000Z');
    });
    it('vinter (CET +01:00): 19:30 Stockholm → 18:30 UTC', () => {
      expect(toUtcIsoFromStockholm('2026-01-14', '19:30')).toBe('2026-01-14T18:30:00.000Z');
    });
    it('vår (april — CEST): 12:00 Stockholm → 10:00 UTC', () => {
      expect(toUtcIsoFromStockholm('2026-04-15', '12:00')).toBe('2026-04-15T10:00:00.000Z');
    });
    it('UTC passthrough: behåller Z', () => {
      expect(toUtcIsoFromStockholm('2026-10-14T19:30:00Z')).toBe('2026-10-14T19:30:00.000Z');
    });
    it('UTC med offset: konverterar till Z', () => {
      expect(toUtcIsoFromStockholm('2026-10-14T19:30:00+02:00')).toBe('2026-10-14T17:30:00.000Z');
    });
    it('naive ISO-sträng: använd toUtcIso istället (time arg är obligatoriskt)', () => {
      // Om datum innehåller T men ingen tid-zon → splittra på T och skicka
      // datum + tid separat, eller använd toUtcIso() direkt.
      expect(toUtcIsoFromStockholm('2026-10-14', '19:30')).toBe('2026-10-14T17:30:00.000Z');
    });
    it('saknar tid: 00:00 Stockholm', () => {
      expect(toUtcIsoFromStockholm('2026-10-14')).toBe('2026-10-13T22:00:00.000Z');
    });
    it('null → null', () => {
      expect(toUtcIsoFromStockholm(null)).toBe(null);
    });
    it('tom sträng → null', () => {
      expect(toUtcIsoFromStockholm('')).toBe(null);
    });
  });

  describe('toUtcIso', () => {
    it('UTC passthrough', () => {
      expect(toUtcIso('2026-10-14T19:30:00Z')).toBe('2026-10-14T19:30:00.000Z');
    });
    it('naive → Stockholm-tolkning', () => {
      expect(toUtcIso('2026-01-14T19:30')).toBe('2026-01-14T18:30:00.000Z');
    });
    it('null → null', () => {
      expect(toUtcIso(null)).toBe(null);
    });
  });

  describe('stockholmOffsetMinutes', () => {
    it('15 juli (CEST) = +120 min', () => {
      expect(stockholmOffsetMinutes('2026-07-15T12:00:00Z')).toBe(120);
    });
    it('15 januari (CET) = +60 min', () => {
      expect(stockholmOffsetMinutes('2026-01-15T12:00:00Z')).toBe(60);
    });
  });
});