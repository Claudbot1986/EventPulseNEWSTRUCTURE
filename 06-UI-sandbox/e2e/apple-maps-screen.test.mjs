// e2e/apple-maps-screen.test.mjs — verifierar AppleMapsScreen (06-UI-sandbox).
//
// Vad detta test verifierar (live + logik, inte påstådd):
//   1. helpers (filterEventsByMode, computeCountsByMode) är rena
//   2. FILTER_MODES täcker alla fyra lägen
//   3. INITIAL_REGION pekar på Stockholm (centrum Sergels torg)
//   4. Live data: events_public har framtida events med lat/lng
//   5. Filter-monotonicitet: today ≤ weekend ≤ next_weekend ≤ all
//   6. Markers-byggbar: filtrerade events kan mappas till {latitude, longitude}
//
// Vad det INTE verifierar (kräver simulator/Dev Client):
//   - Visuell rendering av Apple Maps
//   - Pinch/pan/zoom-upplevelse (smooth)
//   - Auto-klustring-beteende
//
// Hur man kör:
//   node --test 06-UI-sandbox/e2e/apple-maps-screen.test.mjs
//
// Designval — kör live Supabase REST i test (samma anon-nyckel som sandbox):
//   * Skip:a datatest om SUPABASE_URL/ANON_KEY saknas (CI utan nätverk).
//   * Logiktest (helpers, INITIAL_REGION) kör alltid.

import { test } from 'node:test';
import assertStrict from 'node:assert/strict';

const helpers = await import('../components/AppleMapsScreen.helpers.js');

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
    url.searchParams.set(
      'select',
      'id, title_sv, title_en, start_time, lat, lng',
    );
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

// --- Hjälpare --------------------------------------------------------------

test('export: FILTER_MODES innehåller alla fyra lägen', () => {
  const expected = ['today', 'weekend', 'next_weekend', 'all'];
  assertStrict.equal(helpers.FILTER_MODES.length, 4);
  for (const mode of expected) {
    assertStrict.ok(
      helpers.FILTER_MODES.includes(mode),
      `saknar mode: ${mode}`,
    );
  }
});

test('export: FETCH_SELECT inkluderar lat, lng, title, start_time', () => {
  assertStrict.ok(helpers.FETCH_SELECT.includes('lat'));
  assertStrict.ok(helpers.FETCH_SELECT.includes('lng'));
  assertStrict.ok(helpers.FETCH_SELECT.includes('title_sv'));
  assertStrict.ok(helpers.FETCH_SELECT.includes('title_en'));
  assertStrict.ok(helpers.FETCH_SELECT.includes('start_time'));
});

test('export: INITIAL_REGION pekar på Stockholm (Sergels torg-området)', () => {
  const region = helpers.INITIAL_REGION;
  assertStrict.ok(region, 'INITIAL_REGION är inte exporterad');
  assertStrict.ok(
    region.latitude > 59.0 && region.latitude < 60.0,
    `latitude utanför Stockholm: ${region.latitude}`,
  );
  assertStrict.ok(
    region.longitude > 17.0 && region.longitude < 19.0,
    `longitude utanför Stockholm: ${region.longitude}`,
  );
  assertStrict.ok(region.latitudeDelta > 0);
  assertStrict.ok(region.longitudeDelta > 0);
});

test('export: helpers exponerade', () => {
  assertStrict.equal(typeof helpers.filterEventsByMode, 'function');
  assertStrict.equal(typeof helpers.computeCountsByMode, 'function');
  assertStrict.equal(typeof helpers.fetchFutureEvents, 'function');
  assertStrict.equal(typeof helpers.translateError, 'function');
});

// --- Fel-översättning (UX-läckage-skydd) --------------------------------

test('translateError: PG statement_timeout (57014) → användarvänlig svenska', () => {
  const err = {
    code: '57014',
    message: 'canceling statement due to statement timeout',
  };
  const out = helpers.translateError(err);
  // Får INTE innehå åter-PG-meddelandet eller felkoden
  assertStrict.ok(!out.includes('canceling'), 'läcker PG-meddelande');
  assertStrict.ok(!out.includes('57014'), 'läcker felkode');
  assertStrict.ok(out.length > 0);
  assertStrict.ok(/försök igen|tidsgräns|långsamt/i.test(out));
});

