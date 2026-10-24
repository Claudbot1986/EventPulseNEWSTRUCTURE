/**
 * dateOnlyTitles.test.ts — bevis för att datum-formade titlar känns igen
 * utan att riktiga event-titlar kastas.
 *
 * Tre krav:
 *   1. Varje observerad datum-titel fångas (positiv kontroll).
 *   2. Riktiga event-titlar släpps igenom — även sådana som BÖRJAR med
 *      ett datum ("1 MAJ – EFTERFESTEN …") och sådana som råkar innehålla
 *      en månadsförkortning ("Oktoberfest", "Juldagen", "Marstein").
 *   3. Hela texten måste vara datum — en titel med uttrycklig fortsättning
 *      är ett riktigt event-namn.
 */

import { describe, it, expect } from 'vitest';
import { isDateOnlyText } from './dateOnlyTitles';

describe('isDateOnlyText', () => {
  describe('fångar observerad datum-titel', () => {
    // vasamuseet.se — 6 av 6 rubriker som faktiskt lade in skräptitlar
    const VASAMUSEET = [
      '6 NOV, 14:30',
      '11 NOV, 18:00',
      '18 NOV, 17:30',
      '27 NOV, 14:30',
      '2 DEC, 18:00',
      '1 DEC, 14:30',
    ];
    for (const t of VASAMUSEET) {
      it(`fångar "${t}"`, () => expect(isDateOnlyText(t)).toBe(true));
    }

    // fallan.nu — engelskt datumformat
    it('fångar "Nov 4, 2026"', () => expect(isDateOnlyText('Nov 4, 2026')).toBe(true));

    // folkoperan.se
    it('fångar "7 november"', () => expect(isDateOnlyText('7 november')).toBe(true));

    // övriga datumformat
    it('fångar "2026-11-06"', () => expect(isDateOnlyText('2026-11-06')).toBe(true));
    it('fångar "06/11"', () => expect(isDateOnlyText('06/11')).toBe(true));
    it('fångar "24 okt"', () => expect(isDateOnlyText('24 okt')).toBe(true));
    it('fångar "3 nov 2026"', () => expect(isDateOnlyText('3 nov 2026')).toBe(true));
    it('fångar "4-6 september 2026"', () => expect(isDateOnlyText('4-6 september 2026')).toBe(true));
    it('fångar "30 nov 2026, 18:00–20:00"', () => expect(isDateOnlyText('30 nov 2026, 18:00–20:00')).toBe(true));
    it('fångar "18:00"', () => expect(isDateOnlyText('18:00')).toBe(true));
  });

  describe('släpper igenom riktiga event-titlar', () => {
    // Negativ kontroll — dessa finns i det extraherade korpuset och
    // FÅR INTE kastas bort.
    const REAL_TITLES = [
      'Oktoberfest',            // liseberg.se — "okt" + "oberfest"
      'Juldagen',               // nojesfabriken.se — "jul" + "dagen"
      'Marstein',               // momentsapp — "mar" + "stein"
      'Martinez',               // white-guide.se
      'Augsburgerur, 1640',     // djurgarden.se
      '1 MAJ – EFTERFESTEN MED KSMB, S & LOKSM', // debaser.se — datum INNAN mer text
      'Gustav Adolf - dagen',   // vasamuseet.se — den riktiga titeln
      'Undergång – ett interaktivt deckarspel',
      'Afternoon tea - Mörker och kyla under 1600-talet',
      'FULLBOKAT! Magasinsvisning',
      'Lunar Fest 2026',
      'Biografmysteriet - LasseMajas Detektivbyrå',
      'Novolym',
      'Maraton',
      'Decemberkriget',
      'September',
      'Maj',
      'Köpbiljetter',
    ];
    for (const t of REAL_TITLES) {
      it(`släpper igenom "${t}"`, () => expect(isDateOnlyText(t)).toBe(false));
    }
  });

  describe('randvilliga gränser', () => {
    it('tom text är inte datum', () => expect(isDateOnlyText('')).toBe(false));
    it('undefined är inte datum', () => expect(isDateOnlyText(undefined)).toBe(false));
    it('null är inte datum', () => expect(isDateOnlyText(null)).toBe(false));
    it('whitespace är inte datum', () => expect(isDateOnlyText('   ')).toBe(false));
    it('"maj" är INTE datum (bart månadsord kan vara ett namn)', () => expect(isDateOnlyText('maj')).toBe(false));
    it('"maj 2026" är datum (månad + år)', () => expect(isDateOnlyText('maj 2026')).toBe(true));
    it('"May" är INTE datum (engelskt ord, för riskabelt)', () => expect(isDateOnlyText('May')).toBe(false));
    it('"maj-klubben" är inte datum', () => expect(isDateOnlyText('maj-klubben')).toBe(false));
    it('"6 november 2026 kl 18" är inte datum (kl är inte datum)', () => expect(isDateOnlyText('6 november 2026 kl 18')).toBe(false));
  });
});
