/**
 * eventLikeness — är en rad ett evenemang, en artikel, eller vet vi inte?
 *
 * PROBLEM (2026-10-31/11-01). P3D promote:ar en kandidat om "det persisterats
 * events" i smoke-fasen. Men "det finns rader" ≠ "raderna är evenemang". En
 * blogg- eller nyhetssida ger rader, och deras artikelrubrikar hamnar i grafen
 * som evenemang. Mätt på 154 rader från 20 promote:ade källor: 6 domäner med
 * samma mönster (kollaborationse, kulturfestivalenstockholmse,
 * wwwmynewsdeskcom, wwwsensusse, wwwnationalmuseumse, wwwsfotose).
 *
 * MÄTNINGEN SOM STYR SIGNALVALET. På de 154 raderna gav de vanliga
 * radfälten ingen skillnad alls:
 *
 *   venue_full_name  28/154 (18 %)  — 82 % saknar plats, även de riktiga
 *   start_time      154/154 (100 %) — datumet fylls alltid i med fallback
 *   ticket_url      148/154 (96 %)  — faller tillbaka på käll-URL
 *   category_slug   124/154 "community" — fallback
 *   confidence_score  15:21 35:106 55:15 60:12 — skräp och bra i samma band
 *
 * Endast TITELN skiljer. Därför bygger den här modulen på titeln — men bara
 * som SISTA utväg. Bättre är de STRUKTURELLA markörerna på själva
 * detaljsidan (se `classifyPageSignals`), eftersom de kommer från sidans egen
 * deklaration och inte från gissningar om ord.
 *
 * TVÅ SIDOR AV SIGNALEN — det är inte symmetriskt:
 *
 *   - En sida som deklarerar `Article`/`NewsArticle`/`BlogPosting` i JSON-LD
 *     ÄR en artikel. Starkt bevis, används direkt.
 *   - En sida som INTE deklarerar `Event` är INTE bevis för att den är en
 *     artikel. Mätt: royaldjurgarden.se/julmarknad-pa-nordiska-museet är ett
 *     riktigt evenemang men har varken JSON-LD eller `og:type=article` —
 *     och kulturhusetstadsteatern.se/laslovet-2026 har bara `WebPage`.
 *     Svenska sajter emitterar sällan `schema.org/Event`.
 *
 *   Så: article-signaler är AUKTORITATIVA, frånvaro av event-signal är
 *   OINFORMATIV. Det är därför modellen har tre lägen och inte två.
 *
 * INGA ÄNDRINGAR I C0/C1/C2. Det här är ett lager ovanför, i P3D.
 */

/** Vad en rad kan vara. `unknown` betyder "vi vet inte" — aldrig "nej". */
export type LikenessVerdict = 'event' | 'article' | 'unknown';

