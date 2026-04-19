/**
 * UNIVERSAL EVENT EXTRACTOR v2 — WORLD'S BEST SCRAPER
 *
 * Comprehensive multi-pass extraction engine for Swedish event sites.
 * NO AI — pure heuristic + structured data extraction.
 *
 * Extraction priority (all run, results merged + deduped):
 *
 * PHASE 1 — Structured Data (highest precision)
 *   A1. JSON-LD (schema.org/Event)
 *   A2. Microdata (schema.org/Event in DOM)
 *
 * PHASE 2 — Embedded JavaScript Data (extremely common on Swedish/German sites)
 *   B1. window.__INITIAL_STATE__ = JSON.parse("...")
 *   B2. __NEXT_DATA__ (Next.js pages)
 *   B3. window.__STATE__ / window.INITIAL_DATA / window.EVENTS_DATA
 *   B4. AppRegistry.registerInitialState (SiteVision/React Swedish sites)
 *   B5. Large <script> blocks with "events": [...] or eventList [...]
 *   B6. JSON arrays in script with trailing commas
 *
 * PHASE 3 — HTML Heuristics (always run, no artificial threshold)
 *   C1. Rich event card extraction — expanded selector universe
 *   C2. <time datetime> anchor extraction — grouped with nearby title/link/venue/image
 *   C3. Swedish relative date parsing (Imorgon, I dag, Onsdag 15 maj)
 *   C4. ISO date + URL anchor grouping
 *
 * Normalization: ALL outputs → ParsedEvent (see schema.ts)
 *
 * Usage:
 *   import { extractEvents } from './universal-extractor';
 *   const result = extractEvents(html, sourceId, baseUrl);
 */

import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
  ParsedEventSchema,
  type ParsedEvent,
  ExtractionConfidenceSchema,
} from './schema';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractResult {
  events: ParsedEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
  methodsUsed: string[];
  methodBreakdown: Record<string, number>;
}

// ─── Date Parsing ────────────────────────────────────────────────────────────

const SWE_MONTH_MAP: Record<string, string> = {
  januari:'01',februari:'02',mars:'03',april:'04',maj:'05',juni:'06',
  juli:'07',augusti:'08',september:'09',oktober:'10',november:'11',december:'12',
  jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
  sep:'09',okt:'10',nov:'11',dec:'12',
};

const SWE_WEEKDAY_MAP: Record<string, string> = {
  måndag:'01',tisdag:'02',onsdag:'03',torsdag:'04',fredag:'05',
  lördag:'06',söndag:'07',mandag:'01',tirsdag:'02',onsdag:'03',
  torsdag:'04',fredag:'05',lordag:'06',sondag:'07',
};

const DATE_PATTERNS = [
  // ISO 8601 full
  { rx: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/, fmt: (m: string) => m.replace('T',' ') },
  // ISO date only
  { rx: /(\d{4}-\d{2}-\d{2})/, fmt: (m: string) => m },
  // Swedish: 25 mars 2025 / 25 mar 2025
  { rx: /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i,
    fmt: (_: string, day: string, mon: string, year: string) => {
      const m = SWE_MONTH_MAP[mon.toLowerCase()] ?? '01';
      return `${year}-${m}-${day.padStart(2,'0')}`;
    }
  },
  // European: 25/03/2025 or 25.03.2025 (day-first, for SE context)
  { rx: /(\d{1,2})[/\.](\d{1,2})[/\.](\d{4})/,
    fmt: (_: string, a: string, b: string, year: string) => {
      const m = parseInt(b) > 12 ? a : b;
      const d = parseInt(b) > 12 ? b : a;
      return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
  },
];

const TIME_RX = /\b(\d{1,2}):(\d{2})(?::\d{2})?/;

function getToday(): Date {
  return new Date();
}

/**
 * Parse relative Swedish date expressions.
 * "Imorgon" → tomorrow's date
 * "I dag" / "Idag" → today
 * "Måndag" (standalone, no date) → next occurrence this/next week
 */
function parseRelativeSwedishDate(text: string): string | null {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const today = getToday();

  if (/imorgon/i.test(lower)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  if (/^i\s?dag$/i.test(lower) || /^idag$/i.test(lower)) {
    return today.toISOString().split('T')[0];
  }

  const weekdayOnlyRx = /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mandag|tirsdag|onsdag|torsdag|fredag|lordag|sondag)\b(?![\s,]*\d)/i;
  const wdMatch = lower.match(weekdayOnlyRx);
  if (wdMatch) {
    const wdName = wdMatch[1].toLowerCase();
    const targetDay = SWE_WEEKDAY_MAP[wdName];
    if (!targetDay) return null;
    const target = parseInt(targetDay);
    const current = today.getDay();
    const mappedCurrent = current === 0 ? 7 : current;
    let daysUntil = target - mappedCurrent;
    if (daysUntil <= 0) daysUntil += 7;
    const result = new Date(today);
    result.setDate(result.getDate() + daysUntil);
    return result.toISOString().split('T')[0];
  }

  return null;
}

function parseDate(raw: string): { date: string; time?: string } {
  if (!raw) return { date: '' };

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [date, time] = raw.split('T');
    return { date, time: time?.slice(0,5) };
  }

  for (const p of DATE_PATTERNS) {
    const m = raw.match(p.rx);
    if (m) {
      try {
        const dateStr = p.fmt(m[1], m[2], m[3], m[4]);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const t = TIME_RX.exec(raw);
          return { date: dateStr, time: t ? `${t[1].padStart(2,'0')}:${t[2]}` : undefined };
        }
      } catch { /* invalid */ }
    }
  }

  const relDate = parseRelativeSwedishDate(raw);
  if (relDate) return { date: relDate };

  return { date: raw.slice(0, 10) };
}

