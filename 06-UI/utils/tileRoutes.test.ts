// tileRoutes.test.ts (2026-09-28): pins för TILE_ROUTES — alla 24+ tiles har
// route, klientfilter returnerar rätt rad-uppsättning, dateMode-helpers ger
// korrekt from/days.
//
// Inga React, ingen fetch — rena enhetstester.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildTileRoutes,
  getTileRoute,
  computeFromIso,
  DATE_MODE_DAYS,
  _resetTileRoutesForTests,
} from './tileRoutes';

const MOCK_CATEGORIES = [
  { key: 'music', labelKey: 'cat.music' },
  { key: 'opera', labelKey: 'cat.opera' },
  { key: 'theatre-comedy', labelKey: 'cat.theatreComedy' },
  { key: 'wine-tasting', labelKey: 'cat.wineTasting' },
];

beforeEach(() => {
  _resetTileRoutesForTests();
});

describe('computeFromIso (dateMode helpers)', () => {
  // Reference day: 2026-09-28 (Monday). UTC-stable för test.
  const monday = new Date('2026-09-28T08:00:00Z');

  it('tomorrow returns next calendar day', () => {
    expect(computeFromIso('tomorrow', monday)).toBe('2026-09-29');
  });

  it('today returns same day', () => {
    expect(computeFromIso('today', monday)).toBe('2026-09-28');
  });

  // 2026-10-01 (helg consistency): weekend returnerar nu nästa lördag,
  // inte "idag + 4 dagar" som tidigare missade helgen helt på onsdag–
  // söndag. days=2 gör att fönstret blir exakt lör+sön.
  it('weekend returns next Saturday (idag + 5 dagar för måndag)', () => {
    // Måndag 2026-09-28 + 5 dagar = lördag 2026-10-03
    expect(computeFromIso('weekend', monday)).toBe('2026-10-03');
  });

  it('weekend on Saturday returns today (lör+sön kvar)', () => {
    const saturday = new Date('2026-10-03T08:00:00Z');
    expect(computeFromIso('weekend', saturday)).toBe('2026-10-03');
  });

  it('weekend on Sunday returns yesterday (lör, days=2 täcker lör+sön)', () => {
    const sunday = new Date('2026-10-04T08:00:00Z');
    expect(computeFromIso('weekend', sunday)).toBe('2026-10-03');
  });

  it('weekend on Wednesday returns next Saturday', () => {
    const wednesday = new Date('2026-09-30T08:00:00Z');
    // Ons + 3 = lör 2026-10-03
    expect(computeFromIso('weekend', wednesday)).toBe('2026-10-03');
  });

  it('any returns today as start', () => {
    expect(computeFromIso('any', monday)).toBe('2026-09-28');
  });

  it('all dateModes produce valid YYYY-MM-DD', () => {
    for (const mode of ['tomorrow', 'today', 'weekend', 'any']) {
      const iso = computeFromIso(mode, monday);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('DATE_MODE_DAYS', () => {
  it('any has wider window than tomorrow/today', () => {
    expect(DATE_MODE_DAYS.any).toBeGreaterThan(DATE_MODE_DAYS.tomorrow);
    expect(DATE_MODE_DAYS.any).toBeGreaterThan(DATE_MODE_DAYS.today);
  });

  // 2026-10-01 (helg consistency): weekend = 2 (lör+sön). Tidigare 3
  // täckte fre+lör+sön men då fredagen inte är helg → count och
  // faktiska helg-events matchade inte.
  it('weekend covers lör+sön (2 dagar)', () => {
    expect(DATE_MODE_DAYS.weekend).toBe(2);
  });
});

describe('buildTileRoutes — smak-tiles (6)', () => {
  it('ger routes för alla 6 smak-tiles', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.gratis).toBeDefined();
    expect(routes.live).toBeDefined();
    expect(routes.skratt).toBeDefined();
    expect(routes.stamning).toBeDefined();
    expect(routes.helg).toBeDefined();
    expect(routes.imorgon).toBeDefined();
  });

  it('smak-routes har eyebrowKey + emptyHintKey', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    for (const id of ['gratis', 'live', 'skratt', 'stamning', 'helg', 'imorgon']) {
      expect(routes[id].eyebrowKey).toMatch(/^home\.explore\./);
      expect(routes[id].emptyHintKey).toMatch(/^explore\.empty\./);
    }
  });

  it('imorgon använder dateMode=tomorrow (serverside-filter via fetchFeed)', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.imorgon.dateMode).toBe('tomorrow');
    expect(routes.imorgon.clientFilter).toBeUndefined();
  });

  it('stamning skickar mood som fetcherExtra (Fas D)', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.stamning.fetcherExtra).toEqual({ mood: 'stamningsfullt' });
  });
});

describe('buildTileRoutes — kategori-routes (autogenererade)', () => {
  it('skapar routes för alla CATEGORY_FILTERS', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.music).toBeDefined();
    expect(routes.opera).toBeDefined();
    expect(routes['theatre-comedy']).toBeDefined();
    expect(routes['wine-tasting']).toBeDefined();
  });

  it('använder labelKey som eyebrowKey', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.music.eyebrowKey).toBe('cat.music');
    expect(routes['wine-tasting'].eyebrowKey).toBe('cat.wineTasting');
  });

  it('genererar emptyHintKey med rätt prefix', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.music.emptyHintKey).toBe('explore.empty.music');
    expect(routes['wine-tasting'].emptyHintKey).toBe('explore.empty.wine-tasting');
  });
});

