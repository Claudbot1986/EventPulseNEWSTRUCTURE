/**
 * vasalund.test.ts — tester för Vasalunds IF DM/360Player-adapter.
 *
 * Nätverket mockas: adaptern ska kunna verifieras utan live-API. Live-mätningen
 * (2026-10-24) ligger i kommentaren i vasalund.ts.
 *
 * Fixture-värdena är KOPIERADE ur det faktiska API-svaret
 * (matchesUpcoming, siteAlias 2d5d3bf3) — inte påhittade.
 *
 * Negativ kontroll: gruppfiltret måste kunna fälla. Utan kontrollen skulle ett
 * filter som alltid ger alla rader se likadant ut som ett som ger rätt rader.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  readVasalundConfig,
  extractSiteAlias,
  buildCollectionUrl,
  parseDmMatches,
  buildMatchTitle,
  toRows,
  runVasalundAdapter,
} from './vasalund';
import type { SourceTruth } from '../../tools/sourceRegistry';

function makeSource(overrides: Partial<SourceTruth> = {}): SourceTruth {
  return {
    id: 'vasalund-2',
    url: 'https://www.vasalund.com/matcher',
    name: 'Vasalund',
    city: 'Stockholm',
    metadata: {},
    ...overrides,
  } as unknown as SourceTruth;
}

/** Utdrag ur DM:s runtime-parameters — mätt på den riktiga sidan. */
const PAGE_SNIPPET = `
  <script type="text/javascript">
    window.Parameters = window.Parameters || {
      HomeUrl: 'https://www.vasalund.com/',
      SystemID: 'US_DIRECT_PRODUCTION',
      SiteAlias: '2d5d3bf3',
      SiteType: atob('RFVEQU9ORQ=='),
    };
  </script>`;

/** Tre seniorlagets matcher + en ungdomsmatch + en inställd match. */
const MATCHES = [
  {
    data: {
      id: '319987',
      groupId: '14790',
      homeName: 'Sollentuna FK',
      awayName: 'Herrar ',
      startsAt: 1792850400,
      location: 'Sollentunavallen 1',
      competitionName: '',
      isHome: false,
      status: 'published',
    },
  },
  {
    data: {
      id: '320017',
      groupId: '14790',
      homeName: 'Herrar ',
      awayName: 'IF Karlstad Fotboll',
      startsAt: 1793545200,
      location: 'Skytteholms IP 1',
      competitionName: '',
      isHome: true,
      status: 'published',
    },
  },
  {
    data: {
      id: '320048',
      groupId: '14790',
      homeName: 'FC Järfälla',
      awayName: 'Herrar ',
      startsAt: 1794146400,
      location: 'Järfällavallen 1',
      competitionName: '',
      isHome: false,
      status: 'published',
    },
  },
  {
    data: {
      id: '637840',
      groupId: '37908',
      homeName: 'P2017 Solna Svart',
      awayName: 'Oklart ännu',
      startsAt: 1792926000,
      location: 'Järvastadens IP plan C',
      competitionName: '',
      isHome: true,
      status: 'published',
    },
  },
  {
    data: {
      id: '732130',
      groupId: '85681',
      homeName: 'P2013 Future',
      awayName: 'Motståndare',
      startsAt: 1792940400,
      location: '',
      competitionName: '',
      isHome: true,
      status: 'canceled',
    },
  },
];

/** 2026-10-20 12:00 UTC — alla fixture-matcherna ligger i framtiden. */
const NOW_MS = Date.UTC(2026, 9, 20, 12, 0, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readVasalundConfig', () => {
  it('defaultar till seniorlagets grupp (14790)', () => {
    expect(readVasalundConfig(makeSource()).groupIds).toEqual(['14790']);
  });

  it('läser grupper ur source-filens metadata', () => {
    const source = makeSource({
      metadata: { vasalund: { groupIds: ['37908', '14790'], maxPages: 5 } },
    } as Partial<SourceTruth>);
    expect(readVasalundConfig(source)).toEqual({ groupIds: ['37908', '14790'], maxPages: 5 });
  });
});

describe('extractSiteAlias', () => {
  it('läser SiteAlias ur DM:s runtime-parameters', () => {
    expect(extractSiteAlias(PAGE_SNIPPET)).toBe('2d5d3bf3');
  });

  it('returnerar null när parametern saknas', () => {
    expect(extractSiteAlias('<html><body>inget</body></html>')).toBeNull();
  });
});

describe('buildCollectionUrl', () => {
  it('bygger DM:s collection-URL med alias och collection-namn', () => {
    expect(buildCollectionUrl('https://www.vasalund.com', '2d5d3bf3', 'matchesUpcoming', 0)).toBe(
      'https://www.vasalund.com/rts/collections/public/2d5d3bf3/runtime/collection/matchesUpcoming/query-data?pageSize=100&pageNumber=0',
    );
  });

  it('pageNumber är nollbaserad (mätt: pageNumber=1 ger 0 rader)', () => {
    // DM:s API är nollbaserat: pageNumber=0 → första sidan (46 rader),
    // pageNumber=1 → 0 rader trots att page.totalItems säger 46.
    // Ett API-anrop som börjar på 1 ger alltså en TOM lista utan fel —
    // därför är nollbaseringen uttrycklig och testad.
    expect(buildCollectionUrl('https://x.test', 'a', 'c', 1)).toContain('pageNumber=1');
    expect(buildCollectionUrl('https://x.test', 'a', 'c', 1)).not.toBe(
      buildCollectionUrl('https://x.test', 'a', 'c', 0),
    );
  });
});