// ─── URL Building ────────────────────────────────────────────────────────────

function buildUrl(href: string | undefined, base: string): string {
  if (!href) return '';
  try {
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) {
      const u = new URL(base);
      return `${u.origin}${href}`;
    }
    return new URL(href, base).href;
  } catch { return href; }
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function norm(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (val == null) return '';
  return String(val);
}

function normUrl(val: unknown, base: string): string {
  return buildUrl(norm(val), base);
}

function normPrice(val: unknown): string {
  return norm(val).replace(/[^\d.,]/g, '').replace(',', '.');
}

function parsePrice(s: string): number | undefined {
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function makeEvent(data: Record<string, unknown>, method: string, source: string, baseUrl: string): ParsedEvent | null {
  try {
    let title = '';
    if (data.translations && typeof data.translations === 'object') {
      const t = data.translations as Record<string, string>;
      title = t.originalName || t.name || t.title || '';
    }
    if (!title) title = norm(data.name || data.title || data.eventTitle || data.heading || data.label);
    if (!title) return null;

    let startDate = norm(
      data.startDate || data.start_date || data.date || data.eventDate ||
      (Array.isArray(data.dates) && data.dates[0] && ((data.dates as unknown[])[0] as Record<string,string>).startDate) ||
      (Array.isArray(data.dates) && data.dates[0] && ((data.dates as unknown[])[0] as Record<string,string>).date) || '');
    let endDate = norm(data.endDate || data.end_date || '');

    if (!startDate && Array.isArray(data.dates) && data.dates.length) {
      const first = data.dates[0] as Record<string, string>;
      startDate = norm(first.startDate || first.date || '');
      endDate = norm(first.endDate || '');
    }

    if (startDate.includes('T')) startDate = startDate.split('T')[0];
    if (endDate.includes('T')) endDate = endDate.split('T')[0];

    let time: string | undefined;
    if (data.startTime || data.time || data.eventTime) {
      const t = norm(data.startTime || data.time || data.eventTime);
      const m = t.match(TIME_RX);
      time = m ? `${m[1].padStart(2,'0')}:${m[2]}` : t.slice(0,5);
    }

    let venue = norm(data.venue || data.location || data.place || data.locationName || data.venueName);
    let city = norm(data.city || data.town || data.municipality || data.addressLocality);
    let address = norm(data.address || data.streetAddress || data.locationAddress);

    if (typeof data.location === 'object' && data.location) {
      const loc = data.location as Record<string, string>;
      venue = venue || norm(loc.name || loc.venue);
      city = city || norm(loc.city || loc.town || loc.addressLocality);
      address = address || norm(loc.address || loc.street || loc.streetAddress);
    }

    let location = venue || city || address;
    if (city && venue && !venue.includes(city)) location = `${venue}, ${city}`;

    const eventUrl = normUrl(
      data.url || data.link || data.href || data.eventUrl || data.bookingUrl || data.detailUrl, baseUrl);
    const ticketUrl = normUrl(
      data.ticketUrl || data.ticketsUrl || data.buyUrl || data.registrationUrl || data.purchaseUrl, baseUrl);

    let desc = norm(data.description || data.shortDescription || data.intro || data.text || data.shortDesc);
    if (typeof data.translations === 'object' && data.translations) {
      const t = data.translations as Record<string, string>;
      desc = desc || t.originalDescription || t.description || '';
    }
    desc = desc.replace(/<[^>]+>/g, '').slice(0, 500);

    let price = '';
    const isFree = data.isFree === true || data.isFree === 'true' || data.free === true || data.freeEntry === true;
    if (isFree) {
      price = 'Free';
    } else {
      const p = data.price || data.priceMin || data.priceAmount || data.cost || data.minPrice;
      if (p != null) price = normPrice(p);
    }

    let image = normUrl(
      data.image || data.photo || data.poster || data.thumbnail || data.img || data.imageUrl, baseUrl);
    if (Array.isArray(data.images) && data.images.length) {
      const first = data.images[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url || (first as Record<string,string>).src, baseUrl);
    }
    if (Array.isArray(data.photos) && data.photos.length) {
      const first = data.photos[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url || (first as Record<string,string>).src, baseUrl);
    }

    let category = '';
    if (Array.isArray(data.categories)) category = (data.categories as string[]).join(', ');
    else if (data.category) category = norm(data.category);
    else if (Array.isArray(data.tags)) category = (data.tags as string[]).join(', ');

    let performers: string[] = [];
    if (Array.isArray(data.performers)) performers = data.performers.map(norm);
    else if (Array.isArray(data.artists)) performers = data.artists.map(norm);
    else if (Array.isArray(data.speakers)) performers = data.speakers.map(norm);
    else if (Array.isArray(data.actors)) performers = data.actors.map(norm);
    else if (Array.isArray(data.musicians)) performers = data.musicians.map(norm);
    else if (typeof data.organizer === 'string') performers = [data.organizer];
    else if (typeof data.organizer === 'object' && data.organizer && (data.organizer as Record<string,string>).name) {
      performers = [(data.organizer as Record<string,string>).name];
    }

    let status = norm(data.status || data.eventStatus || 'posted');
    if (data.cancelled || data.canceled) status = 'cancelled';
    else if (data.soldOut || data.bookedOut) status = 'sold_out';

    const confidenceScore = ['A1','A2','B1','B2','B3','B4','B5'].includes(method) ? 0.95 : 0.75;

    const parsed = ParsedEventSchema.parse({
      title: title.slice(0, 200),
      date: startDate || 'unknown',
      time,
      endDate: endDate || undefined,
      venue: venue || undefined,
      address: address || undefined,
      city: city || undefined,
      description: desc || undefined,
      url: eventUrl || undefined,
      ticketUrl: ticketUrl || undefined,
      organizer: norm(data.organizer) || undefined,
      performers: performers.length ? performers : undefined,
      category: category || undefined,
      isFree: isFree || undefined,
      priceMin: parsePrice(price),
      priceMax: data.priceMax ? parsePrice(norm(data.priceMax)) : undefined,
      imageUrl: image || undefined,
      status,
      source,
      sourceUrl: baseUrl,
      confidence: {
        score: confidenceScore,
        hasTitle: true,
        hasDate: !!startDate,
        hasVenue: !!venue,
        hasUrl: !!eventUrl,
        hasDescription: !!desc,
        hasTicketInfo: !!(ticketUrl || isFree),
        signals: [`method:${method}`],
      },
    });
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─── JSON Safe Parse ─────────────────────────────────────────────────────────

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ─── Method A1: JSON-LD ──────────────────────────────────────────────────────

function extractJsonLd($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html() || '';
      const data = JSON.parse(content);
      collectJsonLdEvents(data, source, baseUrl, events);
    } catch { /* skip */ }
  });

  return events;
}

