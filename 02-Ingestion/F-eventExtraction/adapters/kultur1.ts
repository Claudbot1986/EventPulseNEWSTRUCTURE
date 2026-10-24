/**
 * Kultur1 (kultur1.se) adapter — Kulturnätverket, evenemang i Stockholms län.
 *
 * Site-specifict mönster (verifierat 2026-10-24 med enbart gratis HTTP —
 * noll ScrapingBee-krediter):
 *
 * - Sidan är handrullad PHP (4.01-loose-DTD) med tabell-layout. Det finns
 *   ingen JSON-LD, ingen WordPress och ingen Next.js.
 * - DEN FUNGERANDE LISTAN är
 *     https://www.kultur1.se/calendar_lan.php?from=YYYY-MM-DD&to=YYYY-MM-DD&lid=1
 *   där `lid=1` = Stockholms län. Utan `from`/`to` visas 5281 evenemang
 *   (första sidan), med två veckors fönster "Det finns 7 evenemang i denna
 *   kategori". `calendar_city.php` kräver `kid=<kategori-id>` och gav 0
 *   rader med den gamla D-AI-URL:en, och `/kalendarium.php` är en 404.
 * - Listraden är en tabellrad:
 *
 *     <td width='110'><img src='../USERCONTENT/cal/2026/10/th_11163907_516.jpg'></td>
 *     <td><span class='normal_headline'>Kathrin Bernekorn</span><br>
 *       <span class='cal_small_text'><b>GALLERI GREGER, STOCKHOLM (2026-10-23 - 2026-10-29)</b></span><br>
 *       Naturmåleri<br>
 *       <a href='' onclick='return OpenCal(16547)'>Läs mer &raquo;</a></td>
 *
 *   Alltså: titel i `span.normal_headline`, plats + ort + datumintervall i
 *   `<b>` inuti `span.cal_small_text`, evenemangs-ID:t i
 *   `onclick='return OpenCal(<id>)'`. Det ID:t ger evenemangets URL:
 *     https://www.kultur1.se/open_cal.php?cid=<id>
 *   (GET fungerar; den vanliga OpenCal()-JS:en gör en POST.)
 * - DETALJSIDAN `open_cal.php?cid=<id>` är ett HTML-fragment med två celler:
 *   - vänster cell: bild + `span.cal_small_text` med "Datum:", "Veckodagar:"
 *     och "Öppettider:" (t.ex. "11-17").
 *   - höger cell: `span.normal_headline` (titel), kategorin (t.ex. "Konst"),
 *     beskrivning, `<b>VENUE</b>`, gatuadress, "ORT, LÄN", telefon, kontakt.
 *
 * ENCODING (viktigt): kultur1.se serverar `Content-Type: text/html;
 * charset=ISO-8859-1` och sidor innehåller å/ä/ö. Node/undici:s `res.text()`
 * avkodar alltid som UTF-8, vilket ger trasiga tecken (U+FFFD) i den
 * vanliga HTTP-vägen. ScrapingBee/D-gate-vägen går via en riktig webbläsare
 * och avkodar rätt. Adaptern markerar därför HTML som innehåller U+FFFD med
 * signalen "charset-latin1-lossy" och sänker confidence — den rättar inte
 * tecknen (det går inte, byten är redan förlorade).
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST kultur1.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'kultur1-stockholm';
const BASE = 'https://www.kultur1.se';
const CITY = 'Stockholm';

const HOSTS = new Set(['kultur1.se', 'www.kultur1.se']);

/** Ett evenemang rått extraherat ur HTML:en. */
export interface RawKultur1Event {
  title: string | null;
  date: string | null;
  endDate: string | null;
  time: string | null;
  endTime: string | null;
  venue: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  description: string | null;
  performers: string[];
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

/** Normaliserar whitespace. */
function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > 0 ? value : null;
}

/** Gör en relativ bildlänk absolut mot kultur1.se. */
function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

/**
 * Ort- och platsnamn skrivs versalt på sidan ("STOCKHOLM", "NACKA", "TÄBY").
 * De görs om till normal titelstil så att listan och detaljsidan ger samma
 * sträng för samma plats ("GALLERI GREGER" → "Galleri Greger"). Korta
 * akronymer ("AP") lämnas som de är.
 */
