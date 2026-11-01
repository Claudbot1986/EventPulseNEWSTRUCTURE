/**
 * detailEnrichment — läs evenemangssidan, inte bara biljettkortet.
 *
 * PROBLEM (2026-11-01, användarens iakttagelse). "Info om eventet kan även
 * ligga utanför självaste biljettkortet på en hemsida." Mätt på de 154 rader
 * som discovery-källorna lade in i grafen:
 *
 *   venue_full_name   28/154 (18 %)  ← mot 87 % för övriga källor
 *   description       0/154  (0 %)
 *
 * Rotorsak: C-gaten extraherar från en LISTNINGSSIDA. Varje kort ger rubrik,
 * datum och en URL — men vi besöker aldrig den URL:en. Resultatet är att
 * beskrivningen blir kortets teaser, eller ännu värre sidans generiska
 * boilerplate ("Teater, konserter, utställningar, bibliotek, aktiviteter för
 * barn …"). Den boilerplate-texten är inte eventets beskrivning.
 *
 * MÄTTNING (live 2026-11-01) på 353 extraherade rader från 19 källor:
 *
 *   radens url skiljer sig från listningssidan (sourceUrl): 297/353 = 84 %
 *   raden saknar plats:                                     231/353 = 65 %
 *   BERIKNINGSBART (detalj-URL OCH saknar plats):           178/353 = 50 %
 *
 * Så halva raderna har en detaljsida som vi redan känner till — vi använder
 * den bara inte.
 *
 * BEVIS (live 2026-11-01) att detaljsidan faktiskt bär informationen:
 *
 *   kulturhusetstadsteatern.se/laslovet-2026
 *     kort:   description = "Teater, konserter, utställningar, bibliotek …"  (boilerplate)
 *     detalj: "Under årets läslov står barns rättigheter högt upp på
 *              Kulturhuset Stadsteaterns agenda – men också högläsning med
 *              Dracula, schackspel, minibåtsworkshop och k-pop. …"
 *
 *   royaldjurgarden.se/julmarknad-pa-nordiska-museet
 *     detalj: "Julmarknad i Stora hallen med unika och hållbara julklappar"
 *
 *   bild:   kortet ger generisk og-image ("…/media/img/og-image.jpg"),
 *           detaljsidan ger den riktiga evenemangsbilden.
 *
 * PRINCIP: kortet är ett index, detaljsidan är record. Vi följer kortets egen
 * URL och läser den. Vi hittar INGA på uppgifter — bara sådant som faktiskt
 * står på sidan.
 *
 * TVÅ EXTRA SIGNALER FÖR "ÄR DETTA ETT EVENEMANG?" (se eventLikeness.ts):
 *
 *   1. Sidans egen deklaration: JSON-LD `Article`/`NewsArticle` = artikel.
 *      Mätt: kollaboration.se deklarerar `Article`, thatsupse `NewsArticle`.
 *   2. Nyhetssidornas egen boilerplate i beskrivningen: "Läsningstid: 3 min",
 *      "Uppdaterat: 07 December 2025". Det är en STRUKTUR i texten, inte ett
 *      ämnesord — och den fungerar oberoende av sajt.
 *
 *   Den andra signalen är viktig för en anledning: mätning visar att
 *   "saknar Event-JSON-LD" INTE betyder "är en artikel" (royaldjurgarden är
 *   ett riktigt evenemang utan JSON-LD). Signalen är alltså ensidig — den
 *   bevisar artikel, aldrig evenemang.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { ARTICLE_TEXT_MARKERS, classifyPageSignals, decodeEntities } from '../../07-Discovery/src/sourceTesting/eventLikeness.js';

export interface DetailFacts {
  title: string | null;
  description: string | null;
  image: string | null;
  venue: string | null;
  address: string | null;
  startDate: string | null;
  jsonLdTypes: string[];
  ogType: string | null;
  /** Sant om sidan själv deklarerar att innehållet är en artikel. */
  declaredArticle: boolean;
  /** Sant om sidan själv deklarerar att innehållet är ett evenemang. */
  declaredEvent: boolean;
}