test('translateError: nätverksfel → kontrollera anslutning', () => {
  const err = { message: 'Network request failed' };
  const out = helpers.translateError(err);
  assertStrict.ok(!out.includes('Network'), 'läcker tekniskt fel');
  assertStrict.ok(/nätverk|anslutning/i.test(out));
});

test('translateError: ENOTFOUND/ETIMEDOUT → nätverksfel', () => {
  for (const code of ['ENOTFOUND', 'ETIMEDOUT']) {
    const out = helpers.translateError({ message: code });
    assertStrict.ok(/nätverk|anslutning/i.test(out), `${code} borde ge nätverksmeddelande`);
  }
});

test('translateError: 401 unauthorized → auktoriseringsfel', () => {
  const err = { code: '401', message: 'Invalid API key' };
  const out = helpers.translateError(err);
  assertStrict.ok(!out.includes('Invalid'), 'läcker tekniskt fel');
  assertStrict.ok(/auktoriser|nyckel/i.test(out));
});

test('translateError: okänt fel → generiskt meddelande (aldrig raw)', () => {
  const err = { message: 'Some internal database error XYZ-12345' };
  const out = helpers.translateError(err);
  assertStrict.ok(!out.includes('XYZ-12345'), 'läcker internt fel-ID');
  assertStrict.ok(/försök igen/i.test(out));
});

test('translateError: null/undefined → fallback-meddelande', () => {
  const out1 = helpers.translateError(null);
  const out2 = helpers.translateError(undefined);
  assertStrict.ok(/försök igen/i.test(out1));
  assertStrict.ok(/försök igen/i.test(out2));
});

// --- Filter-logik --------------------------------------------------------

function makeEvent(startIso) {
  return {
    id: `evt-${startIso}`,
    start_time: startIso,
    lat: 59.3293,
    lng: 18.0686,
    title_sv: 'Test',
  };
}

const NOW = new Date('2026-10-04T12:00:00Z');
const ISO_FUTURE_TODAY = '2026-10-04T20:00:00Z'; // senare idag
const ISO_FUTURE_TOMORROW = '2026-10-05T20:00:00Z';
const ISO_PAST = '2026-10-01T20:00:00Z';

test('filter: today behåller dagens framtida events, droppar dåtid', () => {
  const events = [
    makeEvent(ISO_FUTURE_TODAY),
    makeEvent(ISO_FUTURE_TOMORROW),
    makeEvent(ISO_PAST),
  ];
  const out = helpers.filterEventsByMode(events, 'today', NOW);
  const ids = out.map((e) => e.id);
  assertStrict.ok(ids.includes(`evt-${ISO_FUTURE_TODAY}`));
  assertStrict.ok(!ids.includes(`evt-${ISO_FUTURE_TOMORROW}`));
  assertStrict.ok(!ids.includes(`evt-${ISO_PAST}`));
});

test('filter: all returnerar alla framtida events, droppar dåtid', () => {
  const events = [
    makeEvent(ISO_FUTURE_TODAY),
    makeEvent(ISO_FUTURE_TOMORROW),
    makeEvent(ISO_PAST),
  ];
  const out = helpers.filterEventsByMode(events, 'all', NOW);
  const ids = out.map((e) => e.id);
  assertStrict.ok(ids.includes(`evt-${ISO_FUTURE_TODAY}`));
  assertStrict.ok(ids.includes(`evt-${ISO_FUTURE_TOMORROW}`));
  assertStrict.ok(!ids.includes(`evt-${ISO_PAST}`));
});

test('filter: today ≤ weekend ≤ next_weekend ≤ all (monotonicitet)', () => {
  const events = [
    makeEvent(ISO_FUTURE_TODAY),
    makeEvent(ISO_FUTURE_TOMORROW),
    makeEvent('2026-10-10T20:00:00Z'),
    makeEvent('2026-11-15T20:00:00Z'),
  ];
  const today = helpers.filterEventsByMode(events, 'today', NOW).length;
  const weekend = helpers.filterEventsByMode(events, 'weekend', NOW).length;
  const next = helpers.filterEventsByMode(events, 'next_weekend', NOW).length;
  const all = helpers.filterEventsByMode(events, 'all', NOW).length;
  assertStrict.ok(today <= weekend);
  assertStrict.ok(weekend <= next);
  assertStrict.ok(next <= all);
});

