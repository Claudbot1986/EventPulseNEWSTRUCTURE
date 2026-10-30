/**
 * usableEvents.test.ts — definitionen av "användbart datum".
 *
 * Den här regeln är hela poängen med fixen 2026-10-24: C-gaten ska räkna
 * en källa som framgång bara om den producerar rader som faktiskt kan hamna
 * i databasen. Importen (03-Queue/importToEventPulse) kastar bort rader
 * som är datumlösa eller förflutna — och det är DEN regeln som gäller.
 *
 * Negativ kontroll: varje "nej"-fall har ett "ja"-fall bredvid sig, så
 * att testet inte kan passera på en regel som alltid ger samma svar.
 */

import { describe, it, expect } from 'vitest';
import {
  countUsableEvents,
  eventStartTime,
  filterUsableEvents,
  hasUsableDate,
  isValidDateString,
  toIsoEndTime,
  toIsoStartTime,
} from './usableEvents';

// 2026-10-24 12:00 lokal tid — samma referens som eventFreshness.test.ts.
const NOON = new Date(2026, 9, 24, 12, 0, 0, 0).getTime();

describe('toIsoStartTime', () => {
  it('datum utan klockslag blir midnatt (markör för okänd tid)', () => {
    expect(toIsoStartTime('2026-11-20', undefined)).toBe('2026-11-20T00:00:00.000Z');
  });

  it('tolkar tiden som Stockholms LOKALA tid, inte UTC', () => {
    // 2026-10-30: adaptrorna ger lokal väggtid. Att skriva den som UTC
    // lade varje kvällsevenemang 1–2 timmar fel i appen (se
    // 02-Ingestion/lib/stockholmTime.ts).
    // 2026-11-20 är CET (+01:00) → 18:30 lokal = 17:30Z.
    expect(toIsoStartTime('2026-11-20', '18:30')).toBe('2026-11-20T17:30:00.000Z');
    // 2026-10-24 är CEST (+02:00) → 18:30 lokal = 16:30Z.
    expect(toIsoStartTime('2026-10-24', '18:30')).toBe('2026-10-24T16:30:00.000Z');
  });

  it('saknat datum ger tom stämpel', () => {
    expect(toIsoStartTime(undefined, '18:30')).toBe('');
    expect(toIsoStartTime('', undefined)).toBe('');
  });

  it('mellanslag runt datum och tid ignoreras', () => {
    expect(toIsoStartTime(' 2026-11-20 ', ' 18:30 ')).toBe('2026-11-20T17:30:00.000Z');
  });
});

