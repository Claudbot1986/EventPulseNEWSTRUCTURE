/**
 * "Användbart datum" — har en extraherad rad ett datum som faktiskt kan sparas?
 *
 * Varför: 2026-10-24 — C-gaten räknade en extraherad rad som ett event bara
 * för att den fanns. Men importen (03-Queue/importToEventPulse.ts) kastar
 * bort rader som är datumlösa eller som ligger i det förflutna
 * (isEventPast). En källa som bara gav 8 datumlösa rader rapporterades
 * därför som "extract_success / 8 events" och skrev en fil som importen
 * sedan kastade bort hela. Källan såg levande ut i dashboarden men gav
 * noll rader i databasen.
 *
 * Samma definition som importen använder — `eventStartTime` + `isEventPast`.
 * Två definitioner kan glida isär, och då ljuger gaten igen.
 */

import { isEventPast } from '../../03-Queue/eventFreshness';

/** Minimal struktur som både ParsedEvent och AiExtractedEvent uppfyller. */
export interface DateableEvent {
  date?: string | null;
  time?: string | null;
  start_time?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  endTime?: string | null;
  [key: string]: unknown;
}

/** "YYYY-MM-DD" */
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "HH:MM" */
const TIME_RX = /^(\d{2}):(\d{2})$/;

/**
 * Är år/månad/dag en VERKLIG kalenderdag?
 *
 * Date.parse("2026-02-30") rullar över till 2026-03-02 utan att klaga.
 * En omöjlig dag blev därför tyst en annan dag — och eftersom den rullade
 * framåt räknades raden som ett användbart framtida event. Delarna jämförs
 * därför mot den konstruerade dagen i stället för att bara syntaktiskt
 * matcha formatet.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Sant om värdet är ett "YYYY-MM-DD" som också är en verklig kalenderdag.
 */
export function isValidDateString(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const m = DATE_RX.exec(value.trim());
  if (!m) return false;
  return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Ett "YYYY-MM-DD" + valfri "HH:MM" blir en ISO-stämpel i UTC.
 *
 * 2026-10-24 — tre lagningar, alla provade mot verkliga rader:
 *  1. Datumet måste vara en verklig kalenderdag (se isRealCalendarDate).
 *     Ett trasigt datum ger tom stämpel → både gaten och importen kastar
 *     bort raden i stället för att ta fram ett påhittat datum.
 *  2. En trasig klocka ("19.00", "19", "kl 19") kastade förut ett
 *     TypeError — `time.split(':')` gav en del som `padStart` fick
 *    undefined. Nu tolkas raden som ett heldags-event: DAGEN är känd,
 *     klockan är det inte, så dagen behålls och ingen klocksaga luras på.
 *  3. Mellanslag runt datum och tid ignoreras.
 */
export function toIsoStartTime(date?: string | null, time?: string | null): string {
  const day = typeof date === 'string' ? date.trim() : '';
  if (!day) return '';
  if (!isValidDateString(day)) return '';

  const clock = typeof time === 'string' ? time.trim() : '';
  if (!clock) return `${day}T00:00:00.000Z`;

  const m = TIME_RX.exec(clock);
  if (!m) return `${day}T00:00:00.000Z`;
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return `${day}T00:00:00.000Z`;

  return `${day}T${m[1]}:${m[2]}:00.000Z`;
}

/**
 * Är detta en användbar ISO-stämpel?
 *
 * Måste börja med en verklig kalenderdag ("2026-11-20…") och gå att tolka
 * som tidpunkt. "unknown", "PT2H" och "2026-02-30T00:00:00.000Z" (den
 * sista rullar över till 2 mars) är alltså INTE användbara.
 */
function isUsableIsoStamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m || !isValidDateString(m[1])) return false;
  return Number.isFinite(Date.parse(s));
}

/**
 * Starttid för en rad — identisk med importens `extractStartTime`.
 * Fältordningen varierar mellan gater: C/A använder `date` + `time`,
 * B/D använder `start_time`/`startTime` (ISO med klockslag).
 *
 * 2026-10-24 — en trasig `start_time` ("unknown", "2026-02-30…") blockerar
 * inte längre en rad som har ett bra `date`+`time` under sig: stämpeln
 * hoppas över och nästa källa används. Ingen rad ska dö för att ett fält
 * råkade vara trasigt när ett annat fält bär rätt information.
 */
export function eventStartTime(ev: DateableEvent): string {
  for (const candidate of [ev.start_time, ev.startTime]) {
    if (isUsableIsoStamp(candidate)) return candidate.trim();
  }
  return toIsoStartTime(ev.date, ev.time);
}

/**
 * Sluttid från ett slutdatum + sluttid.
 *
 * 2026-10-24 — samma formatskydd som starttiden. En trasig slutklocka
 * ("19") gav undefined i `padStart` och kastade TypeError, vilket kastade
 * bort hela raden i importen trots att starttiden var bra. Nu: trasig
 * slutklocka → slutet av dagen (23:59:59), trasigt slutdatum → inget
 * slutdatum. Starttiden bär fortfarande raden.
 */
export function toIsoEndTime(endDate?: string | null, endTime?: string | null): string | null {
  const day = typeof endDate === 'string' ? endDate.trim() : '';
  if (!day) return null;
  if (!isValidDateString(day)) return null;

  const clock = typeof endTime === 'string' ? endTime.trim() : '';
  const m = clock ? TIME_RX.exec(clock) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return `${day}T23:59:59.000Z`;
  return `${day}T${m[1]}:${m[2]}:00.000Z`;
}

/**
 * Sluttid för en rad — speglar importens `extractEndTime`.
 *
 * 2026-10-24 — behövs för att ett PÅGÅENDE flerdagsevenemang ("23-28
 * oktober") ska överleva datumvakten: starten har passerat men evenemanget
 * pågår fortfarande. Slutdatumet är det som avgör.
 */
export function eventEndTime(ev: DateableEvent): string | null {
  for (const candidate of [ev.end_time, ev.endTime]) {
    if (isUsableIsoStamp(candidate)) return candidate.trim();
  }
  const day = typeof ev.endDate === 'string' ? ev.endDate.trim()
    : typeof ev.end_date === 'string' ? ev.end_date.trim()
    : '';
  if (!day) return null;
  const clock = typeof ev.endTime === 'string' ? ev.endTime.trim() : '';
  return toIsoEndTime(day, clock);
}

/**
 * Sant om raden har ett datum som överlever importens datumvakt —
 * alltså om den faktiskt kan hamna i databasen.
 */
export function hasUsableDate(ev: DateableEvent, nowMs: number = Date.now()): boolean {
  const start = eventStartTime(ev);
  if (!start) return false;
  return !isEventPast(start, nowMs, eventEndTime(ev));
}

/**
 * Antal rader som faktiskt kan sparas. Används av C-gaten för att
 * avgöra om en källa lyckades — en källa som bara ger datumlösa rader
 * har inte lyckats.
 */
export function countUsableEvents(events: DateableEvent[], nowMs: number = Date.now()): number {
  let count = 0;
  for (const ev of events) {
    if (hasUsableDate(ev, nowMs)) count++;
  }
  return count;
}

/** De rader som faktiskt kan sparas — resten filtreras bort. */
export function filterUsableEvents<T extends DateableEvent>(events: T[], nowMs: number = Date.now()): T[] {
  return events.filter((ev) => hasUsableDate(ev, nowMs));
}
