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
  [key: string]: unknown;
}

/** Ett "YYYY-MM-DD" + valfri "HH:MM" blir en ISO-stämpel i UTC. */
export function toIsoStartTime(date?: string | null, time?: string | null): string {
  if (!date) return '';
  if (time) {
    const [h, m] = time.split(':');
    return `${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00.000Z`;
  }
  return `${date}T00:00:00.000Z`;
}

/**
 * Starttid för en rad — identisk med importens `extractStartTime`.
 * Fältordningen varierar mellan gater: C/A använder `date` + `time`,
 * B/D använder `start_time`/`startTime` (ISO med klockslag).
 */
export function eventStartTime(ev: DateableEvent): string {
  if (ev.start_time) return ev.start_time;
  if (ev.startTime) return ev.startTime;
  return toIsoStartTime(ev.date, ev.time);
}

/**
 * Sant om raden har ett datum som överlever importens datumvakt —
 * alltså om den faktiskt kan hamna i databasen.
 */
export function hasUsableDate(ev: DateableEvent, nowMs: number = Date.now()): boolean {
  const start = eventStartTime(ev);
  if (!start) return false;
  return !isEventPast(start, nowMs);
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
