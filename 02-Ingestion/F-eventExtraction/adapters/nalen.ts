/**
 * Nalen (Nalen, Regeringsgatan 29, Stockholm) adapter — konserthus.
 *
 * Site-specific pattern (verified 2026-10-24 from /sv/konserter-event):
 * - Next.js-app. JSON-LD finns men är nästan tom:
 *     {"@type":"Event","name":"Daniel Lanois at Nalen","image":[...]}
 *   Ingen `startDate` — så universalextractorn faller tillbaka på
 *   öppettiderna ("Måndag till fredag klockan 11.00–14.30") och hittar
 *   öppettiderna som ett evenemang. Det är en FALSK POSITIV.
 * - De riktiga evenemangen ligger i `__NEXT_DATA__` som Storyblok-block:
 *   varje `artistCard` har `startDate`, `endDate`, `artistName` (rich text),
 *   `sideKickName` (support/medverkande), `price`, `artistPageUrl.story.full_slug`.
 * - Listningssidan innehåller samma lista två gånger (216 kort, 108 unika).
 *
 * Per CLAUDE.md Generalization Protection Rule: adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST nalen.com.
 */
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'nalencom';
const VENUE = 'Nalen';
const CITY = 'Stockholm';
const ADDRESS = 'Regeringsgatan 29, Stockholm';

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'nalen.com' || u.hostname === 'www.nalen.com';
  } catch {
    return false;
  }
}

const NEXT_DATA_RX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

interface ArtistCard {
  startDate?: string;
  endDate?: string;
  price?: string;
  sideKickName?: string;
  info?: string;
  artistName?: { content?: Array<{ content?: Array<{ text?: string }> }> };
  artistPageUrl?: { story?: { full_slug?: string } };
  image?: { filename?: string };
}

/** Plockar ut alla `artistCard`-block ur __NEXT_DATA__-trädet. */
export function findArtistCards(node: unknown, out: ArtistCard[] = []): ArtistCard[] {
  if (Array.isArray(node)) {
    for (const item of node) findArtistCards(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.component === 'artistCard') out.push(obj as unknown as ArtistCard);
    for (const value of Object.values(obj)) findArtistCards(value, out);
  }
  return out;
}

/** Rich text → ren text. */
function richText(node: ArtistCard['artistName']): string {
  const parts: string[] = [];
  for (const block of node?.content ?? []) {
    for (const leaf of block?.content ?? []) {
      if (leaf?.text) parts.push(leaf.text);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** "2027-04-30 19:00" → { date, time }. "00:00" räknas som datum utan tid. */
function parseStart(value: string | undefined): { date: string; time?: string } | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!m) return null;
  const date = m[1];
  const time = m[2] && m[2] !== '00:00' ? m[2] : undefined;
  return { date, time };
}

/** Språkprefixet ("/sv", "/en") från sidans URL — Storyblok-sluggen saknar det. */
function baseUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (seg === 'sv' || seg === 'en') return `${u.origin}/${seg}`;
    return u.origin;
  } catch {
    return 'https://nalen.com';
  }
}

export interface NalenExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'nalen-next-data' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): NalenExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const nextData = html.match(NEXT_DATA_RX);
  if (!nextData) return { showUrls: [], events: [], method: 'none' };

  let payload: unknown;
  try {
    payload = JSON.parse(nextData[1]);
  } catch {
    return { showUrls: [], events: [], method: 'none' };
  }

  const cards = findArtistCards(payload);
  if (cards.length === 0) return { showUrls: [], events: [], method: 'none' };

  const base = baseUrl(url);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const card of cards) {
    const title = richText(card.artistName);
    if (!title) continue;
    const start = parseStart(card.startDate);
    if (!start) continue;

    const slug = card.artistPageUrl?.story?.full_slug;
    const eventUrl = slug ? `${base}/${slug.replace(/^\/+/, '')}` : url;

    const key = `${title}|${start.date}|${start.time ?? ''}|${eventUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    showUrls.add(eventUrl);

    const descriptionParts: string[] = [];
    if (card.sideKickName) descriptionParts.push(card.sideKickName);
    if (card.price) descriptionParts.push(`Pris: ${card.price}`);
    if (card.info) descriptionParts.push(card.info);

    try {
      const evt = ParsedEventSchema.parse({
        title,
        date: start.date,
        time: start.time,
        venue: VENUE,
        address: ADDRESS,
        city: CITY,
        description: descriptionParts.join(' — ') || undefined,
        url: eventUrl,
        ticketUrl: eventUrl,
        imageUrl: card.image?.filename || undefined,
        category: 'concert',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.9,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: descriptionParts.length > 0,
          hasTicketInfo: !!card.price,
          signals: ['nalen-next-data', `artistCard:${slug ?? 'none'}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'nalen-next-data' };
}
