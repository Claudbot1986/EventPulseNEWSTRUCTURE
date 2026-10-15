/**
 * swedishTimeText.test.ts — Unit-test för Swedish-time-text util.
 *
 * Kör med: npx vitest run 02-Ingestion/lib/swedishTimeText.test.ts
 */
import { describe, it, expect } from 'vitest';
import { parseKlockan, findKlockanInText } from './swedishTimeText.js';

describe('swedishTimeText', () => {
  describe('parseKlockan', () => {
    it('parser "kl. 19:00"', () => {
      expect(parseKlockan('kl. 19:00')).toEqual({ start: '19:00' });
    });

    it('parser "kl. 19.00" (punkt)', () => {
      expect(parseKlockan('kl. 19.00')).toEqual({ start: '19:00' });
    });

    it('parser "kl 19:00" (utan punkt)', () => {
      expect(parseKlockan('kl 19:00')).toEqual({ start: '19:00' });
    });

    it('parser "Klockan 17:30–19:00" (en-dash)', () => {
      expect(parseKlockan('Klockan 17:30–19:00')).toEqual({
        start: '17:30',
        end: '19:00',
      });
    });

    it('parser "Klockan: 18:00-20:00" (Klockan med kolon + hyphen)', () => {
      expect(parseKlockan('Klockan: 18:00-20:00')).toEqual({
        start: '18:00',
        end: '20:00',
      });
    });

    it('parser intervall utan prefix: "19:30-21:00"', () => {
      expect(parseKlockan('19:30-21:00')).toEqual({
        start: '19:30',
        end: '21:00',
      });
    });

    it('parser enkel tid utan prefix: "17:30"', () => {
      expect(parseKlockan('17:30')).toEqual({ start: '17:30' });
    });

    it('returnerar tomt objekt vid helt fel input', () => {
      expect(parseKlockan('inte en tid')).toEqual({});
      expect(parseKlockan('')).toEqual({});
    });

    it('returnerar undefined (inte tom sträng) för saknade fält', () => {
      const r = parseKlockan('Klockan 19:00');
      expect(r.start).toBe('19:00');
      expect(r.end).toBeUndefined();
    });

    it('avvisar ogiltiga klockslag (timme > 23, minut > 59)', () => {
      expect(parseKlockan('kl. 25:00')).toEqual({});
      expect(parseKlockan('kl. 19:60')).toEqual({});
    });

    it('case-insensitive', () => {
      expect(parseKlockan('KLOCKAN 19:00')).toEqual({ start: '19:00' });
      expect(parseKlockan('kL. 19:00')).toEqual({ start: '19:00' });
    });
  });

  describe('findKlockanInText', () => {
    it('hittar "kl. 19:00" i mening', () => {
      expect(findKlockanInText('Evenemanget börjar kl. 19:00.')).toEqual({
        start: '19:00',
      });
    });

    it('hittar "Klockan 17:30–19:00" i stycke', () => {
      expect(
        findKlockanInText('När: Klockan 17:30–19:00.Plats: Torget.')
      ).toEqual({ start: '17:30', end: '19:00' });
    });

    it('hittar tabell-cell: "<td>15:00 - 17:00</td>"', () => {
      expect(findKlockanInText('<td>15:00 - 17:00</td>')).toEqual({
        start: '15:00',
        end: '17:00',
      });
    });

    it('hittar tid utan prefix i fritext', () => {
      expect(findKlockanInText('Öppnar 19:30, fri entré.')).toEqual({
        start: '19:30',
      });
    });

    it('returnerar null när inget hittas', () => {
      expect(findKlockanInText('Inget klockslag i den här texten.')).toBeNull();
      expect(findKlockanInText('')).toBeNull();
    });

    it('avvisar falska positiva: priser, versioner', () => {
      // 1.25 är pris, inte tid
      expect(findKlockanInText('Pris: 1.25 kr')).toBeNull();
      expect(findKlockanInText('v3.14.2')).toBeNull();
    });

    it('avvisar tider som del av längre sekvens', () => {
      // 12345:67 är inte en tid, ska inte matchas
      expect(findKlockanInText('Tel: 08-123-4567')).toBeNull();
    });
  });
});