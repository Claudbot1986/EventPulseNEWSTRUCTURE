/**
 * entityExtractor.ts — extraherar entiteter (personer/band/verk/team) från
 * event-posten OCH deras roll i eventet.
 *
 * FAS 2 (2026-10-08). Skriven EFTER P8-KORRIGERING 1–8.
 *
 * KONTRAST MOT GAMLA semanticExtractor.ts:
 *   - semanticExtractor.ts var Zurich-pattern only (klassisk konsert med
 *     orkester/solist/kompositör). Hittade 0 performers i icke-klassiska
 *     events.
 *   - entityExtractor.ts är GENERELL men KONSERVATIV:
 *     använder generella mönster (inte site-specifika specialregler),
 *     märker varje claim med confidence + evidence + role.
 *
 * CONFIDENCE-LABELS (från Korrigering 8 — EJ påhittade decimaler):
 *   - VERIFIED   : strukturdata bekräftar (input.performers etc.)
 *   - SUPPORTED  : generellt mönster + kategoristöd, inga motstridiga signaler
 *   - AMBIGUOUS  : flera rimliga tolkningar (t.ex. tribute kan vara homage
 *                  men också cover band) — returneras separat för manuell review
 *   - INFERRED   : sannolik utifrån kategori men inte uttryckligen sagt
 *   - UNKNOWN    : finns INTE i källan
 *
 * CORE-REGLER (från Korrigering 2, 4, 5, 7):
 *   - Inga special-regler per exempel.
 *   - Entity ≠ role automatiskt.
 *   - Evidence obligatorisk för varje entitet.
 *   - Testas mot negativa exempel (tribute, museum, themed party, etc.).
 *   - Ingen DB-migration; profil/DB oförändrade.
 *
 * OUTPUT:
 *   ExtractedEntity[] — returnerar ALLA entiteter vi vågar påstå, plus
 *   AMBIGUOUS-entiteter separat (via .ambiguousEntities om vi senare behöver).
 *
 * ANVÄNDNING:
 *   const entities = extractEntities({
 *     title: event.title_sv,
 *     raw_description: event.raw_description,
 *     category_slug: event.category_slug,
 *     venue_name: event.venue_name,
 *     structured_performers: input.performers, // om tillgängligt
 *   });
 *   const artists = entities.filter(e => ['artist','band','dj','comedian','performer','ensemble','conductor'].includes(e.role));
 */

import type { EntityRole, ExtractedEntity, EntityExtractionInput } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Slå ihop flera uttryck till en regex-grupp (case-insensitive). */
function alt(...patterns: string[]): string {
  return `(?:${patterns.join('|')})`;
}

/** Kategori → vilka roller som är rimliga. */
const CATEGORY_ROLES: ReadonlyMap<string, ReadonlySet<EntityRole>> = new Map<string, ReadonlySet<EntityRole>>([
  ['music', new Set<EntityRole>(['artist', 'band', 'dj', 'ensemble', 'conductor'])],
  ['classical', new Set<EntityRole>(['ensemble', 'conductor', 'soloist'])],
  ['opera', new Set<EntityRole>(['ensemble', 'conductor', 'soloist'])],
  ['theatre-comedy', new Set<EntityRole>(['performer', 'comedian'])],
  ['theatre-drama', new Set<EntityRole>(['performer'])],
  ['musical-theatre', new Set<EntityRole>(['performer', 'ensemble'])],
  ['dance', new Set<EntityRole>(['performer', 'ensemble'])],
  ['sport', new Set<EntityRole>(['team'])],
  ['sports', new Set<EntityRole>(['team'])],
  ['humor', new Set<EntityRole>(['comedian'])],
  ['talks-lectures', new Set<EntityRole>(['speaker'])],
  ['workshop', new Set<EntityRole>(['speaker'])],
  ['jazz', new Set<EntityRole>(['artist', 'ensemble'])],
  ['electronic', new Set<EntityRole>(['dj', 'artist'])],
  ['rock', new Set<EntityRole>(['band', 'artist'])],
  ['pop', new Set<EntityRole>(['artist', 'band'])],
  ['kids', new Set<EntityRole>(['performer'])],
  ['family', new Set<EntityRole>(['performer'])],
  ['barn-familj', new Set<EntityRole>(['performer'])],
]);

const FALLBACK_ROLES: ReadonlySet<EntityRole> = new Set<EntityRole>(['artist', 'performer']);

/** Returnerar de roller som rimligen kan gälla entiteter i en kategori. */
function rolesForCategory(category: string | null | undefined): ReadonlySet<EntityRole> {
  if (!category) return FALLBACK_ROLES;
  return CATEGORY_ROLES.get(category) ?? FALLBACK_ROLES;
}

