#!/usr/bin/env node
/**
 * verify-extractor-object-fields.mjs — bevis för JSON-LD-objektfält.
 *
 * Schemans JSON-LD anger ofta ett OBJEKT där vi väntar en sträng:
 *   organizer: { "@type": "Organization", "name": "Stockholm Live" }
 *   location: { "@type": "Place", "name": "Oscarsteatern",
 *               "address": { "@type": "PostalAddress", "streetAddress": "…" } }
 *
 * `norm()` gjorde `String(obj)` → '[object Object]'. Mätt på de riktiga
 * körningarna: 599 rader i 21 orelaterade källor bar det i venue/address/
 * organizer/performers, varav 250 var framtida events som landade i databasen.
 *
 * Mönstret är General (21 domäner, inte en sajt) — därför sitter fixen i den
 * generella normaliseringen och inte i någon källspecifik adapter.
 *
 * IDs:
 *   e1 — extraktorn läser objektfälten korrekt (venue/address/organizer/city)
 *   e2 — negativ kontroll: utan fixen kommer '[object Object]' (gaten kan faila)
 *   e3 — inga '[object Object]' kvar i databasens venue_full_-fält
 *
 * Anropas som `node scripts/verify-extractor-object-fields.mjs <e1|e2|e3>`.
 * Skriver ut `eN: <status> pass` på stdout vid PASS, annars `eN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 *
 * Testerna använder INTE verkliga sajter: JSON-LD-blocket nedan är en
 * syntetisk men schema.org-korrekt representation av formen ovan.
 */

import fs from 'node:fs';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

const EXTRACTOR = path.join(ROOT, '02-Ingestion/F-eventExtraction/universal-extractor.ts');

/** Kopian som simulerar "fixen finns inte" — ligger i samma katalog så att
 *  de relativa importerna i universal-extractor.ts fortfarande löser sig. */
const NEGATIVE_CONTROL = path.join(
  ROOT,
  '02-Ingestion/F-eventExtraction/.gate-negative-control.ts',
);

/** Neutral domän: källspecifika adaptrar (biljettshop, folkoperan, ...) fångar
 *  sina egna värden först. Här vill vi den GENERELLA JSON-LD-vägen. */
const BASE_URL = 'https://exempel-venue.se/kalender';
const SOURCE_ID = 'exempel-venue';

const FIXED_NORM = `    return typeof name === 'string' ? name.trim() : '';`;
const OLD_NORM = `    return String(val);`;

const OBJECT_FIELDS_JSONLD = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Chicago - the Musical",
    "startDate": "2026-11-14T19:30",
    "url": "https://biljettshop.se/sv/chicago-the-musical-2026-11-14/",
    "organizer": {
      "@type": "Organization",
      "name": "Stockholm Live",
      "url": "https://www.stockholmlive.se"
    },
    "location": {
      "@type": "Place",
      "name": "Oscarsteatern",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Birger Jarlsgatan 57",
        "addressLocality": "Stockholm"
      }
    }
  }
  </script>
</head>
<body></body>
</html>`;

const FLAT_ADDRESS_JSONLD = `<!doctype html>
<html lang="sv">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Formex trender",
    "startDate": "2026-11-20",
    "venue": { "@type": "Place", "name": "Formex scen, A20" },
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Kistagatan 4",
      "addressLocality": "Stockholm"
    }
  }
  </script>
</head>
<body></body>
</html>`;

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

// ── Kör den riktiga extraktorn mot ett fixture ─────────────────────────────

/**
 * Kör universal-extractor.ts (eller en angiven modul) mot fixtures och
 * returnera de extraherade raderna.
 */
function runExtractor(modulePath) {
  const probe = `
import { extractEvents } from ${JSON.stringify(modulePath)};
const OBJECT_FIELDS = ${JSON.stringify(OBJECT_FIELDS_JSONLD)};
const FLAT = ${JSON.stringify(FLAT_ADDRESS_JSONLD)};
const BASE = ${JSON.stringify(BASE_URL)};
const SOURCE = ${JSON.stringify(SOURCE_ID)};
const pick = (ev) => ({
  venue: ev.venue ?? null,
  address: ev.address ?? null,
  city: ev.city ?? null,
  organizer: ev.organizer ?? null,
});
const out = {
  objectFields: extractEvents(OBJECT_FIELDS, SOURCE, BASE).events.map(pick),
  flatAddress: extractEvents(FLAT, SOURCE, BASE).events.map(pick),
};
console.log('###RESULT###' + JSON.stringify(out));
`;
  const probePath = path.join(path.dirname(modulePath), `.gate-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe, 'utf8');
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (res.status !== 0) {
      return { error: `tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 400)}` };
    }
    const line = (res.stdout || '').split('###RESULT###')[1];
    if (!line) {
      return { error: `proben skrev ingen resultatrad: ${(res.stdout || '').trim().slice(0, 300)}` };
    }
    return { data: JSON.parse(line.trim()) };
  } catch (e) {
    return { error: `tsx-probe kastade: ${e?.message ?? e}` };
  } finally {
    rmSync(probePath, { force: true });
  }
}