describe('toIsoStartTime — trasiga datum-format', () => {
  it('ett trasigt datum ger tom stämpel i stället för en påhittad tid', () => {
    expect(toIsoStartTime('inte-ett-datum', '18:30')).toBe('');
    expect(toIsoStartTime('unknown', undefined)).toBe('');
    expect(toIsoStartTime('2026-1-1', undefined)).toBe('');
  });

  it('en omöjlig kalenderdag rullar inte framåt till nästa månad', () => {
    // Date.parse("2026-11-31") ger 2026-12-01 — raden såg ut att vara ett
    // framtida event med ett datum som aldrig existerade.
    expect(toIsoStartTime('2026-11-31', undefined)).toBe('');
    expect(toIsoStartTime('2026-02-30', undefined)).toBe('');
    expect(toIsoStartTime('2026-13-01', undefined)).toBe('');
    expect(toIsoStartTime('2026-04-31', undefined)).toBe('');
  });

  it('kastar inte när klockan är trasig — dagen behålls som heldag', () => {
    // Före fixen: "19".split(':') → ["19"] → m === undefined → TypeError
    // i padStart. Raden dog i en krasch i stället för att överleva.
    expect(() => toIsoStartTime('2026-11-20', '19')).not.toThrow();
    expect(toIsoStartTime('2026-11-20', '19')).toBe('2026-11-20T00:00:00.000Z');
    expect(toIsoStartTime('2026-11-20', '19.00')).toBe('2026-11-20T00:00:00.000Z');
    expect(toIsoStartTime('2026-11-20', 'kl 19:00')).toBe('2026-11-20T00:00:00.000Z');
  });

  it('en klockslag utanför dygnet räknas som okänd tid', () => {
    expect(toIsoStartTime('2026-11-20', '25:00')).toBe('2026-11-20T00:00:00.000Z');
    expect(toIsoStartTime('2026-11-20', '18:70')).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('isValidDateString', () => {
  it('accepterar verkliga kalendardagar', () => {
    expect(isValidDateString('2026-11-20')).toBe(true);
    expect(isValidDateString('2024-02-29')).toBe(true); // skottår
  });

  it('avvisar omöjliga och trasiga datum', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2025-02-29')).toBe(false); // inte skottår
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-00-10')).toBe(false);
    expect(isValidDateString('unknown')).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });
});

describe('toIsoEndTime', () => {
  it('slutdatum med sluttid ger en ISO-stämpel', () => {
    // 2026-10-30 — slutdatum + sluttid är STOCKHOLMS LOKALA VÄGGTID och
    // konverteras till UTC. 2026-11-20 är CET (+01:00) → 21:30 lokal
    // = 20:30Z. Samma tidsbas som starttiden (annars jämförs start och
    // slut i olika baser, och "noll längd"-skyddet slutar fungera).
    expect(toIsoEndTime('2026-11-20', '21:30')).toBe('2026-11-20T20:30:00.000Z');
  });

  it('slutdatum utan sluttid ger slutet av dagen', () => {
    // Slutet av LOKALA dagen = 23:59:59 CET = 22:59:59Z.
    expect(toIsoEndTime('2026-11-20')).toBe('2026-11-20T22:59:59.000Z');
  });

  it('saknat slutdatum ger null', () => {
    expect(toIsoEndTime(undefined, '21:30')).toBeNull();
  });

  it('trasig slutklocka kastar inte — raden behåller sitt slutdatum', () => {
    expect(() => toIsoEndTime('2026-11-20', '21')).not.toThrow();
    expect(toIsoEndTime('2026-11-20', '21')).toBe('2026-11-20T22:59:59.000Z');
  });

  it('trasigt slutdatum ger null', () => {
    expect(toIsoEndTime('2026-02-30', '21:30')).toBeNull();
  });
});

describe('eventStartTime', () => {
  it('start_time vinner över date/time', () => {
    expect(eventStartTime({ start_time: '2027-01-01T10:00:00.000Z', date: '2026-01-01' }))
      .toBe('2027-01-01T10:00:00.000Z');
  });

  it('startTime används när start_time saknas', () => {
    expect(eventStartTime({ startTime: '2027-01-01T10:00:00.000Z' })).toBe('2027-01-01T10:00:00.000Z');
  });

  it('annars byggs stämpeln av date + time (lokal tid → UTC)', () => {
    // 2026-11-20 är CET (+01:00): 19:00 lokal = 18:00Z.
    expect(eventStartTime({ date: '2026-11-20', time: '19:00' })).toBe('2026-11-20T18:00:00.000Z');
  });

  it('en trasig start_time blockerar inte ett bra date/time under sig', () => {
    expect(eventStartTime({ start_time: 'unknown', date: '2026-11-20', time: '19:00' }))
      .toBe('2026-11-20T18:00:00.000Z');
  });

  it('en omöjlig dag i start_time rullar inte framåt', () => {
    expect(eventStartTime({ start_time: '2026-02-30T00:00:00.000Z' })).toBe('');
  });
});

describe('hasUsableDate', () => {
  it('accepterar ett framtida datum', () => {
    expect(hasUsableDate({ date: '2026-11-20' }, NOON)).toBe(true);
  });

  it('accepterar ett heldags-event som pågår idag', () => {
    expect(hasUsableDate({ date: '2026-10-24' }, NOON)).toBe(true);
  });

  it('avvisar ett förflutet datum', () => {
    expect(hasUsableDate({ date: '2026-10-01' }, NOON)).toBe(false);
  });

  it('avvisar en rad utan datum', () => {
    expect(hasUsableDate({ title: 'Ingen datumrad' }, NOON)).toBe(false);
  });

  it('avvisar en rad med trasigt datum', () => {
    expect(hasUsableDate({ date: 'inte-ett-datum' }, NOON)).toBe(false);
  });

  it('avvisar en rad med omöjlig kalenderdag', () => {
    // Negativ kontroll: före fixen rullade "2026-11-31" fram till 2026-12-01
    // och raden räknades som ett användbart framtida event — med fel datum.
    expect(hasUsableDate({ date: '2026-11-31' }, NOON)).toBe(false);
    expect(hasUsableDate({ date: '2026-02-30' }, NOON)).toBe(false);
  });

  it('accepterar en rad med trasig klocka men giltigt datum', () => {
    expect(hasUsableDate({ date: '2026-11-20', time: '19.00' }, NOON)).toBe(true);
  });
});

describe('countUsableEvents', () => {
  it('räknar bara raderna som överlever datumvakten', () => {
    const events = [
      { date: '2026-11-20' },   // framtid  → sparas
      { date: '2026-10-01' },   // förflutet → kastas
      { title: 'ingen datum' }, // datumlös  → kastas
      { date: '2026-10-24' },   // idag     → sparas
    ];
    expect(countUsableEvents(events, NOON)).toBe(2);
  });

  it('tom lista ger 0', () => {
    expect(countUsableEvents([], NOON)).toBe(0);
  });
});

describe('filterUsableEvents', () => {
  it('behåller bara raderna med användbart datum', () => {
    const events = [
      { title: 'behålls', date: '2026-11-20' },
      { title: 'kastas', date: '2026-10-01' },
      { title: 'kastas också' },
    ];
    const kept = filterUsableEvents(events, NOON);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe('behålls');
  });

  it('behåller den ursprungliga raden (ingen mutation)', () => {
    const events = [{ title: 'behålls', date: '2026-11-20' }];
    const kept = filterUsableEvents(events, NOON);
    expect(kept[0]).toBe(events[0]);
  });
});
