/**
 * Riksarkivet (riksarkivet.se) adapter — Riksarkivets egna evenemang,
 * utställningar och "Arkivens dag".
 *
 * Site-specifict mönster (verifierat 2026-10-24 med enbart gratis HTTP +
 * lokal Chromium — noll ScrapingBee-krediter):
 *
 * - Sidan är Next.js 16 (App Router) ovanpå WordPress. Det finns INGEN
 *   JSON-LD och ingen `__NEXT_DATA__` att läsa.
 * - `/evenemang` är en 404 ("Vi kan tyvärr inte hitta sidan du söker").
 *   Den riktiga listan heter `/kalendarium`.
 * - `/kalendarium` är KLIENT-renderad: den första HTML:en innehåller bara
 *   RSC-flight-payloaden (`self.__next_f.push`) med
 *   `postsDataPostType:{name:"event"}` och `data:null`. Kortlistan lever i
 *   ett server action (POST) som bara körs i webbläsaren. Efter rendering
 *   finns 24 kort:
 *
 *     <div class="grid content-start rounded-lg ...">
 *       <div class="row-start-2 ...">
 *         <h3 ...><a href="/evenemang/<slug>">TITEL</a></h3>
 *         <dl>
 *           <div><dt><span class="sr-only">Datum:</span></dt>
 *                <dd><span><time datetime="2026-01-01/2026-12-30">…</time></span></dd></div>
 *           <div><dt><span class="sr-only">Plats:</span></dt><dd>Uppsala</dd></div>
 *         </dl>
 *       </div>
 *       <div aria-hidden="true"><time datetime="10-24">24 okt</time></div>   ← dekorativ badge
 *       <div class="prose ..."><p>beskrivning</p></div>
 *     </div>
 *
 *   Datumet är alltså antingen "YYYY-MM-DD" eller ett intervall
 *   "YYYY-MM-DD/YYYY-MM-DD" (utställningar). Badge-tiden (`datetime="10-24"`)
 *   är bara en dekorativ kalendercirkel och får INTE läsas som datum — den
 *   ligger dessutom utanför `<dl>`.
 * - Detaljsidan `/evenemang/<slug>` är SERVER-renderad och kan läsas med
 *   enkel fetch. Där ligger:
 *     - `<h1>` = titeln
 *     - `<time datetime="2026-11-14">lördag 14 november 2026</time>` = datum
 *       (OBS: sidan har ÄVEN ett "Publicerad:"-datum i en `<dd>` — det får
 *       inte plockas som evenemangsdatum)
 *     - `<time datetime="10:30/14:00">10.30–14.00</time>` = tidsfönster
 *     - inforutorna: datum, tid, plats ("Täby"), arrangör ("Riksarkivet")
 *     - `<div class="prose"><p class="lead">` = beskrivningen
 *
 * Om ett evenemang INTE har någon gata-adress på sidan utelämnas `address`
 * hellre än att gissa — Riksarkivets footer-adress (Box 7223, Täby) är
 * huvudkontoret, inte evenemangsplatsen.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST riksarkivet.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'riksarkivet';
const BASE = 'https://riksarkivet.se';
const ORGANIZER = 'Riksarkivet';
const CITY = 'Stockholm';

const HOSTS = new Set(['riksarkivet.se', 'www.riksarkivet.se']);

/** Ett evenemang rått extraherat ur HTML:en. */
export interface RawRiksarkivetEvent {
  title: string | null;
  date: string | null;
  endDate: string | null;
  time: string | null;
  endTime: string | null;
  place: string | null;
  organizer: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
}

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Normaliserar whitespace och tar bort dubbla mellanrum. */
function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > 0 ? value : null;
}

/** Gör en relativ länk absolut mot riksarkivet.se. */
function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

/**
 * Plockar ut originalbilden ur Next.js-bilden `/_next/image?url=…&w=…&q=…`.
 * Returnerar null om det inte är en riktig bild (t.ex. logotypen i svg).
 */
