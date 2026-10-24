/**
 * listingCrawlCore — rena hjälpfunktioner för D-gatens tvåstegs-listingcrawl.
 *
 * Utdrag ur `runD-listing-crawl.ts` så att logiken kan enhetstestas utan att
 * starta en crawl (och utan att köpa Scrapingbee-credits). Skriptet importerar
 * härifrån; testet (`listingCrawlCore.test.ts`) testar samma funktioner.
 *
 * Bakgrund 2026-10-24. Se `runD-listing-crawl.ts` för hela resonemanget.
 */

import * as cheerio from 'cheerio';

/** Standardmönster för event-länkar. Kan overrides per källa. */
export const DEFAULT_EVENT_HREF_PATTERN = /\/e\/[a-z0-9-]+/i;

/**
 * Scope-filter för en källa.
 *
 * En aggregators listningssidor är filtrerade på stad, men turnerande
 * evenemang hamnar ändå i listan. Mätt på billetto: av 7 extraherade events
 * låg 2 i Göteborg trots att listan var /c/…/stockholm. Ett Göteborg-event i
 * en Stockholms-agent är fel data.
 *
 * Två nycklar, i prioritetsordning:
 *   postalPrefixes — postnummerprefix. Stockholms län använder 1xxxx
 *                    (111–199), Göteborg 4xxxx, Norrköping 6xxxx.
 *                    Postnumret är entydigt och maskinellt — det bästa
 *                    signalen.
 *   cities         — ortnamn, används när postnumret saknas.
 *
 * Härleds ur källans egen metadata, så en källa utan scope-fält filtreras
 * inte alls (ingen risk att tyst tappa data för andra källor).
 */
export interface ScopeFilter {
  postalPrefixes: string[];
  cities: string[];
}

export const NO_SCOPE: ScopeFilter = { postalPrefixes: [], cities: [] };

/** Vad som behövs för att hitta event-länkar i en listningssida. */
export interface EventLinkSource {
  eventHrefPattern: RegExp;
  eventUrlPrefix: string;
}

/** Postnummer ur en adresssträng: "Vasagatan 41, 41136 Göteborg" → "41136". */
export function extractPostalCode(address: string | undefined, postalCode?: string): string | null {
  if (postalCode) {
    const digits = postalCode.replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(0, 5);
  }
  if (!address) return null;
  const match = address.match(/(\d{3})\s?(\d{2})\b/);
  if (match) return `${match[1]}${match[2]}`;
  const direct = address.match(/\b(\d{5})\b/);
  return direct ? direct[1] : null;
}

/** Är ett event in-scope enligt filtret? */
export function isInScope(
  scope: ScopeFilter,
  postalCode: string | null,
  locality: string | undefined,
): boolean {
  if (scope.postalPrefixes.length === 0 && scope.cities.length === 0) return true;
  if (postalCode) {
    return scope.postalPrefixes.some((prefix) => postalCode.startsWith(prefix));
  }
  if (locality) {
    const normalized = locality.toLowerCase();
    return scope.cities.some((city) => normalized.includes(city.toLowerCase()));
  }
  return false;
}

/** Normalisera event-URL:en så att dedup är stabil mellan körningar. */
export function normalizeEventUrl(raw: string): string {
  let url = raw;
  const qIdx = url.indexOf('?');
  if (qIdx >= 0) url = url.slice(0, qIdx);
  if (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

/** Hitta event-URL:er i den renderade listningssidan. */
export function extractEventUrlsFromCategory(
  html: string,
  source: EventLinkSource,
): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (!source.eventHrefPattern.test(href)) return;
    const full = href.startsWith('http')
      ? href
      : `${source.eventUrlPrefix}${href.replace(/^\//, '')}`;
    urls.add(normalizeEventUrl(full));
  });
  return Array.from(urls);
}

/** Hitta JSON-LD Event i en renderad event-sida. */
export function findJsonLdEvent(html: string): Record<string, any> | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    const text = $(el).contents().text();
    try {
      const parsed = JSON.parse(text);
      const candidates: Record<string, any>[] = [];
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const obj = node as Record<string, any>;
        const type = obj['@type'];
        if (type === 'Event' || (Array.isArray(type) && type.includes('Event'))) {
          candidates.push(obj);
        }
        if (Array.isArray(obj['@graph'])) obj['@graph'].forEach(visit);
      };
      visit(parsed);
      if (candidates.length > 0) return candidates[0];
    } catch {
      // nästa script
    }
  }
  return null;
}

/** Plocka datum/tid ur ett ISO-strängsvärde. */
export function splitDateTime(iso: string | undefined): { date: string; time?: string } {
  if (!iso) return { date: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso };
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

/** Plocka prisuppgifter ur JSON-LD offers. */
export function pickOffer(offers: unknown): {
  isFree?: boolean;
  priceMin?: number;
  priceMax?: number;
  ticketUrl?: string;
} {
  if (!offers) return {};
  const list: Record<string, unknown>[] = Array.isArray(offers)
    ? (offers as Record<string, unknown>[])
    : [offers as Record<string, unknown>];
  // BUG-fix 2026-10-24: `o.price || o.url` kastade bort gratis-events.
  // JSON-LD med `price: 0` (numeriskt noll) är falsy, så en gratis-offer
  // utan egen url filtrerades bort helt — och då försvann isFree-flaggan.
  const hasPrice = (o: Record<string, unknown>): boolean =>
    o.price !== undefined && o.price !== null && o.price !== '';
  const valid = list.filter((o) => o && (hasPrice(o) || o.url));
  if (valid.length === 0) return {};
  const prices = valid
    .map((o) => Number(o.price ?? (o.priceSpecification as Record<string, unknown>)?.price ?? NaN))
    .filter((n) => Number.isFinite(n));
  const isFree = valid.some(
    (o) => o.price === 0 || o.price === '0' ||
      (o.priceSpecification as Record<string, unknown>)?.price === 0,
  );
  const ticketUrl = valid.find((o) => o.url)?.url as string | undefined;
  return {
    isFree: isFree || undefined,
    priceMin: prices.length ? Math.min(...prices) : undefined,
    priceMax: prices.length ? Math.max(...prices) : undefined,
    ticketUrl,
  };
}

/** Plocka ort/venue/adress ur JSON-LD location. */
export function extractStockholm(place: unknown): {
  city?: string;
  venue?: string;
  address?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
} {
  const p = (place ?? {}) as Record<string, any>;
  if (!p || typeof p !== 'object') return { city: 'Stockholm' };
  const addr =
    p.address && typeof p.address === 'object'
      ? [
          p.address.streetAddress,
          [p.address.postalCode, p.address.addressLocality].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : undefined;
  const city = p.address?.addressLocality || p.address?.addressRegion || 'Stockholm';
  return {
    city: typeof city === 'string' ? city : 'Stockholm',
    venue: typeof p.name === 'string' ? p.name : undefined,
    address: addr,
    postalCode: typeof p.address?.postalCode === 'string' ? p.address.postalCode : undefined,
    lat: p.geo && typeof p.geo.latitude === 'number' ? p.geo.latitude : undefined,
    lng: p.geo && typeof p.geo.longitude === 'number' ? p.geo.longitude : undefined,
  };
}
