/**
 * Kungsträdgården (kungstradgarden.stockholm) adapter — evenemang i parken.
 *
 * Site-specifict mönster (verifierat 2026-10-24 med enbart gratis HTTP +
 * Wayback — noll ScrapingBee-krediter):
 *
 * - `kungstradgarden.se` är INTE sajten: det är en 841 bytes stor
 *   frameset som bara vidarebefordrar till `kungstradgarden.stockholm`.
 *   Den gamla D-AI-adaptern pekade på frameset-skalet och fick 0 events.
 * - `kungstradgarden.stockholm` är WordPress (tema "stockholms-stad-miniwebb")
 *   utan evenemangs-CPT. `wp-json/wp/v2/types` listar bara post/page/media/
 *   wp_block/… och `wp-json/wp/v2/posts` ger 0 träffar — de publiserade
 *   evenemangen hamnade i ett eget "evenemang"-inlägg.
 * - Evenemangssidan `/evenemang/` (WP-sida "Kalendarium") renderar ett
 *   `section.block.block-event-list` med `article.article-list__item`:
 *
 *     <article class="article article-list__item article-list__item--narrow">
 *       <header class="article__head article__head--narrow">
 *         <div class="media"><div class="media__image">
 *           <div class="date-label"><p class="date-label__date">2</p>
 *                                  <p class="date-label__month">aug</p></div>
 *         </div><div class="media__body">
 *           <h2 class="article__header article__header--small">
 *             <a href="https://kungstradgarden.stockholm/evenemang/sverige-tillber-jesus/" class="article__link">Sverige Tillber Jesus</a></h2>
 *           <time datetime="2025-08-02 00:00:00" class="article__date ...">
 *             2 augusti 2025 <span class="article__date__time">13:00–22:00</span></time>
 *         </div></div>
 *       </header>
 *       <div class="article__text text"><a href="..." class="article__link">
 *         <p>Över 60 församlingar …</p></a></div>
 *     </article>
 *
 *   Datumet ligger i `time[datetime]` (WordPress-format "YYYY-MM-DD 00:00:00")
 *   och tiden i `span.article__date__time` ("13:00–22:00"). `date-label`
 *   ("2" / "aug") är bara en dekorativ etikett och läses inte.
 *
 * VIKTIGT (2026-10-24): den LIVE-sidan har just nu **noll evenemang** —
 * `section.block.block-event-list` finns men är tom, `article` = 0 och
 * `time[datetime]` = 0. Adaptern är skriven mot den riktiga markupen (verifierad
 * mot Wayback-snapshotet 2025-08-01 som innehöll 9 riktiga evenemang) så att
 * den börjar fungera så snart parken publicerar igen. Den hittar ingenting
 * på en tom sida — den fabricerar inga rader.
 *
 * Adressen kommer från sidans EGEN kontaktblock ("Besöksadress: Jussi
 * Björlings allé 10, Kungsträdgården"), inte från en gissning.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST kungstradgarden.se / kungstradgarden.stockholm.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'kungstradgarden-2';
const BASE = 'https://kungstradgarden.stockholm';
const VENUE = 'Kungsträdgården';
const ADDRESS = 'Jussi Björlings allé 10, Kungsträdgården';
const CITY = 'Stockholm';

const HOSTS = new Set([
  'kungstradgarden.se',
  'www.kungstradgarden.se',
  'kungstradgarden.stockholm',
  'www.kungstradgarden.stockholm',
]);

/** Ett evenemang rått extraherat ur HTML:en. */
export interface RawKungstradgardenEvent {
  title: string | null;
  date: string | null;
  time: string | null;
  endTime: string | null;
  description: string | null;
  url: string | null;
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

/** Gör en relativ länk absolut mot kungstradgarden.stockholm. */
function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

/** Läser tidsfönstret "13:00–22:00" (eller "13:00"). */
export function parseTimeRange(raw: string | null): { time: string | null; endTime: string | null } {
  const text = clean(raw);
  if (!text) return { time: null, endTime: null };

  const range = text.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (range) {
    return {
      time: `${range[1].padStart(2, '0')}:${range[2]}`,
      endTime: `${range[3].padStart(2, '0')}:${range[4]}`,
    };
  }

  const single = text.match(/(\d{1,2}):(\d{2})/);
  if (single) return { time: `${single[1].padStart(2, '0')}:${single[2]}`, endTime: null };

  return { time: null, endTime: null };
}

/** Läser evenemangslistan. */
export function parseListing(html: string): RawKungstradgardenEvent[] {
  const $ = cheerio.load(html);
  const events: RawKungstradgardenEvent[] = [];

  const items = $('section.block.block-event-list article.article-list__item');
  const scope = items.length > 0 ? items : $('article.article-list__item');

  scope.each((_i, item) => {
    const $item = $(item);
    const link = $item.find('h2.article__header a.article__link').first();
    const title = clean(link.text());
    if (!title) return;

    const timeAttr = clean($item.find('time[datetime]').first().attr('datetime'));
    const dateMatch = timeAttr?.match(/^(\d{4}-\d{2}-\d{2})/);
    const { time, endTime } = parseTimeRange($item.find('span.article__date__time').first().text());
    const description = clean($item.find('div.article__text p').first().text());

    events.push({
      title,
      date: dateMatch ? dateMatch[1] : null,
      time,
      endTime,
      description,
      url: absoluteUrl(link.attr('href')),
    });
  });

  return events;
}

export interface KungstradgardenExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'kungstradgarden-listing' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): KungstradgardenExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const raw = parseListing(html);
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

    try {
      const evt = ParsedEventSchema.parse({
        title: item.title,
        date: item.date,
        time: item.time ?? undefined,
        endTime: item.endTime ?? undefined,
        venue: VENUE,
        address: ADDRESS,
        city: CITY,
        description: item.description ?? undefined,
        url: eventUrl,
        source,
        sourceUrl: url,
        confidence: {
          score: 0.84,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: Boolean(item.description),
          hasTicketInfo: false,
          signals: ['kungstradgarden-article-list', `venue:${VENUE}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'kungstradgarden-listing' };
}