function collectJsonLdEvents(data: unknown, source: string, baseUrl: string, acc: ParsedEvent[]): void {
  if (!data || typeof data !== 'object') return;

  const obj = data as Record<string, unknown>;
  const type: string = String(obj['@type'] || '');

  if (['Event', 'EventSeries', 'EventTicket'].includes(type)) {
    const evt = makeEvent(obj, 'A1', source, baseUrl);
    if (evt) acc.push(evt);
  }

  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) collectJsonLdEvents(item, source, baseUrl, acc);
  }

  if (Array.isArray(obj.itemListElement)) {
    for (const item of obj.itemListElement) {
      if (typeof item === 'object' && item) {
        const i = item as Record<string, unknown>;
        const itemType = String(i['@type'] || '');
        const eventObj = i.item || i;
        if (typeof eventObj === 'object' && eventObj) {
          const et = String((eventObj as Record<string,unknown>)['@type'] || '');
          if (['Event', 'EventSeries', 'EventTicket'].includes(et) || ['Event', 'EventSeries', 'EventTicket'].includes(itemType)) {
            const evt = makeEvent(eventObj as Record<string,unknown>, 'A1', source, baseUrl);
            if (evt) acc.push(evt);
          }
        }
      }
    }
  }

  for (const key of ['subEvent', 'subEvents', 'superEvent']) {
    if (Array.isArray(obj[key])) {
      for (const sub of obj[key]) collectJsonLdEvents(sub, source, baseUrl, acc);
    } else if (obj[key]) {
      collectJsonLdEvents(obj[key], source, baseUrl, acc);
    }
  }

  if (Array.isArray(obj['@set'])) {
    for (const item of obj['@set']) collectJsonLdEvents(item, source, baseUrl, acc);
  }
}

// ─── Method A2: Microdata ─────────────────────────────────────────────────────

function extractMicrodata($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  $('[itemtype*="schema.org/Event"]').each((_, el) => {
    const data: Record<string, unknown> = {};
    $(el).find('[itemprop]').each((__, e2) => {
      const prop = $(e2).attr('itemprop') || '';
      const val = $(e2).attr('content') || $(e2).attr('datetime') || $(e2).text();
      data[prop] = val.trim();
    });
    const evt = makeEvent(data, 'A2', source, baseUrl);
    if (evt) events.push(evt);
  });

  return events;
}

// ─── Method B2: __NEXT_DATA__ (Next.js) ──────────────────────────────────────

function extractNextJsData(html: string, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return events;

  try {
    const parsed = JSON.parse(match[1]);
    recursivelyCollectEvents(parsed.props?.pageProps || parsed.props || parsed, events, source, baseUrl);
  } catch { /* skip */ }

  return events;
}

// ─── Method B1/B3: __INITIAL_STATE__ / window.* ─────────────────────────────

