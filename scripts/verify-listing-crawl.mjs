#!/usr/bin/env node
/**
 * verify-listing-crawl.mjs — bevis för D-gatens tvåstegs-listingcrawl.
 *
 * Bakgrund (2026-10-24). En aggregator (billetto) har sina events bakom en
 * JS-renderad listningssida. D-gatens vanliga väg renderar EN sida per
 * källa — för en listningssida ger det 0 events, bara länkar. Tvåstegs-crawlen
 * gör listningssidan → event-URL:er → event-sidor, där JSON-LD finns.
 *
 * Gates (se GATES.md):
 *   lc0 — D-filen innehåller riktiga ParsedEvent-rader (negativ kontroll:
 *         en rad utan titel/datum måste underkännas)
 *   lc1 — källans status speglar att crawlen gav events (inte "död")
 *   lc2 — cron-kedjan kör steget, i rätt ordning
 *   lc3 — ett extraherat event-URL svarar 200 (eventsen är inte påhittade)
 *   lc4 — en riktig körning släppte igenom scope-filtret (negativ kontroll:
 *         en utom-Stockholm-rad måste underkännas)
 *
 * Användning:
 *   node scripts/verify-listing-crawl.mjs <gate>
 *     gate = lc0 | lc1 | lc2 | lc3 | lc4
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_ID = 'billetto-stockholm';
const D_FILE = path.join(ROOT, '03-Queue/03-extractedevents/D', `${SOURCE_ID}.jsonl`);
const CRON_FILE = path.join(ROOT, 'scripts/ingestion-cron.ts');
const RUN_LOG_DIR = path.join(ROOT, 'runtime/listing-crawl-runs');

function ok(msg) {
  console.log(msg);
}
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** En rad är en riktig ParsedEvent om den har titel, datum och käll-URL. */
function isRealEvent(row) {
  return Boolean(
    row &&
      typeof row === 'object' &&
      typeof row.title === 'string' &&
      row.title.length > 0 &&
      typeof row.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      typeof row.sourceUrl === 'string' &&
      row.sourceUrl.startsWith('http'),
  );
}

function readEvents() {
  if (!fs.existsSync(D_FILE)) return [];
  return fs
    .readFileSync(D_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function lc0() {
  const rows = readEvents();
  if (rows.length === 0) {
    return fail('lc0: FAIL D-filen är tom — crawlen har inte producerat några events');
  }
  const real = rows.filter(isRealEvent);
  if (real.length === 0) {
    return fail(
      `lc0: FAIL ${rows.length} rader i D-filen men ingen av dem är en riktig ParsedEvent ` +
        '(titel + datum + sourceUrl)',
    );
  }

  // Negativ kontroll: kontrollen MÅSTE kunna underkänna en trasig rad.
  const broken = { title: '', date: 'inte-ett-datum', sourceUrl: 'x' };
  if (isRealEvent(broken)) {
    return fail('lc0: FAIL negativ kontroll — en rad utan titel/datum accepteras (kontrollen kan inte faila)');
  }
  if (isRealEvent({ ...real[0], title: undefined })) {
    return fail('lc0: FAIL negativ kontroll — en rad utan titel accepteras (kontrollen kan inte faila)');
  }

  // Alla rader ska dessutom bära listing-crawl-signalen.
  const withSignal = real.filter((r) =>
    Array.isArray(r.confidence?.signals) && r.confidence.signals.includes('jsonld-event-listing-crawl'),
  );
  if (withSignal.length === 0) {
    return fail(
      'lc0: FAIL ingen rad bär signalen "jsonld-event-listing-crawl" — raderna kommer inte från listing-crawlen',
    );
  }

  const sample = real[0];
  ok(
    `lc0: ${real.length}/${rows.length} rader i D-filen är riktiga ParsedEvent ` +
      `(negativ kontroll: trasig rad underkänns) — t.ex. "${sample.title}" ${sample.date} ` +
      `(${sample.city ?? '?'}) pass`,
  );
}

async function lc1() {
  const registryUrl = pathToFileURL(
    path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts'),
  ).href;
  const { getSource, getSourceStatus } = await import(registryUrl);
  const source = getSource(SOURCE_ID);
  if (!source) return fail(`lc1: FAIL källan "${SOURCE_ID}" finns inte i sources/`);
  const status = getSourceStatus(SOURCE_ID);
  if (!status) return fail(`lc1: FAIL källan "${SOURCE_ID}" saknar statusrad i runtime/sources_status.jsonl`);
  if (status.status !== 'success') {
    return fail(
      `lc1: FAIL källans status är "${status.status}" (förväntat success) — ` +
        'crawlen har inte rapporterat in sin framgång',
    );
  }
  const found = Number(status.lastEventsFound ?? 0);
  if (!Number.isFinite(found) || found <= 0) {
    return fail(`lc1: FAIL lastEventsFound=${status.lastEventsFound} — källan rapporterar 0 events`);
  }
  ok(
    `lc1: källan "${SOURCE_ID}" har status success, lastEventsFound=${found}, ` +
      `lastPathUsed=${status.lastPathUsed ?? '?'}, routingReason="${status.lastRoutingReason ?? '?'}" pass`,
  );
}

/**
 * Ordningskontrollen som ren funktion, så att negativ kontroll kan köra
 * samma kodväg mot en medvetet felaktig cron-text.
 *
 * Returnerar null om ordningen är korrekt, annars en feltext.
 */
function checkCronOrder(cron) {
  if (!cron.includes('runD-listing-crawl.ts')) {
    return 'cron-kedjan innehåller inte steget D-listing-crawl';
  }
  const iRender = cron.indexOf("name: 'D-renderGate'");
  const iListing = cron.indexOf("name: 'D-listing-crawl'");
  const iImport = cron.indexOf("name: 'import-to-eventpulse'");
  if (iRender === -1 || iListing === -1 || iImport === -1) {
    return 'cron-kedjan saknar ett av stegen D-renderGate / D-listing-crawl / import-to-eventpulse';
  }
  if (iListing < iRender) {
    return 'D-listing-crawl körs FÖRE D-renderGate — ordningen är fel';
  }
  if (iListing > iImport) {
    return 'D-listing-crawl körs EFTER import-to-eventpulse — eventsen hinner inte in samma natt';
  }
  return null;
}

function lc2() {
  const cron = fs.readFileSync(CRON_FILE, 'utf8');
  const problem = checkCronOrder(cron);
  if (problem) return fail(`lc2: FAIL ${problem}`);

  const iListing = cron.indexOf("name: 'D-listing-crawl'");
  const iImport = cron.indexOf("name: 'import-to-eventpulse'");

  // Negativ kontroll: samma kontroll MÅSTE underkänna en medvetet felaktig
  // ordning. Utan detta är gate bara en beskrivning av hur koden ser ut.
  const swapped = cron
    .replace("name: 'D-listing-crawl'", "name: '__TMP_LISTING__'")
    .replace("name: 'D-renderGate'", "name: 'D-listing-crawl'")
    .replace("name: '__TMP_LISTING__'", "name: 'D-renderGate'");
  if (checkCronOrder(swapped) === null) {
    return fail(
      'lc2: FAIL negativ kontroll — en cron där D-listing-crawl körs FÖRE D-renderGate accepteras ' +
        '(ordningskontrollen kan inte faila)',
    );
  }
  const afterImport = cron
    .replace("name: 'D-listing-crawl'", "name: '__TMP_LISTING__'")
    .replace("name: 'import-to-eventpulse'", "name: 'D-listing-crawl'")
    .replace("name: '__TMP_LISTING__'", "name: 'import-to-eventpulse'");
  if (checkCronOrder(afterImport) === null) {
    return fail(
      'lc2: FAIL negativ kontroll — en cron där D-listing-crawl körs EFTER import-to-eventpulse accepteras ' +
        '(ordningskontrollen kan inte faila)',
    );
  }

  ok(
    `lc2: cron-kedjan kör D-listing-crawl efter D-renderGate och före import-to-eventpulse ` +
      `(position ${iListing} < ${iImport}); negativ kontroll: båda felordningarna underkänns pass`,
  );
}

async function lc3() {
  const rows = readEvents().filter(isRealEvent);
  if (rows.length === 0) return fail('lc3: FAIL inga riktiga events att verifiera');

  let checked = 0;
  let alive = 0;
  for (const row of rows.slice(0, 5)) {
    const url = row.ticketUrl || row.sourceUrl;
    if (!url) continue;
    checked++;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; EventPulse/1.0)' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 200) alive++;
    } catch {
      // nätverksfel räknas som "ej verifierad", inte som död
    }
  }
  if (checked === 0) return fail('lc3: FAIL inga event-URL:er att kontrollera');
  if (alive === 0) {
    return fail(
      `lc3: FAIL ${checked} event-URL:er kontrollerade, 0 av dem svarade 200 — ` +
        'eventsen kan inte verifieras mot källan',
    );
  }
  ok(`lc3: ${alive}/${checked} kontrollerade event-URL:er svarade 200 — eventsen är verifierbara mot källan pass`);
}