test('computeCountsByMode returnerar samma värden som enskilda filter-anrop', () => {
  const events = [
    makeEvent(ISO_FUTURE_TODAY),
    makeEvent(ISO_FUTURE_TOMORROW),
  ];
  const counts = helpers.computeCountsByMode(events, helpers.FILTER_MODES, NOW);
  for (const mode of helpers.FILTER_MODES) {
    const direct = helpers.filterEventsByMode(events, mode, NOW).length;
    assertStrict.equal(counts[mode], direct, `count mismatch for ${mode}`);
  }
});

test('filter: tom input → tom output', () => {
  const out = helpers.filterEventsByMode([], 'weekend', NOW);
  assertStrict.equal(out.length, 0);
});

test('filter: input med ogiltiga datum filtreras bort', () => {
  const events = [
    { id: 'invalid', start_time: 'not-a-date', lat: 59, lng: 18 },
    makeEvent(ISO_FUTURE_TODAY),
  ];
  const out = helpers.filterEventsByMode(events, 'all', NOW);
  // Ogiltika dates kommer från `new Date(...).getTime() = NaN`, jämförelser
  // blir false → events med ogiltigt datum kommer INTE matchas.
  const ids = out.map((e) => e.id);
  assertStrict.ok(!ids.includes('invalid'));
});

// --- Live data -----------------------------------------------------------

test('live: events_public har 1000+ framtida events', async () => {
  const events = await fetchLiveFutureEvents();
  assertStrict.ok(
    events.length >= 1000,
    `förväntade 1000+ events, fick ${events.length}`,
  );
});

test('live: ≥95% av events har numerisk lat/lng (mappable till Marker)', async () => {
  const events = await fetchLiveFutureEvents();
  const mappable = events.filter(
    (e) => Number.isFinite(e.lat) && Number.isFinite(e.lng),
  );
  const ratio = mappable.length / events.length;
  assertStrict.ok(
    ratio >= 0.95,
    `bara ${(ratio * 100).toFixed(1)}% har numerisk lat/lng`,
  );
});

test('live: ≥90% av events inom Stockholm-bounds (lat 58.5–60.2, lng 16.8–19.4)', async () => {
  const events = await fetchLiveFutureEvents();
  const inBounds = events.filter(
    (e) =>
      e.lat >= 58.5 && e.lat <= 60.2 &&
      e.lng >= 16.8 && e.lng <= 19.4,
  );
  const ratio = inBounds.length / events.length;
  assertStrict.ok(
    ratio >= 0.90,
    `bara ${(ratio * 100).toFixed(1)}% inom Stockholm-bounds (förväntade ≥90%)`,
  );
});

test('live: filter-monotonicitet håller på riktig data', async () => {
  const events = await fetchLiveFutureEvents();
  const counts = helpers.computeCountsByMode(events, helpers.FILTER_MODES);
  assertStrict.ok(counts.today <= counts.weekend);
  assertStrict.ok(counts.weekend <= counts.next_weekend);
  assertStrict.ok(counts.next_weekend <= counts.all);
});

test('live: alla fyra lägen returnerar rimligt antal (>0)', async () => {
  const events = await fetchLiveFutureEvents();
  const counts = helpers.computeCountsByMode(events, helpers.FILTER_MODES);
  for (const mode of helpers.FILTER_MODES) {
    assertStrict.ok(
      counts[mode] > 0,
      `mode ${mode} returnerade 0 events (förväntade >0)`,
    );
  }
});

test('live: filtrerade events är mappable till Marker-coordinates', async () => {
  const events = await fetchLiveFutureEvents();
  const filtered = helpers.filterEventsByMode(events, 'weekend');
  // Simulerar samma mappning som i AppleMapsScreen.js
  const markers = filtered.map((e) => ({
    key: e.id,
    coordinate: { latitude: e.lat, longitude: e.lng },
    title: e.title_sv || e.title_en || 'Event',
  }));
  assertStrict.equal(markers.length, filtered.length);
  for (const m of markers.slice(0, 50)) {
    assertStrict.ok(Number.isFinite(m.coordinate.latitude));
    assertStrict.ok(Number.isFinite(m.coordinate.longitude));
    assertStrict.equal(typeof m.title, 'string');
    assertStrict.ok(m.title.length > 0);
  }
});