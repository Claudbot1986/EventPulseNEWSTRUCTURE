/**
 * Livrustkammaren (livrustkammaren.se) — site adapter for EventPulse ingestion.
 *
 * Verified 2026-10-24 against the live site (plain HTTP + local Chromium,
 * zero ScrapingBee credits):
 *
 * - Both livrustkammaren.se and historiska.se run the same "SHM" Next.js
 *   front-end on top of WordPress. There is no server-rendered card markup
 *   worth scraping — all listing data lives in a JSON payload:
 *     <script id="__NEXT_DATA__" type="application/json">{ … }</script>
 *   → props.pageProps.page.blocks[]  (WordPress block tree)
 *
 * - The event calendar page `https://livrustkammaren.se/besok/kalender/`
 *   contains a `shm/event-list` block. Its `attrs.teasers[]` holds the
 *   `shm/teaser-event` cards: title, free-text date, price, image, event
 *   link and an optional Tickster booking link. The teasers are rendered
 *   server-side, so the payload is present in the plain HTML too — no JS
 *   render (and no credits) needed.
 *
 * - `attrs.query.date.label` ("oktober 2026") says which month the listing
 *   is filtered on. It is the reference used to infer the year of dates that
 *   omit it.
 *
 * - `attrs.date` on a teaser is free text, e.g.
 *     "Lördag 24 oktober klockan 10-12"
 *     "25 oktober-1 november"
 *     "torsdag 29 oktober 18.00"
 *   Only the START of a range becomes `date`; the range end becomes
 *   `endDate`.
 *
 * - The exhibition catalogue `https://livrustkammaren.se/utstallningar/`
 *   carries no start dates at all — only "till och med <datum>" (an END
 *   date). A row without a start date cannot survive the import, so those
 *   cards are skipped instead of being faked. The calendar page above is the
 *   listing that actually yields events.
 *
 * Per CLAUDE.md Generalization Protection Rule this adapter is isolated from
 * C0/C1/C2 and applies ONLY to livrustkammaren.se.
 */
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'livrustkammaren';
const VENUE = 'Livrustkammaren';
const ORGANIZER = 'Livrustkammaren';
const ADDRESS = 'Slottsbacken 3, 111 30 Stockholm';
const CITY = 'Stockholm';

/** Exact hostnames only — the source queue points at www.livrustkammaren.se. */
const HOSTS = new Set(['livrustkammaren.se', 'www.livrustkammaren.se']);

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawBlock {
  blockName?: string;
  attrs?: Record<string, unknown>;
  innerBlocks?: RawBlock[];
}

interface RawTeaser {
  title: string | null;
  description: string | null;
  dateText: string | null;
  labelText: string | null;
  price: string | null;
  url: string | null;
  ticketUrl: string | null;
  imageUrl: string | null;
}

interface ReferencePeriod {
  year: number;
  month: number; // 1-12
}

interface ParsedWhen {
  date: string; // YYYY-MM-DD
  endDate?: string;
  time?: string; // HH:MM
  endTime?: string; // HH:MM
}

export interface LivrustkammarenExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'livrustkammaren-listing' | 'none';
}

// ─── Swedish calendar primitives ─────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  mars: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  augusti: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

const WEEKDAYS: Record<string, number> = {
  söndag: 0,
  måndag: 1,
  tisdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lördag: 6,
};

