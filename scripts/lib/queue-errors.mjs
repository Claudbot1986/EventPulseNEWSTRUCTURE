/**
 * queue-errors.mjs — gemensam hantering av köfel i ingest-scripts.
 *
 * Varför (2026-10-28). Nattet 26 okt skrev importen 583 KB identiska
 * felrader — en rad per event — och avslutade med exit 0. Två fel samman:
 *
 *   1. Ingen övre gräns på antalet felrader. Loggen växte proportionellt
 *      med antalet event, vilket gjorde felsökningen omöjlig och skapade
 *      583 KB-filer.
 *   2. exit 0. "Klart" betydde "inget kom in", vilket är den gröna ljugen
 *      som hela fail-fast-stremmen finns för att motverka.
 *
 * Den här modulen ger båda: högst MAX_SAMPLES provrader i loggen, och en
 * ärlig exit-kod när INGET kunde köas (då är felet ett fel, inte en
 * försämring). Delvis lyckade körningar (några rader köade, några fel)
 * avslutar med exit 0 men skriver sina fel till stderr — kedjan läser
 * stderr och klassar dem (transport/auth ⇒ röd, http/logic ⇒ grön med
 * noterad försämring).
 */

import { classifyError, exitCodeFor } from './net-error.mjs';

/**
 * @typedef {import('./net-error.mjs').ErrorClass} ErrorClass
 */

/** Så många felrader som skrivs ut innan resten bara räknas. */
export const MAX_SAMPLES = 3;

/** Prioritet — den värsta klassen vinner. */
const CLASS_PRIORITY = { empty: 0, logic: 1, http: 2, auth: 3, transport: 4 };

/**
 * @returns {{
 *   record: (error: unknown, label: string) => number,
 *   readonly count: number,
 *   readonly errorClass: ErrorClass | null,
 *   printSummary: (context?: string) => void,
 *   exitCode: (queued?: number) => number,
 * }}
 */
export function createQueueErrorTracker() {
  let count = 0;
  const samples = [];
  let worstClass = null;

  return {
    record(error, label) {
      count += 1;
      const cls = classifyError(error);
      if (worstClass === null || CLASS_PRIORITY[cls] > CLASS_PRIORITY[worstClass]) {
        worstClass = cls;
      }
      if (samples.length < MAX_SAMPLES) {
        const text = error instanceof Error ? error.message : String(error?.message ?? error);
        samples.push(`${label}: ${text}`);
      }
      return count;
    },

    get count() {
      return count;
    },

    get errorClass() {
      return worstClass;
    },

    /**
     * Skriver en BEGRÄNSAD sammanfattning till stderr.
     *
     * DEGRADED-markören sätter ribban mellan "röd" och "grön med noterad
     * försämring" — precis som planen anger:
     *
     *   transport/auth ⇒ INGEN markör. Kedjan ska se felet och gå röd.
     *   http/logic    ⇒ DEGRADED. Kedjan ser att steget var sämre än
     *                   utlovat, men steget gick inte sönder.
     *
     * Markören sätter på rubrikraden, inte på provraderna: provraderna
     * bär feltexten som kedjan klassar, och en markerad rad lyfts bort
     * ur klassningen. Hade markören suttit på provraderna hade ett
     * transportfel kunnat döljas i en "ofarlig" http/logic-sammanfattning.
     *
     * @param {string} [context]
     */
    printSummary(context = 'queue') {
      if (count === 0) return;
      const isHard = worstClass === 'transport' || worstClass === 'auth';
      const marker = isHard ? '' : ' DEGRADED';
      console.error(`[${context}]${marker} ${count} köfel (visar ${samples.length} av ${count}):`);
      for (const sample of samples) console.error(`  - ${sample}`);
      if (count > samples.length) {
        console.error(`  … ${count - samples.length} till fel inte utskrivna`);
      }
    },

    /**
     * Ärlig exit-kod.
     *
     * - inga fel ⇒ 0
     * - fel men något köades ⇒ 0 (kedjan får stderr och klassar själv)
     * - fel och inget köades ⇒ exit-kod för felklassen (transport ⇒ 69)
     *
     * @param {number} [queued]
     * @returns {number}
     */
    exitCode(queued = 0) {
      if (count === 0) return 0;
      if (queued > 0) return 0;
      return exitCodeFor(worstClass ?? 'logic');
    },
  };
}