export interface EnrichmentRow {
  [key: string]: unknown;
  title?: string;
  url?: string;
  sourceUrl?: string;
  description?: string;
  imageUrl?: string;
  venue?: string;
  venue_name?: string;
  venue_address?: string;
  startTime?: string;
  time?: string;
  date?: string;
}

export interface EnrichOptions {
  projectRoot: string;
  /** Max antal rader som hämtas per källa. */
  perSourceLimit?: number;
  /** Max antal rader totalt i en körning. */
  globalLimit?: number;
  /** Timeout per fetch i ms. */
  timeoutMs?: number;
  /** Skriv inte tillbaka — bara rapportera. */
  dryRun?: boolean;
  /** Logga varje hämtning. */
  verbose?: boolean;
  /** Använd detta för tester. */
  fetchImpl?: (url: string) => Promise<{ status: number; body: string }>;
}

export interface EnrichResult {
  filesScanned: number;
  rowsScanned: number;
  rowsEnriched: number;
  rowsFetched: number;
  rowsFailed: number;
  rowsSkipped: number;
  fieldsFilled: Record<string, number>;
  pagesDeclaredArticle: number;
  pagesDeclaredEvent: number;
  perSource: Record<string, { enriched: number; fetched: number; failed: number }>;
  /** Rader som fylldes — för audit. */
  samples: Array<{ sourceId: string; title: string; url: string; filled: string[] }>;
}

// 2026-11-01 — de här mängderna låg dubblerade här och i eventLikeness.ts.
// Nu är eventLikeness.ts den enda definitionen: JSON-LD-typerna
// och artikelmarkörerna importeras därifrån.

/**
 * Nyhetssidans egen boilerplate — strukturell artikelmarkör.
 *
 * 2026-11-01 — mängden låg dubblerad här och i eventLikeness.ts. Två
 * definitioner av samma sak kan glida isär, och det gjorde det: här räknades
 * `og:type=article` ensamt som bevis för artikel, medan gaten inte gör det
 * (mätning: royaldjurgarden.se ÄR ett evenemang och bär `og:type=article`).
 * Nu är eventLikeness.ts den enda definitionen.
 */

function readMeta(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i');
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]).trim() : null;
}

/** Plocka ut JSON-LD-noderna (inkl. @graph) ur en HTML-sida. */
export function parseJsonLd(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['@graph'])
          ? ((parsed as Record<string, unknown>)['@graph'] as unknown[])
          : [parsed];
      for (const n of list) {
        if (n && typeof n === 'object' && !Array.isArray(n)) nodes.push(n as Record<string, unknown>);
      }
    } catch {
      // Trasig JSON-LD — ignorera, vi har andra källor.
    }
  }
  return nodes;
}

function jsonLdTypeNames(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
}

