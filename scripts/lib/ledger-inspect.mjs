/**
 * ledger-inspect.mjs — granskning av import-ledgern.
 *
 * Varför (2026-10-28). Ledgern (`runtime/import-ledger.jsonl`) är kedjans
 * enda bevis på att events faktiskt nådde databasen: 'queued' betyder
 * "jobben ligger bara i Redis", 'persisted' betyder "dräneringen skrev dem".
 *
 * Under tre nätter såg kedjan GRÖN ut medan ledger stod kvar på 'queued'.
 * Orsaken var ett stavnamn i dräneringen: `markPersisted(ledger,
 * persistedBySource)` när variabeln hette `persistedByFile`. Felet kastades
 * i en catch som bara loggade, och kedjans klassificering läste loggraden
 * som 'logic' — alltså grönt. Beviset skrevs aldrig, och nästa natt hoppade
 * importen över källorna. Events försvann utan att en enda logg sa något.
 *
 * Det här modulen gör de två sakerna som skulle ha fångat det:
 *   1. Hitta loggrader som säger att ledgerbeviset inte skrevs.
 *   2. Räkna radernas tillstånd före/efter en körning.
 *
 * Modulen är ren (läser bara filer) och kan därför testas utan Redis.
 */

import fs from 'node:fs';

/**
 * Mönster som betyder "beviset skrevs inte" — dvs. att kedjan kan se GRÖN
 * ut utan att ledger faktiskt fördes framåt.
 *
 * De två feltexterna är exakta: de kommer från de två catch-blocken i
 * dräneringen respektive importen. Ingen substring som "ledger" generellt —
 * det skulle fånga onödiga träffar i informationsrader.
 */
export const LEDGER_FAILURE_PATTERNS = [
  /kunde inte uppdatera ledger/i,
  /kunde inte skriva ledger/i,
];

/**
 * Fördelning av ledger-radernas `state`.
 *
 * @typedef {{
 *   total: number,
 *   persisted: number,
 *   queued: number,
 *   empty: number,
 *   failed: number,
 * }} LedgerStateCounts
 */

/**
 * Räkna radernas tillstånd i en ledgerfil.
 *
 * En saknad eller trasig fil ger nollor — "vet inte", inte "inget fel".
 *
 * @param {string} ledgerPath
 * @returns {LedgerStateCounts}
 */
export function ledgerStates(ledgerPath) {
  /** @type {LedgerStateCounts} */
  const counts = { total: 0, persisted: 0, queued: 0, empty: 0, failed: 0 };
  if (!fs.existsSync(ledgerPath)) return counts;
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return counts;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue; // en trasig rad får inte stoppa räkningen
    }
    if (typeof row?.sourceId !== 'string') continue;
    counts.total += 1;
    if (row.state === 'persisted') counts.persisted += 1;
    else if (row.state === 'empty') counts.empty += 1;
    else if (row.state === 'failed') counts.failed += 1;
    else counts.queued += 1; // 'queued' och saknad state = inget bevis
  }
  return counts;
}

/**
 * Hittade en logg någon rad som betyder att ledgerbeviset inte skrevs?
 *
 * @param {string} output
 * @returns {string[]} de träffande raderna (trimmade)
 */
export function ledgerFailureLines(output) {
  const hits = [];
  for (const line of String(output ?? '').split('\n')) {
    if (LEDGER_FAILURE_PATTERNS.some((p) => p.test(line))) hits.push(line.trim());
  }
  return hits;
}

/**
 * Har antalet 'queued'-rader vuxit trots att dräneringen slutförde jobb?
 *
 * Det är signalen på att beviset inte skrevs: jobb kördes (de persisterades
 * i databasen), men ledger-raderna flippades inte till 'persisted'.
 *
 * @param {LedgerStateCounts} before
 * @param {LedgerStateCounts} after
 * @param {number} drainCompleted antal jobb dräneringen slutförde
 * @returns {boolean}
 */
export function queuedGrewWithoutEvidence(before, after, drainCompleted) {
  if (!Number.isFinite(drainCompleted) || drainCompleted <= 0) return false;
  return after.queued > before.queued;
}