/**
 * Bygg en kopia av extraktorn där objektfält-fixen är ÅTERFÖRD — så att
 * negativa kontrollen mäter en riktig regression, inte ett syntaxfel.
 */
function writeNegativeControl() {
  if (!existsSync(EXTRACTOR)) return { error: `extraktorn saknas: ${EXTRACTOR}` };
  const src = readFileSync(EXTRACTOR, 'utf8');
  const occurrences = src.split(FIXED_NORM).length - 1;
  if (occurrences !== 1) {
    return {
      error:
        `negativ kontroll ogiltig: fixen hittades ${occurrences} gånger i extraktorn ` +
        `(förväntat exakt 1) — filen har ändrats sedan gaten skrevs`,
    };
  }
  writeFileSync(NEGATIVE_CONTROL, src.split(FIXED_NORM).join(OLD_NORM), 'utf8');
  return { ok: true };
}

// ── E1: extraktorn läser objektfälten ──────────────────────────────────────

function e1() {
  if (!existsSync(EXTRACTOR)) return fail(`e1: FAIL extraktorn saknas: ${EXTRACTOR}`);
  const probe = runExtractor(EXTRACTOR);
  if (probe.error) return fail(`e1: FAIL ${probe.error}`);
  const d = probe.data;

  const problems = [];
  for (const ev of d.objectFields ?? []) {
    if (ev.venue !== 'Oscarsteatern') problems.push(`venue=${JSON.stringify(ev.venue)} (förväntat "Oscarsteatern")`);
    if (ev.address !== 'Birger Jarlsgatan 57') problems.push(`address=${JSON.stringify(ev.address)}`);
    if (ev.organizer !== 'Stockholm Live') problems.push(`organizer=${JSON.stringify(ev.organizer)}`);
  }
  for (const ev of d.flatAddress ?? []) {
    if (ev.venue !== 'Formex scen, A20') problems.push(`venue=${JSON.stringify(ev.venue)} (platt form)`);
    if (ev.address !== 'Kistagatan 4') problems.push(`address=${JSON.stringify(ev.address)} (platt form)`);
    if (ev.city !== 'Stockholm') problems.push(`city=${JSON.stringify(ev.city)} (platt form)`);
  }
  if ((d.objectFields ?? []).length === 0) problems.push('inga events extraherades ur location-objektet');
  if ((d.flatAddress ?? []).length === 0) problems.push('inga events extraherades ur platt venue-objekt');

  const all = JSON.stringify(d);
  if (all.includes('[object Object]')) problems.push('fältet innehåller fortfarande "[object Object]"');

  if (problems.length > 0) {
    return fail(`e1: FAIL ${problems.join(' | ')}`);
  }
  return ok('e1: extraktorn läser location/organizer/address som objekt pass');
}

// ── E2: negativ kontroll — gaten kan faila ─────────────────────────────────

function e2() {
  const built = writeNegativeControl();
  if (built.error) return fail(`e2: FAIL ${built.error}`);
  // Städa ALLTID före fail(): fail() anropar process.exit(), som annars
  // hoppar över finally och lämnar negativkontrollen kvar i repot.
  let probe;
  try {
    probe = runExtractor(NEGATIVE_CONTROL);
  } finally {
    rmSync(NEGATIVE_CONTROL, { force: true });
  }
  if (probe.error) return fail(`e2: FAIL negativ kontroll kastade i stället för att ge skräp: ${probe.error}`);
  const all = JSON.stringify(probe.data);
  if (!all.includes('[object Object]')) {
    return fail(
      'e2: FAIL negativ kontroll PASSADE — en extraktor utan fixen gav ändå inget "[object Object]". ' +
        'Gaten mäter alltså ingenting.',
    );
  }
  return ok('e2: negativ kontroll ger "[object Object]" utan fixen — gaten kan faila pass');
}

// ── E3: inga artefakter kvar i databasen ───────────────────────────────────

async function supabaseCount(query) {
  const env = {};
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing i .env' };
  const res = await fetch(`${url}/rest/v1/events?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const cr = res.headers.get('content-range') ?? '';
  const count = Number(cr.split('/')[1] ?? 0);
  return { count: Number.isFinite(count) ? count : 0 };
}

async function e3() {
  const bad = await supabaseCount(
    'select=id&venue_full_name=eq.%5Bobject%20Object%5D',
  );
  if (bad.error) return fail(`e3: FAIL ${bad.error}`);
  const badAddr = await supabaseCount(
    'select=id&venue_full_address=eq.%5Bobject%20Object%5D',
  );
  if (badAddr.error) return fail(`e3: FAIL ${badAddr.error}`);
  if (bad.count > 0 || badAddr.count > 0) {
    return fail(
      `e3: FAIL databasen har ${bad.count} rader med venue_full_name='[object Object]' ` +
        `och ${badAddr.count} med venue_full_address='[object Object]'`,
    );
  }
  return ok('e3: inga "[object Object]" i venue_full_name/venue_full_address i databasen pass');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const gates = { e1, e2, e3 };
if (!gates[arg]) {
  console.error(`Användning: node scripts/verify-extractor-object-fields.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
await gates[arg]();