/** Huruvida en kategori tenderar att ha work-titles som heter samma som artister. */
function categoryTendsToWorkTitle(category: string | null | undefined): boolean {
  return ['musical-theatre', 'theatre-drama', 'opera', 'film', 'dance'].includes(category ?? '');
}

/**
 * Kategorier där det är rimligt att TITELN innehåller performers (X och Y, X - Y, X på Y).
 *
 * FAS 2.5 (2026-10-09): Detta är grinden som gör att "Konstruktion och bild" (exhibition)
 * inte feltolkas som två performers. Tidigare fångade `X och Y` mönstret alla kategorier,
 * vilket gav 8 FPs. Nu fångas `X och Y` ENDAST för performer-bearing kategorier.
 *
 * Cross-site evidens: alla 8 FP-fall i live-sample var i icke-performer-kategorier
 * (exhibition, food, wine-tasting, flea-market, festival).
 */
const PERFORMER_BEARING_CATEGORIES: ReadonlySet<string> = new Set([
  'music',
  'classical',
  'opera',
  'jazz',
  'electronic',
  'rock',
  'pop',
  'theatre-comedy',
  'theatre-drama',
  'musical-theatre',
  'dance',
  'sport',
  'sports',
  'humor',
  'talks-lectures',
  'workshop',
  'kids',
  'family',
  'barn-familj',
]);

/**
 * Event-type keywords som signalerar att ett ord ÄR ett event-namn (inte en artist).
 *
 * Används i `X på Y`, `colon_list`, `single_name`-heuristik för att filtrera bort
 * "Jazzfest", "Julfest", "Barnlördagar" etc.
 *
 * Cross-site: jazzfest, loppis, fest, mässa, festival är vanliga titel-ord i Stockholm events.
 */
const EVENT_TYPE_KEYWORDS: ReadonlyArray<string> = [
  'fest', 'festival', 'mässa', 'party', 'afton', 'kväll', 'natt',
  'gig', 'show', 'tour', 'nights', 'session', 'salong',
  'konsert', 'concert', 'live', 'event', 'eventet',
  'loppis', 'marknad', 'mässa',
];

// ─── Negativa mönster (saker vi INTE ska extrahera som performer) ───────────
//
// Dessa mönster matchas på TITLE. Om ett namn förekommer i ett negativt
// mönster markas det som `work` eller `referenced` — INTE som artist.

const NEGATIVE_TITLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; role: EntityRole; reason: string }> = [
  // Tribute / hyllning
  { pattern: /^(.+?)\s+tribute(?:\s|$)/i, role: 'referenced', reason: 'tribute_event' },
  { pattern: /\btribute\s+to\s+(.+)$/i, role: 'referenced', reason: 'tribute_event' },
  { pattern: /^(.+?)\s+(?:cover|hyllning|tribute)$/i, role: 'referenced', reason: 'cover_event' },

  // Museer / utställningar
  { pattern: /^(.+?)\s+(?:the\s+)?museum$/i, role: 'referenced', reason: 'museum' },
  { pattern: /^the\s+museum\s+of\s+(.+)$/i, role: 'referenced', reason: 'museum' },
  { pattern: /^(.+?)\s+exhibition$/i, role: 'work', reason: 'exhibition_title' },

  // Tematiska fester / pub-kvällar / disco med artistnamn
  { pattern: /^(.+?)\s+(?:party|afton|kväll|natt)$/i, role: 'theme', reason: 'themed_party' },
  { pattern: /^en\s+kväll\s+med\s+(.+)$/i, role: 'theme', reason: 'themed_event' },

  // Verkstitlar (musical, the play, the symphony, the opera)
  // Tätat 2026-10-09 (FAS 2.5): även vid efterföljande text (datum/venue/location),
  // t.ex. "Chicago - the Musical Oscarsteatern 2026-10-09 19:30".
  { pattern: /^(.+?)\s+-\s+(?:the\s+)?(?:musical|play|film|opera|ballet|symphony)(?:[\s\d].+|$)/i, role: 'work', reason: 'work_title' },
  { pattern: /^the\s+(.+?)\s+(?:musical|opera|ballet|symphony|concerto)(?:[\s\d].+|$)/i, role: 'work', reason: 'work_title' },

  // Konsert/festival med kompositör som work context (inte performer)
  { pattern: /^(.+?)\s+in\s+concert$/i, role: 'work', reason: 'concert_about_composer' },
  { pattern: /^(.+?)\s+festival$/i, role: 'work', reason: 'festival_named_after' },
];

/** Testa om en title är ett negativt mönster. Returnerar i så fall role. */
function matchNegativeTitlePattern(title: string): { role: EntityRole; reason: string } | null {
  for (const p of NEGATIVE_TITLE_PATTERNS) {
    if (p.pattern.test(title)) {
      return { role: p.role, reason: p.reason };
    }
  }
  return null;
}

