/**
 * eventUrlExtraction — en värds extra event-sidor (`metadata.eventUrls`).
 *
 * Bakgrund (2026-10-24). En värd har ofta flera event-sidor: en
 * listningssida, språkversioner och detaljsidor per evenemang. Före detta
 * skapade discovery en egen `candidate-*`-källa per URL — 25 filer och 67
 * DB-rader där samma evenemang låg under flera source-namn.
 *
 * Nu är sidorna `metadata.eventUrls` på värdkällan, och C-gaten extraherar
 * dem för sig.
 *
 * EN skillnad mot huvudkörningen: även en event-URL körs genom C0:s
 * kandidatdiscovery. Utan det ger en LISTNINGSSIDA (t.ex. venue.se/kalender)
 * nästan inga events — den innehåller länkar och datum i nyhetsarkiv, inte
 * evenemang. Med discovery hittar vi sidorna som faktiskt listar events.
 *
 * Mönstret är detsamma som C-gatens C-NextCandidate-fallback: vi använder
 * de kandidater C0 redan rankat och mätt. Ingen ny heuristik, ingen
 * scoring-vikt, ingen IGNORE_PATTERN — bara fler URLs som testas.
 */

import { discoverEventCandidates, screenUrl } from './index';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import { filterUsableEvents } from '../F-eventExtraction/usableEvents';
import type { ParsedEvent } from '../F-eventExtraction/schema';
import type { DerivedRulesStore } from './c4-derived-rules';

/** Hur många C0-kandidater per event-URL som testas. */
export const EVENT_URL_CANDIDATE_LIMIT = 3;

/**
 * Identitet för en extraherad rad — titel + datum + tid.
 *
 * Används för att slå ihop listningssidans rader med detaljsidans rader:
 * samma evenemang ska inte hamna två gånger i samma källa.
 */
export function eventIdentity(ev: { title?: string; date?: string; time?: string }): string {
  const title = (ev.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const date = (ev.date ?? '').trim();
  const time = (ev.time ?? '').trim();
  return `${title}|${date}|${time}`;
}

export interface EventUrlOutcome {
  /** Sidor som gav minst en rad. */
  pagesWithEvents: number;
  /** Antal C0-kandidater som faktiskt testades. */
  candidatesTested: number;
  /** Antal sparbara rader som kom från denna event-URL. */
  usable: number;
}

/**
 * Extraherar en event-URL: först sidan själv, sedan de bästa kandidaterna
 * som C0 hittade på den.
 *
 * Returnerar de nya raderna (de som inte redan fanns i `seen`) tillsammans
 * med en kort sammanfattning för loggen.
 */
export async function extractEventUrl(
  eventUrl: string,
  sourceId: string,
  derivedRules: DerivedRulesStore | undefined,
  seen: Set<string>,
): Promise<{ events: ParsedEvent[]; outcome: EventUrlOutcome }> {
  const events: ParsedEvent[] = [];
  const outcome: EventUrlOutcome = { pagesWithEvents: 0, candidatesTested: 0, usable: 0 };

  const collect = async (url: string): Promise<boolean> => {
    const screened = await screenUrl(url);
    const html = screened.html;
    if (!html) return false;
    const extracted = extractFromHtml(html, sourceId, url);
    const usable = filterUsableEvents(extracted.events);
    const fresh = usable.filter((e) => {
      const id = eventIdentity(e);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (fresh.length > 0) {
      events.push(...fresh);
      outcome.pagesWithEvents += 1;
      outcome.usable += fresh.length;
      return true;
    }
    return false;
  };

  // 1. Sidan själv — fångar detaljsidor och sidor med datum i HTML.
  try {
    await collect(eventUrl);
  } catch (e) {
    console.log(`[${sourceId}] [C-EventUrl] ${eventUrl}: fel ${(e as Error)?.message ?? String(e)}`);
    return { events, outcome };
  }

  // 2. Kandidater som C0 hittade på sidan — fångar listningssidor.
  let candidates: { url: string }[] = [];
  try {
    const c0 = await discoverEventCandidates(eventUrl, derivedRules, sourceId);
    candidates = (c0?.topCandidates ?? []).slice(0, EVENT_URL_CANDIDATE_LIMIT);
  } catch (e) {
    console.log(`[${sourceId}] [C-EventUrl] ${eventUrl}: C0-fel ${(e as Error)?.message ?? String(e)}`);
  }

  for (const candidate of candidates) {
    if (!candidate?.url || candidate.url === eventUrl) continue;
    outcome.candidatesTested += 1;
    try {
      await collect(candidate.url);
    } catch (e) {
      console.log(`[${sourceId}] [C-EventUrl] ${candidate.url}: fel ${(e as Error)?.message ?? String(e)}`);
    }
  }

  return { events, outcome };
}