const WEEKDAY_RX = /\b(söndag|måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)?\b/;
const DATE_TOKEN_RX = /(\d{1,2})\s+([a-zåäö]{3,12})(?:\s+(\d{4}))?/g;
const NEXT_DATA_RX = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .replace(/[–—−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toHm(hours: string, minutes?: string): string {
  return `${pad(Number(hours))}:${pad(minutes ? Number(minutes) : 0)}`;
}

function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function absoluteUrl(href: string): string {
  try {
    return new URL(href).toString();
  } catch {
    return href;
  }
}

// ─── NEXT_DATA payload ───────────────────────────────────────────────────────

function readNextDataBlocks(html: string): RawBlock[] {
  const match = html.match(NEXT_DATA_RX);
  if (!match) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const pageProps = (payload as { props?: { pageProps?: { page?: { blocks?: RawBlock[] } } } })?.props
    ?.pageProps;
  return pageProps?.page?.blocks ?? [];
}

function collectBlocks(blocks: RawBlock[], name: string): RawBlock[] {
  const found: RawBlock[] = [];
  const walk = (list: RawBlock[]): void => {
    for (const block of list ?? []) {
      if (block.blockName === name) found.push(block);
      if (block.innerBlocks?.length) walk(block.innerBlocks);
    }
  };
  walk(blocks);
  return found;
}

/** The month/year the calendar is filtered on — the year reference for dates. */
function readReferencePeriod(attrs: Record<string, unknown>): ReferencePeriod | null {
  const query = attrs.query as { date?: { label?: string; startDate?: string } } | undefined;
  const label = query?.date?.label;
  if (typeof label === 'string') {
    const match = label.match(/([a-zåäö]+)\s+(\d{4})/i);
    const month = match ? MONTHS[match[1].toLowerCase()] : undefined;
    if (match && month) return { year: Number(match[2]), month };
  }
  const iso =
    query?.date?.startDate ?? (typeof attrs.date === 'string' ? attrs.date : undefined);
  if (typeof iso === 'string') {
    const match = iso.match(/(\d{4})-(\d{2})/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTeaser(block: RawBlock): RawTeaser {
  const attrs = block.attrs ?? {};
  const link = attrs.link as { href?: unknown } | undefined;
  const booking = attrs.bookingLink as { href?: unknown } | undefined;
  const image = attrs.image as { url?: unknown } | undefined;
  return {
    title: readString(attrs.title),
    description: readString(attrs.description),
    dateText: readString(attrs.date),
    labelText: readString(attrs.labelText),
    price: readString(attrs.price),
    url: readString(link?.href),
    ticketUrl: readString(booking?.href),
    imageUrl: readString(image?.url),
  };
}

// ─── Date parsing ────────────────────────────────────────────────────────────

interface DateToken {
  day: number;
  month: number;
  year: number | null;
}

/** Pulls "<day> <month> [<year>]" tokens out of the text; keeps the residue. */
function readDateTokens(text: string): { tokens: DateToken[]; residue: string } {
  const tokens: DateToken[] = [];
  let residue = '';
  let cursor = 0;
  for (const match of text.matchAll(DATE_TOKEN_RX)) {
    const month = MONTHS[match[2]];
    if (!month) continue;
    tokens.push({
      day: Number(match[1]),
      month,
      year: match[3] ? Number(match[3]) : null,
    });
    residue += text.slice(cursor, match.index) + ' ';
    cursor = match.index + match[0].length;
  }
  residue += text.slice(cursor);
  return { tokens, residue };
}

function readTime(residue: string): { time?: string; endTime?: string } {
  const range = residue.match(/(\d{1,2})(?:[.:](\d{2}))?\s*-\s*(\d{1,2})(?:[.:](\d{2}))?/);
  if (range) {
    return { time: toHm(range[1], range[2]), endTime: toHm(range[3], range[4]) };
  }
  const single = residue.match(/(\d{1,2})[.:](\d{2})/);
  if (single) return { time: toHm(single[1], single[2]) };
  return {};
}

function inferStartYear(
  token: DateToken,
  weekday: number | null,
  reference: ReferencePeriod
): number {
  if (token.year) return token.year;
  const candidates = [reference.year - 1, reference.year, reference.year + 1];
  if (weekday !== null) {
    const match = candidates.find((year) => weekdayOf(year, token.month, token.day) === weekday);
    if (match !== undefined) return match;
  }
  // No weekday to cross-check with: take the year closest to the month the
  // listing is filtered on (a month that has already passed this year means
  // next year).
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const year of candidates) {
    const distance = Math.abs(
      (year * 12 + token.month) - (reference.year * 12 + reference.month)
    );
    if (distance < bestDistance) {
      best = year;
      bestDistance = distance;
    }
  }
  return best;
}

function inferEndYear(startYear: number, startMonth: number, token: DateToken): number {
  if (token.year) return token.year;
  return token.month < startMonth ? startYear + 1 : startYear;
}

/**
 * Parses a teaser date into a start date (+ optional end date and times).
 *
 * Returns null when the text carries no usable START date — e.g. the
 * exhibition labels "till och med 1 november 2026" (end date only).
 */
export function parseWhen(raw: string, reference: ReferencePeriod): ParsedWhen | null {
  const text = normalize(raw);
  if (!text) return null;
  // "till och med <datum>" is an end date, not a start date.
  if (/till och med|t\.o\.m/.test(text)) return null;

  const { tokens, residue } = readDateTokens(text);
  if (tokens.length === 0) return null;

  const weekdayMatch = text.match(WEEKDAY_RX);
  const weekday = weekdayMatch ? WEEKDAYS[weekdayMatch[1]] : null;

  const start = tokens[0];
  const startYear = inferStartYear(start, weekday, reference);
  const date = toIso(startYear, start.month, start.day);

  let endDate: string | undefined;
  if (tokens.length > 1) {
    const end = tokens[1];
    endDate = toIso(inferEndYear(startYear, start.month, end), end.month, end.day);
  }

  const { time, endTime } = readTime(residue);

  return { date, endDate, time, endTime };
}

// ─── Prices ──────────────────────────────────────────────────────────────────

interface PriceInfo {
  isFree?: boolean;
  priceMin?: number;
  priceMax?: number;
}

/**
 * Prices are free text on this site ("Kostnadsfritt", "Kostnad 180 kronor.").
 * Only amounts written as "N kronor" become numbers, and `isFree` is only
 * set when the whole teaser says so (no kronor amount, no age restriction).
 */
export function readPrice(price: string | null): PriceInfo {
  if (!price) return {};
  const amounts = [...price.matchAll(/(\d+)\s*kronor/gi)].map((m) => Number(m[1]));
  const info: PriceInfo = {};
  if (amounts.length > 0) {
    info.priceMin = Math.min(...amounts);
    info.priceMax = Math.max(...amounts);
  }
  const mentionsFree = /kostnadsfritt|fri entré/i.test(price);
  const hasAgeRule = /\bunder\s+\d|\b\d+\s*år\b|\böver\s+\d/i.test(price);
  if (mentionsFree && amounts.length === 0 && !hasAgeRule) info.isFree = true;
  return info;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function isExhibitionBlock(block: RawBlock): boolean {
  return (
    block.blockName === 'shm/teaser' ||
    block.blockName === 'shm/split-teaser' ||
    block.blockName === 'shm/teaser-fullscreen'
  );
}

/**
 * Exhibition cards only carry an end date ("till och med …") or a range in
 * prose ("visas 17 september 2026 - 14 februari 2027"). Only rows with a real
 * start date are emitted — the label is deliberately NOT used as a date.
 */
function readExhibitionTeasers(blocks: RawBlock[]): RawTeaser[] {
  const teasers: RawTeaser[] = [];
  for (const block of blocks) {
    if (!isExhibitionBlock(block)) continue;
    const teaser = readTeaser(block);
    const prose = teaser.description ?? '';
    if (!/\b(19|20)\d{2}\b/.test(prose)) continue; // no explicit year → not trustworthy
    teasers.push({ ...teaser, dateText: prose });
  }
  return teasers;
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): HistoriskaMuseetExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const blocks = readNextDataBlocks(html);
  if (blocks.length === 0) return { showUrls: [], events: [], method: 'none' };

  const eventLists = collectBlocks(blocks, 'shm/event-list');
  const reference: ReferencePeriod = (() => {
    for (const list of eventLists) {
      const period = readReferencePeriod(list.attrs ?? {});
      if (period) return period;
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  })();

  const teasers: RawTeaser[] = [];
  for (const list of eventLists) {
    const listTeasers = (list.attrs?.teasers ?? []) as RawBlock[];
    if (Array.isArray(listTeasers)) {
      for (const teaser of listTeasers) teasers.push(readTeaser(teaser));
    }
  }
  for (const block of collectBlocks(blocks, 'shm/teaser-event')) {
    teasers.push(readTeaser(block));
  }
  teasers.push(...readExhibitionTeasers(collectBlocks(blocks, 'shm/teaser')));
  teasers.push(...readExhibitionTeasers(collectBlocks(blocks, 'shm/split-teaser')));
  teasers.push(...readExhibitionTeasers(collectBlocks(blocks, 'shm/teaser-fullscreen')));

  const now = new Date();
  const cutoff = todayIso(now);
  const events: ParsedEvent[] = [];
  const showUrls = new Set<string>();
  const seen = new Set<string>();

  for (const teaser of teasers) {
    if (!teaser.title || !teaser.dateText) continue;

    const when = parseWhen(teaser.dateText, reference);
    if (!when) continue;
    // Rader som redan börjat kan inte överleva importens datumvakt.
    if (when.date < cutoff) continue;

    const key = `${teaser.title}|${when.date}|${teaser.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const eventUrl = teaser.url ? absoluteUrl(teaser.url) : url;
    showUrls.add(eventUrl);

    const price = readPrice(teaser.price);

    try {
      events.push(
        ParsedEventSchema.parse({
          title: teaser.title,
          date: when.date,
          endDate: when.endDate,
          time: when.time,
          endTime: when.endTime,
          venue: VENUE,
          address: ADDRESS,
          city: CITY,
          organizer: ORGANIZER,
          description: teaser.description ?? undefined,
          url: eventUrl,
          ticketUrl: teaser.ticketUrl ? absoluteUrl(teaser.ticketUrl) : undefined,
          category: teaser.labelText ?? undefined,
          imageUrl: teaser.imageUrl,
          isFree: price.isFree,
          priceMin: price.priceMin,
          priceMax: price.priceMax,
          source,
          sourceUrl: url,
          confidence: {
            score: 0.9,
            hasTitle: true,
            hasDate: true,
            hasVenue: true,
            hasUrl: Boolean(teaser.url),
            hasDescription: Boolean(teaser.description),
            hasTicketInfo: Boolean(teaser.ticketUrl),
            signals: ['shm-next-data', `shm-teaser-event`, `reference:${reference.year}-${reference.month}`],
          },
        })
      );
    } catch {
      /* skip malformed rows */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'livrustkammaren-listing' };
}