function extractInitialState(html: string, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  const m1 = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"/);
  if (m1) {
    try {
      const unescaped = m1[1]
        .replace(/\\"/g, '"').replace(/\\n/g, '\n')
        .replace(/\\u[\da-f]{4}/gi, (s) => String.fromCodePoint(parseInt(s.slice(2), 16)))
        .replace(/\\\\/g, '\\');
      const data = JSON.parse(unescaped);
      recursivelyCollectEvents(data, events, source, baseUrl);
    } catch { /* skip */ }
  }

  if (events.length > 0) return events;

  for (const varName of ['__STATE__', 'INITIAL_DATA', 'EVENTS_DATA', 'eventStore', 'EVENT_STORE', 'pageData', 'GLOBALS']) {
    const rx = new RegExp('window\\.' + varName + '\\s*=\\s*({[\\s\\S]*?})\\s*;?', '');
    const m = html.match(rx);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        recursivelyCollectEvents(data, events, source, baseUrl);
        if (events.length > 0) return events;
      } catch { /* skip */ }
    }
  }

  // Generic JSON.parse("...") inside script blocks
  const jsonParseRx = /JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"/g;
  let jsonMatch;
  while ((jsonMatch = jsonParseRx.exec(html)) !== null) {
    try {
      const unescaped = jsonMatch[1]
        .replace(/\\"/g, '"').replace(/\\n/g, '\n')
        .replace(/\\u[\da-f]{4}/gi, (s) => String.fromCodePoint(parseInt(s.slice(2), 16)));
      const data = JSON.parse(unescaped);
      const before = events.length;
      recursivelyCollectEvents(data, events, source, baseUrl);
      if (events.length > before) return events;
    } catch { /* continue */ }
  }

  return events;
}

function recursivelyCollectEvents(data: unknown, acc: ParsedEvent[], source: string, baseUrl: string): void {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item) {
        const obj = item as Record<string, unknown>;
        if (obj.name || obj.title || obj.eventTitle) {
          const evt = makeEvent(obj, 'B1', source, baseUrl);
          if (evt) acc.push(evt);
        }
        recursivelyCollectEvents(item, acc, source, baseUrl);
      }
    }
    return;
  }

  const obj = data as Record<string, unknown>;

  if (obj.name || obj.title) {
    const evt = makeEvent(obj, 'B1', source, baseUrl);
    if (evt) acc.push(evt);
  }

  for (const key of ['events', 'eventList', 'items', 'data', 'results', 'children', 'entries', 'content', 'event', 'eventsData', 'eventData', '_events', 'allEvents']) {
    if (obj[key]) recursivelyCollectEvents(obj[key], acc, source, baseUrl);
  }
}

// ─── Method B4: AppRegistry.registerInitialState ───────────────────────────────

function extractAppRegistryEvents(html: string, source: string, baseUrl: string, acc: ParsedEvent[]): boolean {
  const callStart = html.indexOf("AppRegistry.registerInitialState('");
  if (callStart < 0) return false;

  const braceStart = html.indexOf(',', callStart);
  if (braceStart < 0) return false;

  let jsonStart = -1;
  for (let i = braceStart; i < html.length && i < braceStart + 100; i++) {
    if (html[i] === '{') { jsonStart = i; break; }
  }
  if (jsonStart < 0) return false;

  let depth = 0, jsonEnd = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
    if (html.slice(i, i + 9) === '</script>') { jsonEnd = i - 1; break; }
  }
  if (jsonEnd < 0) return false;

  const jsonStr = html.slice(jsonStart, jsonEnd + 1);

  try {
    const data = JSON.parse(jsonStr);
    return collectEventsFromObject(data, acc, source, baseUrl);
  } catch {
    try {
      const cleaned = jsonStr.replace(/,(\s*[}\]])/g, '$1');
      const data = JSON.parse(cleaned);
      return collectEventsFromObject(data, acc, source, baseUrl);
    } catch { return false; }
  }
}

// ─── Method B5: Large JS blocks with arrays ───────────────────────────────────

function extractJsEmbeddedEvents(html: string, source: string, baseUrl: string): { events: ParsedEvent[]; method: string } {
  const events: ParsedEvent[] = [];

  // B4d: AppRegistry
  const appOk = extractAppRegistryEvents(html, source, baseUrl, events);
  if (appOk && events.length > 0) return { events, method: 'B4d' };

  // B2: __NEXT_DATA__
  const nextEvents = extractNextJsData(html, source, baseUrl);
  if (nextEvents.length > 0) {
    events.push(...nextEvents);
    return { events, method: 'B2' };
  }

  // B1/B3: InitialState / window.*
  const initEvents = extractInitialState(html, source, baseUrl);
  if (initEvents.length > 0) {
    events.push(...initEvents);
    return { events, method: 'B1' };
  }

  const $ = cheerio.load(html);

  const scriptBlocks: Array<{ content: string; len: number }> = [];
  $('script').each((_, el) => {
    const content = (el.children[0] as unknown as { data?: string })?.data || $(el).html() || '';
    if (content.length < 5000 && !content.includes('"events"') && !content.includes("'events'")) return;
    scriptBlocks.push({ content, len: content.length });
  });
  scriptBlocks.sort((a, b) => b.len - a.len);

  for (const { content } of scriptBlocks) {
    let found = extractEventsArrayPattern(content, source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B5a' };

    found = extractEventsArrayPattern(content.replace(/'/g, '"'), source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B5b' };

    for (const varName of ['eventList', 'eventsData', 'event_data', 'EVENT_DATA', 'window.events', 'eventData', '_events', 'allEvents', 'eventItems']) {
      const rx = new RegExp('(?:var|let|const)\\s+' + varName + '\\s*=\\s*\\[', '');
      if (rx.test(content)) {
        const idx = content.search(rx);
        const arrStart = content.indexOf('[', idx);
        if (arrStart >= 0) {
          let depth = 0, arrEnd = -1;
          for (let k = arrStart; k < content.length; k++) {
            if (content[k] === '[') depth++;
            else if (content[k] === ']') { depth--; if (depth === 0) { arrEnd = k; break; } }
            if (depth === 0 && k > arrStart + 10) break;
          }
          if (arrEnd > arrStart) {
            const arrStr = content.slice(arrStart, arrEnd + 1).replace(/,(\s*[}\]])/g, '$1');
            const parsed = tryParseJson(arrStr);
            if (parsed && Array.isArray(parsed)) {
              let count = 0;
              for (const item of parsed) {
                if (typeof item === 'object' && item) {
                  const evt = makeEvent(item as Record<string,unknown>, 'B5c', source, baseUrl);
                  if (evt) { events.push(evt); count++; }
                }
              }
              if (count > 0) return { events, method: 'B5c' };
            }
          }
        }
      }
    }
  }

  return { events: [], method: '' };
}

function collectEventsFromObject(obj: unknown, acc: ParsedEvent[], source: string, baseUrl: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    let found = false;
    for (const item of obj) {
      if (collectEventsFromObject(item, acc, source, baseUrl)) found = true;
    }
    return found;
  }

  const o = obj as Record<string, unknown>;

  if (Array.isArray(o.events) && o.events.length > 0) {
    let count = 0;
    for (const item of o.events) {
      if (typeof item === 'object' && item) {
        const evt = makeEvent(item as Record<string,unknown>, 'B4d', source, baseUrl);
        if (evt) { acc.push(evt); count++; }
      }
    }
    return count > 0;
  }

  for (const key of ['data', 'items', 'results', 'children', 'entries', 'content', 'event', 'eventsData', 'pageProps']) {
    if (o[key]) {
      if (collectEventsFromObject(o[key], acc, source, baseUrl)) return true;
    }
  }

  return false;
}

