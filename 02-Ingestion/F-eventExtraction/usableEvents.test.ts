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
  toIsoStartTime,
} from './usableEvents';

// 2026-10-24 12:00 lokal tid — samma referens som eventFreshness.test.ts.
const NOON = new Date(2026, 9, 24, 12, 0, 0, 0).getTime();

describe('toIsoStartTime', () => {
  it('datum utan klockslag blir midnatt', () => {
    expect(toIsoStartTime('2026-11-20', undefined)).toBe('2026-11-20T00:00:00.000Z');
  });

  it('datum med klockslag behåller tiden', () => {
    expect(toIsoStartTime('2026-11-20', '18:30')).toBe('2026-11-20T18:30:00.000Z');
  });

  it('saknat datum ger tom stämpel', () => {
    expect(toIsoStartTime(undefined, '18:30')).toBe('');
    expect(toIsoStartTime('', undefined)).toBe('');
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

  it('annars byggs stämpeln av date + time', () => {
    expect(eventStartTime({ date: '2026-11-20', time: '19:00' })).toBe('2026-11-20T19:00:00.000Z');
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
