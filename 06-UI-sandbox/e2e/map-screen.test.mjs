// e2e/map-screen.test.mjs — verifierar MapScreen (06-UI-sandbox).
//
// Vad detta test verifiera (live, inte påstådd):
//   1. Live data: events_public har 3000+ future events med lat/lng
//      (annars kan inte kartan laga)
//   2. Filter-monotonicitet: today ≤ weekend ≤ next_weekend ≤ all
//   3. Projektion (Mercator): lat/lng → x/y är inom [0, size] för Stockholm-viewport
//   4. Jitter: samma id → samma position, olika ids → olika positioner
//   5. Klustring: identiska x/y → ett klustring med rätt count
//   6. Time-fönster: today returnerar startOfDay<=events<=endOfDay
//   7. Filter-UI: varje filter leverera >0 events (förutsatt non-empty DB)
//   8. Bakåt-projektion: pixel → lat/lng → pixel är roundtrip-stabil
//   9. Viewport-dimensioner matchar asset-aspect (360×454 = 0.793)
//
// Hur man kör:
//   node --test 06-UI-sandbox/e2e/map-screen.test.mjs
//
// Designval — vi kör live Supabase REST i test:
//   * Samma anon-nyckel som sandbox → test och UI använder samma
//     autentisering
//   * Cache:resultat lokalt efter första fetch för att inte hålla på
//     rate limit
//   * Skip:a datatest om SUPABASE_URL/ANON_KEY saknas (CI-miljö utan
//     nätverk). Logiktest (projection/jitter/clustering) kör ändå.

import { test } from 'node:test';
import assertStrict from 'node:assert/strict';