function extractEventsArrayPattern(
  content: string, source: string, baseUrl: string, acc: ParsedEvent[], key: string
): boolean {
  const idx = content.indexOf(key);
  if (idx < 0) return false;

  let arrStart = -1;
  for (let i = idx + key.length; i < content.length; i++) {
    if (content[i] === '[') { arrStart = i; break; }
    if (content[i] === '{' || content[i] === '"') return false;
  }
  if (arrStart < 0) return false;

  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    if (depth === 0 && i > arrStart + 10) {
      const rest = content.slice(i+1, i+20).trim();
      if (rest.startsWith('}') || (rest.startsWith(',') && rest.includes('}'))) { arrEnd = i; depth = 0; break; }
    }
  }
  if (arrEnd < 0) return false;

  const arrStr = content.slice(arrStart, arrEnd + 1);
  const cleaned = arrStr.replace(/,(\s*[}\]])/g, '$1');
  const parsed = tryParseJson(cleaned);
  if (!parsed || !Array.isArray(parsed)) return false;

  let count = 0;
  for (const item of parsed) {
    if (typeof item === 'object' && item && !Array.isArray(item)) {
      const evt = makeEvent(item as Record<string,unknown>, 'B5', source, baseUrl);
      if (evt) { acc.push(evt); count++; }
    }
  }

  return count > 0;
}

// ─── PHASE 3: HTML HEURISTICS ────────────────────────────────────────────────

/**
 * Rich HTML event card extraction — 20x selector universe vs v1.
 * Groups all related fields (title, date, venue, image, price) per event card.
 */