// ─── Positiva mönster (VI EXTRAHERAR) ────────────────────────────────────────

interface TitlePattern {
  pattern: RegExp;
  role: EntityRole;
  /** Kräver specifik kategori (eller substring), annars returnera INFERRED. */
  categoryHint?: string;
  /** Multi-entity: returnera TVÅ entiteter (a, b). Role derived from category when possible. */
  multi?: boolean;
  /** Hur vi märker evidensmetoden. */
  method: string;
}

const POSITIVE_TITLE_PATTERNS: ReadonlyArray<TitlePattern> = [
  // "X och Y" — båda artister om kategorin stödjer
  { pattern: /^(.+?)\s+och\s+(.+?)(?:\s+-.*|\s+på\s|\s+i\s|$)/i, role: 'artist', multi: true, method: 'title_pattern:och' },

  // "X - Y" (em-dash eller vanlig) — generellt: två entiteter, role beroende av kategori
  { pattern: /^(.+?)\s+-\s+(.+?)(?:\s+\d{4}|\s*$)/i, role: 'artist', multi: true, method: 'title_pattern:dash' },

  // "X vs Y" / "X mot Y" (sport) — båda teams
  { pattern: /^(.+?)\s+(?:vs\.?|mot)\s+(.+?)\s*$/i, role: 'team', multi: true, categoryHint: 'sport', method: 'title_pattern:vs' },

  // "X på Y" — artist på venue (vanlig konsertformulering)
  // OBS: Y filtreras bort om det matchar venue_name i input.
  { pattern: /^(.+?)\s+på\s+(.+?)\s*$/i, role: 'artist', method: 'title_pattern:pa' },

  // "Standup med X"
  { pattern: /^(?:standup|komedi|humor)\s+med\s+(.+)$/i, role: 'comedian', categoryHint: 'humor', method: 'title_pattern:med' },

  // "Föreläsning med X" / "Talk med X"
  { pattern: /^(?:föreläsning|talk|samtal)\s+med\s+(.+)$/i, role: 'speaker', categoryHint: 'talks-lectures', method: 'title_pattern:med' },

  // FAS 2.6: "Konsert med X" / "Spelning med X" / "Turné med X" — generellt med-prefix
  // för konserter / spelningar. Cross-site: sthlmlist, dehartomyso, kulturhus-listor.
  // Säkerhetsnät: endast performer-bearing categories (via matchPositiveTitlePatterns).
  // Dessutom: "med X" måste vara ett proper name (versalbörjande, ej småord som "en kväll").
  { pattern: /^(?:konsert|spelning|konserter|turné|turne|gig|show|afton|kväll|konsertserie|forestilling|foreställning)\s+med\s+([A-ZÅÄÖ][\w\såäöÅÄÖ\-']{1,50})$/i, role: 'artist', method: 'title_pattern:med_concert' },

  // "Live: X" / "Live med X"
  { pattern: /^live(?:\s*på|\s*med|\s*:)\s*(.+)$/i, role: 'artist', method: 'title_pattern:live' },

  // "DJ X" / "DJ-set med X"
  { pattern: /^(?:dj|dj-set)\s+(?:med\s+|med\s|:)?(.+)$/i, role: 'dj', categoryHint: 'electronic', method: 'title_pattern:dj' },
];

interface MatchedTitleEntity {
  name: string;
  role: EntityRole;
  method: string;
  inferredFromCategory: boolean;
}

/** Välj bästa role för en entitet utifrån pattern.role + kategori. */
function pickRoleForCategory(patternRole: EntityRole, category: string | null): EntityRole {
  if (!category) return patternRole;
  const validRoles = rolesForCategory(category);
  // Om patternRole finns i kategorins giltiga roller → använd den.
  if (validRoles.has(patternRole)) return patternRole;
  // Annars, välj första rimliga rollen från kategori.
  // (t.ex. "X och Y" med humor → comedian; med sports → team)
  if (validRoles.size > 0) {
    return [...validRoles][0] as EntityRole;
  }
  return patternRole;
}

/** Filtrera bort icke-namn (för korta, med siffror, etc.). */
function isValidName(s: string): boolean {
  if (!s || s.length < 2) return false;
  if (s.length > 60) return false;
  if (/^\d+$/.test(s)) return false;
  // Måste innehålla minst en bokstav
  if (!/[A-Za-zÅÄÖåäö]/.test(s)) return false;
  return true;
}

/**
 * Returnerar true om `s` innehåller något av våra kända event-type keywords.
 *
 * "Jazzfest" → true (innehåller "fest").
 * "Veronica Maggio" → false.
 * "Julfest på Konserthuset" → true (innehåller "fest").
 *
 * FAS 2.5: Tillåter partiell matchning i sammansatta ord (utan word-boundary)
 * för att fånga "jazzfest", "julfest", "höstfest" etc.
 */
function containsEventKeyword(s: string): boolean {
  const lower = s.toLowerCase();
  return EVENT_TYPE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * Returnerar true om strängen ser ut som en FRAS (innehåller " och ", " + ", " - ",
 * etc.) snarare än ett namn. Används för att förhindra att `X på Y`-mönstret
 * feltolkar sammansatta utställnings-/event-titlar.
 *
 * Cross-site evidens: "Konstruktion och bild" (exhibition), "Så blir höstens
 * vinprovningar" (wine-tasting) — båda undviks.
 */
function looksLikePhraseNotName(s: string): boolean {
  return /\s+(?:och|\+|,|\-|\|)\s+/i.test(s);
}

/**
 * Välj bästa role för en entitet i en kategori. Prioriterar:
 *   - comedian (humor/teater-komedi-kategorier)
 *   - artist (musik-kategorier)
 *   - team (sport-kategorier)
 *   - performer (fallback för andra performance-kategorier)
 *
 * Detta gör att colon_list-entiteter får samma roll som om de hade
 * extraherats via "X och Y"-mönstret i samma kategori.
 */
function pickBestRoleForCategory(category: string | null): EntityRole {
  if (!category) return 'artist';
  const validRoles = rolesForCategory(category);
  const priority: readonly EntityRole[] = ['comedian', 'artist', 'performer', 'team', 'ensemble'];
  for (const r of priority) {
    if (validRoles.has(r)) return r;
  }
  return [...validRoles][0] as EntityRole;
}

/** Matcha positiva title-mönster. Returnerar 0+ entiteter. */
function matchPositiveTitlePatterns(
  title: string,
  category: string | null,
  venueName: string | null = null,
): MatchedTitleEntity[] {
  const out: MatchedTitleEntity[] = [];
  for (const p of POSITIVE_TITLE_PATTERNS) {
    // ── FAS 2.5: Kategori-grind för `X och Y`-mönstret ──────────────────
    // Utan denna grind ger "Konstruktion och bild" (exhibition), "Vin i Linköping"
    // (wine-tasting) etc. falska performers. Cross-site evidens: alla 8 FPs i
    // live-sample 2026-10-08 var i icke-performer-kategorier.
    if (p.method === 'title_pattern:och' && category && !PERFORMER_BEARING_CATEGORIES.has(category)) {
      continue;
    }

    const m = title.match(p.pattern);
    if (!m) continue;

    const inferredFromCategory = !!(p.categoryHint && category && !category.includes(p.categoryHint));

    if (p.multi) {
      // Två entiteter
      const a = m[1]?.trim();
      const b = m[2]?.trim();
      if (!isValidName(a) || !isValidName(b)) continue;
      // ── FAS 2.5: Skydd mot event-keywords i `X och Y` (t.ex. "Barnlördagar och Kalas")
      if (containsEventKeyword(a) || containsEventKeyword(b)) continue;
      const role = pickRoleForCategory(p.role, category);
      out.push({ name: a, role, method: p.method, inferredFromCategory });
      out.push({ name: b, role, method: p.method, inferredFromCategory });
    } else if (p.method === 'title_pattern:pa') {
      // "X på Y" — X är artist; Y är venue (filtrera bort om matchar input.venue_name)
      const artistName = m[1]?.trim();
      const afterPa = m[2]?.trim();
      if (!isValidName(artistName)) continue;
      // ── FAS 2.5: Skydd mot event-keywords i X (t.ex. "Jazzfest på Konserthuset")
      // "Jazzfest" är ett event-namn, inte en artist.
      if (containsEventKeyword(artistName)) continue;
      // ── FAS 2.5: Skydd mot fras-liknande X (t.ex. "Konstruktion och bild",
      // "Så blir höstens vinprovningar"). Cross-site: 2 av 14 FP-fall.
      if (looksLikePhraseNotName(artistName)) continue;
      const role = pickRoleForCategory(p.role, category);
      out.push({ name: artistName, role, method: p.method, inferredFromCategory });
      // Y är venue, INTE performer — vi returnerar den bara om den INTE matchar venueName
      // (dvs vi vill inte dubbelregistrera venue). Skippa alltid.
      // Logga bara om venue_name INTE matchade (då är Y en intressant plats-context).
      void afterPa; // undertrycker unused-varning
    } else {
      // En entitet
      const name = m[1]?.trim();
      if (!isValidName(name)) continue;
      const role = pickRoleForCategory(p.role, category);
      out.push({ name, role, method: p.method, inferredFromCategory });
    }
    // Använd ENDAST första matchande mönstret (för determinism)
    break;
  }
  return out;
}

/**
 * FAS 2.5: Matcha `Title: A [+ ,] B [+ ,] C ...` — kolon-prefixerade listor.
 *
 * Designprincip: LHS (före kolon) MÅSTE vara kort programnamn (1-3 ord),
 * annars är det inte en lista utan en mening. RHS är 2+ tokens, var och en
 * proper-name-format (börjar med versal), separerade av + eller ,.
 *
 * Cross-site evidens:
 *   - sthlmlist: "Quidam: Helene Berg + Paul Pignon + ..." (6 performers)
 *   - sthlmlist: "Praktikpresentation: Skånes Dansteater + Escarleth Romo Pozo"
 *   - livespot-stockholm: "Norra Brunn: Måns Möller, Tobias Erehed, ..."
 *   - berwaldhallen: delvis i #28 (work-titel före : erkänns som work).
 */
function matchColonList(
  title: string,
  category: string | null,
): MatchedTitleEntity[] {
  // Hitta första kolon. Tillåt bokstäver/siffror i LHS, men EJ fler kolon.
  const colonIdx = title.indexOf(':');
  if (colonIdx <= 0 || colonIdx >= title.length - 1) return [];
  // Bara första kolonen — fånga "Norra Brunn: Måns Möller, Tobias..."
  const lhs = title.slice(0, colonIdx).trim();
  const rhsRaw = title.slice(colonIdx + 1).trim();
  if (!lhs || !rhsRaw) return [];

  // LHS måste vara kort programnamn (1-3 ord).
  const lhsWords = lhs.split(/\s+/).filter(w => w.length > 0);
  if (lhsWords.length < 1 || lhsWords.length > 3) return [];

  // LHS får inte innehålla skiljetecken som tyder på mening.
  if (/[?!]/.test(lhs)) return [];

  // RHS: splittra på + eller , (eller ` och `).
  // Plocka ut icke-tomma tokens.
  const tokens = rhsRaw
    .split(/\s*(?:\+|,)\s*/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tokens.length < 2) return [];

  // Varje token måste se ut som ett proper name (börja med versal,
  // innehålla minst en bokstav, EJ vara bara skiljetecken).
  const names = tokens.filter(t => {
    if (!isValidName(t)) return false;
    if (!/^[A-ZÅÄÖ]/.test(t)) return false;
    // Ska inte vara ett enstaka prepositionsord ("i", "med", "och")
    if (/^(?:med|och|på|i|av|medverkande|the|and)$/i.test(t)) return false;
    return true;
  });

  if (names.length < 2) return [];

  // Bestäm roll baserat på kategori (prioritera comedian → artist → performer → team).
  const validRoles = rolesForCategory(category);
  const role = pickBestRoleForCategory(category);

  return names.map((name) => ({
    name,
    role,
    method: 'title_pattern:colon_list',
    inferredFromCategory: !validRoles.has(role),
  }));
}

/**
 * FAS 2.5: Matcha `Artist / Group` — slash-separator för samarbeten/konstellationer.
 *
 * Särskiljer från datum-mönster (2026/10/09) genom att kräva att båda sidor
 * är proper-name-format. Cross-site evidens: sthlmlist.
 */
function matchSlashCollab(
  title: string,
  category: string | null,
): MatchedTitleEntity[] {
  // Hitta slash som INTE är omgiven av siffror.
  // Tillåt bara slash mellan text-segment.
  const m = title.match(
    /^([A-ZÅÄÖ][\p{L}åäöÅÄÖ'\.\-]+(?:\s+[A-ZÅÄÖ][\p{L}åäöÅÄÖ'\.\-]+){0,3})\s+\/\s+([A-ZÅÄÖ][\p{L}åäöÅÄÖ'\.\-]+(?:\s+[A-ZÅÄÖ][\p{L}åäöÅÄÖ'\.\-]+){0,3})\s*$/u,
  );
  if (!m) return [];
  const a = m[1].trim();
  const b = m[2].trim();

  // Varken a eller b får vara ren siffra (skydd mot datum).
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return [];

  // Båda måste vara giltliga namn.
  if (!isValidName(a) || !isValidName(b)) return [];

  // Brandvägg mot event-keywords.
  if (containsEventKeyword(a) || containsEventKeyword(b)) return [];

  const validRoles = rolesForCategory(category);
  const role: EntityRole = validRoles.has('artist') ? 'artist' : 'artist';

  return [
    { name: a, role, method: 'title_pattern:slash_collab', inferredFromCategory: false },
    { name: b, role, method: 'title_pattern:slash_collab', inferredFromCategory: false },
  ];
}

/**
 * FAS 2.6: Matcha `med X & Y [& Z ...]` — ampersand-lista med "med"-prefix.
 *
 * Särdrag: kräver `med` (swe: "with") som prefix OCH att det finns
 * minst en `&` med versalbörjande tokens på båda sidor.
 *
 * Exempel:
 *   "Musik till åminnelse - med Radiokören & Peter Dijkstra" → 2 performers
 *   "Vinterkonsert - med X & Y & Z" → 3 performers
 *
 * Säkerhetsnät:
 *   - Kräver performer-bearing kategori (utöver första "med"-kravet)
 *   - Varje split måste börja med versal (proper name-format)
 *   - Skippar om "&" saknas eller färre än 2 giltliga namn hittas
 *   - Skippar "Earth, Wind & Fire" (utan "med"-prefix) — bandnamn skyddas
 *
 * Cross-site: Berwaldhallen #28. Mönstret är generellt (svenska konsertlistor).
 */
function matchAmpersandList(
  title: string,
  category: string | null,
): MatchedTitleEntity[] {
  // Snabb bortval om varken "med" eller "&" finns.
  if (!/\bmed\b/i.test(title) || !title.includes('&')) return [];

  // Snabb bortval om kategori inte performer-bearing.
  if (!category || !PERFORMER_BEARING_CATEGORIES.has(category)) return [];

  // Hitta "med X [& Y ...]" i titeln. Vi kräver att texten fram till `med`
  // slutar med skiljetecken/whitespace (för att inte feltolka "Medical" osv).
  const m = title.match(/(?:^.+?[\s\-,:]\s*|\s)med\s+([A-ZÅÄÖ][^]*?(?:\s+&\s+[A-ZÅÄÖ][^]*?)+)\s*$/i);
  if (!m) return [];

  const raw = m[1].trim();

  // Splittra på `&` med valfri whitespace runt.
  const candidates = raw.split(/\s*&\s*/).map(s => s.trim()).filter(s => s.length > 0);

  // Varje del måste vara ett giltligt proper name — börja med versal,
  // innehålla minst en bokstav, inte vara enbart preposition/småord.
  const validNames = candidates.filter(s =>
    isValidName(s) &&
    /^[A-ZÅÄÖ]/.test(s) &&
    !/^(?:och|på|med|av|i|medverkande|the|and|en|ett|en\s+kväll)$/i.test(s)
  );

  if (validNames.length < 2) return [];

  // Ytterligare skydd: ampersand-pattern ska inte hämta in hela meningar.
  // Om någon del är > 50 tecken är det sannolikt en fras, inte ett namn.
  if (validNames.some(n => n.length > 50)) return [];

  const validRoles = rolesForCategory(category);
  const role = pickBestRoleForCategory(category);

  return validNames.map((name) => ({
    name,
    role,
    method: 'title_pattern:ampersand_list',
    inferredFromCategory: !validRoles.has(role),
  }));
}

/**
 * FAS 2.5: Single-name heuristik för musik-kategorier.
 *
 * Används som sista fallback när inget annat mönster matchar. Kräver:
 *   - Kategori ∈ music/jazz/classical/pop/rock/electronic
 *   - Titeln är 1-4 ord, alla börjar med VERSAL
 *   - Inga skiljetecken/separatorer
 *   - Inga event-type keywords
 *   - Inga årstal/siffror
 *
 * Cross-site: sthlmlist, livespot-stockholm (Donovan Woods m.fl.)
 *
 * Skydd:
 *   - "Hamlet" (theatre-drama) — fel kategori → skip
 *   - "Antikrist" (theatre-drama) — fel kategori → skip
 *   - "Big in Japan 2026" — har siffror → skip
 *   - "Birita" (ovrigt) — fel kategori → skip
 *   - "Joy With Strings" (festival) — fel kategori → skip
 *   - "Vin i Linköping" (community) — har "i" + fel kategori → skip
 */
function matchSingleName(
  title: string,
  category: string | null,
): MatchedTitleEntity | null {
  const musicCategories = new Set([
    'music', 'jazz', 'classical', 'pop', 'rock', 'electronic',
  ]);
  if (!category || !musicCategories.has(category)) return null;

  const clean = title.trim();

  // Inga separatorer eller skiljetecken
  if (/[:,\-|&+?!]/.test(clean)) return null;

  // Inga siffror (år, klockslag, etc.)
  if (/\d/.test(clean)) return null;

  // Inga event-keywords
  if (containsEventKeyword(clean)) return null;

  // Inga småord som prepositioner/konjunktioner
  if (/\b(?:på|med|och|i|av|för|från|hos|över|under|medverkande|the|and|at|in)\b/i.test(clean)) return null;

  // 1-4 ord, alla versalbörjande
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 1 || words.length > 4) return null;

  const validWord = /^[A-ZÅÄÖ][\p{L}åäöÅÄÖ'\.\-]+$/u;
  if (!words.every(w => validWord.test(w))) return null;

  return {
    name: clean,
    role: 'artist',
    method: 'title_pattern:single_name',
    inferredFromCategory: false,
  };
}

// ─── Pass på raw_description (svaga signaler) ────────────────────────────────

interface DescriptionSignal {
  name: string;
  role: EntityRole;
  span: string; // exakt source-fras
  method: string;
}

const DESCRIPTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; role: EntityRole; method: string }> = [
  // "Medverkande: X, Y, Z" (teater/konsert)
  { pattern: /Medverkande:?\s+([A-ZÅÄÖa-zåäö][^.;\n]+)/i, role: 'performer', method: 'desc_pattern:medverkande' },

  // "På scenen: X" / "På scenen står X"
  { pattern: /[Pp]å\s+scenen(?:\s+står)?:?\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[a-zåäö]+)?(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/, role: 'performer', method: 'desc_pattern:scenen' },

  // "Dirigent: X"
  { pattern: /Dirigent:?\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[a-zåäö]+){0,3})/, role: 'conductor', method: 'desc_pattern:dirigent' },

  // "Solist: X" / "Pianosolist: X"
  { pattern: /(?:Pianosolist|Cellosolist|Violinsolist|Solist)\s*(?:är|:)\s+([A-ZÅÄÖ][\w\såäöÅÄÖ\.\-]{2,40})/, role: 'artist', method: 'desc_pattern:solist' },

  // "Artister: X, Y"
  { pattern: /Artister:?\s+([A-ZÅÄÖ][^.;\n]+)/, role: 'artist', method: 'desc_pattern:artister' },
];

