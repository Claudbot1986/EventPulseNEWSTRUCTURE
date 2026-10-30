import { describe, it, expect } from 'vitest';
import { groupDuplicateEvents, duplicateExtras } from './duplicateGroups';

/**
 * Grupperingsreglerna som stoppar dubblettkorten i appen.
 * Negativa kontroller: en rad som hör ihop med en annan får INTE
 * hamna i samma grupp.
 */

const VENUE = 'venue-nalen';
const OTHER_VENUE = 'venue-bern';

function evt(over: Partial<Parameters<typeof groupDuplicateEvents>[0][number]> = {}) {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    title: 'MAFFIA COMEDY SUPERWEEKEND med Elin Almén m.fl',
    startTime: '2026-11-20T19:00:00+00:00',
    venueId: VENUE,
    venueName: 'Nalen',
    source: 'livespot-stockholm',
    ticketUrl: null,
    ...over,
  };
}

describe('groupDuplicateEvents — strikt regel', () => {
  it('grupperar samma event från två källor', () => {
    const a = evt({ id: 'a', source: 'livespot-stockholm', ticketUrl: 'https://livespot.se/x' });
    const b = evt({ id: 'b', source: 'evensos-stockholm', ticketUrl: 'https://evensos.com/y' });
    const groups = groupDuplicateEvents([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(duplicateExtras(groups)).toBe(1);
  });

  it('håller isär olika datum i samma serie', () => {
    const a = evt({ id: 'a', startTime: '2026-11-20T19:00:00+00:00' });
    const b = evt({ id: 'b', startTime: '2026-11-21T19:00:00+00:00' });
    expect(groupDuplicateEvents([a, b])).toHaveLength(0);
  });

  it('håller isär olika klockslag samma dag', () => {
    const a = evt({ id: 'a', startTime: '2026-11-20T19:00:00+00:00' });
    const b = evt({ id: 'b', startTime: '2026-11-20T20:30:00+00:00' });
    expect(groupDuplicateEvents([a, b])).toHaveLength(0);
  });

  it('håller isär olika platser', () => {
    const a = evt({ id: 'a', venueId: VENUE, venueName: 'Nalen' });
    const b = evt({ id: 'b', venueId: OTHER_VENUE, venueName: 'Berns' });
    expect(groupDuplicateEvents([a, b])).toHaveLength(0);
  });

  it('håller isär olika titlar', () => {
    const a = evt({ id: 'a', title: 'Kneecap' });
    const b = evt({ id: 'b', title: 'Paris Paloma' });
    expect(groupDuplicateEvents([a, b])).toHaveLength(0);
  });

  it('ignorerar rader utan titel eller tid', () => {
    const a = evt({ id: 'a', title: null });
    const b = evt({ id: 'b', title: null });
    expect(groupDuplicateEvents([a, b])).toHaveLength(0);
  });

  it('slår ihop venue_id-former när namnet är detsamma', () => {
    // Mätt i DB: samma venue bar vid olika venue_id-former.
    const a = evt({ id: 'a', venueId: 'vid-1', venueName: 'Berwaldhallen' });
    const b = evt({ id: 'b', venueId: null, venueName: 'Berwaldhallen' });
    expect(groupDuplicateEvents([a, b])).toHaveLength(1);
  });
});

describe('groupDuplicateEvents — date-only-bridging', () => {
  it('brygger en datumlös rad till en entydig tidsatt grupp', () => {
    const timed = evt({ id: 't', startTime: '2026-11-20T19:00:00+00:00' });
    const untimed = evt({ id: 'u', startTime: '2026-11-20T00:00:00+00:00' });
    const groups = groupDuplicateEvents([timed, untimed]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('date-only-bridge');
  });

  it('brygger INTE när det finns två tidsatta kandidater (gissning)', () => {
    const t1 = evt({ id: 't1', startTime: '2026-11-20T19:00:00+00:00' });
    const t2 = evt({ id: 't2', startTime: '2026-11-20T21:00:00+00:00' });
    const untimed = evt({ id: 'u', startTime: '2026-11-20T00:00:00+00:00' });
    const groups = groupDuplicateEvents([t1, t2, untimed]);
    // t1 och t2 bildar ingen grupp (olika tid). Den tidlösa raden får
    // ingen entydig kandidat → ingen brygga.
    expect(groups).toHaveLength(0);
  });

  it('brygger inte en datumlös rad till en grupp med en annan tid', () => {
    const timed = evt({ id: 't', startTime: '2026-11-20T19:00:00+00:00' });
    const untimed = evt({ id: 'u', startTime: '2026-11-21T00:00:00+00:00' });
    expect(groupDuplicateEvents([timed, untimed])).toHaveLength(0);
  });
});

describe('groupDuplicateEvents — konsistens', () => {
  it('lägger aldrig en rad i två grupper', () => {
    const rows = [
      evt({ id: 'a' }),
      evt({ id: 'b', source: 'evensos' }),
      evt({ id: 'c', source: 'sthlmlist' }),
      evt({ id: 'd', startTime: '2026-11-20T00:00:00+00:00', source: 'ticketmaster' }),
    ];
    const groups = groupDuplicateEvents(rows);
    const ids = groups.flatMap((g) => g.members.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returnerar tom lista för tom indata', () => {
    expect(groupDuplicateEvents([])).toHaveLength(0);
  });
});
