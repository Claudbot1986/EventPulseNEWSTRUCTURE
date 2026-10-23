#!/usr/bin/env node
/**
 * cleanup-venue-object-artifacts.mjs — städa bort "[object Object]" ur venue-fälten.
 *
 * Bakgrund (2026-10-23): extraktorn skrev JSON-LD-objektfält med
 * `String(obj)` → venue/address blev '[object Object]'. Fixen finns i
 * universal-extractor.ts (gaten e1/e2 bevisar den), men de rader som redan
 * skrevs till databasen 2026-09-24 bar fortfarande skräpet.
 *
 * Varför en vanlig nyimport inte rättar det: normalizern sätter
 * venue_full_address till `undefined` när värdet är trasigt, och
 * `undefined` betyder "hoppa över kolumnen" för PostgREST. En befintlig
 * trasig adress skrivs alltså ALDRIG över — varken av en ny import eller av
 * en ny drain. Skräpet är permanent tills det städas bort.
 *
 * Vad scriptet gör:
 *   1. events.venue_full_name / venue_full_address == '[object Object]' →
 *      sätts till NULL, eller till värdet från en JOIN mot venues (bara när
 *      eventet redan bär ett giltigt venue-namn och joinen är entydig).
 *   2. events som pekar på en venue-rad med skräp → pekas om till den
 *      rätta venue-raden (via eventets eget venue_full_name).
 *   3. venue-rader med skräp i name/address raderas (när inga events pekar
 *      på dem).
 *
 * Varför NULL är ärligt och inte "tappar data": NULL betyder "okänd adress".
 * '[object Object]' är inte en adress. Rader som KAN få en riktig adress
 * (källor som fortfarande går genom pipelinen) får den vid nästa
 * re-extrahering — den normalizern skriver då över.
 *
 * Användning:
 *   node scripts/cleanup-venue-object-artifacts.mjs            # dry-run (default)
 *   node scripts/cleanup-venue-object-artifacts.mjs --apply    # skriv
 */

import fs from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

const BAD = '[object Object]';

/**
 * Artefaktmarkörer — värden som INTE kom från en källa utan från en
 * programmeringsmiss. Tom sträng räknas INTE hit: en venue-rad utan adress
 * är normalt, inte skräp.
 */
const ARTIFACT_MARKERS = new Set(['[object object]', '[object array]', 'undefined', 'null', 'none']);

function isArtifactText(value) {
  if (typeof value !== 'string') return false;
  return ARTIFACT_MARKERS.has(value.trim().toLowerCase());
}

/** Samma artefaktguard som normalizern använder (normalizer.ts:181-199). */
function isUsableText(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  return !isArtifactText(v);
}

function readEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  if (!existsSync(p)) return env;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnv();
const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('FAIL: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing i .env');
  process.exit(2);
}
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, { headers: HEADERS, ...init });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${pathAndQuery}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

async function getAll(table, query, columns) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await rest(
      `${table}?${query}`,
      { headers: { ...HEADERS, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } },
    );
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