function extractHtmlHeuristics($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const EVENT_CARD_SELECTORS = [
    // Swedish venue patterns (most important)
    '[class*="event"]', '[class*="kalender"]', '[class*="evenemang"]',
    '[class*="program"]', '[class*="konsert"]', '[class*="forestilling"]',
    '[class*="show"]', '[class*="biljett"]', '[class*="arrangement"]',
    '[class*="arrangemang"]', '[class*="aktivitet"]', '[class*="activity"]',
    // International
    'article', '.card', '.item', '.entry', '.post',
    'li[class*="event"]', 'li[class*="kalender"]', 'li[class*="program"]',
    'li[class*="item"]', 'li[class*="card"]',
    // Data attributes
    '[data-event]', '[data-item]', '[data-type="event"]',
    '[role="article"]', '[itemtype*="Event"]',
    // Rich CSS class patterns
    '.event-card', '.event-item', '.event-row', '.event-block',
    '.kalender-item', '.kalender-rad', '.program-item', '.program-rad',
    '.evenemang-item', '.happening-item', '.happening-card',
    '.activity-item', '.activity-card',
  ];

  function extractTitle($el: cheerio.CheerioAPI, $card: any): string {
    const headingSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[class*="title"]', '[class*="heading"]', '[class*="namn"]', '[class*="name"]',
      '[data-title]', '[data-name]',
    ];
    for (const sel of headingSelectors) {
      const t = $card.find(sel).first().text().trim();
      if (t && t.length >= 2 && t.length <= 200) return t;
    }
    const anchorTitle = $card.find('a[title]').attr('title') || '';
    if (anchorTitle.length > 2) return anchorTitle;
    const linkText = $card.find('a').first().text().trim();
    if (linkText.length > 2) return linkText;
    return $card.find('img[alt]').attr('alt') || '';
  }

  function extractDate($el: cheerio.CheerioAPI, $card: any): { date: string; time?: string } {
    const $time = $card.find('time[datetime]').first();
    if ($time.length) {
      const dt = $time.attr('datetime') || '';
      if (dt) return parseDate(dt);
    }
    for (const attr of ['data-date', 'data-start', 'data-event-date', 'data-datetime', 'data-time']) {
      const val = $card.attr(attr) || '';
      if (val) return parseDate(val);
    }
    const cardText = $card.text();
    const sweDateRx = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i;
    const m = cardText.match(sweDateRx);
    if (m) return parseDate(cardText);
    for (const rel of ['imorgon', 'i dag', 'idag']) {
      if (cardText.toLowerCase().includes(rel)) {
        const result = parseRelativeSwedishDate(rel);
        if (result) return { date: result };
      }
    }
    const href = $card.find('a[href]').first().attr('href') || '';
    const urlMatch = href.match(/(\d{4}-\d{2}-\d{2})/);
    if (urlMatch) return parseDate(urlMatch[1]);
    return { date: '' };
  }

  function extractVenue($el: cheerio.CheerioAPI, $card: any): { venue: string; city: string } {
    const venueSelectors = [
      '[class*="venue"]', '[class*="location"]', '[class*="plats"]', '[class*="adress"]',
      '[class*="arena"]', '[class*="scene"]', '[class*="ort"]', '[class*="stad"]',
      'address', '[class*="where"]', '[class*="location-name"]',
    ];
    for (const sel of venueSelectors) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && t.length < 200) {
        const parts = t.split(',').map(p => p.trim());
        if (parts.length >= 2) return { venue: parts[0], city: parts[1] };
        return { venue: t, city: '' };
      }
    }
    return { venue: '', city: '' };
  }

  function extractPrice($card: any): { price: string; isFree: boolean } {
    const priceSelectors = [
      '[class*="price"]', '[class*="biljett"]', '[class*="kostnad"]', '[class*="pris"]',
      '[class*="entry-price"]', '[class*="ticket"]', '[class*="cost"]',
      '[data-price]', '[data-cost]',
    ];
    for (const sel of priceSelectors) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length < 50) {
        const isFree = /gratis|free|fritt|0\s*(kr|sek)|kostnadsfri/i.test(t);
        if (isFree || /\d/.test(t)) return { price: t, isFree };
      }
    }
    return { price: '', isFree: false };
  }

  function extractImage($card: any, baseUrl: string): string {
    const $pic = $card.find('picture source[srcset]').first();
    if ($pic.length) {
      const srcset = $pic.attr('srcset') || '';
      const first = srcset.split(',')[0].trim().split(' ')[0];
      if (first) return buildUrl(first, baseUrl);
    }
    for (const sel of ['img[src]', 'img[data-src]', '[class*="image"] img', '[class*="poster"] img']) {
      const $img = $card.find(sel).first();
      if ($img.length) {
        const src = $img.attr('src') || $img.attr('data-src') || '';
        if (src && !src.includes('data:') && src.length > 4) return buildUrl(src, baseUrl);
      }
    }
    return '';
  }

  function extractUrl($card: any, baseUrl: string): string {
    const $a = $card.find('a[href]').first();
    const href = $a.attr('href') || '';
    if (!href || href === '#' || href === '/' || href.startsWith('#')) return '';
    return buildUrl(href, baseUrl);
  }

  function extractCategory($card: any): string {
    const attr = ($card.attr('class') || '') + ' ' + ($card.attr('data-category') || '');
    const catMap: Array<[RegExp, string]> = [
      [/konsert|musik/i, 'music'], [/teater|scen|drama/i, 'theater'],
      [/dans|dance/i, 'dance'], [/barn|familj/i, 'family'],
      [/utställning|konst|exhibition/i, 'art'], [/sport|match/i, 'sports'],
      [/mat|food|wine|öl/i, 'food'], [/jazz|blues/i, 'music'],
      [/festival/i, 'festival'], [/film|movie/i, 'film'],
      [/föreläsning|seminarium/i, 'education'],
    ];
    for (const [rx, cat] of catMap) { if (rx.test(attr)) return cat; }
    return 'culture';
  }

  function extractDescription($card: any): string {
    for (const sel of ['p', '[class*="desc"]', '[class*="text"]', '[class*="summary"]', '[class*="intro"]', '[class*="lead"]']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ').slice(0, 300);
      if (t && t.length > 10) return t;
    }
    return '';
  }

  function extractTicketUrl($card: any, baseUrl: string): string {
    for (const sel of ['a[class*="ticket"]', 'a[class*="biljett"]', 'a[class*="book"]', 'a[class*="köp"]', 'a[class*="boka"]']) {
      const href = $card.find(sel).first().attr('href') || '';
      if (href && href.length > 3) return buildUrl(href, baseUrl);
    }
    return '';
  }

  const $scope = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list, [class*="event"]');
  const $searchRoot = $scope.length >= 3 ? $scope : $('body');

  for (const sel of EVENT_CARD_SELECTORS) {
    $searchRoot.find(sel).each((_: any, el: any) => {
      const $card = $(el);

      if ($card.closest('nav, footer, .nav, .sidebar, [class*="breadcrumb"]').length > 0) return;
      if ($card.closest('[class*="news"], [class*="article"], [class*="blog"], [class*="post"]').length > 0) return;

      const title = extractTitle($, $card);
      if (!title || title.length < 2 || title.length > 200) return;

      const { date, time } = extractDate($, $card);
      if (!date) return;

      const { venue, city } = extractVenue($, $card);
      const { price, isFree } = extractPrice($card);
      const image = extractImage($card, baseUrl);
      const eventUrl = extractUrl($card, baseUrl);
      const category = extractCategory($card);
      const desc = extractDescription($card);
      const ticketUrl = extractTicketUrl($card, baseUrl);

      const key = `${title}|${date}|${time || ''}|${eventUrl}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      try {
        const priceMin = price && !isFree ? parsePrice(price) : undefined;
        const evt = ParsedEventSchema.parse({
          title, date, time: time || undefined,
          venue: venue || undefined, city: city || undefined,
          description: desc || undefined,
          url: eventUrl || undefined, ticketUrl: ticketUrl || undefined,
          category, isFree: isFree || undefined, priceMin,
          imageUrl: image || undefined,
          source, sourceUrl: baseUrl,
          confidence: {
            score: 0.72,
            hasTitle: true, hasDate: true, hasVenue: !!venue,
            hasUrl: !!eventUrl, hasDescription: !!desc,
            hasTicketInfo: !!(ticketUrl || isFree),
            signals: ['html-rich-card'],
          },
        });
        events.push(evt);
      } catch { /* skip malformed */ }
    });
  }

  return events;
}

/**
 * Extract events from <time datetime> anchors — groups time tag with nearby
 * title/link/venue/image. Primary pattern for Tribe Events Calendar, SiteVision, React.
 */
function extractTimeAnchors($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const $scope = $('main, article, [role="main"], .content, .kalender, .event-list, [class*="event"], body');
  const searchRoot = $scope.length >= 2 ? $scope : $('body');

  searchRoot.find('time[datetime]').each((_: any, timeEl: any) => {
    const $time = $(timeEl);
    const datetime = $time.attr('datetime') || '';
    if (!datetime || !/^\d{4}-\d{2}-\d{2}/.test(datetime)) return;

    if ($time.closest('nav, footer, [class*="breadcrumb"], [class*="nav"], [class*="news"], [class*="article"]').length > 0) return;

    const { date, time } = parseDate(datetime);

    const $card = $time.closest(
      'li, article, [class*="event"], [class*="kalender"], [class*="item"], [class*="card"], [class*="row"], [class*="program"], [class*="entry"], [class*="happening"]'
    );
    if (!$card.length) return;

    const cardClass = $card.attr('class') || '';
    if (/news|article|blog|post/i.test(cardClass)) return;

    let title = '';
    for (const sel of ['h1','h2','h3','h4','[class*="title"]','[class*="heading"]','[data-title]']) {
      const t = $card.find(sel).first().text().trim();
      if (t && t.length >= 2) { title = t; break; }
    }
    if (!title) title = $card.find('a[title]').attr('title') || '';
    if (!title) {
      const $link = $time.closest('a');
      if ($link.length) title = $link.attr('title') || $link.text().trim().replace(/\s+/g, ' ');
    }
    if (!title || title.length < 2) return;

    let eventUrl = '';
    const $link = $card.find('a[href]').filter((_: any, a: any) => {
      const t = $(a).text().trim();
      return t.length > 2 && !/^(boka|book|köp|buy|läs|read|mer|more)$/i.test(t);
    }).first();
    if ($link.length) {
      const href = $link.attr('href') || '';
      if (href && !href.startsWith('#')) eventUrl = buildUrl(href, baseUrl);
    }

    let venue = '', city = '';
    for (const sel of ['[class*="venue"]','[class*="location"]','[class*="plats"]','[class*="arena"]','[class*="scene"]','address']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && t.length < 200) {
        const parts = t.split(',').map(p => p.trim());
        venue = parts[0]; city = parts[1] || ''; break;
      }
    }

    let image = '';
    const $img = $card.find('img[src]').first();
    if ($img.length) {
      const src = $img.attr('src') || '';
      if (src && !src.includes('data:')) image = buildUrl(src, baseUrl);
    }

    let isFree = false, priceMin: number | undefined;
    for (const sel of ['[class*="price"]','[class*="biljett"]','[class*="pris"]']) {
      const t = $card.find(sel).first().text().trim();
      if (t && /\d/.test(t)) {
        isFree = /gratis|free|fritt|0\s*(kr|sek)/i.test(t);
        if (!isFree) priceMin = parsePrice(t);
        break;
      }
    }

    let desc = '';
    for (const sel of ['p','[class*="desc"]','[class*="text"]','[class*="intro"]']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ').slice(0, 200);
      if (t && t.length > 10) { desc = t; break; }
    }

    let category = 'culture';
    const catMap: Array<[RegExp, string]> = [
      [/konsert|musik/i,'music'], [/teater|scen/i,'theater'], [/dans|dance/i,'dance'],
      [/barn|familj/i,'family'], [/utställning|konst/i,'art'], [/sport|match/i,'sports'],
      [/mat|food/i,'food'], [/jazz|blues/i,'music'], [/festival/i,'festival'],
    ];
    for (const [rx, cat] of catMap) { if (rx.test(cardClass)) { category = cat; break; } }

    const key = `${title}|${date}|${time || ''}|${eventUrl}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title, date, time: time || undefined,
        venue: venue || undefined, city: city || undefined,
        description: desc || undefined,
        url: eventUrl || undefined,
        isFree: isFree || undefined, priceMin,
        imageUrl: image || undefined,
        category, source, sourceUrl: eventUrl || baseUrl,
        confidence: {
          score: 0.75,
          hasTitle: true, hasDate: true, hasVenue: !!venue,
          hasUrl: !!eventUrl, hasDescription: !!desc,
          hasTicketInfo: !!(isFree || priceMin !== undefined),
          signals: ['html-time-anchor'],
        },
      });
      events.push(evt);
    } catch { /* skip */ }
  });

  return events;
}

