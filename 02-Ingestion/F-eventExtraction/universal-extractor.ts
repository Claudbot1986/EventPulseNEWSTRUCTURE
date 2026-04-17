/**
 * UNIVERSAL EVENT EXTRACTOR v1
 * 
 * Boil-the-ocean extractor: tries EVERY known method to find events.
 * 
 * Methods tried in order (first success wins):
 * 
 * TYPE A — Structured Data (highest precision)
 *   A1. JSON-LD (schema.org/Event)           ← current C3 only does this
 *   A2. Microdata (schema.org/Event in DOM)
 * 
 * TYPE B — Embedded JSON in JavaScript (very common on Swedish/German municipal sites)
 *   B1. window.__INITIAL_STATE__ = JSON.parse("...")
 *   B2. __INITIAL_STATE__ = {...}
 *   B3. eventsData = [...], eventList = [...], EVENT_DATA = [...]
 *   B4. Large <script> blocks with "events": [...] — THE GOLD MINE for Cruncho/Lund-style sites
 *   B5. JSON arrays with trailing commas (fix before parsing)
 * 
 * TYPE C — HTML Heuristics (fallback when structured data fails)
 *   C1. time/datetime attributes
 *   C2. <time> elements with datetime
 *   C3. data-date, data-time, data-start attributes
 *   C4. Event-link patterns (title in <a> near date)
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
  methodsUsed: string[];      // which methods found events
  methodBreakdown: Record<string, number>; // method → count
}

// ─── Confidence helpers ──────────────────────────────────────────────────────

type Confidence = z.infer<typeof ExtractionConfidenceSchema>;

// ─── Date Parsing ────────────────────────────────────────────────────────────

const DATE_PATTERNS = [
  // ISO
  { rx: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/, fmt: (m: string) => m.replace('T', ' ') },
  { rx: /(\d{4}-\d{2}-\d{2})/, fmt: (m: string) => m },
  // Swedish: 25 mars 2025, 25 mar 2025
  { rx: /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/i, fmt: (d: string, day: string, mon: string, year: string) => {
    const m: Record<string,string> = {januari:'01',februari:'02',mars:'03',april:'04',maj:'05',juni:'06',juli:'07',augusti:'08',september:'09',oktober:'10',november:'11',december:'12'};
    return `${year}-${m[mon.toLowerCase()]}-${day.padStart(2,'0')}`;
  }},
  // Swedish short: 25 mar 2025
  { rx: /(\d{1,2})\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i, fmt: (d: string, day: string, mon: string, year: string) => {
    const m: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',maj:'05',jun:'06',jul:'07',aug:'08',sep:'09',okt:'10',nov:'11',dec:'12'};
    return `${year}-${m[mon.toLowerCase()]}-${day.padStart(2,'0')}`;
  }},
  // European: 25/03/2025 or 25.03.2025
  { rx: /(\d{1,2})[/\.](\d{1,2})[/\.](\d{4})/, fmt: (d: string, a: string, b: string, year: string) => `${year}-${b.padStart(2,'0')}-${a.padStart(2,'0')}` },
  // American: 03/25/2025
  { rx: /(\d{1,2})[/\.](\d{1,2})[/\.](\d{4})/, fmt: (d: string, a: string, b: string, year: string) => `${year}-${a.padStart(2,'0')}-${b.padStart(2,'0')}` },
];

const TIME_RX = /\b(\d{1,2}):(\d{2})(?::\d{2})?\b/;

function parseDate(raw: string): { date: string; time?: string } {
  if (!raw) return { date: '' };
  
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [date, time] = raw.split('T');
    return { date, time: time?.slice(0,5) };
  }
  
  for (const p of DATE_PATTERNS) {
    const m = raw.match(p.rx);
    if (m) {
      try {
        const dateStr = p.fmt(m[1], m[2], m[3], m[4]);
        // Validate
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const t = TIME_RX.exec(raw);
          return { date: dateStr, time: t ? `${t[1].padStart(2,'0')}:${t[2]}` : undefined };
        }
      } catch { /* invalid */ }
    }
  }
  
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