async function patch(table, filter, body) {
  const res = await rest(`${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function del(table, filter) {
  const res = await rest(`${table}?${filter}`, {
    method: 'DELETE',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
  });
  return res.status;
}

// ── Steg 1: samla underlaget ───────────────────────────────────────────────

const enc = (v) => encodeURIComponent(v);

const venues = await getAll('venues', 'select=id,name,address,city,postal_code,lat,lng', 'id');
const venuesById = new Map(venues.map((v) => [v.id, v]));
const venuesByName = new Map();
for (const v of venues) {
  const key = (v.name || '').trim().toLowerCase();
  if (!key) continue;
  if (!venuesByName.has(key)) venuesByName.set(key, []);
  venuesByName.get(key).push(v);
}

// Venue-rader med ARTEFAKT i name/address (tom adress är inte artefakt).
const garbageVenues = venues.filter((v) => isArtifactText(v.name) || isArtifactText(v.address));
const garbageVenueIds = garbageVenues.map((v) => v.id);

// Events som antingen bär artefakten själva ELLER pekar på en venue-rad
// med artefakt — den andra gruppen har annars rena fält men en trasig FK.
const eventFilter = [
  `venue_full_name.eq.${enc(BAD)}`,
  `venue_full_address.eq.${enc(BAD)}`,
  ...(garbageVenueIds.length > 0 ? [`venue_id.in.(${garbageVenueIds.join(',')})`] : []),
].join(',');

const badEvents = await getAll(
  'events',
  `select=id,source,title_sv,venue_id,venue_full_name,venue_full_address&or=(${eventFilter})`,
  'id',
);

console.log(`events med artefakt: ${badEvents.length}`);
console.log(`venue-rader totalt: ${venues.length}`);

/**
 * Hitta den ENDA venue-rad som eventets eget venue-namn pekar på.
 *
 * Sorterar på datakomplettelse (postnummer > ort > koordinater > adress) så
 * att dubbletten "Kungsgatan, 111 22" (postnummer saknas) inte vinner över
 * "Kungsgatan 63" (postnummer 111 22). En otydlig join ger NULL i stället
 * för en gissning.
 */
function resolveVenueJoin(venueFullName) {
  if (!isUsableText(venueFullName)) return null;
  const candidates = (venuesByName.get(venueFullName.trim().toLowerCase()) || []).filter(
    (v) => isUsableText(v.name) && isUsableText(v.address),
  );
  if (candidates.length === 0) return null;
  const score = (v) =>
    (v.postal_code ? 4 : 0) + (v.city ? 2 : 0) + (v.lat != null && v.lng != null ? 1 : 0);
  const sorted = [...candidates].sort((a, b) => score(b) - score(a));
  if (sorted.length > 1 && score(sorted[0]) === score(sorted[1])) {
    console.log(`  Otydlig join för "${venueFullName}" (${sorted.length} kandidater) → NULL`);
    return null;
  }
  return sorted[0];
}

// ── Steg 2: planera ändringarna ─────────────────────────────────────────────

const eventFixes = new Map(); // id → { body, note }
const venueRepoint = new Map(); // gammal venueId → ny venueId

for (const ev of badEvents) {
  const body = {};
  const notes = [];

  if (ev.venue_full_name === BAD) {
    body.venue_full_name = null;
    notes.push('name→NULL');
  }
  if (ev.venue_full_address === BAD) {
    body.venue_full_address = null;
    notes.push('address→NULL');
  }

  // Pekar eventet på en venue-rad med skräp? Då ska den ompekas.
  const currentVenue = ev.venue_id ? venuesById.get(ev.venue_id) : null;
  const currentIsGarbage =
    currentVenue && (isArtifactText(currentVenue.name) || isArtifactText(currentVenue.address));

  if (currentIsGarbage) {
    const join = resolveVenueJoin(ev.venue_full_name);
    if (join) {
      body.venue_id = join.id;
      venueRepoint.set(currentVenue.id, join.id);
      notes.push(`venue_id ${currentVenue.id.slice(0, 8)}→${join.id.slice(0, 8)}`);
      // Eventets egen adress vinner om den är giltig; annars hämtas den ur
      // den rätta venue-raden.
      if (!isUsableText(ev.venue_full_address)) {
        body.venue_full_address = join.address;
        notes.push('address←venue-rad');
      }
    } else {
      body.venue_id = null;
      notes.push('venue_id→NULL (ingen entydig join)');
    }
  } else if (!currentVenue && isUsableText(ev.venue_full_name)) {
    // Eventet har ett giltigt platsnamn men ingen venue-rad. Joina om det
    // går entydigt — annars lämnas venue_id som den är.
    const join = resolveVenueJoin(ev.venue_full_name);
    if (join && body.venue_full_address === null) {
      body.venue_id = join.id;
      body.venue_full_address = join.address;
      notes.push(`venue_id→${join.id.slice(0, 8)} + address←venue-rad`);
    }
  }

  if (Object.keys(body).length > 0) {
    eventFixes.set(ev.id, { body, notes: notes.join(', ') });
  }
}

// Venue-rader med ARTEFAKT som ska raderas (när inget event pekar på dem kvar).
const stillReferenced = new Set();
for (const ev of badEvents) {
  const target = eventFixes.get(ev.id);
  if (target?.body?.venue_id) stillReferenced.add(target.body.venue_id);
}
const deletableVenues = garbageVenues.filter((v) => !stillReferenced.has(v.id));

// ── Steg 3: rapportera / skriv ─────────────────────────────────────────────

console.log(`\n=== PLAN ===`);
console.log(`events att skriva om: ${eventFixes.size}`);
const noteCounts = {};
for (const f of eventFixes.values()) noteCounts[f.notes] = (noteCounts[f.notes] || 0) + 1;
for (const [n, c] of Object.entries(noteCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${c}  ${n}`);
console.log(`venue-rader med skräp: ${garbageVenues.length} (${garbageVenues.map((v) => v.id.slice(0, 8)).join(', ')})`);
console.log(`venue-rader att radera: ${deletableVenues.length}`);

if (!APPLY) {
  console.log('\n(dry-run — inget skrevs. Kör med --apply för att skriva.)');
  process.exit(0);
}

// ── Steg 4: skriv ───────────────────────────────────────────────────────────

let written = 0;
for (const [id, fix] of eventFixes) {
  await patch('events', `id=eq.${id}`, fix.body);
  written++;
}
console.log(`events uppdaterade: ${written}`);

let deleted = 0;
for (const v of deletableVenues) {
  // Sista kontrollen: inget event får peka på raden som raderas.
  const res = await rest(`events?select=id&venue_id=eq.${v.id}`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  const count = Number((res.headers.get('content-range') || '').split('/')[1] || 0);
  if (count > 0) {
    console.log(`  hoppar över radering av ${v.id.slice(0, 8)} — ${count} events pekar fortfarande på den`);
    continue;
  }
  await del('venues', `id=eq.${v.id}`);
  deleted++;
  console.log(`  raderade venue-rad ${v.id}`);
}
console.log(`venue-rader raderade: ${deleted}`);

// ── Steg 5: verifiera själv ─────────────────────────────────────────────────

const leftName = await rest(`events?select=id&venue_full_name=eq.${enc(BAD)}`, {
  headers: { ...HEADERS, Prefer: 'count=exact' },
});
const leftAddr = await rest(`events?select=id&venue_full_address=eq.${enc(BAD)}`, {
  headers: { ...HEADERS, Prefer: 'count=exact' },
});
const leftVenueName = await rest(`venues?select=id&name=eq.${enc(BAD)}`, {
  headers: { ...HEADERS, Prefer: 'count=exact' },
});
const leftVenueAddr = await rest(`venues?select=id&address=eq.${enc(BAD)}`, {
  headers: { ...HEADERS, Prefer: 'count=exact' },
});
const n = (r) => Number((r.headers.get('content-range') || '').split('/')[1] || 0);
console.log(
  `\nEfter städning: events name=${n(leftName)} address=${n(leftAddr)} | venues name=${n(leftVenueName)} address=${n(leftVenueAddr)}`,
);
if (n(leftName) + n(leftAddr) + n(leftVenueName) + n(leftVenueAddr) > 0) {
  console.error('FAIL: artefakter kvar');
  process.exit(1);
}
console.log('PASS: inga "[object Object]" kvar');