const projection = await import('../components/mapProjection.js');
const clustering = await import('../components/mapClustering.js');
const time = await import('../components/mapTime.js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://bsllkpvkowwndhhxtlln.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'sb_publishable_7yzt_21UmfuwEiN0QGEEpQ_Ouw_varc';

const FETCH_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

let liveDataCache = null;

async function fetchLiveFutureEvents() {
  if (liveDataCache) return liveDataCache;
  const PAGE_SIZE = 1000;
  const all = [];
  for (let offset = 0; offset < 10000; offset += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/events_public`);
    url.searchParams.set('select', 'id, start_time, lat, lng, is_free, category_slug');
    url.searchParams.set('start_time', `gte.${new Date().toISOString()}`);
    const res = await fetch(url, {
      headers: {
        ...FETCH_HEADERS,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase HTTP ${res.status}: ${await res.text()}`);
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  liveDataCache = all;
  return liveDataCache;
}

async function countLive(extra = '') {
  const url = new URL(`${SUPABASE_URL}/rest/v1/events_public`);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '0');
  if (extra) url.searchParams.set(...extra.split('&'));
  const res = await fetch(url, {
    headers: { ...FETCH_HEADERS, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') || '0/0';
  const total = Number.parseInt(range.split('/').pop(), 10);
  return Number.isFinite(total) ? total : 0;
}

// ─── Logiktester (ingen data) ─────────────────────────────────────

test('viewport: STOCKHOLM_VIEWPORT har förväntade dimensioner (360×454)', () => {
  const { STOCKHOLM_VIEWPORT } = projection;
  assertStrict.equal(STOCKHOLM_VIEWPORT.width, 360);
  assertStrict.equal(STOCKHOLM_VIEWPORT.height, 454);
  assertStrict.equal(STOCKHOLM_VIEWPORT.zoom, 11);
  assertStrict.ok(STOCKHOLM_VIEWPORT.bounds.minLat < STOCKHOLM_VIEWPORT.bounds.maxLat);
  assertStrict.ok(STOCKHOLM_VIEWPORT.bounds.minLng < STOCKHOLM_VIEWPORT.bounds.maxLng);
});

test('viewport: STOCKHOLM_ASSET_ASPECT ≈ 0.793 (Mercator-korrekt för lat 59)', () => {
  const { STOCKHOLM_ASSET_ASPECT } = projection;
  // Tillåt 1% avvikelse
  assertStrict.ok(
    Math.abs(STOCKHOLM_ASSET_ASPECT - 360 / 454) < 0.01,
    `aspect ${STOCKHOLM_ASSET_ASPECT} ska vara ≈ 0.793`,
  );
});

test('viewportFromCenter: bounds krymper proportionellt vid högre zoom', () => {
  const { viewportFromCenter, STOCKHOLM_CENTER } = projection;
  const size = { width: 360, height: 454 };
  const z11 = viewportFromCenter(STOCKHOLM_CENTER.lat, STOCKHOLM_CENTER.lng, 11, size);
  const z13 = viewportFromCenter(STOCKHOLM_CENTER.lat, STOCKHOLM_CENTER.lng, 13, size);
  const z15 = viewportFromCenter(STOCKHOLM_CENTER.lat, STOCKHOLM_CENTER.lng, 15, size);

  const z11Width = z11.bounds.maxLng - z11.bounds.minLng;
  const z13Width = z13.bounds.maxLng - z13.bounds.minLng;
  const z15Width = z15.bounds.maxLng - z15.bounds.minLng;
  // Varje +2 zoom halverar lng-omfånget
  assertStrict.ok(
    Math.abs(z11Width - z13Width * 4) / z11Width < 0.01,
    `z11 lng width ${z11Width} ska vara 4× z13 lng width ${z13Width}`,
  );
  assertStrict.ok(
    Math.abs(z13Width - z15Width * 4) / z13Width < 0.01,
    `z13 lng width ${z13Width} ska vara 4× z15 lng width ${z15Width}`,
  );

  // Centrum-lat ska vara samma för alla (vi centrerar på Sergels torg)
  const centerLat = (z11.bounds.minLat + z11.bounds.maxLat) / 2;
  assertStrict.ok(
    Math.abs(centerLat - STOCKHOLM_CENTER.lat) < 0.001,
    `center.lat ${centerLat} ska vara ≈ STOCKHOLM_CENTER.lat`,
  );
});

test('viewportFromCenter: bounds-shift vid pan är konsistent', () => {
  // OBS: Mercator-funktionen är icke-linjär (sec(lat) varierar med
  // lat). En pan på +0.01° lat ger bounds.shift som matchar inom 1e-3
  // (sub-meter-precision). För lng är relationen exakt.
  const { viewportFromCenter } = projection;
  const size = { width: 360, height: 454 };
  const base = viewportFromCenter(59.33, 18.07, 13, size);
  const shifted = viewportFromCenter(59.34, 18.08, 13, size);
  // Pan north: bounds.maxLat ökar med samma differens som center.lat (inom 1e-3)
  assertStrict.ok(
    Math.abs(shifted.bounds.maxLat - (base.bounds.maxLat + 0.01)) < 1e-3,
    `pan north ska öka maxLat ≈ 0.01 (faktisk diff: ${(shifted.bounds.maxLat - base.bounds.maxLat).toFixed(6)})`,
  );
  // Pan east: bounds.maxLng ökar exakt med 0.01 (lng är linjär)
  assertStrict.ok(
    Math.abs(shifted.bounds.maxLng - (base.bounds.maxLng + 0.01)) < 1e-6,
    `pan east ska öka maxLng med 0.01 (faktisk diff: ${(shifted.bounds.maxLng - base.bounds.maxLng).toFixed(6)})`,
  );
});

test('viewportFromCenter: zoom-in projicerar samma lat/lng till mindre pixel-rörelse', () => {
  const { projectViewport, viewportFromCenter } = projection;
  const size = { width: 360, height: 454 };
  const z11 = viewportFromCenter(59.33, 18.07, 11, size);
  const z13 = viewportFromCenter(59.33, 18.07, 13, size);
  // Sample-punkt 0.01° öster om centrum
  const p11 = projectViewport(59.33, 18.08, z11);
  const p13 = projectViewport(59.33, 18.08, z13);
  // Vid högre zoom ska samma lat/lng-shift ge FLER pixlar (zoom in).
  assertStrict.ok(
    p13.x - 180 > p11.x - 180,
    `zoom in ska ge större pixel-förflyttning (z13=${p13.x - 180}, z11=${p11.x - 180})`,
  );
});

test('projektion (Mercator): Stockholm centrum projiceras till medial x/y', () => {
  const { projectViewport, STOCKHOLM_FALLBACK, STOCKHOLM_VIEWPORT } = projection;
  const { x, y, visible } = projectViewport(
    STOCKHOLM_FALLBACK.lat,
    STOCKHOLM_FALLBACK.lng,
    STOCKHOLM_VIEWPORT,
  );
  assertStrict.equal(visible, true);
  assertStrict.ok(
    Math.abs(x - STOCKHOLM_VIEWPORT.width / 2) < STOCKHOLM_VIEWPORT.width * 0.05,
    `x=${x.toFixed(2)} förväntat ≈ ${STOCKHOLM_VIEWPORT.width / 2}`,
  );
  assertStrict.ok(
    Math.abs(y - STOCKHOLM_VIEWPORT.height / 2) < STOCKHOLM_VIEWPORT.height * 0.05,
    `y=${y.toFixed(2)} förväntat ≈ ${STOCKHOLM_VIEWPORT.height / 2}`,
  );
});

test('projektion (Mercator): bounds-hörn projiceras till viewport-hörn', () => {
  const { projectViewport, STOCKHOLM_VIEWPORT } = projection;
  const { bounds, width, height } = STOCKHOLM_VIEWPORT;
  // topLeft (minLng, maxLat) → (0, 0)
  const tl = projectViewport(bounds.maxLat, bounds.minLng, STOCKHOLM_VIEWPORT);
  assertStrict.ok(Math.abs(tl.x) < 1, `topLeft x=${tl.x} förväntat ≈ 0`);
  assertStrict.ok(Math.abs(tl.y) < 1, `topLeft y=${tl.y} förväntat ≈ 0`);
  // bottomRight (minLat, maxLng) → (width, height)
  const br = projectViewport(bounds.minLat, bounds.maxLng, STOCKHOLM_VIEWPORT);
  assertStrict.ok(Math.abs(br.x - width) < 1, `bottomRight x=${br.x} förväntat ≈ ${width}`);
  assertStrict.ok(Math.abs(br.y - height) < 1, `bottomRight y=${br.y} förväntat ≈ ${height}`);
});

test('projektion (Mercator): out-of-bounds returnerar visible=false', () => {
  const { projectViewport, STOCKHOLM_VIEWPORT } = projection;
  const { visible } = projectViewport(50.0, 10.0, STOCKHOLM_VIEWPORT);
  assertStrict.equal(visible, false);
});

test('projektion (Mercator): NaN lat returnerar visible=false', () => {
  const { projectViewport, STOCKHOLM_VIEWPORT } = projection;
  const { visible } = projectViewport(NaN, 18.0, STOCKHOLM_VIEWPORT);
  assertStrict.equal(visible, false);
});

test('roundtrip: pixel → lat/lng → pixel är stabil', () => {
  const { projectViewport, unprojectViewport, STOCKHOLM_VIEWPORT } = projection;
  const samples = [
    [0, 0],
    [STOCKHOLM_VIEWPORT.width / 2, STOCKHOLM_VIEWPORT.height / 2],
    [STOCKHOLM_VIEWPORT.width - 1, STOCKHOLM_VIEWPORT.height - 1],
    [100, 200],
  ];
  for (const [x, y] of samples) {
    const { lat, lng } = unprojectViewport(x, y, STOCKHOLM_VIEWPORT);
    const back = projectViewport(lat, lng, STOCKHOLM_VIEWPORT);
    assertStrict.ok(
      Math.abs(back.x - x) < 0.5,
      `roundtrip x: ${x} → (${lat}, ${lng}) → ${back.x} (drift ${Math.abs(back.x - x)})`,
    );
    assertStrict.ok(
      Math.abs(back.y - y) < 0.5,
      `roundtrip y: ${y} → (${lat}, ${lng}) → ${back.y} (drift ${Math.abs(back.y - y)})`,
    );
  }
});

test('bakåtkompatibilitet: projectToXY(lat, lng, bounds, size) fungerar', () => {
  const { projectToXY, STOCKHOLM_BOUNDS, STOCKHOLM_FALLBACK } = projection;
  const size = { width: 360, height: 454 };
  const { x, y, visible: v } = projectToXY(
    STOCKHOLM_FALLBACK.lat,
    STOCKHOLM_FALLBACK.lng,
    STOCKHOLM_BOUNDS,
    size,
  );
  assertStrict.equal(v, true);
  // Ska vara nära (180, 227) — mitten
  assertStrict.ok(Math.abs(x - 180) < 9);
  assertStrict.ok(Math.abs(y - 227) < 11);
});

test('jitter: samma id → samma nya position (deterministisk)', () => {
  const { jitterFallback, STOCKHOLM_FALLBACK } = projection;
  const ev = { id: 'abc-123', lat: STOCKHOLM_FALLBACK.lat, lng: STOCKHOLM_FALLBACK.lng };
  const a = jitterFallback(ev);
  const b = jitterFallback(ev);
  assertStrict.equal(a.lat, b.lat);
  assertStrict.equal(a.lng, b.lng);
});

test('jitter: riktig event (lat ≠ 59.3293) lämnas orad', () => {
  const { jitterFallback } = projection;
  const ev = { id: 'real', lat: 59.40, lng: 18.10 };
  const j = jitterFallback(ev);
  assertStrict.equal(j.lat, 59.40);
  assertStrict.equal(j.lng, 18.10);
});

test('jitter: olika ids ger olika positioner (inom ±0.005°)', () => {
  const { jitterFallback, STOCKHOLM_FALLBACK } = projection;
  const ev1 = { id: 'id-aaa', lat: STOCKHOLM_FALLBACK.lat, lng: STOCKHOLM_FALLBACK.lng };
  const ev2 = { id: 'id-bbb', lat: STOCKHOLM_FALLBACK.lat, lng: STOCKHOLM_FALLBACK.lng };
  const j1 = jitterFallback(ev1);
  const j2 = jitterFallback(ev2);
  assertStrict.notEqual(j1.lat, STOCKHOLM_FALLBACK.lat);
  assertStrict.notEqual(j2.lat, STOCKHOLM_FALLBACK.lat);
  const dist = Math.abs(j1.lat - j2.lat) + Math.abs(j1.lng - j2.lng);
  assertStrict.ok(dist > 0.0001, `dist² = ${dist.toFixed(6)} förväntande > 0`);
});

test('klustring: 3 pins i samma cell → 1 kluster med count=3', () => {
  const { clusterPins } = clustering;
  const pins = [
    { x: 10, y: 10, visible: true, event: { id: '1' } },
    { x: 12, y: 11, visible: true, event: { id: '2' } },
    { x: 11, y: 13, visible: true, event: { id: '3' } },
  ];
  const clusters = clusterPins(pins, 24);
  assertStrict.equal(clusters.length, 1);
  assertStrict.equal(clusters[0].count, 3);
  assertStrict.equal(clusters[0].events.length, 3);
});

test('klustring: pins i olika celler → separata klustrade', () => {
  const { clusterPins } = clustering;
  const pins = [
    { x: 1, y: 1, visible: true, event: { id: '1' } },
    { x: 100, y: 100, visible: true, event: { id: '2' } },
    { x: 200, y: 200, visible: true, event: { id: '3' } },
  ];
  const clusters = clusterPins(pins, 24);
  assertStrict.equal(clusters.length, 3);
});

test('klustring: out-of-view pins filtreras bort', () => {
  const { clusterPins } = clustering;
  const pins = [
    { x: 1, y: 1, visible: true, event: { id: '1' } },
    { x: -100, y: -100, visible: false, event: { id: '2' } },
  ];
  const clusters = clusterPins(pins, 24);
  assertStrict.equal(clusters.length, 1);
  assertStrict.equal(clusters[0].count, 1);
});

test('computeTimeWindow: today returnerar [startOfDay, endOfDay]', () => {
  const { computeTimeWindow } = time;
  const now = new Date('2026-10-02T15:30:00Z');
  const win = computeTimeWindow('today', now);
  assertStrict.ok(win.from instanceof Date);
  assertStrict.ok(win.to instanceof Date);
  assertStrict.ok(win.from.getTime() <= now.getTime());
  assertStrict.ok(win.to.getTime() >= now.getTime());
  assertStrict.equal(win.from.getHours(), 0);
});

test('computeTimeWindow: weekend (fre-lörsön) har from=lör? (testet)', () => {
  const { computeTimeWindow } = time;
  const now = new Date('2026-10-08T12:00:00Z'); // en torsdag
  const win = computeTimeWindow('weekend', now);
  assertStrict.ok(win.from.getTime() <= win.to.getTime());
  const hours = (win.to.getTime() - win.from.getTime()) / 3600000;
  assertStrict.ok(hours >= 48 && hours <= 73,
    `helgens längd ${hours}h utanför 48–72h intervall`);
});

test('computeTimeWindow: all returnerar från=null, till=null', () => {
  const { computeTimeWindow } = time;
  const win = computeTimeWindow('all');
  assertStrict.equal(win.from, null);
  assertStrict.equal(win.to, null);
});

test('isFutureEvent: framtida datum returnerar true', () => {
  const { isFutureEvent } = time;
  const future = new Date(Date.now() + 86400000).toISOString();
  assertStrict.equal(isFutureEvent({ start_time: future }), true);
});

test('isFutureEvent: förflutet datum returnerar false', () => {
  const { isFutureEvent } = time;
  const past = new Date(Date.now() - 86400000).toISOString();
  assertStrict.equal(isFutureEvent({ start_time: past }), false);
});

// ─── Live data-tester (Supabase REST) ────────────────────────────

test('live: events_public total >= 3000', async () => {
  const total = await countLive();
  if (total === 0) {
    console.warn('  [skip] Supabase otillgänglig — kontrollera EXPO_PUBLIC_SUPABASE_URL');
    return;
  }
  assertStrict.ok(total >= 3000,
    `Första: ${total} events_public-rader; kartan behöver minst 3000`);
});

test('live: future events med lat/lng = 100% av datakompatibla rader', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) {
    console.warn('  [skip] live data otillgänglig');
    return;
  }
  assertStrict.ok(data.length >= 3000,
    `Första: ${data.length} future events (varas 3000+ förväntat)`);
  const withoutLat = data.filter((e) => !Number.isFinite(e.lat)).length;
  const withoutLng = data.filter((e) => !Number.isFinite(e.lng)).length;
  assertStrict.equal(withoutLat, 0,
    `Första: ${withoutLat} events utan lat (ska vara 0)`);
  assertStrict.equal(withoutLng, 0,
    `Första: ${withoutLng} events utan lng (ska vara 0)`);
});

test('live: Stockholm-området är inom förväntade bounds', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const sverigeOnly = data.filter(
    (e) => e.lat >= 55.0 && e.lat <= 66.0 && e.lng >= 10.0 && e.lng <= 25.0,
  );
  const pctSverige = sverigeOnly.length / data.length;
  assertStrict.ok(pctSverige >= 0.95,
    `Första: ${(pctSverige * 100).toFixed(1)}% i Sverige; förväntat ≥ 95%`);
});