function titleCaseWords(value: string): string {
  return value
    .split(' ')
    .map((word) => (word.length <= 2 ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

function normalizeCity(raw: string | null): string | null {
  const value = clean(raw);
  if (!value) return null;
  if (/^stockholm$/i.test(value)) return CITY;
  return titleCaseWords(value);
}

function normalizeVenue(raw: string | null): string | null {
  const value = clean(raw);
  if (!value) return null;
  return titleCaseWords(value);
}

/** Delar en cells innehåll i rader (siten skiljer med <br>). */
function splitLines(html: string): string[] {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  const $frag = cheerio.load(withBreaks);
  return $frag('body')
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/** Plockar ut evenemangs-ID:t ur `onclick='return OpenCal(16547)'`. */
function readCid(onclick: string | null | undefined): string | null {
  if (!onclick) return null;
  const match = onclick.match(/OpenCal\((\d+)\)/i);
  return match ? match[1] : null;
}

/**
 * Tolkar listradens metadata: "GALLERI GREGER, STOCKHOLM (2026-10-23 - 2026-10-29)".
 * Plats och ort kommer före parentesen, datumet inuti.
 */
export function parseMeta(meta: string): {
  venue: string | null;
  city: string | null;
  date: string | null;
  endDate: string | null;
} {
  const text = clean(meta);
  if (!text) return { venue: null, city: null, date: null, endDate: null };

  const parenMatch = text.match(/\(([^)]*)\)\s*$/);
  const head = parenMatch ? clean(text.slice(0, text.lastIndexOf('('))) : text;
  const dates = parenMatch ? clean(parenMatch[1]) : null;

  let venue: string | null = null;
  let city: string | null = null;
  if (head) {
    const comma = head.lastIndexOf(',');
    if (comma > -1) {
      venue = clean(head.slice(0, comma));
      city = clean(head.slice(comma + 1));
    } else {
      venue = head;
    }
  }

  let date: string | null = null;
  let endDate: string | null = null;
  if (dates) {
    const match = dates.match(/(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    if (match) {
      date = match[1];
      endDate = match[2] ?? null;
    }
  }

  return { venue, city, date, endDate };
}

/** Läser listan (calendar_lan.php / calendar_city.php / startsidan). */
export function parseListing(html: string): RawKultur1Event[] {
  const $ = cheerio.load(html);
  const events: RawKultur1Event[] = [];
  const seen = new Set<string>();

  $('span.normal_headline').each((_i, headline) => {
    const $headline = $(headline);
    const title = clean($headline.text());
    if (!title) return;

    const $cell = $headline.closest('td');
    if ($cell.length === 0) return;

    const meta = clean($cell.find('span.cal_small_text b').first().text());
    const parsed = parseMeta(meta ?? '');
    if (!parsed.date) return;

    const $link = $cell.find('a[onclick*="OpenCal("]').first();
    const cid = readCid($link.attr('onclick'));
    if (!cid) return;
    if (seen.has(cid)) return;
    seen.add(cid);

    const $row = $headline.closest('tr');
    const imageUrl = absoluteUrl($row.find('img').first().attr('src'));

    // Beskrivningen är texten som står kvar när titel, metadata, bild och
    // "Läs mer"-länken tagits bort ur cellen.
    const $clone = $cell.clone();
    $clone.find('br').replaceWith(' ');
    $clone.find('span.normal_headline, span.cal_small_text, a[onclick*="OpenCal("], img').remove();
    const description = clean($clone.text());

    events.push({
      title,
      date: parsed.date,
      endDate: parsed.endDate,
      time: null,
      endTime: null,
      venue: normalizeVenue(parsed.venue),
      address: null,
      city: normalizeCity(parsed.city),
      category: null,
      description,
      performers: [],
      url: `${BASE}/open_cal.php?cid=${cid}`,
      imageUrl,
    });
  });

  return events;
}

/** Läser detaljsidan open_cal.php?cid=<id>. */
export function parseDetail(html: string, url: string): RawKultur1Event | null {
  const $ = cheerio.load(html);
  const $cells = $('td');
  if ($cells.length < 2) return null;

  const $info = $cells.eq(0);
  const $main = $cells.eq(1);

  const title = clean($main.find('span.normal_headline').first().text());
  if (!title) return null;

  const infoText = clean($info.find('span.cal_small_text').first().text()) ?? '';
  const dateMatch = infoText.match(/Datum:\s*(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
  if (!dateMatch) return null;

  const hoursMatch = infoText.match(/Öppettider:\s*(\d{1,2})\s*-\s*(\d{1,2})/);
  const time = hoursMatch ? `${hoursMatch[1].padStart(2, '0')}:00` : null;
  const endTime = hoursMatch ? `${hoursMatch[2].padStart(2, '0')}:00` : null;

  // Kategorin är det "cal_small_text" som inte är en etikett ("Konstnär: ").
  let category: string | null = null;
  $main.find('span.cal_small_text').each((_i, el) => {
    if (category) return;
    const text = clean($(el).text());
    if (text && !/:$/.test(text)) category = text;
  });

  const lines = splitLines($main.html() ?? '');

  // "<b>VENUE</b>" — den första b-taggen som inte är en etikett.
  let venue: string | null = null;
  $main.find('b').each((_i, el) => {
    if (venue) return;
    const text = clean($(el).text());
    if (text && !/:$/.test(text)) venue = text;
  });

  const venueIdx = venue ? lines.findIndex((line) => line === venue) : -1;
  const address = venueIdx > -1 ? clean(lines[venueIdx + 1]) : null;
  const cityLine = venueIdx > -1 ? clean(lines[venueIdx + 2]) : null;
  const city = normalizeCity(cityLine ? cityLine.split(',')[0] : null);

  const isLabel = (line: string): boolean => /^[A-Za-zÅÄÖåäöÉéÜü]+:$/.test(line);
  const descriptionLines = lines
    .slice(0, venueIdx > -1 ? venueIdx : lines.length)
    .filter((line) => line !== title && line !== category && !isLabel(line) && !/»$/.test(line));

  const performers: string[] = [];
  $main.find('a').each((_i, el) => {
    const text = clean($(el).text());
    if (!text || /^Hemsida/i.test(text)) return;
    const name = clean(text.replace(/»\s*$/, ''));
    if (name && name !== title) performers.push(name);
  });

  const imageUrl = absoluteUrl($info.find('img').first().attr('src'));

  return {
    title,
    date: dateMatch[1],
    endDate: dateMatch[2] ?? null,
    time,
    endTime,
    venue: normalizeVenue(venue),
    address,
    city,
    category,
    description: clean(descriptionLines.join(' ')),
    performers,
    url: absoluteUrl(url) ?? url,
    imageUrl,
  };
}

export interface Kultur1ExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'kultur1-listing' | 'kultur1-detail' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): Kultur1ExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const isDetail = /open_cal\.php/i.test(url);
  let raw: RawKultur1Event[] = [];
  let method: 'kultur1-listing' | 'kultur1-detail' = 'kultur1-listing';

  if (isDetail) {
    const detail = parseDetail(html, url);
    raw = detail ? [detail] : [];
    method = 'kultur1-detail';
  } else {
    raw = parseListing(html);
    if (raw.length === 0) {
      const detail = parseDetail(html, url);
      if (detail) {
        raw = [detail];
        method = 'kultur1-detail';
      }
    }
  }

  // ISO-8859-1-avkodad HTML som lästs som UTF-8 har tecken förlorade.
  const isLossy = html.includes('\uFFFD');

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const item of raw) {
    if (!item.title || !item.date) continue;

    const key = `${item.title}|${item.date}|${item.time ?? ''}|${item.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const eventUrl = item.url ?? url;
    showUrls.add(eventUrl);

    try {
      const evt = ParsedEventSchema.parse({
        title: item.title,
        date: item.date,
        time: item.time ?? undefined,
        endDate: item.endDate ?? undefined,
        endTime: item.endTime ?? undefined,
        venue: item.venue ?? undefined,
        address: item.address ?? undefined,
        city: item.city ?? undefined,
        description: item.description ?? undefined,
        url: eventUrl,
        ticketUrl: undefined,
        category: item.category ?? undefined,
        performers: item.performers.length > 0 ? item.performers : undefined,
        imageUrl: item.imageUrl ?? undefined,
        source,
        sourceUrl: url,
        confidence: {
          score: isLossy ? 0.68 : method === 'kultur1-detail' ? 0.85 : 0.78,
          hasTitle: true,
          hasDate: true,
          hasVenue: Boolean(item.venue),
          hasUrl: true,
          hasDescription: Boolean(item.description),
          hasTicketInfo: false,
          signals: [
            method === 'kultur1-detail' ? 'kultur1-open-cal-detail' : 'kultur1-calendar-row',
            item.venue ? `venue:${item.venue}` : 'venue:saknas',
            ...(isLossy ? ['charset-latin1-lossy'] : []),
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
