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
});