function makeEvent(data: Record<string, unknown>, method: string, source: string, baseUrl: string): ParsedEvent | null {
  try {
    // Title
    let title = '';
    if (data.translations && typeof data.translations === 'object') {
      const t = data.translations as Record<string, string>;
      title = t.originalName || t.name || t.title || '';
    }
    if (!title) title = norm(data.name || data.title || data.eventTitle || data.heading);
    if (!title) return null;

    // Dates
    let startDate = norm(data.startDate || data.start_date || data.date || data.eventDate || (data.dates && (data.dates as unknown[])[0] && ((data.dates as unknown[])[0] as Record<string,string>).startDate));
    let endDate = norm(data.endDate || data.end_date || '');
    
    // Handle dates array (Cruncho format)
    if (!startDate && Array.isArray(data.dates) && data.dates.length) {
      const first = data.dates[0] as Record<string, string>;
      startDate = norm(first.startDate || first.date || '');
      endDate = norm(first.endDate || '');
    }
    
    // Handle "startDate: 2025-05-01T10:00:00" → "2025-05-01"
    if (startDate.includes('T')) startDate = startDate.split('T')[0];
    if (endDate.includes('T')) endDate = endDate.split('T')[0];

    // Time
    let time: string | undefined;
    if (data.startTime || data.time) {
      const t = norm(data.startTime || data.time);
      const m = t.match(TIME_RX);
      time = m ? `${m[1].padStart(2,'0')}:${m[2]}` : t.slice(0,5);
    }

    // Location
    let venue = norm(data.venue || data.location || data.place || data.locationName);
    let city = norm(data.city || data.town || data.municipality);
    let address = norm(data.address || data.streetAddress || data.locationAddress);
    
    if (typeof data.location === 'object' && data.location) {
      const loc = data.location as Record<string, string>;
      venue = venue || norm(loc.name || loc.venue);
      city = city || norm(loc.city || loc.town);
      address = address || norm(loc.address || loc.street);
    }

    let location = venue || city || address;
    if (city && venue && !venue.includes(city)) location = `${venue}, ${city}`;

    // URLs
    const eventUrl = normUrl(data.url || data.link || data.href || data.eventUrl || data.bookingUrl, baseUrl);
    const ticketUrl = normUrl(data.ticketUrl || data.ticketsUrl || data.buyUrl || data.registrationUrl, baseUrl);

    // Description
    let desc = norm(data.description || data.shortDescription || data.intro || data.text);
    if (typeof data.translations === 'object' && data.translations) {
      const t = data.translations as Record<string, string>;
      desc = desc || t.originalDescription || t.description || '';
    }
    // Strip HTML
    desc = desc.replace(/<[^>]+>/g, '').slice(0, 500);

    // Price
    let price = '';
    const isFree = data.isFree === true || data.isFree === 'true' || data.free === true;
    if (isFree) {
      price = 'Free';
    } else {
      const p = data.price || data.priceMin || data.cost;
      if (p != null) price = norm(p);
    }

    // Image
    let image = normUrl(data.image || data.photo || data.poster || data.thumbnail, baseUrl);
    if (Array.isArray(data.images) && data.images.length) {
      const first = data.images[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url, baseUrl);
    }
    if (Array.isArray(data.photos) && data.photos.length) {
      const first = data.photos[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url, baseUrl);
    }

    // Categories / Performers
    let category = '';
    if (Array.isArray(data.categories)) category = data.categories.join(', ');
    else if (data.category) category = norm(data.category);
    
    let performers: string[] = [];
    if (Array.isArray(data.performers)) performers = data.performers.map(norm);
    else if (Array.isArray(data.artists)) performers = data.artists.map(norm);
    else if (Array.isArray(data.speakers)) performers = data.speakers.map(norm);
    else if (typeof data.organizer === 'string') performers = [data.organizer];

    // Status
    let status = norm(data.status || data.eventStatus || 'posted');
    if (data.cancelled || data.canceled) { status = 'cancelled'; }

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
      priceMin: typeof data.priceMin === 'number' ? data.priceMin : undefined,
      priceMax: typeof data.priceMax === 'number' ? data.priceMax : undefined,
      imageUrl: image || undefined,
      status,
      source,
      sourceUrl: baseUrl,
      confidence: {
        score: ['A1','A2','B1','B4'].includes(method) ? 0.95 : 0.7,
        hasTitle: true,
        hasDate: !!startDate,
        hasVenue: !!venue,
        hasUrl: !!eventUrl,
        hasDescription: !!desc,
        hasTicketInfo: !!ticketUrl,
        signals: [`method:${method}`],
      },
    });
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─── Method A1: JSON-LD ──────────────────────────────────────────────────────

