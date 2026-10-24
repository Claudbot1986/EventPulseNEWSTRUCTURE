/**
 * Tester för stockholmJazz-adaptern (Tool A).
 *
 * Bakgrund (2026-10-24). Källan `stockholm-jazz-festival` pekade på
 * https://www.stockholmjazz.se/program med preferredPath='jsonld'. /program är
 * ett SvelteKit-skal (~8 kB) utan JSON-LD — listspåret är strukturellt dött.
 * Plattformens eget /api/concerts ger däremot 331 publicerade rader med
 * datum, sluttid och plats.
 *
 * FALLGROP (2026-10-24): 42 av de 331 API-raderna har sluggar som innehåller
 * "kop"/"kopia" (t.ex. "augusta-swing-band-kopia-kopia-1784235467313"). Det
 * LÅTER som utkast men är CMS:ets kopieringsmekanik: "Augusta Swing Band"
 * spelar 16:00–18:30 på Källarbyn VARJE dag 9–18 oktober, och nio av de tio
 * dagarna har bara en "kopia"-slug. Ett filter på sluggen skulle därför
 * radera 9 av 10 riktiga konserter. Testet "NEGATIV KONTROLL" låser fast att
 * kopior inte filtreras bort.
 *
 * Testerna är rena (ingen nätåtkomst): de anropar mappningsfunktionerna med
 * ett injicerat "nu".
 */

import { describe, expect, it } from 'vitest';

import {
  concertToRow,
  describeNoUpcoming,
  localDateTimeToUtc,
  mapConcerts,
  readStockholmJazzConfig,
} from './stockholmJazz';
import type { JazzConcert } from './stockholmJazz';
import type { SourceTruth } from '../../tools/sourceRegistry';

const SOURCE = {
  id: 'stockholm-jazz-festival',
  url: 'https://www.stockholmjazz.se/program',
  name: 'Stockholm Jazz Festival',
  type: 'festival',
  city: 'Stockholm',
} as unknown as SourceTruth;

/** 2026-10-01 12:00 UTC — före festivalen, så höstens rader är framtida. */
const BEFORE_FESTIVAL = Date.parse('2026-10-01T12:00:00.000Z');
/** 2026-10-24 12:00 UTC — efter festivalen (9–18 oktober), inget är framtida. */
const AFTER_FESTIVAL = Date.parse('2026-10-24T12:00:00.000Z');

function concert(overrides: Partial<JazzConcert> = {}): JazzConcert {
  return {
    id: 'bb365c69-ca03-462d-9b4e-5db18a04c75c',
    slug: 'augusta-swing-band-2026-10-09-1784235123930',
    titleSv: 'Augusta Swing Band',
    titleEn: '',
    date: '2026-10-09',
    startTime: '16:00',
    endTime: '18:30',
    doorsTime: '14:00',
    genre: 'Jazz',
    ticketUrl: '',
    ticketStatus: 'available',
    isFree: true,
    status: 'published',
    venue: {
      slug: 'kallarbyn',
      nameSv: 'Källarbyn ',
      nameEn: 'Källarbyn ',
      address: 'Stora Nygatan 27',
    },
    ...overrides,
  };
}

describe('localDateTimeToUtc — lokal Stockholms-tid → UTC', () => {
  it('sommartid (CEST, +02:00) subtraheras', () => {
    // 2026-10-09 är CEST. 16:00 lokal = 14:00 UTC.
    expect(localDateTimeToUtc('2026-10-09', '16:00')).toBe('2026-10-09T14:00:00.000Z');
  });

  it('vintertid (CET, +01:00) subtraheras — offseten får inte hardkodas', () => {
    // 2026-11-01 är CET. 16:00 lokal = 15:00 UTC.
    expect(localDateTimeToUtc('2026-11-01', '16:00')).toBe('2026-11-01T15:00:00.000Z');
  });

  it('NEGATIV KONTROLL — trasig datum- eller tidsform ger null', () => {
    expect(localDateTimeToUtc('2026-10-9', '16:00')).toBeNull();
    expect(localDateTimeToUtc('2026-10-09', '9:00')).toBeNull();
    expect(localDateTimeToUtc(null, '16:00')).toBeNull();
    expect(localDateTimeToUtc('2026-10-09', null)).toBeNull();
  });
});