/** Sådana här är artiklar enligt sidan själv. */
const ARTICLE_JSONLD_TYPES = new Set(['article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'techarticle', 'scholarlyarticle']);

/** Sådana här är evenemang enligt sidan själv. */
const EVENT_JSONLD_TYPES = new Set(['event', 'musicevent', 'theaterevent', 'sportsevent', 'festival', 'exhibitionevent', 'screeningevent']);

/**
 * Strukturella artikelmarkörer i svensk text.
 *
 * "Läsningstid: 3 min" / "Uppdaterat: 07 December 2025" är nyhetssidornas
 * egen boilerplate — den syns på kollaboration.se och är helt oberoende av
 * vilken sajt det är. Det är en *struktur* i texten, inte ett ämnesord, och
 * därför fäller den artiklar som en ämnesordslista inte kan.
 */
export const ARTICLE_TEXT_MARKERS: RegExp[] = [
  /\bläsningstid\s*:/i,
  /\buppdaterat\s*:\s*\d/i,
  /\bpublicerad\s*:\s*\d/i,
  /\bskrivet av\b/i,
  /\bpublicerad\s+av\b/i,
  /\barkiv\b.*\bpublicerat\b/i,
];

/**
 * Ordgräns som fungerar för svenska.
 *
 * 2026-11-01 — viktig fälla: JavaScripts `\b` är ASCII-baserat (`\w` =
 * [A-Za-z0-9_]). "å" är INGET word character, så `\b` efter "Tips på" matchar
 * inte — och mönstret fångade därför inte artikeln. Här används
 * Unicode-egenskaper i stället: `(?<!\p{L}\p{N}_)` före och
 * `(?![\p{L}\p{N}_])` efter.
 */
const WORD_START = '(?<![\\p{L}\\p{N}_])';
const WORD_END = '(?![\\p{L}\\p{N}_])';

/**
 * Titelformer som är artiklar. Alla är kontrollerade mot de riktiga
 * evenemangstitlarna i grafen — se `eventLikeness.test.ts`, som innehåller
 * de faktiska titlarna som FÅR INTE fällas.
 */
const ARTICLE_TITLE_PATTERNS: RegExp[] = [
  // Frågeform med svenskt frågeord: "Har du glömt något på Kulturfestivalen?",
  // "Varför är ...?", "När sker ...?", "Är det ...?".
  //
  // OBS: ett frågetecken ensamt är INTE en artikelmarkör. Mätt 2026-11-01:
  // "Benjamin Ingrosso – What Happens Next?" (biljettnuse) och "15 Minutes of
  // Art: Will You Be Profitable, My Friend?" (modernamuseetse) är riktiga
  // evenemang med frågetecken i titeln. Med `\?` som regel fångades båda —
  // alltså toå falsklarm. FrågeORDET är den signal som håller.
  new RegExp(
    `${WORD_START}^(har\\s+du|varför|när\\s+sker|är\\s+det|vad\\s+händer|vilken|vilket|vem\\s+är|kan\\s+man|behöver\\s+man|finns\\s+det)${WORD_END}`,
    'iu',
  ),
  // Förklarande/opinion: "Så funkar ...", "Därför dominerar ..."
  new RegExp(
    `${WORD_START}^(så\\s+funkar|så\\s+väljer|så\\s+gör|så\\s+fixar|så\\s+hittar|så\\s+startar|så\\s+blir|så\\s+kan|så\\s+mycket|därför)${WORD_END}`,
    'iu',
  ),
  // Guide/marknadsföring: "Guiden till ...", "Saker att göra ...", "Tips på ..."
  new RegExp(
    `${WORD_START}\\b(guiden\\s+till|saker\\s+att\\s+göra|här\\s+hittar\\s+du|tips\\s+på|samma\\s+guide|all\\s+kommande\\s+evenemang)${WORD_END}`,
    'iu',
  ),
  // Nyhetsmeddelande: "Ansökan öppen ...", "Snart släpps ..."
  new RegExp(
    `${WORD_START}^(ansökan\\s+öppen|snart\\s+släpps|snart\\s+släpper|nyligen\\s+publicerat)${WORD_END}`,
    'iu',
  ),
];

/**
 * Titelformer som ÄR evenemang. Används för att stärka ett 'unknown' till
 * 'event' — för att inte en artikelform som råkar finnas i en riktig
 * evenemangstitel ska fälla ut den.
 *
 * Mätt 2026-11-01: bara 7 av 37 riktiga evenemangstitlar i grafen har något
 * av dessa ord. Det är i linje med titelanalysen (46 % av alla titlar saknar
 * ett aktivitetsord — de är produktions- eller artistnamn). Därför är detta
 * en *förstärkning*, inte en gate i sig.
 */
const EVENT_TITLE_PATTERNS: RegExp[] = [
  /\b(konsert|festival|utställning|workshop|kurs|teater|scen|musikal|show|kväll|turné|föreläsning|marknad|träff|premiär|release|opening)\b/iu,
  // Datum + tid i titeln: "Helgkurs – Improvisationsteater Karaktär 21-22 november"
  /\b(\d{1,2}[–-]\d{1,2}\s+\w+|\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*)\b/iu,
  // Klockslag: "måndagar kl 17.10", "20:00"
  /\bkl\.?\s*\d{1,2}[.:]\d{2}\b/iu,
];

export interface PageSignals {
  /** JSON-LD @type-värden hittade på sidan. */
  jsonLdTypes?: string[];
  /** `og:type`-metavärde. */
  ogType?: string | null;
  /** Sidans egen beskrivning (og:description / meta description). */
  description?: string | null;
  /** Sidans rubrik. */
  title?: string | null;
}

/**
 * EN rad = EN form.
 *
 * 2026-11-01 — det fanns två former för samma sak: `LikenessSignals` med ett
 * inneslutet `page?: PageSignals`, och `SourceCandidatePageSignal` (flat) i
 * types.ts. P3D skickade den FLATA formen till `assessLikeness`, som läste
 * `row.page` — så sidans egna deklarationer föll bort i varje rad, och gaten
 * arbetade med rubriken ensam. Nu är det en enda form, och `PageSignals` och
 * `SourceCandidatePageSignal` är samma sak.
 */
export interface LikenessSignals extends PageSignals {}

export interface LikenessAssessment {
  verdict: LikenessVerdict;
  /** Korta, spårbara skäl — skrivs i beslutets `reason`. */
  reasons: string[];
  /** Sant om sidan själv säger att innehållet är en artikel. */
  declaredArticle: boolean;
  /** Sant om sidan själv säger att innehållet är ett evenemang. */
  declaredEvent: boolean;
  /** Antal rader som var artiklar (per deklaration eller per titel). */
  articleRows: number;
  /** Antal rader som var evenemang. */
  eventRows: number;
  /** Antal rader som inte kunde bedömas. */
  unknownRows: number;
}

/** Avkoda HTML-entiteter och vanliga teckenkoder. */
export function decodeEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&shy;/g, '')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Titelform → artikel? Endast artiklar, inte evenemang. */
export function classifyTitleShape(title: string | null | undefined): LikenessVerdict {
  const text = decodeEntities(String(title ?? '')).trim();
  if (!text) return 'unknown';
  if (ARTICLE_TITLE_PATTERNS.some((p) => p.test(text))) return 'article';
  if (EVENT_TITLE_PATTERNS.some((p) => p.test(text))) return 'event';
  return 'unknown';
}

/** Sidans egna deklarationer → artikel, evenemang, eller vet vi inte. */
export function classifyPageSignals(page: PageSignals | undefined): {
  verdict: LikenessVerdict;
  declaredArticle: boolean;
  declaredEvent: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!page) return { verdict: 'unknown', declaredArticle: false, declaredEvent: false, reasons };

  const types = (page.jsonLdTypes ?? []).map((t) => String(t).toLowerCase());
  const hasArticleType = types.some((t) => ARTICLE_JSONLD_TYPES.has(t));
  const hasEventType = types.some((t) => EVENT_JSONLD_TYPES.has(t));

  if (hasArticleType) reasons.push(`json-ld-typ=${types.filter((t) => ARTICLE_JSONLD_TYPES.has(t)).join('/')}`);
  if (hasEventType) reasons.push(`json-ld-typ=${types.filter((t) => EVENT_JSONLD_TYPES.has(t)).join('/')}`);

  const ogType = String(page.ogType ?? '').toLowerCase();
  if (ogType === 'article') reasons.push('og:type=article');

  const desc = decodeEntities(String(page.description ?? ''));
  const marker = ARTICLE_TEXT_MARKERS.find((p) => p.test(desc));
  if (marker) reasons.push(`textmarkör=${marker.source}`);

  // Strukturella markörer i själva brödtexten/description.
  const structuralArticle = hasArticleType || !!marker;
  // `og:type=article` ensamt räcker INTE. Mätt 2026-11-01:
  // royaldjurgarden.se/julmarknad-pa-nordiska-museet ÄR ett riktigt evenemang
  // men bär `og:type=article` — en gate som blockerade på og:type ensamt hade
  // tagit bort en bra källa. Det är bara ett stöd, aldrig ett bevis.
  const declaredArticle = structuralArticle;
  const declaredEvent = hasEventType;

  if (declaredEvent) return { verdict: 'event', declaredArticle, declaredEvent, reasons };
  if (declaredArticle) return { verdict: 'article', declaredArticle, declaredEvent, reasons };
  return { verdict: 'unknown', declaredArticle, declaredEvent, reasons };
}