function extractJsonLd($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const JSON_LD_TYPES = ['Event', 'EventSeries', 'EventTicket'];
  
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
  
  // Direct Event
  if (['Event', 'EventSeries', 'EventTicket'].includes(type)) {
    const evt = makeEvent(obj, 'A1', source, baseUrl);
    if (evt) acc.push(evt);
  }
  
  // @graph array
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      collectJsonLdEvents(item, source, baseUrl, acc);
    }
  }
  
  // itemListElement (annexet ItemList)
  if (Array.isArray(obj.itemListElement)) {
    for (const item of obj.itemListElement) {
      if (typeof item === 'object' && item) {
        const i = item as Record<string, unknown>;
        const itemType: string = String(i['@type'] || '');
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
  
  // subEvent / superEvent (EventSeries)
  for (const key of ['subEvent', 'subEvents', 'subEvents', 'superEvent']) {
    if (Array.isArray(obj[key])) {
      for (const sub of obj[key]) collectJsonLdEvents(sub, source, baseUrl, acc);
    } else if (obj[key]) {
      collectJsonLdEvents(obj[key], source, baseUrl, acc);
    }
  }
  
  // Direct array of events
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

// ─── Method B4: Large JS blocks with "events": [...] ──────────────────────────
// THE GOLD MINE for Swedish municipal/Cruncho sites
// Lund: "events": [{"hipTixUrl":..., "name":..., "startDate":...

function extractJsEmbeddedEvents(html: string, source: string, baseUrl: string): { events: ParsedEvent[]; method: string } {
  const events: ParsedEvent[] = [];
  
  // ── B4d: AppRegistry.registerInitialState('id',{...,events:[...]}) ─────────
  // Lund, Västerås, och många Swedish SiteVision/Cruncho sites
  // This is the most common pattern for Swedish municipal event calendars
  const b4d = extractAppRegistryEvents(html, source, baseUrl, events);
  if (b4d) return { events, method: 'B4d' };
  
  // ── Cheerio-based script block extraction ──────────────────────────────────
  const $ = cheerio.load(html);
  
  // Get full raw script text (cheerio .html() truncates, use textContent)
  const scriptBlocks: Array<{content: string; len: number}> = [];
  
  $('script').each((_, el) => {
    // Use underlying text content, not cheerio's html() which truncates
    const content = (el.children[0] as unknown as {data?:string})?.data || $(el).html() || '';
    if (content.length < 5000 && !content.includes('"events"')) return;
    scriptBlocks.push({ content, len: content.length });
  });
  
  // Sort by size descending — largest (full data dump) is best
  scriptBlocks.sort((a, b) => b.len - a.len);
  
  for (const { content } of scriptBlocks) {
    // ── B4a: "events": [...] inside large script blocks ────────────────────
    let found = extractEventsArrayPattern(content, source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B4a' };
    
    // ── B4b: 'events': [...] (single quotes) ─────────────────────────────
    found = extractEventsArrayPattern(content.replace(/'/g, '"'), source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B4b' };
    
    // ── B4c: eventList = [...] or eventsData = [...] ─────────────────────
    for (const varName of ['eventList', 'eventsData', 'event_data', 'EVENT_DATA', 'window.events', 'eventData', '_events']) {
      const rx = new RegExp(varName + '\\s*=\\s*\\[', '');
      const idx = content.search(rx);
      if (idx >= 0) {
        // Extract array from this point
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
                  const evt = makeEvent(item as Record<string,unknown>, 'B4c', source, baseUrl);
                  if (evt) { events.push(evt); count++; }
                }
              }
              if (count > 0) return { events, method: 'B4c' };
            }
          }
        }
      }
    }
  }
  
  return { events: [], method: '' };
}

/**
 * Extract events from AppRegistry.registerInitialState('id',{...,events:[...]}) pattern.
 * Common in Swedish SiteVision sites built with React/Next.js.
 */
function extractAppRegistryEvents(html: string, source: string, baseUrl: string, acc: ParsedEvent[]): boolean {
  // Find the opening parenthesis of registerInitialState(
  const callStart = html.indexOf("AppRegistry.registerInitialState('");
  if (callStart < 0) return false;
  
  // Find the opening brace { after the comma following the string arg
  const braceStart = html.indexOf(',', callStart);
  if (braceStart < 0) return false;
  
  // Find the actual { start
  let jsonStart = -1;
  for (let i = braceStart; i < html.length && i < braceStart + 100; i++) {
    if (html[i] === '{') { jsonStart = i; break; }
  }
  if (jsonStart < 0) return false;
  
  // Bracket-count to find matching }
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i; break; }
    }
    // Safety: stop if we hit a </script> tag (Lund-specific end marker)
    if (html.slice(i, i + 9) === '</script>') { jsonEnd = i - 1; break; }
  }
  if (jsonEnd < 0) return false;
  
  const jsonStr = html.slice(jsonStart, jsonEnd + 1);
  
  try {
    const data = JSON.parse(jsonStr);
    return collectEventsFromObject(data, acc, source, baseUrl);
  } catch (e) {
    // Try to fix trailing comma issues
    try {
      const cleaned = jsonStr.replace(/,(\s*[}\]])/g, '$1');
      const data = JSON.parse(cleaned);
      return collectEventsFromObject(data, acc, source, baseUrl);
    } catch { return false; }
  }
}

