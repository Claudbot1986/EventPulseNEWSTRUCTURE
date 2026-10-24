/**
 * Kammaren (kammaren.com) adapter — konserthus på Torsgatan 41, Stockholm.
 *
 * Site-specifict mönster (verifierat 2026-10-24 mot den riktiga sajten):
 *
 * - WordPress med Elementor. Det finns INGEN JSON-LD och ingen datummarkup
 *   i listningen — bara `<p>`-block. Programsidan
 *   https://kammaren.com/program/ är den enda sidan som bär programmet.
 * - Rubriken är säsongsangivelsen: `<h2>Program 2026</h2>`. ÅRET står alltså
 *   bara där — varje programrad har "11-12 november" UTAN år.
 * - Varje programrad är ett `<p>` där första spanen bär datumet och resten
 *   av stycket bär titeln:
 *
 *     <p>
 *       <span style="font-weight: bold; font-family: inherit;
 *                    font-size: 1.75rem;">11-12 november – </span>
 *       <span style="font-size: 28px;"><b>Emil Holmström </b></span>
 *       <span ...>(</span><span ...>piano) </span>
 *       <span style="font-size: 28px;"><b>&amp; Emma Nyman</b></span>
 *     </p>
 *     <p>Pianisten Emil Holmström kommer tillbaka ...</p>
 *
 *   Datumet är alltså ett eget span (1.75rem, bold) med mönstret
 *   "D–D månad – ". Titeln är resten av samma stycke. Det närmaste stycket
 *   efteråt är beskrivningen.
 *
 *   VARNING: datumspannet ligger ibland INNE i ett yttre "grått" span
 *   (`color: #999999`) som ALSO bär titeln. Då är det den INNRE spannet
 *   (1.75rem) som bara bär datumet — det är den som ska väljas, annars
 *   sparas titeln som en tom rest.
 * - TIDERNA står EN gång för hela säsongen, i en egen rad:
 *
 *     "Konserttid båda dagarna kl 16.15 och 19.45."
 *
 *   "båda dagarna" = båda dagarna i datumspannet. En rad = ett evenemang på
 *   en dag, en tid (occurrence-modellen: en DB-rad per företrädesdag).
 *   Därför skapas en rad per (dag × konserttid).
 * - Det finns INGA enskilda evenemangssidor och ingen egen biljettlänk per
 *   konsert. `url` blir programsidan, `ticketUrl` abonnemangssidan.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST kammaren.com.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'kammarencom';
const BASE = 'https://kammaren.com';
const VENUE = 'Kammaren';
const ADDRESS = 'Torsgatan 41, 113 62 Stockholm';
const CITY = 'Stockholm';
const ORGANIZER = 'Kammaren';

const HOSTS = new Set(['kammaren.com', 'www.kammaren.com']);

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

/** "11-12 november – " (tillåtet: – — -) */
const DATE_PREFIX_RX = /^(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([a-zåäö]+)\s*[–—-]\s*(.*)$/i;

/** "kl 16.15 och 19.45" */
const TIME_RX = /(\d{1,2})\s*[.:]\s*(\d{2})/g;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > 0 ? value : null;
}

/** Läser säsongens år ur rubriken ("Program 2026"). */
export function parseSeasonYear(html: string): number | null {
  const $ = cheerio.load(html);
  let year: number | null = null;
  $('h1, h2, h3, h4').each((_i, el) => {
    if (year) return;
    const match = clean($(el).text())?.match(/\b(?:Program|Programmet)\s+(\d{4})\b/i);
    if (match) year = Number(match[1]);
  });
  return year && year >= 2000 && year <= 2100 ? year : null;
}

/**
 * Läser konserttiderna ur säsongsnoten ("Konserttid båda dagarna kl 16.15
 * och 19.45"). Tom lista = sidan anger inga tider.
 */
export function parseConcertTimes(html: string): string[] {
  const $ = cheerio.load(html);
  const times: string[] = [];
  $('p').each((_i, el) => {
    const text = clean($(el).text());
    if (!text || !/konserttid/i.test(text)) return;
    for (const match of text.matchAll(TIME_RX)) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) continue;
      const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      if (!times.includes(value)) times.push(value);
    }
  });
  return times;
}