/**
 * Samla alla signaler om en eller flera rader.
 *
 * `rows` ska vara de faktiska raderna (med `title` och valfritt `page`).
 * En rad är 'article' om sidan själv säger det, annars om titeln säger det.
 */
export function assessLikeness(rows: LikenessSignals[]): LikenessAssessment {
  const reasons: string[] = [];
  let declaredArticle = false;
  let declaredEvent = false;
  let articleByTitle = 0;
  let eventByTitle = 0;
  let unknown = 0;
  let declaredArticleRows = 0;

  for (const row of rows) {
    // Sidans deklarationer ligger DIREKT på raden (LikenessSignals är flat).
    const page = classifyPageSignals(row);
    declaredArticle = declaredArticle || page.declaredArticle;
    declaredEvent = declaredEvent || page.declaredEvent;
    for (const r of page.reasons) reasons.push(r);

    // Sidans egen deklaration väger tyngre än titeln.
    if (page.verdict === 'article') {
      articleByTitle++;
      declaredArticleRows++;
      continue;
    }
    if (page.verdict === 'event') {
      eventByTitle++;
      continue;
    }
    const titleVerdict = classifyTitleShape(row.title);
    if (titleVerdict === 'article') articleByTitle++;
    else if (titleVerdict === 'event') eventByTitle++;
    else unknown++;
  }

  const total = rows.length;
  if (total === 0) {
    return {
      verdict: 'unknown',
      reasons: ['inga rader att bedöma'],
      declaredArticle,
      declaredEvent,
      articleRows: 0,
      eventRows: 0,
      unknownRows: 0,
    };
  }

  const articleRatio = articleByTitle / total;
  const eventRatio = eventByTitle / total;
  const base = { declaredArticle, declaredEvent, articleRows: articleByTitle, eventRows: eventByTitle, unknownRows: unknown };

  // TVÅ NIVÅER.
  //
  // Nivå 1 — BEVIS. Sidan själv deklarerar `Article`/`NewsArticle`. Detta är
  // auktoritativt och väger över allt annat.
  if (declaredArticleRows > 0 && declaredArticleRows / total > 0.5) {
    return {
      ...base,
      verdict: 'article',
      reasons: [...new Set([...reasons, `sidor-deklarerar-artikel=${declaredArticleRows}/${total}`])],
    };
  }

  // Nivå 2 — INDIKATION. Rubriken ser ut som en artikel. Mätt 2026-11-01 på
  // 45 promote:ade källor: tröskeln "minst 2 artiklar OCH minst 30 % av
  // raderna" fångar exakt kulturfestivalenstockholmse (4/4) och
  // kollaborationse (4/8) — och inga av de sju andra källorna med en enda
  // artikelrubrik. Viktigt: en enda artikelrubrik blockerar INTE, för då
  // skulle "Benjamin Ingrosso – What Happens Next?" (biljettnuse) fälla ut en
  // bra källa.
  if (articleByTitle >= 2 && articleRatio >= 0.3) {
    return {
      ...base,
      verdict: 'article',
      reasons: [...new Set([...reasons, `artikelandel=${articleByTitle}/${total}`])],
    };
  }

  if (eventRatio > 0) {
    return {
      ...base,
      verdict: 'event',
      reasons: [...new Set([...reasons, `eventandel=${eventByTitle}/${total}`])],
    };
  }
  return {
    ...base,
    verdict: 'unknown',
    reasons: [...new Set([...reasons, `okänt=${unknown}/${total}`])],
  };
}

/**
 * Ska en kandidat få promote:as?
 *
 * Beslutet är avsiktligt **konservativt**: bara en klar majoritet artiklar
 * blockerar. Okända rader blockerar aldrig — en felaktigt blockerad bra källa
 * är dyrare än en artikel som slinker igenom (den fångas av auditen).
 */
export function shouldBlockPromotion(assessment: LikenessAssessment, options?: { minRows?: number }): { blocked: boolean; reason: string } {
  const minRows = options?.minRows ?? 2;
  if (assessment.verdict !== 'article') {
    return { blocked: false, reason: assessment.verdict === 'event' ? 'raderna är evenemangsliknande' : 'raderna kunde inte bedömas' };
  }
  return {
    blocked: true,
    reason: `raderna ser ut att vara artiklar, inte evenemang (${assessment.reasons.join('; ')})`,
  };
}