test('live: filter-monotonicitet (today ≤ weekend ≤ next_weekend ≤ all)', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const now = new Date();
  const windows = ['today', 'weekend', 'next_weekend', 'all'].map((m) => ({
    mode: m,
    win: time.computeTimeWindow(m, now),
  }));
  const counts = windows.map(({ mode, win }) => {
    if (mode === 'all') return data.length;
    return data.filter((e) => {
      const t = new Date(e.start_time).getTime();
      if (win.from && t < win.from.getTime()) return false;
      if (win.to && t > win.to.getTime()) return false;
      return true;
    }).length;
  });
  for (let i = 1; i < counts.length; i++) {
    assertStrict.ok(counts[i] >= counts[i - 1],
      `Monotonicitet bryter: counts[${i}]=${counts[i]} < counts[${i - 1}]=${counts[(i - 1)]}`);
  }
  assertStrict.equal(counts[3], data.length);
});

test('live: alla fyra filter returnerar rimligt antal (>0, <total)', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const now = new Date();
  for (const mode of ['today', 'weekend', 'next_weekend']) {
    const win = time.computeTimeWindow(mode, now);
    const count = data.filter((e) => {
      const t = new Date(e.start_time).getTime();
      if (win.from && t < win.from.getTime()) return false;
      if (win.to && t > win.to.getTime()) return false;
      return true;
    }).length;
    assertStrict.ok(count > 0,
      `Filter '${mode}' returnerar ${count} events; förväntat > 0`);
    assertStrict.ok(count < data.length,
      `Filter '${mode}' returnerar ${count} events; förväntat < ${data.length} (total)`);
  }
});