describe('parseDmMatches', () => {
  it('plockar ut dataraderna', () => {
    expect(parseDmMatches({ values: MATCHES })).toHaveLength(5);
  });

  it('returnerar tom lista för ett svar utan values', () => {
    expect(parseDmMatches({} as never)).toEqual([]);
  });
});

describe('buildMatchTitle', () => {
  it('trimmar lagnamnen (API:t har trailing spaces)', () => {
    expect(buildMatchTitle({ homeName: 'Sollentuna FK', awayName: 'Herrar ' })).toBe(
      'Sollentuna FK vs Herrar',
    );
  });

  it('returnerar null när inga lag finns', () => {
    expect(buildMatchTitle({ homeName: '', awayName: '' })).toBeNull();
  });
});

describe('toRows', () => {
  const config = readVasalundConfig(makeSource());

  it('tar bara seniorlagets matcher (gruppfiltret fäller)', () => {
    const rows = toRows(parseDmMatches({ values: MATCHES }), makeSource(), config, NOW_MS);
    expect(rows.map(r => r.title)).toEqual([
      'Sollentuna FK vs Herrar',
      'Herrar vs IF Karlstad Fotboll',
      'FC Järfälla vs Herrar',
    ]);
  });

  it('NEGATIV KONTROLL: en annan grupp ger helt andra rader', () => {
    // Samma filter, annan grupp → de seniorlagets rader som ovan INTE får
    // finnas med. Utan denna kontroll skulle ett filter som alltid ger alla
    // rader se identiskt ut med ett som ger rätt rader.
    const youthConfig = { groupIds: ['37908'], maxPages: 3 };
    const rows = toRows(parseDmMatches({ values: MATCHES }), makeSource(), youthConfig, NOW_MS);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('P2017 Solna Svart vs Oklart ännu');
    expect(rows.some(r => r.title.includes('Herrar'))).toBe(false);
  });

  it('lägger tiden som UTC + lokal Stockholm-tid', () => {
    // Bevisad mot den riktiga renderingen: "Sollentuna FK vs Herrar",
    // lör 24 okt. 2026, 16:00, Sollentunavallen 1.
    const rows = toRows(parseDmMatches({ values: MATCHES }), makeSource(), config, NOW_MS);
    expect(rows[0].start_time).toBe('2026-10-24T14:00:00.000Z');
    expect(rows[0].date).toBe('2026-10-24');
    expect(rows[0].time).toBe('16:00');
    expect(rows[0].venue).toBe('Sollentunavallen 1');
    expect(rows[0].source_id).toBe('319987');
    expect(rows[0].category).toBe('sports');
  });

  it('utesluter inställda matcher', () => {
    const rows = toRows(parseDmMatches({ values: MATCHES }), makeSource(), config, NOW_MS);
    expect(rows.some(r => r.title.includes('P2013 Future'))).toBe(false);
  });

  it('NEGATIV KONTROLL: förflutna matcher ger inga rader', () => {
    const lateNow = Date.UTC(2026, 10, 15, 12, 0, 0);
    const rows = toRows(parseDmMatches({ values: MATCHES }), makeSource(), config, lateNow);
    expect(rows).toHaveLength(0);
  });

  it('tomma API-svar ger inga rader', () => {
    expect(toRows([], makeSource(), config, NOW_MS)).toEqual([]);
  });
});

describe('runVasalundAdapter', () => {
  function mockFetch(pageHtml: string, payload: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          url.includes('/rts/collections/') ? JSON.stringify(payload) : pageHtml,
      })),
    );
  }

  // Klockan låses så att resultatet inte beror på när testet körs.
  // Utan låset skulle "idag"-matchen (2026-10-24 16:00) falla ur bort
  // efter kl 16:00 och testet skulle ge olika svar vid olika tidpunkter.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kör mot API:t och returnerar seniorlagets rader', async () => {
    mockFetch(PAGE_SNIPPET, { values: MATCHES });
    const result = await runVasalundAdapter(makeSource());
    expect(result.status).toBe('completed');
    expect(result.events).toHaveLength(3);
    expect(result.events[0].title).toBe('Sollentuna FK vs Herrar');
  });

  it('NEGATIV KONTROLL: utan SiteAlias faller adaptern tillbaka med felmeddelande', async () => {
    mockFetch('<html><body>ingen DM-parametrar</body></html>', { values: MATCHES });
    const result = await runVasalundAdapter(makeSource());
    expect(result.status).toBe('failed');
    expect(result.events).toHaveLength(0);
    expect(result.error).toContain('SiteAlias');
  });

  it('NEGATIV KONTROLL: tomt API-svar ger 0 events, inte en lyckad körning', async () => {
    mockFetch(PAGE_SNIPPET, { values: [] });
    const result = await runVasalundAdapter(makeSource());
    expect(result.status).toBe('failed');
    expect(result.events).toHaveLength(0);
    expect(result.error).toContain('0 rader');
  });
});
