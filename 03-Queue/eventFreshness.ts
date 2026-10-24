/**
 * Datumvakt — "är det här eventet fortfarande relevant?"
 *
 * 2026-10-24 — BUGB hittad under en riktig körning. Importen och
 * normalizern filtrerade bort "gamla" events med:
 *
 *   const startMs = raw.start_time ? Date.parse(raw.start_time) : NaN;
 *   if (!Number.isFinite(startMs) || startMs < Date.now()) → skip
 *
 * Men ett heldags-event (bara datum, ingen tid) lagras av toIsoStartTime()
 * som "2026-10-24T00:00:00.000Z" — UTC-midnatt. Klockan passerade 00:00
 * UTC, alltså föll ALLA heldags-events för idag bort, trots att de pågår
 * hela dagen. Mätt på riktiga artefakter: 87 rader över 25 källor
 * (jarfalla.se, tekniskamuseet.se, nordiskamuseet.se, djurgarden.se,
 * kulturhusetstadsteatern.se, …). Bevisat med exempel: "Öppen Syateljé"
 * (upplevjarfalla.se) går 24 oktober – 12 december, alltså STARTAR idag.
 *
 * Semantik (samma i båda lagen):
 *   - Event med TID  → "past" när den tidpunkten passerat.
 *   - Heldags-event → gäller hela sin kalenderdag; "past" först efter
 *     midnatten på den dagen.
 *   - Saknat/ogiltigt datum → "past" (raden kan inte placeras i tiden).
 *
 * Kalenderdagen läses av DATUMDELEN i ISO-strängen, inte av den lokala
 * tidsstämpeln. Extractorn skriver venue-lokal kalenderdag ("idag" →
 * "2026-10-24"), så det är den som är semantiken — inte den UTC-moment
 * som midnight-stämpeln råkar peka på.
 */

/** Endast datum: "2026-10-24" */
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Datum + exakt midnatt: "2026-10-24T00:00:00.000Z" (även +02:00 / .0) */
const MIDNIGHT_ISO_RX = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Är detta ett heldags-event (ingen egentlig klockslag)?
 *
 * @param startTime ISO-sträng som importer/normalizer lagrar.
 */
export function isAllDayStart(startTime: string): boolean {
  return DATE_ONLY_RX.test(startTime) || MIDNIGHT_ISO_RX.test(startTime);
}

/**
 * Slutet av den lokala kalenderdagen (23:59:59.999 lokal tid).
 *
 * @param isoDate "YYYY-MM-DD"
 */
export function endOfLocalDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Ska raden hoppas över för att datumet passerat (eller saknas)?
 *
 * @param startTime start_time som den lagrades.
 * @param nowMs     referenstid (default: nu). Injicerbar för tester.
 */
export function isEventPast(startTime: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!startTime) return true;

  const startMs = Date.parse(startTime);
  if (!Number.isFinite(startMs)) return true;

  if (isAllDayStart(startTime)) {
    // Heldags-event: gäller till slutet av sin egen kalenderdag.
    return nowMs > endOfLocalDayMs(startTime.slice(0, 10));
  }

  return startMs < nowMs;
}
