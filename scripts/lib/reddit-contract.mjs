/**
 * reddit-contract.mjs — vad ska ett reddit-steg som inte svarade säga?
 *
 * VARFÖR (2026-10-28). Reddit är en VALFRI källa bland många. Men "valfri"
 * får inte bli "osynlig": en kedja som säger "klar" när nätet var dött är
 * exakt det fel hela den här ändringen finns för att döda.
 *
 * Två lägen, och de är helt olika:
 *
 *   ALLA sökningar misslyckades OCH inget HTTP-svar nådde oss → reddit
 *   nåddes ALDRIG. Det är ett transportfel. Kedjan ska veta det:
 *   exit 69 (EX_UNAVAILABLE). Inte "0 kandidater" — det var 18 försök som
 *   gick sönder.
 *
 *   ALLA sökningar misslyckades MED HTTP-svar → reddit NÅDDE fram och
 *   nekade (t.ex. 403). Världen är frisk, källan vägrar bara. Det är en
 *   försämring av en valfri källa: DEGRADED + exit 0.
 *
 *   NÅGRA misslyckades → reddit svarade, men inte på alla frågor. Det är en
 *   försämring av en valfri källa: DEGRADED + exit 0. De övriga stegen i
 *   kedjan fortsätter.
 *
 *   INGA misslyckades → reddit svarade. Antalet kandidater är ett RESULTAT,
 *   inte ett fel. 0 kandidater är en legitimt tom källa → exit 0.
 *
 * Skillnaden mellan "tom" och "trasig" är hela poängen: den gamla koden
 * räknade inte misslyckade sökningar alls, så 18 trasiga försök såg ut
 * som "reddit hade inget intressant".
 */

/**
 * @typedef {Object} RedditContract
 * @property {number} exitCode        0 = gå vidare, 69 = världen var trasig
 * @property {boolean} degraded       rapporteras som försämring (kedjan fortsätter)
 * @property {string} reason          kort förklaring, för loggen
 */

/**
 * Beräkna vad reddit-steget ska rapportera.
 *
 * @param {Object} input
 * @param {number} input.totalSearches     hur många sökningar som gjordes
 * @param {number} input.failures          hur många av dem misslyckades
 * @param {number} [input.transportFailures] hur många av felen var TRANSPORTfel
 *                                          (inget HTTP-svar nådde oss)
 * @returns {RedditContract}
 */
export function redditContract({ totalSearches, failures, transportFailures = 0 }) {
  const total = Number(totalSearches) || 0;
  const failed = Number(failures) || 0;
  const transport = Number(transportFailures) || 0;

  if (failed <= 0) {
    return { exitCode: 0, degraded: false, reason: 'inga misslyckade sökningar' };
  }
  if (total > 0 && failed >= total) {
    // Alla sökningar misslyckades. Frågan är nu: nådde reddit fram?
    if (transport >= total) {
      return {
        exitCode: 69,
        degraded: false,
        reason: `alla ${total} sökningar misslyckades utan svar — reddit nåddes aldrig`,
      };
    }
    // Reddit svarade (t.ex. 403) men nekade. Världen är frisk — bara den
    // valfria källan saknas. Skulle detta räknas som transportfel går
    // kedjan röd varje natt för en källa som aldrig kommer att svara.
    return {
      exitCode: 0,
      degraded: true,
      reason: `alla ${total} sökningar nekades av reddit (HTTP-svar) — ingen data från källan`,
    };
  }
  return {
    exitCode: 0,
    degraded: true,
    reason: `${failed} av ${total} sökningar misslyckades — reddit svarade delvis`,
  };
}