/** Ett programutdrag ur HTML:en. */
export interface RawKammarenEvent {
  title: string | null;
  dayStart: number | null;
  dayEnd: number | null;
  month: number | null;
  description: string | null;
}

/**
 * Läser programraderna. Varje rad = ett datumspann med en titel.
 */
export function parseProgram(html: string): RawKammarenEvent[] {
  const $ = cheerio.load(html);
  const events: RawKammarenEvent[] = [];

  $('p').each((_i, el) => {
    const $p = $(el);
    const fullText = clean($p.text());
    if (!fullText) return;

    // Datumet ligger i ett eget span. Ibland ligger det inuti ett yttre
    // "grått" span som ALSO innehåller titeln — därför prioriteras det span
    // som BARA innehåller datumet.
    let dateText: string | null = null;
    let dateMatch: RegExpExecArray | null = null;
    $p.find('span').each((_j, span) => {
      const candidate = clean($(span).text());
      if (!candidate) return;
      const match = DATE_PREFIX_RX.exec(candidate);
      if (!match) return;
      if (!match[4]) {
        // Spanet innehåller bara datumet — bästa fallet.
        dateMatch = match;
        dateText = candidate;
        return;
      }
      if (!dateMatch) {
        // Annars: datumet står först i spannet, titeln efter det.
        dateMatch = match;
        dateText = candidate.slice(0, candidate.length - match[4].length);
      }
    });

    if (!dateText || !dateMatch) return;

    const dayStart = Number(dateMatch[1]);
    const dayEnd = Number(dateMatch[2]);
    const month = MONTHS[dateMatch[3].toLowerCase()];
    if (!month || dayStart < 1 || dayStart > 31 || dayEnd < 1 || dayEnd > 31) return;

    // Titeln = resten av stycket efter datumet. Om datumspannet inte står
    // först i stycket används regexens egen rest.
    const title =
      fullText.startsWith(dateText)
        ? clean(fullText.slice(dateText.length))
        : clean(dateMatch[4]);
    if (!title) return;

    // Beskrivningen = närmaste stycke efter programraden.
    const description = clean($p.next('p').text());

    events.push({
      title,
      dayStart,
      dayEnd,
      month,
      description: description && !DATE_PREFIX_RX.test(description) ? description : null,
    });
  });

  return events;
}

/** Bygger ISO-datum. Returnerar null om datumet inte existerar (t.ex. 30 februari). */
function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export interface KammarenExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'kammaren-program' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): KammarenExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const program = parseProgram(html);
  if (program.length === 0) return { showUrls: [], events: [], method: 'none' };

  const year = parseSeasonYear(html);
  const times = parseConcertTimes(html);
  const pageUrl = url.includes('/program') ? url : `${BASE}/program/`;

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  for (const item of program) {
    if (!item.title || !year || !item.month) continue;

    for (let day = item.dayStart; day <= item.dayEnd; day++) {
      const iso = isoDate(year, item.month, day);
      if (!iso) continue;

      // Utan angivna tider blir det en heldagsrad.
      const timeList = times.length > 0 ? times : [undefined];

      for (const time of timeList) {
        const key = `${item.title}|${iso}|${time ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        try {
          const evt = ParsedEventSchema.parse({
            title: item.title,
            date: iso,
            time,
            venue: VENUE,
            address: ADDRESS,
            city: CITY,
            description: item.description ?? undefined,
            url: pageUrl,
            ticketUrl: `${BASE}/boka-abonnemang/`,
            organizer: ORGANIZER,
            category: 'Konsert',
            source,
            sourceUrl: url,
            confidence: {
              score: 0.72,
              hasTitle: true,
              hasDate: true,
              hasVenue: true,
              hasUrl: true,
              hasDescription: Boolean(item.description),
              hasTicketInfo: false,
              signals: [
                'kammaren-program-rad',
                `säsong:${year}`,
                time ? `tid:${time}` : 'tid:saknas',
              ],
            },
          });
          events.push(evt);
        } catch {
          /* skip malformed */
        }
      }
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [pageUrl], events, method: 'kammaren-program' };
}