/**
 * Recursively search an object for an "events" array and collect events.
 */
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
  
  // Found events array!
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
  
  // Recurse into common containers
  for (const key of ['data', 'items', 'results', 'children', 'entries', 'content']) {
    if (o[key]) {
      if (collectEventsFromObject(o[key], acc, source, baseUrl)) return true;
    }
  }
  
  return false;
}

function extractEventsArrayPattern(
  content: string,
  source: string,
  baseUrl: string,
  acc: ParsedEvent[],
  key: string
): boolean {
  // Find key, then find the [...]
  const idx = content.indexOf(key);
  if (idx < 0) return false;
  
  // Find opening [
  let arrStart = -1;
  for (let i = idx + key.length; i < content.length; i++) {
    if (content[i] === '[') { arrStart = i; break; }
    if (content[i] === '{' || content[i] === '"') return false; // not an array
  }
  if (arrStart < 0) return false;
  
  // Find matching closing ]
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    // Don't cross into code — if we hit a } that's not in a string, stop
    if (depth === 0 && i > arrStart + 10) {
      // Check if the next meaningful char is }
      const rest = content.slice(i+1, i+20).trim();
      if (rest.startsWith('}') || (rest.startsWith(',') && rest.includes('}'))) {
        arrEnd = i; depth = 0; break;
      }
    }
  }
  if (arrEnd < 0) return false;
  
  const arrStr = content.slice(arrStart, arrEnd + 1);
  
  // Fix JS trailing commas before JSON parse
  const cleaned = arrStr.replace(/,(\s*[}\]])/g, '$1');
  
  const parsed = tryParseJson(cleaned);
  if (!parsed || !Array.isArray(parsed)) return false;
  
  let count = 0;
  for (const item of parsed) {
    if (typeof item === 'object' && item && !Array.isArray(item)) {
      const evt = makeEvent(item as Record<string,unknown>, 'B4', source, baseUrl);
      if (evt) { acc.push(evt); count++; }
    }
  }
  
  return count > 0;
}