function extractNextImage(src: string | null | undefined): string | null {
  if (!src) return null;
  const decoded = decodeURIComponent(src);
  const match = decoded.match(/[?&]url=([^&]+)/);
  if (!match) return null;
  const raw = match[1];
  if (!/^https?:\/\//i.test(raw)) return null;
  if (/\.svg($|\?)/i.test(raw)) return null;
  return raw;
}

/** Plockar ut "Plats:"-raden ur ett `dl` med sr-only-etiketter. */
function readDlRows($: cheerio.CheerioAPI, scope: cheerio.Cheerio<any>): { date: string | null; place: string | null } {
  let date: string | null = null;
  let place: string | null = null;

  scope.find('dl > div').each((_i, row) => {
    const $row = $(row);
    const label = clean($row.find('dt .sr-only').first().text()) ?? '';
    const $dd = $row.find('dd').first();
    const timeAttr = $dd.find('time[datetime]').first().attr('datetime') ?? '';

    if (/^datum/i.test(label) || /^\d{4}-\d{2}-\d{2}/.test(timeAttr)) {
      if (!date && timeAttr) date = timeAttr;
      return;
    }
    if (/^plats/i.test(label) || (!timeAttr && !place && /plats/i.test(label))) {
      const text = clean($dd.text());
      if (text) place = text;
    }
  });

  // Om etiketten saknas: första raden utan <time> är platsen.
  if (!place) {
    scope.find('dl > div').each((_i, row) => {
      const $row = $(row);
      if ($row.find('time[datetime]').length > 0) return;
      const text = clean($row.find('dd').first().text());
      if (text) {
        place = text;
        return false;
      }
      return undefined;
    });
  }

  return { date, place };
}

/** Läser kortlistan på /kalendarium. */
export function parseListing(html: string): RawRiksarkivetEvent[] {
  const $ = cheerio.load(html);
  const events: RawRiksarkivetEvent[] = [];

  $('a[href^="/evenemang/"]').each((_i, anchor) => {
    const $anchor = $(anchor);
    const title = clean($anchor.text());
    if (!title) return;

    const card = $anchor.closest('div.grid');
    const scope = card.length > 0 ? card : $anchor.closest('div');
    const { date: dateAttr, place } = readDlRows($, scope);

    const dateMatch = dateAttr?.match(/^(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?$/);
    const description = clean(card.find('div.prose p').first().text());
    const imageUrl = extractNextImage(card.find('img[src^="/_next/image?url="]').first().attr('src'));

    events.push({
      title,
      date: dateMatch ? dateMatch[1] : null,
      endDate: dateMatch && dateMatch[2] ? dateMatch[2] : null,
      time: null,
      endTime: null,
      place,
      organizer: ORGANIZER,
      description,
      url: absoluteUrl($anchor.attr('href')),
      imageUrl,
    });
  });

  return events;
}

/** Läser en detaljsida /evenemang/<slug>. */
export function parseDetail(html: string, url: string): RawRiksarkivetEvent | null {
  const $ = cheerio.load(html);
  const title = clean($('h1').first().text());
  if (!title) return null;

  // Evenemangets datum ligger i en <time> på formatet YYYY-MM-DD och INTE
  // i en <dd> ("Publicerad:"-raden ligger i en <dd>).
  let date: string | null = null;
  let endDate: string | null = null;
  let dateEl: cheerio.Cheerio<any> | null = null;

  $('time[datetime]').each((_i, el) => {
    const attr = $(el).attr('datetime') ?? '';
    const match = attr.match(/^(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?$/);
    if (!match) return;
    if (date) return;

    const $dd = $(el).closest('dd');
    if ($dd.length > 0) {
      const label = clean($dd.parent().find('dt').first().text()) ?? '';
      if (/publicerad/i.test(label)) return; // publiceringsdatum, inte evenemangsdatum
    }

    date = match[1];
    endDate = match[2] ?? null;
    dateEl = $(el);
  });

  if (!date || !dateEl) return null;

  // Tidsfönstret: "10:30/14:00" → time 10:30, endTime 14:00.
  let time: string | null = null;
  let endTime: string | null = null;
  $('time[datetime]').each((_i, el) => {
    if (time) return;
    const attr = $(el).attr('datetime') ?? '';
    const match = attr.match(/^(\d{1,2}):(\d{2})(?:\/(\d{1,2}):(\d{2}))?$/);
    if (!match) return;
    time = `${match[1].padStart(2, '0')}:${match[2]}`;
    if (match[3]) endTime = `${match[3].padStart(2, '0')}:${match[4]}`;
  });

  // Inforutorna (datum, tid, plats, arrangör) ligger i samma block.
  const infoBlock = dateEl.parent().parent();
  let place: string | null = null;
  let organizer: string | null = null;

  infoBlock.children().each((_i, row) => {
    const $row = $(row);
    if ($row.find('time[datetime]').length > 0) return; // datum- eller tidrad
    const text = clean($row.text());
    if (!text) return;

    if (/^arrangör/i.test(text)) {
      const value = clean(text.replace(/^arrangör\s*:?\s*/i, ''));
      if (value) organizer = value;
      return;
    }
    if (!place) place = text;
  });

  // Reserv: platsraden har ikonen "place.…svg" i mask-image.
  if (!place) {
    const placeRow = infoBlock
      .children()
      .filter((_i, row) => $(row).find('span.icon[style*="place"]').length > 0)
      .first();
    place = clean(placeRow.text());
  }
  if (!organizer) {
    const organizerRow = infoBlock
      .children()
      .filter((_i, row) => clean($(row).text())?.toLowerCase().startsWith('arrangör'))
      .first();
    organizer = clean(organizerRow.text()?.replace(/^arrangör\s*:?\s*/i, ''));
  }

  const description = clean($('div.prose p.lead').first().text()) ?? clean($('div.prose p').first().text());
  const imageUrl = extractNextImage(
    $('img[src^="/_next/image?url="]')
      .toArray()
      .map((el) => $(el).attr('src'))
      .find((src) => extractNextImage(src) !== null)
  );

  return {
    title,
    date,
    endDate,
    time,
    endTime,
    place,
    organizer,
    description,
    url: absoluteUrl(url) ?? url,
    imageUrl,
  };
}

/** Platsen är Riksarkivets lokala arkiv — orten är stad, inte gata-adress. */
function cityOf(place: string | null): string | undefined {
  if (!place) return undefined;
  if (/stockholm/i.test(place)) return CITY;
  return place;
}

export interface RiksarkivetExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'riksarkivet-listing' | 'riksarkivet-detail' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): RiksarkivetExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  let raw: RawRiksarkivetEvent[] = [];
  let method: 'riksarkivet-listing' | 'riksarkivet-detail' = 'riksarkivet-listing';

  const isDetailUrl = /\/evenemang\/[^/]+\/?$/.test(new URL(url).pathname);
  if (isDetailUrl) {
    const detail = parseDetail(html, url);
    raw = detail ? [detail] : [];
    method = 'riksarkivet-detail';
  } else {
    raw = parseListing(html);
    if (raw.length === 0) {
      const detail = parseDetail(html, url);
      if (detail) {
        raw = [detail];
        method = 'riksarkivet-detail';
      }
    }
  }

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const item of raw) {
    if (!item.title || !item.date) continue;

    const key = `${item.title}|${item.date}|${item.time ?? ''}|${item.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const eventUrl = item.url ?? absoluteUrl(url) ?? url;
    showUrls.add(eventUrl);

    const venue = item.place ? `${ORGANIZER}, ${item.place}` : ORGANIZER;
    const hasDescription = Boolean(item.description);

    try {
      const evt = ParsedEventSchema.parse({
        title: item.title,
        date: item.date,
        time: item.time ?? undefined,
        endDate: item.endDate ?? undefined,
        endTime: item.endTime ?? undefined,
        venue,
        city: cityOf(item.place),
        description: item.description ?? undefined,
        url: eventUrl,
        ticketUrl: undefined,
        organizer: item.organizer ?? ORGANIZER,
        imageUrl: item.imageUrl ?? undefined,
        source,
        sourceUrl: url,
        confidence: {
          score: method === 'riksarkivet-detail' ? 0.92 : 0.86,
          hasTitle: true,
          hasDate: true,
          hasVenue: Boolean(item.place),
          hasUrl: true,
          hasDescription,
          hasTicketInfo: false,
          signals: [
            method === 'riksarkivet-detail' ? 'riksarkivet-detail-info-block' : 'riksarkivet-kalendarium-card',
            item.place ? `plats:${item.place}` : 'plats:saknas',
          ],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method };
}
