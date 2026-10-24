import { describe, it, expect } from 'vitest';
import {
  calendarDay,
  classifyTicketUrlMatch,
  isDuplicateTicketUrlMatch,
  selectTicketUrlCandidate,
  type TicketUrlCandidate,
} from './ticketUrlDedup';

/**
 * Regressionstest för buggen 2026-10-24:
 * normalizerns ticket_url-sökning kollapsade flera event på samma URL
 * till EN rad (ifk-stockholm: 3 event → 1 rad).
 */

const URL = 'https://ifkstockholmsimklubb.se/sida/?ID=408177';

function candidate(over: Partial<TicketUrlCandidate> = {}): TicketUrlCandidate {
  return {
    id: 'row-1',
    updated_at: '2026-10-24T00:00:00.000Z',
    source: 'ifk-stockholm',
    start_time: '2026-11-13T00:00:00+00:00',
    ...over,
  };
}

/**
 * GAMMALT beteende, återskapat här som negativ kontroll: sökningen tog den
 * första raden med matchande URL, oavsett datum. Får den INTE matcha där den
 * nya regeln säger "ny rad", annars kan vi inte bevisa att fixen gör något.
 */
function oldRuleMatched(candidates: TicketUrlCandidate[]): boolean {
  return candidates.length > 0;
}

describe('calendarDay', () => {
  it('läser datumdelen av ett datum-only-värde', () => {
    expect(calendarDay('2026-11-13')).toBe('2026-11-13');
  });

  it('läser UTC-dagen av en Z-tidsstämpel', () => {
    expect(calendarDay('2026-11-26T18:00:00.000Z')).toBe('2026-11-26');
  });

  it('läser UTC-dagen av en offset-tidsstämpel', () => {
    // 00:30 lokal (+01:00) = 23:30 UTC dagen innan — DB-dagen blir 12/11.
    expect(calendarDay('2026-11-13T00:30:00+01:00')).toBe('2026-11-12');
  });

  it('läser datumdelen av en naiv tidsstämpel', () => {
    expect(calendarDay('2026-11-13T19:00:00')).toBe('2026-11-13');
  });

  it('returnerar null för saknat eller trasigt värde', () => {
    expect(calendarDay(null)).toBeNull();
    expect(calendarDay(undefined)).toBeNull();
    expect(calendarDay('')).toBeNull();
    expect(calendarDay('inte-ett-datum')).toBeNull();
  });
});

describe('classifyTicketUrlMatch', () => {
  it('korskälla med samma dag → samma event', () => {
    const reason = classifyTicketUrlMatch({
      incomingSource: 'lulea-hf-2',
      incomingStartTime: '2026-09-10T18:00:00.000Z',
      candidate: candidate({ source: 'downtown-2', start_time: '2026-09-10T18:00:00.000Z' }),
    });
    expect(reason).toBe('cross-source');
    expect(isDuplicateTicketUrlMatch(reason)).toBe(true);
  });

  it('samma källa med samma dag → samma event (titelförvandling)', () => {
    const reason = classifyTicketUrlMatch({
      incomingSource: 'sthlmlist',
      incomingStartTime: '2026-10-24T19:00:00.000Z',
      candidate: candidate({ source: 'sthlmlist', start_time: '2026-10-24T19:00:00.000Z' }),
    });
    expect(reason).toBe('same-source-same-day');
    expect(isDuplicateTicketUrlMatch(reason)).toBe(true);
  });

  it('samma källa med annan dag → INTE en dubblett', () => {
    const reason = classifyTicketUrlMatch({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidate: candidate({ start_time: '2026-12-08T00:00:00+00:00' }),
    });
    expect(reason).toBe('different-day');
    expect(isDuplicateTicketUrlMatch(reason)).toBe(false);
  });

  it('korskälla med annan dag → INTE en dubblett', () => {
    const reason = classifyTicketUrlMatch({
      incomingSource: 'stockholmlive-evenemang',
      incomingStartTime: '2026-10-29',
      candidate: candidate({ source: '3arena', start_time: '2026-10-11T12:00:00.000Z' }),
    });
    expect(reason).toBe('different-day');
    expect(isDuplicateTicketUrlMatch(reason)).toBe(false);
  });

  it('saknat datum → gammalt beteende (behåll dubbletten)', () => {
    expect(
      classifyTicketUrlMatch({
        incomingSource: 'x',
        incomingStartTime: '2026-11-13',
        candidate: candidate({ start_time: null }),
      }),
    ).toBe('no-date');

    expect(
      classifyTicketUrlMatch({
        incomingSource: 'x',
        incomingStartTime: null,
        candidate: candidate(),
      }),
    ).toBe('no-date');
  });
});