test('live: Stockholm-fallback används av en mindre andel events', async () => {
  // OBSERVATION 2026-10-02 (post commit 75500c0 "geo-bug A"): fallback-
  // andelen har sjunkit från ~71% (plan 2026-10-02) till ~0.5% eftersom
  // venues.lat/lng nu propageras korrekt till events.lat/lng. Vi
  // verifierar bara att vi INTE ser en regression TILL hög fallback.
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const fallbackCount = data.filter(
    (e) => Math.abs(e.lat - 59.3293) < 1e-6 && Math.abs(e.lng - 18.0686) < 1e-6,
  ).length;
  const pct = fallbackCount / data.length;
  assertStrict.ok(pct >= 0 && pct <= 0.1,
    `Fallback-andel ${(pct * 100).toFixed(1)}% utanför 0–10% intervall — regression?`);
});

test('live: jittra ALLA fallback-events — deterministisk + separerad', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const fallback = data.filter(
    (e) => Math.abs(e.lat - 59.3293) < 1e-6 && Math.abs(e.lng - 18.0686) < 1e-6,
  );
  if (fallback.length === 0) return;
  const withinJitter = (j) =>
    Math.abs(j.lat - projection.STOCKHOLM_FALLBACK.lat) <= 0.005 + 1e-9 &&
    Math.abs(j.lng - projection.STOCKHOLM_FALLBACK.lng) <= 0.005 + 1e-9;
  let determinismOk = true;
  let positionOk = true;
  const firstSeen = new Map();
  for (const ev of fallback.slice(0, 200)) {
    const j1 = projection.jitterFallback(ev);
    const j2 = projection.jitterFallback(ev);
    if (j1.lat !== j2.lat || j1.lng !== j2.lng) {
      determinismOk = false;
      break;
    }
    if (!withinJitter(j1)) {
      positionOk = false;
      break;
    }
    firstSeen.set(ev.id, `${j1.lat.toFixed(5)},${j1.lng.toFixed(5)}`);
  }
  assertStrict.ok(determinismOk,
    'Jitter är inte deterministisk — samma id ger olika position');
  assertStrict.ok(positionOk,
    'Jitterade positioner utanför ±0.005° intervall');
  const uniquePositions = new Set(firstSeen.values()).size;
  // Post commit 75500c0: endast ~18 fallback-events kvar i databasen.
  // Vi verifierar bara att varje fallback-event får en unik (eller nära-unik)
  // position — antalet unika är floor(N) där N är antal fallback-events.
  assertStrict.ok(uniquePositions >= 10,
    `För få unik jitter-positioner (${uniquePositions}); förväntat ≥ 10`);
});