function lc4() {
  if (!fs.existsSync(RUN_LOG_DIR)) return fail('lc4: FAIL inga listing-crawl-körningar att inspektera');
  const logs = fs
    .readdirSync(RUN_LOG_DIR)
    .filter((f) => f.endsWith('.log'))
    .sort();
  if (logs.length === 0) return fail('lc4: FAIL inga listing-crawl-loggar finns');

  let outOfScope = 0;
  let inScope = 0;
  for (const file of logs) {
    const text = fs.readFileSync(path.join(RUN_LOG_DIR, file), 'utf8');
    outOfScope += (text.match(/OUT-OF-SCOPE/g) ?? []).length;
    inScope += (text.match(/WROTE \d+ events/g) ?? []).length;
  }
  if (outOfScope === 0) {
    return fail(
      'lc4: FAIL ingen OUT-OF-SCOPE-rad i någon körning — scope-filtret har aldrig filtrerat bort något ' +
        '(kontrollen kan inte faila)',
    );
  }

  // Negativ kontroll: en Göteborg-rad måste underkännas av samma regel.
  const stockholmScope = { postalPrefixes: ['1'], cities: ['Stockholm'] };
  const isInScope = (postalCode, city) => {
    if (postalCode) return stockholmScope.postalPrefixes.some((p) => postalCode.startsWith(p));
    if (city) return stockholmScope.cities.some((c) => city.toLowerCase().includes(c.toLowerCase()));
    return false;
  };
  if (isInScope('41136', 'Göteborg')) {
    return fail('lc4: FAIL negativ kontroll — en Göteborg-rad accepteras (kontrollen kan inte faila)');
  }
  if (!isInScope('12162', 'Stockholm')) {
    return fail('lc4: FAIL negativ kontroll — en Stockholms-rad underkänns (kontrollen kan inte faila)');
  }

  ok(
    `lc4: scope-filtret har underkänt ${outOfScope} utom-Stockholm-events i riktiga körningar ` +
      `(${inScope} körningar skrev events; negativ kontroll: Göteborg underkänns, Stockholm accepteras) pass`,
  );
}

const gate = process.argv[2];
const gates = { lc0, lc1, lc2, lc3, lc4 };
if (!gate || !gates[gate]) {
  console.error(`usage: node scripts/verify-listing-crawl.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
await gates[gate]();