// ─── Method B1/B2: __INITIAL_STATE__ ───────────────────────────────────────

function extractInitialState(html: string, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  
  // B1: window.__INITIAL_STATE__ = JSON.parse("...")
  const m1 = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"/);
  if (m1) {
    try {
      const unescaped = m1[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\u[\da-f]{4}/gi, (s) => String.fromCodePoint(parseInt(s.slice(2), 16)))
        .replace(/\\\\/g, '\\');
      const data = JSON.parse(unescaped);
      recursivelyCollectEvents(data, events, source, baseUrl);
    } catch { /* skip */ }
  }
  
  if (events.length) return events;
  
  // B2: __INITIAL_STATE__ = {...}
  const m2 = html.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m2) {
    try {
      const data = JSON.parse(m2[1]);
      recursivelyCollectEvents(data, events, source, baseUrl);
    } catch { /* skip */ }
  }
  
  return events;
}

function recursivelyCollectEvents(data: unknown, acc: ParsedEvent[], source: string, baseUrl: string): void {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item) {
        const obj = item as Record<string, unknown>;
        // If it looks like an event, parse it
        if (obj.name || obj.title || obj.eventTitle) {
          const evt = makeEvent(obj, 'B1', source, baseUrl);
          if (evt) { acc.push(evt); return; }
        }
        // Recurse into arrays
        recursivelyCollectEvents(item, acc, source, baseUrl);
      }
    }
    return;
  }
  
  const obj = data as Record<string, unknown>;
  
  // Direct event fields
  if (obj.name || obj.title) {
    const evt = makeEvent(obj, 'B1', source, baseUrl);
    if (evt) { acc.push(evt); return; }
  }
  
  // Search common containers
  for (const key of ['events', 'eventList', 'items', 'data', 'results', 'children', 'entries']) {
    if (obj[key]) recursivelyCollectEvents(obj[key], acc, source, baseUrl);
  }
}

// ─── Method C: HTML Heuristics ───────────────────────────────────────────────

