/**
 * navigationTitles.test.ts — negativa kontroller för navigations-/CTA-filter.
 *
 * Tre krav på listan:
 *   1. Den fångar VARJE observerad brus-titel (positiv kontroll).
 *   2. Den släpper igenom riktiga event-titlar — även sådana som råkar
 *      innehålla ett brus-ord ("skolbiljetter", "Läs mer om språkcafé …").
 *   3. Den matchar EXAKT — inte delsträng, inte prefix.
 *
 * Beviset bakom listan: körning 2026-10-24 (30 live-källor, 167 rader) gav
 * 26 brus-rader av 123 datumberoende. 65 rader i hela corpuset, 13 domäner.
 * Negativ kontroll mot databasen: 0 av 12 120 events matchar.
 */

import { describe, it, expect } from 'vitest';
import { isNavigationTitle, normaliseNavTitle, NAVIGATION_TITLE_COUNT } from './navigationTitles';

describe('navigationTitles', () => {
  describe('fångar observerad brus', () => {
    const OBSERVED = [
      // postmuseum (C3)
      'På startsidan', 'Nyheter', 'Kalendarium',
      // folkoperanse + rival (C1)
      'Köp biljetter', 'Köp Biljetter', 'Biljetter här.', 'Biljetter',
      // rival (C3)
      'Mer Info', 'Mer info / More info',
      // tekniska-museet (C3)
      'Läs mer', 'Läs mer om föreställningen',
      // hyroxukcom (C1, engelsk sajt)
      'click here',
      // oscarsteatern (C1)
      'Om föreställningen', 'Medverkande',
      // wwwfaschingse (C2)
      'Datum',
      // kammarencom (C1)
      'Historik',
      // wwwnobelprizemuseumse (C1)
      'På gång',
      // dramaten / sparvag-city / umea-ik / malmo-opera
      'Läs mer och se fler datum', 'Äldre nyheter »',
    ];

    it('alla observerade brus-titlar blockeras', () => {
      for (const title of OBSERVED) {
        expect(isNavigationTitle(title), `expected "${title}" to be blocked`).toBe(true);
      }
    });

    it('matchar oberoende av skiftläge, extra mellanrum och avslutande punktuation', () => {
      expect(isNavigationTitle('köp   BILJETTER')).toBe(true);
      expect(isNavigationTitle('  Läs mer.  ')).toBe(true);
      expect(isNavigationTitle('Nyheter!')).toBe(true);
      expect(isNavigationTitle('BILJETTER HÄR')).toBe(true);
    });
  });

  describe('släpper igenom riktiga titlar', () => {
    const REAL = [
      'Nietzsche kontra Wagner',
      'Jag är Ulla Winblad',
      'A Christmas Carol',
      'Olympiaden',
      'Nyårsgala',
      'Lena från Vetlanda',
      'MUCHA – Beyond Art Nouveau',
      'Höstlov på Postmusuem',
      'Chicago - the Musical',
      'Anu Põder',
      'Anna Casparsson',
      'Sommarnattens leende',
      'Vem fan gillar opera?',
      'Brevskrivarkvällar',
      'Slottid till Postis',
      'Intervju med Agneta Stark',
      'Guidad kulturhistorisk visning',
      'Upptäck mer med våra guidade visningar',
      'Roof of Reflection – konstupplevelse i 360°',
    ];

    it('inga riktiga titlar blockeras', () => {
      for (const title of REAL) {
        expect(isNavigationTitle(title), `expected "${title}" to pass`).toBe(false);
      }
    });

    it('delsträng går igenom — "skolbiljetter" är ett riktigt event', () => {
      expect(isNavigationTitle('skolbiljetter')).toBe(false);
      expect(isNavigationTitle('Läs mer om språkcafé en viktig mötesplats stadsbiblioteket')).toBe(false);
      expect(isNavigationTitle('Läs mer om det stora operaäventyret')).toBe(false);
      expect(isNavigationTitle('Nyheter från scenen')).toBe(false);
    });

    it('prefix går igenom — bara exakt matchning blockeras', () => {
      expect(isNavigationTitle('Biljetter till Phantom')).toBe(false);
      expect(isNavigationTitle('Datum för förrätningen')).toBe(false);
      expect(isNavigationTitle('Köp biljetter till La Bohème')).toBe(false);
    });
  });

  describe('normalisering', () => {
    it('kollapsar mellanrum, gementar och tar bort avslutande punktuation', () => {
      expect(normaliseNavTitle('  Köp   BILJETTER. ')).toBe('köp biljetter');
      expect(normaliseNavTitle('Biljetter här!')).toBe('biljetter här');
      expect(normaliseNavTitle(null)).toBe('');
      expect(normaliseNavTitle(undefined)).toBe('');
    });
  });

  describe('guard', () => {
    it('listan är inte tom', () => {
      expect(NAVIGATION_TITLE_COUNT).toBeGreaterThan(20);
    });
  });
});