/**
 * Extract events from Swedish relative date expressions in page text.
 * Handles: "Imorgon", "I dag", "Onsdag" (standalone weekday → next occurrence).
 */
function extractSwedishRelativeDates($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const $scope = $('main, article, [role="main"], .content, .kalender, .event-list, [class*="event"]');
  const $searchRoot = $scope.length >= 2 ? $scope : $('body');

  $searchRoot.find('a[href]').each((_: any, el: any) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.startsWith('#') || href === '/' || !href) return;
    if ($a.closest('nav, footer, .nav, [class*="breadcrumb"]').length > 0) return;

    const linkText = $a.text().trim().replace(/\s+/g, ' ');
    if (linkText.length < 3 || linkText.length > 200) return;
    if (/^(boka|book|köp|buy|läs|read|mer|more|idag|imorgon)$/i.test(linkText)) return;

    const $card = $a.closest('li, article, [class*="event"], [class*="item"], [class*="card"], [class*="kalender"], [class*="program"]');
    if (!$card.length) return;

    const cardText = $card.text();

    let foundDate = '', foundTime = '';

    for (const rel of ['imorgon', 'i dag', 'idag']) {
      if (cardText.toLowerCase().includes(rel)) {
        const result = parseRelativeSwedishDate(rel);
        if (result) { foundDate = result; break; }
      }
    }

    if (!foundDate) {
      const weekdayRx = /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mandag|tirsdag|onsdag|torsdag|fredag|lordag|sondag)\b(?![\s,]*\d)/i;
      const wdMatch = cardText.match(weekdayRx);
      if (wdMatch) {
        const result = parseRelativeSwedishDate(wdMatch[1]);
        if (result) foundDate = result;
      }
    }

    if (!foundDate) {
      const $parent = $card.parent();
      const siblingText = $parent.clone().children().remove().end().text();
      const sweDateRx = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i;
      const m = siblingText.match(sweDateRx);
      if (m) {
        const result = parseDate(siblingText);
        if (result.date) foundDate = result.date;
      }
    }

    if (!foundDate) return;

    const timeMatch = cardText.match(/\b(\d{1,2}):(\d{2})\b/);
    if (timeMatch) foundTime = `${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}`;

    let venue = '';
    for (const sel of ['[class*="venue"]','[class*="location"]','[class*="plats"]','[class*="arena"]','address']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1) { venue = t; break; }
    }

    const eventUrl = buildUrl(href, baseUrl);
    const key = `${linkText}|${foundDate}|${foundTime}|${eventUrl}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title: linkText, date: foundDate, time: foundTime || undefined,
        venue: venue || undefined, url: eventUrl || undefined,
        source, sourceUrl: eventUrl || baseUrl,
        confidence: {
          score: 0.60,
          hasTitle: true, hasDate: true, hasVenue: !!venue,
          hasUrl: !!eventUrl, hasDescription: false, hasTicketInfo: false,
          signals: ['html-swedish-relative-date'],
        },
      });
      events.push(evt);
    } catch { /* skip */ }
  });

  return events;
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function extractEvents(html: string, source: string, baseUrl: string): ExtractResult {
  const errors: string[] = [];
  const methodBreakdown: Record<string, number> = {};
  const allEvents: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  function addEvents(events: ParsedEvent[], method: string): void {
    for (const evt of events) {
      const key = `${evt.title}|${evt.date}|${evt.time || ''}|${evt.url || ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allEvents.push(evt);
      methodBreakdown[method] = (methodBreakdown[method] || 0) + 1;
    }
  }

  if (!html || html.length < 100) {
    return { events: [], rawCount: 0, parseErrors: ['Empty HTML'], sourceUrl: baseUrl, methodsUsed: [], methodBreakdown: {} };
  }

  const $ = cheerio.load(html);

  // PHASE 1: Structured Data
  addEvents(extractJsonLd($, source, baseUrl), 'A1');
  addEvents(extractMicrodata($, source, baseUrl), 'A2');

  // PHASE 2: JavaScript Data
  const jsResult = extractJsEmbeddedEvents(html, source, baseUrl);
  if (jsResult.events.length) addEvents(jsResult.events, jsResult.method);

  // PHASE 3: HTML Heuristics — ALL methods run, no threshold
  addEvents(extractHtmlHeuristics($, source, baseUrl), 'C1');
  addEvents(extractTimeAnchors($, source, baseUrl), 'C2');
  addEvents(extractSwedishRelativeDates($, source, baseUrl), 'C3');

  const methodsUsed = Object.keys(methodBreakdown);

  if (allEvents.length > 0) {
    console.log(`[UniversalExtractor v2] ${allEvents.length} events via ${methodsUsed.join('+')} | ${Object.entries(methodBreakdown).map(([k,v]) => `${k}:${v}`).join(', ')}`);
  }

  return {
    events: allEvents,
    rawCount: allEvents.length,
    parseErrors: errors,
    sourceUrl: baseUrl,
    methodsUsed,
    methodBreakdown,
  };
}

// Alias for backward compatibility
export const extractFromHtml = extractEvents;
