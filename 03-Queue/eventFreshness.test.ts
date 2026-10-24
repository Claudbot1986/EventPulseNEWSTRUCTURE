import { describe, it, expect } from 'vitest';
import { isAllDayStart, endOfLocalDayMs, isEventPast } from './eventFreshness';

describe('isAllDayStart', () => {
  it('känner igen ett rent datum', () => {
    expect(isAllDayStart('2026-10-24')).toBe(true);
  });

  it('känner igen midnight-stämpel', () => {
    expect(isAllDayStart('2026-10-24T00:00:00.000Z')).toBe(true);
    expect(isAllDayStart('2026-10-24T00:00:00Z')).toBe(true);
    expect(isAllDayStart('2026-10-24T00:00:00+02:00')).toBe(true);
  });

  it('känner inte igen ett event med klockslag', () => {
    expect(isAllDayStart('2026-10-24T19:00:00.000Z')).toBe(false);
    expect(isAllDayStart('2026-10-24T00:01:00.000Z')).toBe(false);
  });
});

describe('endOfLocalDayMs', () => {
  it('ger slutet av den lokala kalenderdagen', () => {
    const end = endOfLocalDayMs('2026-10-24');
    const d = new Date(end);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });
});

describe('isEventPast', () => {
  // 2026-10-24 12:00 lokal tid (testet är timezone-agnostiskt eftersom
  // både "nu" och gränserna räknas i samma lokala tidszon).
  const noon = new Date(2026, 9, 24, 12, 0, 0, 0).getTime();

  it('behåller ett heldags-event som pågår idag (regression 2026-10-24)', () => {
    // Var detta FÖR buggen: 00:00 UTC < 12:00 lokal → raden föll bort.
    expect(isEventPast('2026-10-24T00:00:00.000Z', noon)).toBe(false);
    expect(isEventPast('2026-10-24', noon)).toBe(false);
  });

  it('behåller ett heldags-event även sent på dagen', () => {
    const lateEvening = new Date(2026, 9, 24, 23, 30, 0, 0).getTime();
    expect(isEventPast('2026-10-24T00:00:00.000Z', lateEvening)).toBe(false);
  });

  it('kastar bort ett heldags-event från en tidigare dag', () => {
    expect(isEventPast('2026-10-23T00:00:00.000Z', noon)).toBe(true);
  });

  it('kastar bort ett heldags-event från en tidigare dag även om klockan är 00:01', () => {
    const justAfterMidnight = new Date(2026, 9, 24, 0, 1, 0, 0).getTime();
    expect(isEventPast('2026-10-23T00:00:00.000Z', justAfterMidnight)).toBe(true);
  });

  it('behåller ett event med klockslag som ännu inte passerat', () => {
    expect(isEventPast('2026-10-24T19:00:00.000Z', noon)).toBe(false);
  });

  it('kastar bort ett event med klockslag som passerat', () => {
    expect(isEventPast('2026-10-24T08:00:00.000Z', noon)).toBe(true);
  });

  it('kastar bort rader utan datum', () => {
    expect(isEventPast('', noon)).toBe(true);
    expect(isEventPast(null, noon)).toBe(true);
    expect(isEventPast(undefined, noon)).toBe(true);
  });

  it('kastar bort rader med ogiltigt datum', () => {
    expect(isEventPast('inte-ett-datum', noon)).toBe(true);
  });

  // 2026-10-24 — pågående flerdagsevenemang ("23-28 oktober"): starten
  // har passerat men evenemanget lever. Slutet avgör.
  describe('pågående flerdagsevenemang', () => {
    it('behåller ett flerdagsevenemang vars slut ligger på en senare dag', () => {
      expect(
        isEventPast('2026-10-23T00:00:00.000Z', noon, '2026-10-28T23:59:59.000Z'),
      ).toBe(false);
    });

    it('behåller ett flerdagsevenemang med klockslag som pågår', () => {
      // Konferens 12 jan 10:00 – 14 jan 17:00, "nu" = 13 jan.
      const mid = new Date(2026, 0, 13, 12, 0, 0, 0).getTime();
      expect(
        isEventPast('2026-01-12T09:00:00.000Z', mid, '2026-01-14T16:00:00.000Z'),
      ).toBe(false);
    });

    it('kastar bort ett flerdagsevenemang som också är slut', () => {
      expect(
        isEventPast('2026-10-20T00:00:00.000Z', noon, '2026-10-22T23:59:59.000Z'),
      ).toBe(true);
    });

    it('NEGATIV KONTROLL: ett ENDAK event som pågår kastas fortfarande bort', () => {
      // Samma dag (24 okt), start 08:00Z har passerat (noon = 12:00 lokal
      // = 10:00Z). Slut 10:00Z är samma kalenderdag → inte flerdag.
      expect(
        isEventPast('2026-10-24T08:00:00.000Z', noon, '2026-10-24T10:00:00.000Z'),
      ).toBe(true);
    });

    it('NEGATIV KONTROLL: utan slutdatum är beteendet oförändrat', () => {
      expect(isEventPast('2026-10-23T00:00:00.000Z', noon)).toBe(true);
      expect(isEventPast('2026-10-23T00:00:00.000Z', noon, null)).toBe(true);
    });
  });
});
