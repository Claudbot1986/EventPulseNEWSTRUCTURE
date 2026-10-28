/**
 * drainOutcome.mjs — vad ska dräneringen rapportera när den avslutar?
 *
 * VARFÖR (2026-10-28). Dräneringens avslutande bär två beslut som båda
 * var fel tidigare:
 *
 *   1. Om ledger-raderna får flippa till 'persisted'. Före detta krävdes
 *      att INGA jobb misslyckades — ett enda misslyckat försök (som retry
 *      räddade) höll hela kedjan från att markera en enda källa, så samma
 *      ~5 000 jobb importerades varje natt. Nu är beviset per källa: en källa
 *      markeras bara om dess körda jobb täcker det importeraren köade.
 *
 *   2. Vilken exitkod dräneringen avslutar med. Före detta avslutade
 *      dräneringen ALLTID med 0 — även när jobb förlorades. Kedjan klassar
 *      steget efter exitkoden, så förlusten var osynlig.
 *
 * Reglerna:
 *
 *   terminala misslyckanden → exitkod utifrån felets klass (69/77/70).
 *   kön INTE tom (maxMs/SIGTERM) → 75 (EX_TEMPFAIL). Kedjan vet att
 *                               dräneringen är ofullständig och ska köras
 *                               igen. Ledger får INTE flippa.
 *   kön tom, inga fel            → 0. Ledger får flippa (per källa).
 *
 * LEDGER OCH MISSLYCKANDEN (2026-10-28, tredje rundan).
 *
 *   Tidigare gällde ett GLOBALT villkor: ett enda terminalt misslyckat
 *   jobb höll ALLT från att flippa till 'persisted'. Följden var att
 *   `isAlreadyImported` underkände varje källa, och hela importen köades
 *   om varje natt — de ~5 000 jobb som redan persisterats laddades upp
 *   igen. Det var samma symptom som den ursprungliga nattenliga buggen.
 *
 *   Nu är beviset PER KÄLLA, och det finns redan i markPersisted():
 *   en rad får bara 'persisted' om de körda jobben för varje kanonisk
 *   källa i raden täcker det importeraren köade. En källa med ett
 *   terminalt misslyckat jobb täcker INTE sitt antal — den stannar i
 *   'queued' och importeras om. Övriga källor, som klarade sig, flippar
 *   som de ska.
 *
 *   Så ledgerEligible beror bara på om kön var tom — aldrig på om något
 *   gick fel. Att kö tom är nödvändigt (annars ligger jobben kvar), och
 *   täckningen per källa är det som avgör vem som får flippa.
 *
 * Modulen är beroendefri — reglerna kan testas utan Redis, utan BullMQ
 * och utan en riktig kö. (net-error.mjs är beroendefritt; queue.ts är det
 * INTE — den öppnar Redis-sockets vid import.)
 */

import { exitCodeFor } from '../scripts/lib/net-error.mjs';

/**
 * @typedef {Object} DrainOutcome
 * @property {number} exitCode        process.exit() — 0 = rent, 69/70/75/77 = fel
 * @property {boolean} ledgerEligible får ledger-rader flippa till 'persisted'
 * @property {string} reason          kort förklaring, för loggen
 */

/**
 * @param {Object} input
 * @param {boolean} input.queueEmpty     var kön tom när dräneringen avslutade?
 * @param {number}  [input.terminalFailures] jobb som misslyckades slutligt
 *                                           (alla försök förbrukade)
 * @param {string}  [input.errorClass]    felklass för de terminala felen
 * @returns {DrainOutcome}
 */
export function drainOutcome({ queueEmpty, terminalFailures = 0, errorClass = 'logic' }) {
  const terminal = Number(terminalFailures) || 0;

  // Kö tom är förutsättningen för att ledger överhuvudtaget får flippa:
  // annars ligger jobben kvar i Redis och "persisted" vore en lögn.
  // Täckningen PER KÄLLA sköts av markPersisted() — inte av detta villkor.
  const ledgerEligible = queueEmpty;

  if (terminal > 0) {
    return {
      exitCode: exitCodeFor(errorClass),
      ledgerEligible,
      reason: `${terminal} jobb misslyckades slutligt — källorna importeras igen`,
    };
  }

  if (!queueEmpty) {
    return {
      exitCode: 75,
      ledgerEligible: false,
      reason: 'dräneringen avslutades innan kön var tom — försök igen senare',
    };
  }

  return {
    exitCode: 0,
    ledgerEligible: true,
    reason: 'kön tom, inga misslyckade jobb',
  };
}
