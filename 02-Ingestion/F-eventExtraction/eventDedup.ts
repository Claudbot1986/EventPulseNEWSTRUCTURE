/**
 * eventDedup — slå ihop dubbletter från universal-extraktorns olika metoder.
 *
 * Bakgrund (2026-10-24). C1 (kortlistan) och C2/C3 (tidsankare/svenska
 * datum) läser samma evenemangskort på två sätt. Ena vägen ger kortets
 * riktiga rubrik + länk, andra vägen ger bara bildens alt-text (en
 * fotobeskrivning, inte ett eventnamn). Eftersom dedup-nyckeln innehöll
 * `url` skiljdes de åt, och båda skrevs till filen.
 *
 * Mätt på den riktiga korpusen (03-Queue/03-extractedevents/, 8405 rader):
 *   - 7985 rader är universal-extractor-form (har `date`). 151 grupper med
 *     identisk titel+datum+tid:
 *       · 66 rader har EN med url och EN utan → samma event, extraherat två
 *         gånger. folkoperan "Jag är Ulla Winblad" (27), folkoperanse (25),
 *         de baser (7), Mölndals (3), Moderna museet, Stora Teatern,
 *         studieframjandet, Göteborgs universitet.
 *       · 278 rader har samma titel+datum+tid men VARJE SIN url. De är
 *         FÖRETÄNDANDEN: t.ex. Konserthuset "Sagolek – Den lille prinsen"
 *         2026-10-25 med url .../20261025-1000/ och .../20261025-1130/ —
 *         samma titel, men klockslaget ligger bara i url:en. Ditto
 *         dn-kalendariet (29), dramaten (19), gota-lejon (17), malmo-opera
 *         (10). De ska BEHÅLLAS.
 *       · 1 rad är en exakt dubblett (sthlmlist "Dolce" 2026-09-19).
 *   - 420 rader är adapter-form (har `startTime`, saknar `date`). De går
 *     inte igenom den här modulen, men nyckeln använder `startTime` som
 *     reservdatum så att de aldrig ska kunna kollapsa om de någon gång
 *     passerar: berwaldhallens "Bowie in Berlin" (26/27/28 nov) har samma
 *     titel och samma url men tre olika datum.
 *
 * Två regler:
 *   R1' Identitet = titel + datum + tid. Inom en sådan grupp:
 *         - finns det en med url och en utan → behåll den med url
 *         - finns det flera med url → behåll en per DISTINKT url
 *         - samma url två gånger → samma rad, behåll en
 *         - finns det bara rader utan url → behåll en
 *   R2  En rad vars titel kom från bildens alt-text OCH som saknar url är
 *       en bildtext, inte ett eventnamn — men bara om samma datum redan
 *       har ett annat event på sidan. Utan det kriterium kan vi inte
 *       skilja "kort med enbart bild" från "kort vi missade rubriken på".
 *
 * Varför R1' och inte "en rad per identitet": klockslaget ligger ibland
 * bara i url:en. Konserthusets "Sagolek – Den lille prinsen" 2026-10-25
 * finns som .../20261025-1000/ och .../20261025-1130/ — två genuint olika
 * företrädanden med identisk titel+datum+tid. En naiv "behåll en per
 * identitet" skulle ha tagit bort 278 rader i korpusen. Därför borttas bara
 * url-lösa rader, och bara när en url-bärande systerrad finns i gruppen.
 *
 * Känd, medvetet ej hanterad dubblettklass: 13 rader har samma url, titel
 * och datum men olika tid (kth 5, naturhistoriska-riksmuseet 3, chinateatern
 * 1, formex 1 + 2 speglingsfiler). Där är det ibland samma event där tiden
 * gått förlorad i ena läsningen (kth), ibland två verkliga företrädanden
 * med olika klockslag (naturhistoriska, chinateatern). Skillnaden går inte
 * att avgöra generellt, så de lämnas orörda hellre än att fel slås ihop.
 *
 * Bevis: `eventDedup.test.ts` (positiva + negativa kontroller) och
 * `scripts/measure-event-dedup.mjs` (korpusmätningen ovan).
 */