describe('concertToRow — mappning av en konsertpost', () => {
  it('bygger en rad med start, slut, plats, adress och kanonisk URL', () => {
    const row = concertToRow(concert(), SOURCE, BEFORE_FESTIVAL);

    expect(row).not.toBeNull();
    expect(row!.title).toBe('Augusta Swing Band');
    expect(row!.start_time).toBe('2026-10-09T14:00:00.000Z');
    expect(row!.end_time).toBe('2026-10-09T16:30:00.000Z');
    expect(row!.venue).toBe('Källarbyn');
    expect(row!.address).toBe('Stora Nygatan 27');
    expect(row!.url).toBe(
      'https://www.stockholmjazz.se/program/augusta-swing-band-2026-10-09-1784235123930',
    );
    expect(row!.source_id).toBe('bb365c69-ca03-462d-9b4e-5db18a04c75c');
    expect(row!.category).toBe('music');
  });

  it('sluttiden skrivs inte när den saknas', () => {
    const row = concertToRow(concert({ endTime: '' }), SOURCE, BEFORE_FESTIVAL);
    expect(row!.end_time).toBeNull();
  });

  it('NEGATIV KONTROLL — en sluttid FÖRE starten skrivs inte', () => {
    // Trasig källa (slut 15:00, start 16:00) får inte ge en trasig sluttid.
    const row = concertToRow(concert({ endTime: '15:00' }), SOURCE, BEFORE_FESTIVAL);
    expect(row!.end_time).toBeNull();
  });

  it('NEGATIV KONTROLL — en förfluten konsert ger ingen rad alls', () => {
    expect(concertToRow(concert(), SOURCE, AFTER_FESTIVAL)).toBeNull();
  });

  it('NEGATIV KONTROLL — en rad utan titel kastas', () => {
    expect(concertToRow(concert({ titleSv: '', titleEn: '' }), SOURCE, BEFORE_FESTIVAL)).toBeNull();
  });

  it('image_url lämnas till AI-workern (null)', () => {
    // Normalizern sätter alltid image_url=null (AI-bilder obligatoriskt).
    const row = concertToRow(concert(), SOURCE, BEFORE_FESTIVAL);
    expect(row!.image_url).toBeNull();
  });
});

describe('mapConcerts — filtrering', () => {
  it('NEGATIV KONTROLL — "kopia"-sluggar filtreras INTE bort', () => {
    // Fallgropen från 2026-10-24: nio av tio "Augusta Swing Band"-dagar har
    // bara en "kopia"-slug. Ett slug-filter skulle radera dem.
    const kopia = concert({
      id: 'kop-1',
      slug: 'augusta-swing-band-kopia-kopia-kopia-kopia-1784235467313',
      date: '2026-10-12',
    });
    const { rows } = mapConcerts([kopia], SOURCE, BEFORE_FESTIVAL, 'published');

    expect(rows).toHaveLength(1);
    expect(rows[0].url).toContain('augusta-swing-band-kopia-kopia-kopia-kopia');
  });

  it('opublicerade rader hoppas över och räknas', () => {
    const draft = concert({ id: 'draft-1', status: 'draft' });
    const published = concert({ id: 'pub-1', slug: 'annan-2026-10-09-1' });
    const { rows, skippedStatus } = mapConcerts([draft, published], SOURCE, BEFORE_FESTIVAL, 'published');

    expect(rows).toHaveLength(1);
    expect(skippedStatus).toBe(1);
  });

  it('dubbletter (samma id + start) skrivs bara en gång', () => {
    const { rows } = mapConcerts(
      [concert(), concert({ slug: 'samma-igen' })],
      SOURCE,
      BEFORE_FESTIVAL,
      'published',
    );
    expect(rows).toHaveLength(1);
  });

  it('säsongslaget: efter festivalen blir det 0 rader', () => {
    const alla = [
      concert({ id: 'a', date: '2026-10-09' }),
      concert({ id: 'b', date: '2026-10-15' }),
      concert({ id: 'c', date: '2026-10-18' }),
    ];
    const { rows } = mapConcerts(alla, SOURCE, AFTER_FESTIVAL, 'published');
    expect(rows).toHaveLength(0);
  });
});

describe('describeNoUpcoming — säsongskällans förklaring', () => {
  it('beskriver varför inga rader är framtida', () => {
    const reason = describeNoUpcoming(331, 0, ['2026-10-09', '2026-10-18']);
    expect(reason).toContain('331 rader');
    expect(reason).toContain('2026-10-09..2026-10-18');
    expect(reason).toContain('säsongsbunden');
  });
});

describe('readStockholmJazzConfig', () => {
  it('läser config ur source-filen', () => {
    const source = {
      ...SOURCE,
      metadata: { stockholmJazz: { limit: 50, maxPages: 2, status: 'published' } },
    } as unknown as SourceTruth;

    expect(readStockholmJazzConfig(source)).toEqual({
      limit: 50,
      maxPages: 2,
      status: 'published',
    });
  });

  it('faller tillbaka på värden när config saknas', () => {
    const config = readStockholmJazzConfig(SOURCE);
    expect(config.limit).toBe(200);
    expect(config.maxPages).toBe(10);
    expect(config.status).toBe('published');
  });
});