function extractHtmlHeuristics($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenTitles = new Set<string>();
  
  // ── C1: <article> or .event or [class*="event"] blocks ─────────────────
  $('[class*="event"], article, [class*="calendar-item"], [class*="program-item"]').each((_, el) => {
    const $el = $(el);
    
    // Find title
    let title = $el.find('h1,h2,h3,h4,[class*="title"],[class*="heading"]').first().text().trim();
    if (!title) title = $el.find('a').first().attr('title') || '';
    if (!title || title.length < 2 || title.length > 200) return;
    if (seenTitles.has(title)) return;
    seenTitles.add(title);
    
    // Find date — look for datetime attribute, data-date, text in <time>
    let dateRaw = '';
    $el.find('time[datetime]').each((__, t) => { dateRaw = $(t).attr('datetime') || ''; });
    if (!dateRaw) {
      $el.find('[datetime]').each((__, t) => { dateRaw = $(t).attr('datetime') || ''; });
    }
    if (!dateRaw) {
      $el.find('[data-date], [data-start], [data-event-date]').each((__, t) => { dateRaw = $(t).attr('data-date') || $(t).attr('data-start') || ''; });
    }
    if (!dateRaw) {
      // Scan text for date-like patterns
      const text = $el.text();
      const dm = text.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/);
      if (dm) dateRaw = dm[1];
    }
    
    const { date, time } = parseDate(dateRaw);
    if (!date) return;
    
    // Find URL
    const url = $el.find('a[href]').first().attr('href') || '';
    
    // Find location
    let venue = $el.find('[class*="venue"], [class*="location"], [class*="plats"]').first().text().trim();
    let city = $el.find('[class*="city"], [class*="stad"]').first().text().trim();
    
    // Find description
    let desc = $el.find('p, [class*="desc"], [class*="text"]').first().text().trim().slice(0, 300);
    
    try {
      const evt = ParsedEventSchema.parse({
        title, date, time,
        venue: venue || undefined,
        city: city || undefined,
        description: desc || undefined,
        url: buildUrl(url, baseUrl) || undefined,
        source,
        sourceUrl: baseUrl,
        confidence: 'medium',
      });
      events.push(evt);
    } catch { /* skip malformed */ }
  });
  
  // ── C2: <time> elements with datetime ───────────────────────────────────
  $('time[datetime]').each((_, el) => {
    const $el = $(el);
    const dt = $el.attr('datetime') || '';
    const { date, time } = parseDate(dt);
    if (!date) return;
    
    // Walk up to find title
    const parent = $el.closest('article,[class*="event"],[class*="item"]');
    let title = '';
    if (parent.length) {
      title = parent.find('h1,h2,h3,h4,[class*="title"]').first().text().trim();
    }
    if (!title) {
      title = $el.closest('a').attr('title') || $el.siblings('a').first().attr('title') || '';
    }
    if (!title || title.length < 2) return;
    if (seenTitles.has(title)) return;
    seenTitles.add(title);
    
    const href = $el.closest('a').attr('href') || '';
    
    try {
      const evt = ParsedEventSchema.parse({
        title, date, time,
        url: buildUrl(href, baseUrl) || undefined,
        source,
        sourceUrl: baseUrl,
        confidence: 'medium',
      });
      events.push(evt);
    } catch { /* skip */ }
  });
  
  return events;
}

// ─── JSON Safe Parse ────────────────────────────────────────────────────────

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function extractEvents(html: string, source: string, baseUrl: string): ExtractResult {
  const errors: string[] = [];
  const methodBreakdown: Record<string, number> = {};
  const allEvents: ParsedEvent[] = [];
  const seenKeys = new Set<string>();
  
  function addEvents(events: ParsedEvent[], method: string): void {
    for (const evt of events) {
      // Dedupe by title+date
      const key = `${evt.title}|${evt.date}|${evt.time || ''}`;
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
  
  // ── A1: JSON-LD ───────────────────────────────────────────────────────────
  addEvents(extractJsonLd($, source, baseUrl), 'A1');
  
  // ── A2: Microdata ─────────────────────────────────────────────────────────
  addEvents(extractMicrodata($, source, baseUrl), 'A2');
  
  // ── B1/B2: __INITIAL_STATE__ ──────────────────────────────────────────────
  addEvents(extractInitialState(html, source, baseUrl), 'B1');
  
  // ── B4: Large JS blocks with events arrays ────────────────────────────────
  const jsResult = extractJsEmbeddedEvents(html, source, baseUrl);
  if (jsResult.events.length) {
    addEvents(jsResult.events, jsResult.method);
  }
  
  // ── C: HTML Heuristics ───────────────────────────────────────────────────
  // Only if we have very few events — don't overwrite high-quality results
  if (allEvents.length < 3) {
    addEvents(extractHtmlHeuristics($, source, baseUrl), 'C');
  }
  
  const methodsUsed = Object.keys(methodBreakdown);
  
  // Log if we found something interesting
  if (allEvents.length > 0) {
    console.log(`[UniversalExtractor] ${allEvents.length} events via ${methodsUsed.join('+')}`);
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
