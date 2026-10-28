#!/usr/bin/env node
/**
 * verify-ledger-evidence.mjs — GATE L7: ledgerbeviset skrivs, och gaten
 * som kontrollerar det fångar den bugg den byggdes för.
 *
 * VARFÖR (2026-10-28). Under tre nätter såg kedjan GRÖN ut medan ledger
 * stod kvar på 'queued'. Orsaken var ett stavnamn i dräneringen:
 * `markPersisted(ledger, persistedBySource)` när variabeln hette
 * `persistedByFile`. Felet kastades i en catch som bara loggade, och kedjans
 * klassificering läste loggraden som 'logic' — alltså grönt.
 *
 * Följden var inte bara "beviset saknas" — nästa natt hoppade importen
 * över de källorna, laddade upp samma events igen, och kön växde mononton
 * medan dräneringen inte hann med. Kedjan skrev "klart" varje natt.
 *
 * DENNA GATE har två delar:
 *
 *   1. NEGATIVA KONTROLLER — verifierar att detektorn FÅNAR den ordagranna
 *      felraden från buggen, och att den INTE larmar på informationsrader.
 *      Utan den delen är gaten värdelös: en detektor som inte fångar
 *      felet ger samma gröna ljus som ingen detektor alls.
 *
 *   2. LIVE-LEDGERN — mäter den faktiska filen. En rad i 'queued' med ett
 *      krav (`jobs > 0`) betyder: importen köade jobb, dräneringen har inte
 *      bevisat att de persisterades. Sådana rader är både en skuld (events
 *      som kan försvinna om Redis dör) och ett tecken på att bevisvägen
 *      inte fungerar.
 *
 * Användning:
 *   node scripts/verify-ledger-evidence.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  ledgerStates,
  ledgerFailureLines,
  queuedGrewWithoutEvidence,
} from './lib/ledger-inspect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LEDGER_PATH = path.join(PROJECT_ROOT, 'runtime', 'import-ledger.jsonl');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

let ok = true;
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`);
  ok = false;
};
const info = (msg) => console.log(`  ${msg}`);

/**
 * Den ORDAGRANNA felraden som drainen skrev under buggen.
 *
 * Det här är inte en uppfinning — det är raden som faktiskt stod i
 * `runtime/ingestion-cron/steps/worker-drain-*.log` under nätterna
 * 26–28 okt. Utan den exakta texten vore negativa kontrollen värdelös:
 * mönstret måste matcha den rad som verkligen förekom.
 */
const REAL_DRAIN_FAILURE_LINE =
  '[drain] DEGRADED kunde inte uppdatera ledger: persistedBySource is not defined ' +
  '— källorna stannar i "queued" och importeras om nästa natt';

/** Informationsrad som förekommer i varje lyckad körning — får INTE larma. */
const INFO_LINE = '[drain] ledger: 5 källor markerade som persisterade';

console.log('[verify-ledger-evidence] del 1 — negativa kontroller av detektorn');

// Negativ kontroll 1: den faktiska felet måste fångas.
const caught = ledgerFailureLines(REAL_DRAIN_FAILURE_LINE);
if (caught.length === 0) {
  fail('detektorn fångar INTE den faktiska felraden från stavnamnsbuggen — gaten är värdelös');
} else {
  info(`negativ kontroll OK: den ordagranna felraden fångas (${caught.length} träff)`);
}

// Negativ kontroll 2: importens felrad måste också fångas.
const caughtImport = ledgerFailureLines('  [ledger] DEGRADED kunde inte skriva ledger: EACCES');
if (caughtImport.length === 0) {
  fail('detektorn fångar INTE importens felrad');
} else {
  info('negativ kontroll OK: importens felrad fångas');
}

// Negativ kontroll 3: informationsrader får INTE ge larm.
const falsePositives = ledgerFailureLines(INFO_LINE);
if (falsePositives.length > 0) {
  fail(`detektorn larmar på en informationsrad — ${falsePositives.length} falska träffar`);
} else {
  info('negativ kontroll OK: informationsrader ger inget larm');
}

// Negativ kontroll 4: queued-tillväxt utan bevis måste flaggas, men oförändrat
// queued får inte flaggas.
const base = { total: 10, persisted: 10, queued: 0, empty: 0, failed: 0 };
const grown = { ...base, queued: 2, persisted: 8 };
const unchanged = { ...base, queued: 0, persisted: 10 };
if (!queuedGrewWithoutEvidence(base, grown, 50)) {
  fail('detektorn missar att "queued" växter trots slutförda jobb');
} else if (queuedGrewWithoutEvidence(base, unchanged, 50)) {
  fail('detektorn larmar trots att beviset skrevs');
} else {
  info('negativ kontroll OK: queued-tillväxt utan bevis flaggas, oförändrat queued inte');
}

console.log('\n[verify-ledger-evidence] del 2 — live-ledgern');

if (!fs.existsSync(LEDGER_PATH)) {
  fail(`ledgerfilen saknas: ${path.relative(PROJECT_ROOT, LEDGER_PATH)}`);
} else {
  const counts = ledgerStates(LEDGER_PATH);
  info(
    `${counts.total} rader: persisted=${counts.persisted} queued=${counts.queued} ` +
      `empty=${counts.empty} failed=${counts.failed}`,
  );

  // Rader i 'queued' med ett KRAV (jobs > 0) saknar bevis. En sådan rad
  // importeras om nästa natt (konservativt) men eventsen kan försvinna om
  // Redis dör utan persistence — och fram till dess importeras samma källa
  // igen varje natt, vilket får kön att växa.
  const unproven = [];
  const raw = fs.readFileSync(LEDGER_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof row?.sourceId !== 'string') continue;
    const state = row.state ?? 'queued';
    const jobs = Number(row.jobs ?? 0);
    if (state === 'queued' && jobs > 0) unproven.push(`${row.sourceId}(jobs=${jobs})`);
  }

  if (unproven.length > 0) {
    fail(
      `${unproven.length} rad(er) står i "queued" trots att importen köade jobb för dem — ` +
        'beviset skrevs inte. Exempel: ' +
        unproven.slice(0, 5).join(', '),
    );
  } else if (counts.persisted === 0 && counts.total > 0) {
    fail('ingen rad är "persisted" — bevisvägen har aldrig fungerat');
  } else {
    info(`inga obevisade rader — ${counts.persisted} källor har bevis på att deras events persisterades`);
  }
}

console.log(ok ? '\n[verify-ledger-evidence] GRÖN' : '\n[verify-ledger-evidence] RÖD');
process.exit(ok ? 0 : 1);