describe('buildTileRoutes — server-side category-fält (Utforska infinite scroll)', () => {
  // 2026-09-28: live/skratt/samtliga kategori-routes sätter `category` så
  // fetchFeed kan skicka `?category=...` till agent-API:t. Utan det får vi
  // 15 generella events per sida och clientFilter gallrar bort 12-14 av
  // dem — sidor med smala kategorier (wine-tasting) blir oanvändbara.
  it('sätter category = cat.key för alla kategori-routes', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.music.category).toBe('music');
    expect(routes.opera.category).toBe('opera');
    expect(routes['theatre-comedy'].category).toBe('theatre-comedy');
    expect(routes['wine-tasting'].category).toBe('wine-tasting');
  });

  it('live (musik) sätter category=music', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.live.category).toBe('music');
  });

  it('skratt sätter category=theatre-comedy', () => {
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.skratt.category).toBe('theatre-comedy');
  });

  it('routes UTAN kategori-filter har category=undefined (saknas fält)', () => {
    // imorgon filtrerar redan på datum, gratis filtrerar på pris,
    // helg filtrerar på veckodag, stamning filtrerar på mood —
    // ingen av dem behöver category=. Bekräftelse att vi inte
    // av misstag sätter category på en route som inte ska ha det.
    const routes = buildTileRoutes(MOCK_CATEGORIES);
    expect(routes.imorgon.category).toBeUndefined();
    expect(routes.gratis.category).toBeUndefined();
    expect(routes.helg.category).toBeUndefined();
    expect(routes.stamning.category).toBeUndefined();
  });
});

describe('clientFilter — rad-påståenden', () => {
  // Rad-shape efter mapAgentEventToRow (har category_slug + isFree)
  const rows = [
    { id: 'a', title: 'Konsert A', category_slug: 'music', isFree: false },
    { id: 'b', title: 'Standup B', category_slug: 'theatre-comedy', isFree: false },
    { id: 'c', title: 'Fritt C', category_slug: 'exhibition', isFree: true },
    { id: 'd', title: 'Lördag D', category_slug: 'music', isFree: false, date: '2026-10-03' },
    { id: 'e', title: 'Söndag E', category_slug: 'opera', isFree: false, date: '2026-10-04' },
    { id: 'f', title: 'Måndag F', category_slug: 'music', isFree: false, date: '2026-10-05' },
  ];

  beforeEach(() => {
    buildTileRoutes(MOCK_CATEGORIES);
  });

  // 2026-10-01: gratis-tile flyttade sitt filter till serversidan
  // (fetcherExtra: { isFree: true }). clientFilter är inte längre
  // definierad — feed_events kör .eq('is_free', true) istället.
  it('gratis har INGEN clientFilter (filter flyttat till servern)', () => {
    const route = getTileRoute('gratis');
    expect(route.clientFilter).toBeUndefined();
  });

  it('gratis skickar isFree=true via fetcherExtra', () => {
    const route = getTileRoute('gratis');
    expect(route.fetcherExtra).toEqual({ isFree: true });
  });

  it('live (musik) filtrerar på category_slug=music (defense-in-depth)', () => {
    const route = getTileRoute('live');
    const out = route.clientFilter(rows);
    expect(out.map(r => r.id)).toEqual(['a', 'd', 'f']);
  });

  it('skratt filtrerar på category_slug=theatre-comedy (defense-in-depth)', () => {
    const route = getTileRoute('skratt');
    const out = route.clientFilter(rows);
    expect(out.map(r => r.id)).toEqual(['b']);
  });

  // 2026-10-01: helg-tile flyttade sitt filter till serversidan via
  // computeFromIso('weekend') → fönster [lör, mån) + DATE_MODE_DAYS=2.
  // clientFilter är inte längre definierad — feed_events räknar
  // automatiskt events inom det fönstret när ingen kategori anges.
  it('helg har INGEN clientFilter (filter flyttat till fönster)', () => {
    const route = getTileRoute('helg');
    expect(route.clientFilter).toBeUndefined();
  });

  it('helg använder dateMode=weekend (serverside via fonster)', () => {
    const route = getTileRoute('helg');
    expect(route.dateMode).toBe('weekend');
  });

  it('kategori-route (opera) filtrerar rätt (defense-in-depth)', () => {
    const route = getTileRoute('opera');
    const out = route.clientFilter(rows);
    expect(out.map(r => r.id)).toEqual(['e']);
  });
});

describe('getTileRoute — saknad route returnerar null', () => {
  beforeEach(() => {
    buildTileRoutes(MOCK_CATEGORIES);
  });

  it('okänd tile.id → null (MOCK-fallback)', () => {
    expect(getTileRoute('okänd-tile')).toBeNull();
  });

  it('null/undefined tileId → null', () => {
    expect(getTileRoute(null)).toBeNull();
    expect(getTileRoute(undefined)).toBeNull();
    expect(getTileRoute('')).toBeNull();
  });
});

describe('buildTileRoutes — idempotent', () => {
  it('returnerar samma routes-objekt vid upprepat anrop med samma CATEGORY_FILTERS', () => {
    const r1 = buildTileRoutes(MOCK_CATEGORIES);
    const r2 = buildTileRoutes(MOCK_CATEGORIES);
    expect(r1).toBe(r2);
  });

  it('utan buildTileRoutes-anrop returnerar getTileRoute ändå smak-routes', () => {
    expect(getTileRoute('imorgon')).not.toBeNull();
    expect(getTileRoute('gratis')).not.toBeNull();
    // Men kategori-routes är undefined eftersom CATEGORY_FILTERS inte injicerats
    expect(getTileRoute('music')).toBeNull();
  });
});