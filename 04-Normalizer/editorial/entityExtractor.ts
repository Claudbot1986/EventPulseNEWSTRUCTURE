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
  { pattern: /^(.+?)\s+-\s+the\s+(?:musical|play|film|opera|ballet|symphony)$/i, role: 'work', reason: 'work_title' },
  { pattern: /^the\s+(.+?)\s+(?:musical|opera|ballet|symphony|concerto)$/i, role: 'work', reason: 'work_title' },

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

/** Matcha positiva title-mönster. Returnerar 0+ entiteter. */
function matchPositiveTitlePatterns(
  title: string,
  category: string | null,
  venueName: string | null = null,
): MatchedTitleEntity[] {
  const out: MatchedTitleEntity[] = [];
  for (const p of POSITIVE_TITLE_PATTERNS) {
    const m = title.match(p.pattern);
    if (!m) continue;

    const inferredFromCategory = !!(p.categoryHint && category && !category.includes(p.categoryHint));

    if (p.multi) {
      // Två entiteter
      const a = m[1]?.trim();
      const b = m[2]?.trim();
      if (!isValidName(a) || !isValidName(b)) continue;
      const role = pickRoleForCategory(p.role, category);
      out.push({ name: a, role, method: p.method, inferredFromCategory });
      out.push({ name: b, role, method: p.method, inferredFromCategory });
    } else if (p.method === 'title_pattern:pa') {
      // "X på Y" — X är artist; Y är venue (filtrera bort om matchar input.venue_name)
      const artistName = m[1]?.trim();
      const afterPa = m[2]?.trim();
      if (!isValidName(artistName)) continue;
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
        const workMatch = title.match(/^(.+?)\s+-\s+(?:the\s+)?(?:musical|play|film|opera|ballet|symphony)$/i)
          ?? title.match(/^the\s+(.+?)\s+(?:musical|opera)/i);
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
      const matches = matchPositiveTitlePatterns(title, category, input.venue_name);
      const validRoles = rolesForCategory(category);

      for (const m of matches) {
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