/** Plocka ut de fakta vi faktiskt kan använda ur en HTML-sida. */
export function extractDetailFacts(html: string): DetailFacts {
  const nodes = parseJsonLd(html);
  const jsonLdTypes: string[] = [];
  let ldDescription: string | null = null;
  let ldImage: string | null = null;
  let ldVenue: string | null = null;
  let ldAddress: string | null = null;
  let ldStartDate: string | null = null;

  for (const node of nodes) {
    jsonLdTypes.push(...jsonLdTypeNames(node));
    if (typeof node.description === 'string' && !ldDescription) ldDescription = decodeEntities(node.description).trim();
    if (!ldImage) {
      const img = node.image;
      if (typeof img === 'string') ldImage = img;
      else if (Array.isArray(img) && typeof img[0] === 'string') ldImage = img[0];
    }
    if (!ldStartDate && typeof node.startDate === 'string') ldStartDate = node.startDate;
    if (!ldVenue && node.location && typeof node.location === 'object') {
      const loc = node.location as Record<string, unknown>;
      if (typeof loc.name === 'string') ldVenue = decodeEntities(loc.name).trim();
      const addr = loc.address;
      if (addr && typeof addr === 'object') {
        const a = addr as Record<string, unknown>;
        const street = typeof a.streetAddress === 'string' ? a.streetAddress : null;
        const city = typeof a.addressLocality === 'string' ? a.addressLocality : null;
        if (street || city) ldAddress = [street, city].filter(Boolean).join(', ');
      }
    }
  }

  const ogDescription = readMeta(html, 'og:description');
  const metaDescription = readMeta(html, 'description');
  const twitterDescription = readMeta(html, 'twitter:description');
  const ogType = readMeta(html, 'og:type');
  const ogTitle = readMeta(html, 'og:title');
  const ogImage = readMeta(html, 'og:image');

  const description =
    pickLongestRealText([ldDescription, ogDescription, twitterDescription, metaDescription]) ??
    null;
  const image = pickImage(ldImage, ogImage, readMeta(html, 'twitter:image'));

  const uniqueTypes = [...new Set(jsonLdTypes)];
  const title = pickLongestRealText([ogTitle]) ?? null;

  // 2026-11-01 — EN regel för "är sidan en artikel".
  //
  // Tidigare fanns en egen regel här som räknade `og:type=article` ensamt som
  // bevis. Den motsägde mätningen på royaldjurgarden.se (ett riktigt evenemang
  // utan JSON-LD som bär `og:type=article`) och den klassifikator som gaten
  // använder — så berikningens auditspår kunde säga "artikel" om en sida som
  // gaten bedömde som evenemang. Nu är `classifyPageSignals` den enda
  // definitionen, och de två kan inte glida isär.
  const pageVerdict = classifyPageSignals({
    jsonLdTypes: uniqueTypes,
    ogType,
    description,
    title,
  });

  // Extra bevis som gaten inte ser: strukturell markör i själva sidans
  // början ("Läsningstid: 3 min"). Här har vi HTML:en, gaten bara
  // beskrivningen.
  const htmlMarker = ARTICLE_TEXT_MARKERS.some((p) => p.test(html.slice(0, 4000)));

  return {
    title,
    description,
    image,
    venue: ldVenue,
    address: ldAddress,
    startDate: ldStartDate,
    jsonLdTypes: uniqueTypes,
    ogType,
    declaredArticle: pageVerdict.declaredArticle || htmlMarker,
    declaredEvent: pageVerdict.declaredEvent,
  };
}

/** Välj den längsta text som inte är boilerplate. */
function pickLongestRealText(candidates: Array<string | null>): string | null {
  const real = candidates.filter((c): c is string => !!c && c.trim().length > 0);
  if (real.length === 0) return null;
  const sorted = [...real].sort((a, b) => b.length - a.length);
  return sorted[0].trim();
}

/** Välj en bild — men inte sidans generiska og-image om vi har en bättre. */
function pickImage(...candidates: Array<string | null>): string | null {
  for (const c of candidates) {
    if (!c || !c.trim()) continue;
    if (/\/og-image\.(jpg|jpeg|png|webp)$/i.test(c)) continue;
    return c.trim();
  }
  return null;
}

/** Kan vi hämta den här URL:en över HTTP? (mailto:, tel:, #anchor → nej) */
export function isFetchableUrl(url: unknown): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim());
}

/** Är radens URL en detaljsida (skiljer den sig från listningssidan)? */
export function isDetailUrl(row: EnrichmentRow): boolean {
  const url = String(row.url ?? '').replace(/\/+$/, '');
  const sourceUrl = String(row.sourceUrl ?? '').replace(/\/+$/, '');
  if (!url || !sourceUrl) return false;
  if (!isFetchableUrl(url)) return false;
  return url !== sourceUrl;
}