/** Signal som sätts på en rad vars titel kom från `img[alt]`. */
export const ALT_TEXT_TITLE_SIGNAL = 'title-from-img-alt';

/** Minimal form av ParsedEvent som dedup-logiken behöver. */
export interface DedupableEvent {
  title: string;
  date: string;
  time?: string | null;
  url?: string | null;
  /**
   * Reservdatum för rader som saknar `date` (t.ex. adapter-rader med
   * `startTime`). Utan det skulle t.ex. berwaldhallens "Bowie in Berlin"
   * (26/27/28 nov, samma url, samma titel) kollapsa till en rad.
   */
  startTime?: string | null;
  confidence?: { signals?: string[] | null } | null;
}

export interface DedupResult<T> {
  kept: T[];
  /** Rader som togs bort för att de var samma event (R1). */
  droppedDuplicate: number;
  /** Rader som togs bort för att titeln var bild-alt-text (R2). */
  droppedAltText: number;
}

/** Har raden en url? Tom sträng räknas som ingen url. */
export function hasUrl(evt: DedupableEvent): boolean {
  return typeof evt.url === 'string' && evt.url.trim().length > 0;
}

/** Kom titeln från bildens alt-text? */
export function isAltTextTitle(evt: DedupableEvent): boolean {
  const signals = evt.confidence?.signals;
  return Array.isArray(signals) && signals.includes(ALT_TEXT_TITLE_SIGNAL);
}

/** R1-nyckel: titel + datum + tid. */
export function identityKey(evt: DedupableEvent): string {
  const date = evt.date || evt.startTime || '';
  return `${(evt.title || '').trim()}|${date}|${evt.time || ''}`;
}

/** Datumnyckel för R2: samma dag räcker, tiden varierar mellan metoder. */
export function dayKey(evt: DedupableEvent): string {
  return evt.date || '';
}

/**
 * Slå ihop dubbletter.
 *
 * Ordningen är viktig: R1 kör först (identitet), sedan R2 (bildtext).
 * R2 kontrollerar mot de R1-överlevande raderna, så en bildtext som
 * kollapsat in i en riktig rad räknas inte som "ett annat event".
 */
export function dedupeEvents<T extends DedupableEvent>(events: T[]): DedupResult<T> {
  // ── R1: identitet = titel + datum + tid ───────────────────────────────
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const evt of events) {
    const key = identityKey(evt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(evt);
    else {
      groups.set(key, [evt]);
      order.push(key);
    }
  }

  const kept: T[] = [];
  let droppedDuplicate = 0;

  for (const key of order) {
    const bucket = groups.get(key)!;
    const withUrl = bucket.filter(hasUrl);
    const withoutUrl = bucket.filter(evt => !hasUrl(evt));

    if (withUrl.length > 0) {
      // Samma event, två läsningar: den med url bär mer information.
      // Men flera url-varianter kan vara olika företrädanden (klockslaget
      // ligger i url:en) → varje DISTINKT url behålls. Samma url två
      // gånger är däremot samma rad → bara en behålls.
      const seenUrls = new Set<string>();
      for (const evt of withUrl) {
        const url = (evt.url || '').trim();
        if (seenUrls.has(url)) {
          droppedDuplicate++;
          continue;
        }
        seenUrls.add(url);
        kept.push(evt);
      }
      droppedDuplicate += withoutUrl.length;
    } else {
      // Ingen url att skilja dem åt — raderna är identiska i databasen.
      kept.push(bucket[0]);
      droppedDuplicate += bucket.length - 1;
    }
  }

  // ── R2: bild-alt-text utan url + ett annat event samma dag → bort ─────
  const daysWithRealEvent = new Set<string>();
  for (const evt of kept) {
    if (!isAltTextTitle(evt)) daysWithRealEvent.add(dayKey(evt));
  }

  const finalKept: T[] = [];
  let droppedAltText = 0;
  for (const evt of kept) {
    const altTextWithoutUrl = isAltTextTitle(evt) && !hasUrl(evt);
    if (altTextWithoutUrl && daysWithRealEvent.has(dayKey(evt))) {
      droppedAltText++;
      continue;
    }
    finalKept.push(evt);
  }

  return { kept: finalKept, droppedDuplicate, droppedAltText };
}