describe('selectTicketUrlCandidate', () => {
  it('väljer samma-dags-raden bland flera träffar', () => {
    const candidates = [
      candidate({ id: 'a', start_time: '2026-11-13T00:00:00+00:00' }),
      candidate({ id: 'b', start_time: '2026-11-24T00:00:00+00:00' }),
      candidate({ id: 'c', start_time: '2026-12-08T00:00:00+00:00' }),
    ];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-24',
      candidates,
    });
    expect(selection.candidate?.id).toBe('b');
    expect(selection.reason).toBe('same-source-same-day');
  });

  it('returnerar ingen kandidat när bara andra dagar finns (ny rad)', () => {
    const candidates = [
      candidate({ id: 'b', start_time: '2026-11-24T00:00:00+00:00' }),
      candidate({ id: 'c', start_time: '2026-12-08T00:00:00+00:00' }),
    ];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidates,
    });
    expect(selection.candidate).toBeNull();
    expect(selection.reason).toBe('different-day');
  });

  it('NEGATIV KONTROLL: den gamla regeln skulle ha matchat — den nya gör det inte', () => {
    const candidates = [candidate({ id: 'c', start_time: '2026-12-08T00:00:00+00:00' })];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidates,
    });

    // Gamla regeln: "finns det en rad med samma URL?" → ja → skriv över den.
    expect(oldRuleMatched(candidates)).toBe(true);
    // Nya regeln: annan dag → ingen träff → INSERT (ny rad).
    expect(selection.candidate).toBeNull();
  });

  it('NEGATIV KONTROLL: samma URL + samma dag → gamla och ny regel matchar båda', () => {
    const candidates = [candidate({ id: 'a', start_time: '2026-11-13T00:00:00+00:00' })];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidates,
    });
    expect(oldRuleMatched(candidates)).toBe(true);
    expect(selection.candidate?.id).toBe('a');
  });

  it('korskällträff med samma dag vinner över samma-källa-träff', () => {
    const candidates = [
      candidate({ id: 'same', source: 'x', start_time: '2026-11-13T00:00:00+00:00' }),
      candidate({ id: 'cross', source: 'y', start_time: '2026-11-13T00:00:00+00:00' }),
    ];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'x',
      incomingStartTime: '2026-11-13',
      candidates,
    });
    expect(selection.candidate?.id).toBe('cross');
    expect(selection.reason).toBe('cross-source');
  });

  it('träff med känt datum vinner över träff utan datum', () => {
    const candidates = [
      candidate({ id: 'nodate', start_time: null }),
      candidate({ id: 'withdate', start_time: '2026-11-13T00:00:00+00:00' }),
    ];
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidates,
    });
    expect(selection.candidate?.id).toBe('withdate');
  });

  it('tom kandidatlista → ingen träff', () => {
    const selection = selectTicketUrlCandidate({
      incomingSource: 'ifk-stockholm',
      incomingStartTime: '2026-11-13',
      candidates: [],
    });
    expect(selection.candidate).toBeNull();
  });
});

describe('ifk-stockholm (verkligt fall, 2026-10-24)', () => {
  it('de tre eventen på samma URL blir tre rader', () => {
    const events = [
      { title: 'Höstläger Katrineholm', day: '2026-11-13' },
      { title: 'IFK Klubbmästerskap', day: '2026-11-24' },
      { title: 'Lucia och Banana Cup', day: '2026-12-08' },
    ];

    // Simulera att raderna behandlas i tur och ordning.
    const db: TicketUrlCandidate[] = [];
    for (const ev of events) {
      const selection = selectTicketUrlCandidate({
        incomingSource: 'ifk-stockholm',
        incomingStartTime: ev.day,
        candidates: db,
      });
      if (selection.candidate) {
        // UPDATE — raden finns redan
        expect(selection.candidate.start_time?.slice(0, 10)).toBe(ev.day);
      } else {
        db.push({
          id: `row-${db.length}`,
          source: 'ifk-stockholm',
          start_time: `${ev.day}T00:00:00+00:00`,
        });
      }
    }

    expect(db).toHaveLength(3);
    expect(db.map((r) => r.start_time?.slice(0, 10))).toEqual([
      '2026-11-13',
      '2026-11-24',
      '2026-12-08',
    ]);
  });

  it('samma URL används av alla tre (dokumenterar varför URL:en inte räcker)', () => {
    expect(URL).toBe('https://ifkstockholmsimklubb.se/sida/?ID=408177');
  });
});