/** Saknar raden de fält som berikningen kan fylla? */
export function missingEnrichableFields(row: EnrichmentRow): string[] {
  const missing: string[] = [];
  const hasDescription = typeof row.description === 'string' && row.description.trim().length >= 40;
  const hasVenue = Boolean(
    (typeof row.venue === 'string' && row.venue.trim()) ||
    (typeof row.venue_name === 'string' && row.venue_name.trim()),
  );
  const hasImage = typeof row.imageUrl === 'string' && row.imageUrl.trim().length > 0;
  const imageLooksGeneric = hasImage && /\/og-image\.(jpg|jpeg|png|webp)$/i.test(String(row.imageUrl));
  if (!hasDescription) missing.push('description');
  if (!hasVenue) missing.push('venue');
  if (!hasImage || imageLooksGeneric) missing.push('image');
  return missing;
}

/**
 * Fyll bara saknade fält. Vi skriver ALDRIG över ett fält som redan har ett
 * värde — kortets egen uppgift har företräde, vi tillför bara det vi lärde
 * oss från detaljsidan. Vi hittar inte på något.
 */
export function mergeEnrichment(row: EnrichmentRow, facts: DetailFacts): { row: EnrichmentRow; filled: string[] } {
  const filled: string[] = [];
  const next: EnrichmentRow = { ...row };

  // "Saknat" har EN definition, och den ligger i missingEnrichableFields():
  // fältet saknas helt, är för kort för att vara användbart (<40 tecken),
  // eller är den generiska og-bilden. enrichExtractedRows() hoppar över
  // rader som saknar inget — om de två funktionerna räknade olika skulle de
  // säga olika saker om samma rad.
  //
  // 2026-11-01 — villkoret var INVERTERAT (`!missing.includes(x)`), vilket
  // betydde att vi fyllde ett fält bara när raden redan HADE ett värde, och
  // aldrig fyllde de fält som faktiskt saknades. Det gjorde hela berikningen
  // till en no-op för beskrivning och plats — precis de uppgifter vi gick dit
  // för att hämta.
  const missing = new Set(missingEnrichableFields(next));

  if (missing.has('description') && facts.description) {
    next.description = facts.description;
    filled.push('description');
  }
  if (missing.has('venue') && facts.venue) {
    next.venue = facts.venue;
    next.venue_name = facts.venue;
    filled.push('venue');
  }
  if (facts.address && !next.venue_address) {
    next.venue_address = facts.address;
    filled.push('venue_address');
  }
  if (missing.has('image') && facts.image) {
    next.imageUrl = facts.image;
    filled.push('image');
  }
  if (facts.startDate && !next.startTime && !next.time) {
    next.startTime = facts.startDate;
    filled.push('startTime');
  }
  if (filled.length > 0) {
    const raw = (next.raw_payload && typeof next.raw_payload === 'object' ? next.raw_payload : {}) as Record<string, unknown>;
    next.raw_payload = {
      ...raw,
      enrichment: {
        detailUrl: String(next.url ?? ''),
        fetchedAt: new Date().toISOString(),
        fields: filled,
        jsonLdTypes: facts.jsonLdTypes,
        ogType: facts.ogType,
        declaredArticle: facts.declaredArticle,
        declaredEvent: facts.declaredEvent,
      },
    };
  }
  return { row: next, filled };
}

/** Standard-fetch med timeout. */
async function defaultFetch(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; EventPulse detail-enrichment/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Hitta alla extraherade event-filer och deras källa. */
export function listExtractedFiles(projectRoot: string): Array<{ file: string; sourceId: string }> {
  const base = path.join(projectRoot, '03-Queue', '03-extractedevents');
  const out: Array<{ file: string; sourceId: string }> = [];
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push({ file: path.join(base, entry.name), sourceId: entry.name.replace(/\.jsonl$/, '') });
    } else if (entry.isDirectory()) {
      for (const f of readdirSync(path.join(base, entry.name))) {
        if (f.endsWith('.jsonl')) out.push({ file: path.join(base, entry.name, f), sourceId: f.replace(/\.jsonl$/, '') });
      }
    }
  }
  return out;
}