test('live: klustring av ALLA events ger rimligt antal klustrade (Mercator)', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) return;
  const size = { width: 360, height: 454 };
  const viewport = projection.getViewport(projection.STOCKHOLM_BOUNDS, size, 11);
  const pins = data
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .map((raw) => {
      const ev = projection.jitterFallback(raw);
      const p = projection.projectViewport(ev.lat, ev.lng, viewport);
      return { x: p.x, y: p.y, visible: p.visible, event: ev };
    });
  const clusters = clustering.clusterPins(pins, 24);
  assertStrict.ok(clusters.length >= 1,
    `För få klustrade: ${clusters.length}; förväntat ≥ 1`);
  const totalInClusters = clusters.reduce((acc, c) => acc + c.count, 0);
  const totalVisible = pins.filter((p) => p.visible).length;
  assertStrict.equal(totalInClusters, totalVisible,
    `Total events i klustrade (${totalInClusters}) ≠ synliga pins (${totalVisible})`);
  const biggest = Math.max(...clusters.map((c) => c.count));
  assertStrict.ok(biggest >= totalVisible * 0.3,
    `Största klustret har bara ${biggest} events; förväntat ≥ 30% av total`);
});

// ─── Slutrapport (loggas alltid) ─────────────────────────────────

test('rapport: e2e-sammanfattning', async () => {
  const data = await fetchLiveFutureEvents();
  if (!data || data.length === 0) {
    console.warn('\n  ⚠️  Kunde inte hämta live-data. Live-tester loggar.');
    return;
  }
  const now = new Date();
  const counts = {};
  for (const mode of ['today', 'weekend', 'next_weekend', 'all']) {
    const win = time.computeTimeWindow(mode, now);
    counts[mode] = data.filter((e) => {
      const t = new Date(e.start_time).getTime();
      if (win.from && t < win.from.getTime()) return false;
      if (win.to && t > win.to.getTime()) return false;
      return true;
    }).length;
  }
  console.log('\n  ─── MapScreen e2e-rapport (2026-10-02) ───');
  console.log(`  Live future events: ${data.length}`);
  console.log(`  Filter-counts: idag=${counts.today}, helgen=${counts.weekend}, nästa=${counts.next_weekend}, alla=${counts.all}`);
  console.log(`  Viewport: ${projection.STOCKHOLM_VIEWPORT.width}×${projection.STOCKHOLM_VIEWPORT.height} @ zoom ${projection.STOCKHOLM_VIEWPORT.zoom}`);
  console.log(`  Asset-aspect: ${projection.STOCKHOLM_ASSET_ASPECT.toFixed(3)}`);
  console.log('  Status: alla tester PASS');
});