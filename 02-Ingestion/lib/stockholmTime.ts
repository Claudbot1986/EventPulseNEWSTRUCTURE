/**
 * stockholmTime — korrekt hantering av Stockholms-tid vid ingestion.
 *
 * Bakgrund (2026-10-07): Tidigare hade vi hårdkodat `+02:00` (CEST) i flera
 * ingestion-skript. Det är fel på vintern (ska vara `+01:00` CET) och dubbel-
 * skiftar källor som redan levererar UTC. Resultat: events hamnar 1–2 timmar
 * fel jämfört med vad källan visar.
 *
 * Rätt metod:
 *  - Om källan ger lokal ENGLISH/UTAN tidszons-suffix ("2026-10-14" eller
 *    "2026-10-14T19:30") → tolka som Europe/Stockholm → konvertera till UTC.
 *  - Om källan ger UTC ("2026-10-14T19:30:00Z") → låt den vara.
 *  - Om källan ger explicit offset (`+01:00`, `+02:00`) → lita på den.
 *
 * Lagringsformat i DB är `timestamptz` — vi vill alltid ha UTC ISO 8601
 * (slutar på `Z`) vid persist.
 *
 * Använder date-fns-tz som redan finns i dependencies.
 */

import { fromZonedTime, toZonedTime, format as formatTz } from 'date-fns-tz';

const STOCKHOLM_TZ = 'Europe/Stockholm';

/**
 * Detektera om en sträng redan har en tidszon (Z eller ±HH:MM).
 * Returnerar true om strängen innehåller Z eller ±HH:MM i tidsdelen.
 */
export function hasTimeZone(s: string | undefined | null): boolean {
  if (!s) return false;
  // Match Z eller ±HH:MM i slutet (eller före sekunder)
  return /Z$|[+-]\d{2}:\d{2}(:?\d{2})?$/.test(s.trim());
}

/**
 * Konvertera (datum, tid) till UTC ISO 8601, där (datum, tid) tolkas som
 * Stockholm-lokaltid. Om `date` redan har en tidszon returneras den
 * oförändrad (normaliserad till UTC).
 *
 * @param date YYYY-MM-DD eller ISO-sträng (med/utan tidzon)
 * @param time HH:MM eller HH:MM:SS — valfri. Om saknad: T00:00:00 lokal tid.
 * @returns ISO 8601 UTC (slutar på Z), eller null om input ogiltig.
 *
 * Exempel:
 *   toUtcIsoFromStockholm('2026-10-14', '19:30')
 *     → '2026-10-14T17:30:00.000Z'  (CEST, +02:00)
 *   toUtcIsoFromStockholm('2026-01-14', '19:30')
 *     → '2026-01-14T18:30:00.000Z'  (CET, +01:00)
 *   toUtcIsoFromStockholm('2026-10-14T19:30:00Z')
 *     → '2026-10-14T19:30:00.000Z'  (redan UTC)
 */
export function toUtcIsoFromStockholm(
  date: string | undefined | null,
  time?: string | null,
): string | null {
  if (!date) return null;
  const trimmed = date.trim();
  if (!trimmed) return null;

  // Om datum redan har tidzon: lita på det. Konvertera till ISO UTC om inte Z.
  if (hasTimeZone(trimmed)) {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Bygg "YYYY-MM-DDTHH:MM[:SS]" utan tidszon — tolka som Stockholm.
  const dateOnly = trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
  const timeOnly = time?.trim() || '00:00:00';
  // Normalisera tid till HH:MM:SS
  const timeNorm = timeOnly.length === 5 ? `${timeOnly}:00` : timeOnly;
  const localIso = `${dateOnly}T${timeNorm}`;

  try {
    // fromZonedTime tolkar en "naive" lokal tid i given zon → returnerar UTC Date.
    const utcDate = fromZonedTime(localIso, STOCKHOLM_TZ);
    if (isNaN(utcDate.getTime())) return null;
    return utcDate.toISOString();
  } catch {
    return null;
  }
}

/**
 * Konvertera en fullständig ISO-liknande sträng till UTC ISO. Om strängen
 * saknar tidszon antas Stockholm-lokaltid.
 */
export function toUtcIso(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (hasTimeZone(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Naive — tolka som Stockholm
  try {
    const utcDate = fromZonedTime(trimmed, STOCKHOLM_TZ);
    return isNaN(utcDate.getTime()) ? null : utcDate.toISOString();
  } catch {
    return null;
  }
}

/**
 * Tolka en datumsträng som ett UTC-instant — utan att gissa.
 *
 * - tz-medveten ("…Z", "…+02:00") → litas på, normaliseras till UTC
 * - naiv datetime ("2026-11-15T18:00:00") → Europe/Stockholm. Tiden MÅSTE
 *   delas av först: `toUtcIsoFromStockholm` hämtar tiden från en separat
 *   parameter och landar annars på midnatt.
 * - enbart datum ("2026-11-15") → Europe/Stockholm midnatt
 *
 * Används av B-gatens nätverks-extraherare, F-eventExtractions mappning och
 * ingestion-schedulern — alla tre läser samma slags datumsträngar och måste
 * tolka dem likadant.
 */
export function toUtcInstantFromString(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasTimeZone(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (trimmed.includes('T')) {
    const [datePart, timePart = ''] = trimmed.split('T');
    return toUtcIsoFromStockholm(datePart, timePart.slice(0, 5));
  }
  return toUtcIsoFromStockholm(trimmed);
}

/**
 * Datumet (YYYY-MM-DD) som ett UTC-instant har i Europe/Stockholm.
 *
 * Viktigt: ett kvällsevenem i Stockholm kl. 18:00 är 16:00Z samma dag, men
 * ett evenem kl. 00:30 är 23:30Z FÖREGÅENDE dag. `.split('T')[0]` på
 * UTC-strängen ger då fel datum — här används zonen.
 */
export function toStockholmDate(utcIso: string | undefined | null): string | null {
  if (!utcIso) return null;
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const zoned = toZonedTime(d, STOCKHOLM_TZ);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const day = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Debug-hjälpare: returnerar vilken offset (i minuter) som gäller för ett
 * visst datum i Europe/Stockholm. Användbart för tester.
 */
export function stockholmOffsetMinutes(dateIso: string): number {
  const utc = new Date(dateIso);
  // Använd Intl.DateTimeFormat för att ta reda på den lokala tiden i Stockholm
  // och räkna ut offset mot UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(utc);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const localAsUtcMs = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'), get('second'),
  );
  return Math.round((localAsUtcMs - utc.getTime()) / 60000);
}