/**
 * Berika alla extraherade rader som pekar på en detaljsida.
 *
 * Budget: per källa och globalt. Utan tak skulle en natt med tusentals rader
 * bli tusentals hämtningar — och kedjan har en tidsgräns.
 */
export async function enrichExtractedRows(options: EnrichOptions): Promise<EnrichResult> {
  const perSourceLimit = options.perSourceLimit ?? 25;
  const globalLimit = options.globalLimit ?? 300;
  const timeoutMs = options.timeoutMs ?? 15000;
  const fetchImpl = options.fetchImpl ?? ((url: string) => defaultFetch(url, timeoutMs));

  const result: EnrichResult = {
    filesScanned: 0,
    rowsScanned: 0,
    rowsEnriched: 0,
    rowsFetched: 0,
    rowsFailed: 0,
    rowsSkipped: 0,
    fieldsFilled: {},
    pagesDeclaredArticle: 0,
    pagesDeclaredEvent: 0,
    perSource: {},
    samples: [],
  };

  const files = listExtractedFiles(options.projectRoot);
  result.filesScanned = files.length;

  let globalFetched = 0;

  for (const { file, sourceId } of files) {
    let perSourceFetched = 0;
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    const outLines: string[] = [];
    let changed = false;

    for (const line of lines) {
      if (!line.trim()) {
        outLines.push(line);
        continue;
      }
      result.rowsScanned++;
      let row: EnrichmentRow;
      try {
        row = JSON.parse(line) as EnrichmentRow;
      } catch {
        outLines.push(line);
        continue;
      }

      const needs = missingEnrichableFields(row);
      if (!isDetailUrl(row) || needs.length === 0) {
        result.rowsSkipped++;
        outLines.push(line);
        continue;
      }
      if (perSourceFetched >= perSourceLimit || globalFetched >= globalLimit) {
        result.rowsSkipped++;
        outLines.push(line);
        continue;
      }

      perSourceFetched++;
      globalFetched++;
      result.rowsFetched++;

      const url = String(row.url);
      let body = '';
      let status = 0;
      try {
        const res = await fetchImpl(url);
        status = res.status;
        body = res.body;
      } catch {
        result.rowsFailed++;
        (result.perSource[sourceId] ??= { enriched: 0, fetched: 0, failed: 0 }).failed++;
        outLines.push(line);
        continue;
      }

      if (!body || status >= 400) {
        result.rowsFailed++;
        (result.perSource[sourceId] ??= { enriched: 0, fetched: 0, failed: 0 }).failed++;
        outLines.push(line);
        continue;
      }

      const facts = extractDetailFacts(body);
      if (facts.declaredArticle) result.pagesDeclaredArticle++;
      if (facts.declaredEvent) result.pagesDeclaredEvent++;

      const { row: merged, filled } = mergeEnrichment(row, facts);
      if (filled.length > 0) {
        changed = true;
        result.rowsEnriched++;
        for (const f of filled) result.fieldsFilled[f] = (result.fieldsFilled[f] ?? 0) + 1;
        if (result.samples.length < 20) {
          result.samples.push({ sourceId, title: String(row.title ?? ''), url, filled });
        }
      }
      (result.perSource[sourceId] ??= { enriched: 0, fetched: 0, failed: 0 }).enriched += filled.length > 0 ? 1 : 0;
      outLines.push(JSON.stringify(merged));
    }

    if (changed && !options.dryRun) {
      writeFileSync(file, outLines.join('\n'), 'utf8');
    }
    if (options.verbose && perSourceFetched > 0) {
      console.log(`  [enrich] ${sourceId}: ${perSourceFetched} hämtningar`);
    }
  }

  return result;
}