/** Returnerar entitets-signaler från raw_description. Svagare än title. */
function matchDescriptionPatterns(description: string): DescriptionSignal[] {
  const out: DescriptionSignal[] = [];
  const cleanedDesc = description.trim();

  // Patterns som ska splittas på komma (flera performers i samma led).
  // Övriga (Dirigent, Solist, På scenen) ger bara EN entitet — det är ledarens namn.
  const COMMA_SPLIT_METHODS = new Set([
    'desc_pattern:medverkande',
    'desc_pattern:artister',
  ]);

  for (const p of DESCRIPTION_PATTERNS) {
    // Bygg en global regex för att hitta alla förekomster (utan dubbel-'g').
    const baseFlags = p.pattern.flags;
    const globalFlags = baseFlags.includes('g') ? baseFlags : baseFlags + 'g';
    const regex = new RegExp(p.pattern.source, globalFlags);
    const matches = cleanedDesc.matchAll(regex);
    for (const m of matches) {
      const raw = m[1];
      if (!raw) continue;
      const span = m[0];

      if (COMMA_SPLIT_METHODS.has(p.method)) {
        // "X, Y, Z" — splitt och ge alla som separata entiteter.
        const candidates = raw.split(/[,;]+/);
        for (const cand of candidates) {
          let name = cand.trim();
          if (name.length < 3 || name.length > 60) continue;
          // Avvisa adjektiv-tyngda börjor ("den unge X")
          name = name.replace(/^(?:den|de|det|som|är|den\s+unge|den\s+kände)[^.A-ZÅÄÖ]*/i, '').trim();
          if (name.length < 3) continue;
          // Måste börja med versal (för att filtrera bort "och X", "eller Y")
          if (!/^[A-ZÅÄÖ]/.test(name)) continue;
          // Filtrera bort icke-namn
          if (!isValidName(name)) continue;
          out.push({
            name,
            role: p.role,
            span,
            method: p.method,
          });
        }
      } else {
        // En-entitet-mönster (Dirigent, Solist, På scenen).
        let name = raw.split(/[,.;:!?()]/)[0].trim();
        if (name.length < 3 || name.length > 60) continue;
        name = name.replace(/^(?:den|de|det|som|är|den\s+unge|den\s+kände)[^.A-ZÅÄÖ]*/i, '').trim();
        if (name.length < 3) continue;
        if (!isValidName(name)) continue;
        out.push({
          name,
          role: p.role,
          span,
          method: p.method,
        });
      }
    }
  }
  return out;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export function extractEntities(input: EntityExtractionInput): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const dedup = (e: ExtractedEntity) => {
    const key = `${e.name}::${e.role}::${e.confidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };

  const title = (input.title ?? '').trim();
  const desc = (input.raw_description ?? '').trim();
  const category = input.category_slug ?? null;

  // ── Pass 1: STRUCTURED (högsta confidence) ──────────────────────────────
  if (input.structured_performers && input.structured_performers.length > 0) {
    for (const p of input.structured_performers) {
      const trimmed = p.trim();
      if (trimmed.length < 2) continue;
      dedup({
        name: trimmed,
        role: 'artist',
        evidence: { field: 'structured_input', span: trimmed, method: 'artist_resolver_pass_through' },
        confidence: 'VERIFIED',
      });
    }
  }

  // ── Pass 2: TITLE — negativa mönster först ──────────────────────────────
  if (title) {
    const neg = matchNegativeTitlePattern(title);
    if (neg) {
      // Titel är ett work/referenced/themed-event — INTE en performer.
      // Vi returnerar INTE entitet (vi avstår hellre än gissar).
      // Om kategorin tenderar att ha work-titles, tänk efter om vi ska
      // registrera ett work här — men för P8 håller vi det enkelt.
      if (categoryTendsToWorkTitle(category)) {
        // Lägg till som work, INTE performer.
        // Försök extrahera work-namnet (utan suffix som "the musical")
        // Tätat 2026-10-09: matcher även med efterföljande text som "Oscarsteatern 2026-10-09".
        const workMatch = title.match(/^(.+?)\s+-\s+(?:the\s+)?(?:musical|play|film|opera|ballet|symphony)(?:[\s\d].+|$)/i)
          ?? title.match(/^the\s+(.+?)\s+(?:musical|opera)(?:[\s\d].+|$)/i);
        const workName = workMatch?.[1]?.trim() ?? title;
        dedup({
          name: workName,
          role: 'work',
          evidence: { field: 'title', span: title, method: `negative_pattern:${neg.reason}` },
          confidence: 'SUPPORTED',
        });
      }
      // Annars: returnera ingenting (vi vet inte vem som är artist).
    } else {
      // ── Pass 2b: TITLE — positiva mönster ─────────────────────────────
      // FAS 2.5 (2026-10-09): ordnad kaskad av mönster, mest specifika först.
      //
      // 1. colon_list  — "Quidam: A + B + C" / "Norra Brunn: A, B, C"
      //    (kräver kort LHS + 2+ tokens i RHS)
      // 2. slash_collab — "Lars Jansson / Erik Söderlind Quartet"
      //    (undantag för datum-mönster)
      // 3. POSITIVE_TITLE_PATTERNS — befintliga "X och Y", "X - Y", "X på Y",
      //    "X vs Y", "med X", "DJ X", etc. (med kategori-grind på `och` + keyword-skydd på `på`)
      // 4. single_name — fallback: 1-4 ord, alla VERSAL, music-kategori
      //
      // Val av ordning: colon_list kommer FÖRST eftersom dess matchning är mest
      // strukturellt specifik och ger färre false positives när den väl fångar.
      const validRoles = rolesForCategory(category);
      const allMatches: MatchedTitleEntity[] = [];

      const colonList = matchColonList(title, category);
      if (colonList.length >= 2) {
        allMatches.push(...colonList);
      } else {
        // ── FAS 2.6: Ampersand-list "med X & Y & Z" (work-titel före `- med`) ────
        // Testas INNan slash/positive så att work-titel-pattern inte fångar hela titeln.
        const ampList = matchAmpersandList(title, category);
        if (ampList.length >= 2) {
          allMatches.push(...ampList);
        } else {
          // Slash-collab är ovanligt och kan samexistera med andra mönster
          // men inte på samma text — välj slash om den fångar.
          const slash = matchSlashCollab(title, category);
          if (slash.length === 2) {
            allMatches.push(...slash);
          } else {
            allMatches.push(...matchPositiveTitlePatterns(title, category, input.venue_name));
          }
          // Single-name är ENDAST en fallback om vi inte hittat något.
          if (allMatches.length === 0) {
            const single = matchSingleName(title, category);
            if (single) allMatches.push(single);
          }
        }
      }

      for (const m of allMatches) {
        const isInferredRole = !validRoles.has(m.role);
        dedup({
          name: m.name,
          role: m.role,
          evidence: { field: 'title', span: title, method: m.method },
          confidence: isInferredRole ? 'INFERRED' : 'SUPPORTED',
        });
      }
    }
  }

  // ── Pass 3: RAW_DESCRIPTION (svagare än title) ──────────────────────────
  if (desc) {
    const signals = matchDescriptionPatterns(desc);
    for (const s of signals) {
      // Försök att dedupligera mot title-baserade
      const key = `${s.name}::${s.role}`;
      if (seen.has(`${key}::SUPPORTED`) || seen.has(`${key}::VERIFIED`)) continue;
      dedup({
        name: s.name,
        role: s.role,
        evidence: { field: 'raw_description', span: s.span, method: s.method },
        confidence: 'SUPPORTED',
      });
    }
  }

  return out;
}
