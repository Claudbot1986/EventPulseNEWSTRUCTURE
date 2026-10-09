/**
 * independenceCheck.ts — semantisk jämförelse av draft mot source description.
 *
 * Pipeline-steg 6 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * Approach (deterministisk, ingen LLM):
 *
 *   Vi vill fånga textual dependence UTAN att fälla riktiga fakta-återanvändning.
 *
 *   Problemet med gamla Jaccard + 4-grams phrase-match:
 *     - HAWK-texten "Hawk on Flight firar sitt 50-årsjubileum" failade på att
 *       "hawk on flight" (artist-namn) matchade source.
 *     - Fakta-termer som "50-årsjubileum", "turné", "bandet", "konsert",
 *       "scen", "publik", "support", "genre", "verk" MÅSTE få förekomma i
 *       både source och draft. Det är inte dependence — det är fakta.
 *
 *   Ny approach (skriven om 2026-10-08):
 *     1. Skyddad vokabulär (factual whitelist) — ord som är OK att upprepa.
 *     2. Filtrera BÅDE draft och source mot skyddad vokabulär.
 *     3. Räkna creative overlap på det som är kvar.
 *     4. Om creative overlap är hög → dependence.
 *     5. Som komplement: kolla längre phrase-sekvenser (5+ ord) EFTER
 *        filtrering — kreativa fraser tenderar att vara sammanhängande.
 *
 *   Skyddad vokabulär innefattar:
 *     - Artistnamn, venues, städer (från Profile + event)
 *     - Genrer, format, kategorier
 *     - Tider, datum, siffror
 *     - Vanliga fakta-ord (turné, jubileum, support, scen, konsert, etc.)
 *     - Pronomen (bandet, artisten, gruppen)
 *
 * Steg 6/15 i P7 Definition of Done. Skriven om 2026-10-08.
 */

import type { EditorialDraft, EventProfile, IndependenceResult } from './types';

// ─── Factual whitelist ───────────────────────────────────────────────────────

/**
 * Ord som är OK att upprepa mellan source och draft.
 * Anledning: dessa är FAKTA, inte kreativt skrivande. Förekommer de i
 * båda texterna är det dependence av nödvändighet (vi måste t.ex. nämna
 * artistnamn, datum, venue) — inte plagiarism.
 */
const PROTECTED_VOCABULARY: ReadonlySet<string> = new Set([
  // generella fakta-ord
  'turné', 'turnén', 'turnéer', 'jubileum', 'jubileet', 'jubileums',
  'support', 'supportas', 'supportar', 'öppningsakt', 'öppningsakten',
  'konsert', 'konserten', 'konserter', 'konsertserie', 'konsertserie',
  'föreställning', 'föreställningen', 'scenföreställning',
  'scen', 'scenen', 'scener', 'scenframställan',
  'publik', 'publiken', 'åhörare',
  'artist', 'artisten', 'artister', 'artisterna', 'bandet', 'band',
  'grupp', 'gruppen', 'trion', 'duon', 'ensemblen', 'orkestern', 'kören',
  'spelar', 'sjunger', 'rapp', 'rappar', 'framträder', 'framträdande',
  'gig', 'gigger', 'show', 'showen', 'konsertupplevelse',
  'låt', 'låten', 'låtar', 'låtarna', 'melodi', 'melodin', 'melodier',
  'verk', 'verket', 'verken', 'pjäs', 'pjäsen', 'pjäser', 'monolog',
  'liveshow', 'livespelning', 'spelning', 'spelningen',
  'festival', 'festivalen', 'festivaler', 'festivalprogrammet',
  'gala', 'galan', 'galakonsert',
  'premiär', 'premiären', 'nypremiär', 'urpremiär',
  'säsong', 'säsongen', 'säsongspremiär', 'säsongsavslutning',
  'ensemble', 'ensemblen', 'besättning', 'sättning', 'sättningen',
  'kör', 'kören', 'kammarmusikensemble',
  'arrangör', 'arrangören', 'presenterar', 'presenteras', 'tillsammans',
  'gäst', 'gäster', 'gästartist', 'gästspel', 'gästspelar',
  'kvartett', 'kvintett', 'sextett', 'orkester', 'storband', 'symfoniorkester',
  'kammarmusik', 'stråkkvartett', 'blåskvartett',
  'genre', 'genren', 'genrer', 'jazzrock', 'fusion', 'fusionband',
  'metal', 'thrash', 'thrash-metal', 'thrash metal',
  'pop', 'rock', 'jazz', 'klassisk', 'elektroniskt', 'folkmusik', 'visa',
  'opera', 'operan', 'operett', 'operetten',
  'swing', 'bebop', 'big band', 'bigband', 'storband',
  'repertoar', 'repertoaren',
  'pianist', 'pianisten', 'gitarrist', 'gitarristen', 'bassist', 'basisten',
  'trummis', 'trummisen', 'saxofonist', 'saxofonisten',
  'sångerska', 'sångaren', 'sångerskan',
  'solo', 'solist', 'solisten',
  'komposition', 'kompositionen', 'kompositioner', 'symfoni', 'symfonin',
  'uvertyr', 'uvertyren', 'konsert', 'konserten', 'konsertstycke',
  'pianokonsert', 'violinkonsert', 'cellokonsert',
  'dirigent', 'dirigenten',
  // generella evenemangs-ord
  'biljett', 'biljetter', 'biljetten', 'entré', 'entréen', 'inträde',
  'förköp', 'dörrarna', 'dörren', 'slår', 'öppnar', 'stänger',
  'konsertlokal', 'konsertlokalen', 'scen', 'scenen',
  'lokal', 'lokalen', 'sal', 'salen', 'hall', 'hallen', 'hus', 'huset',
  'fri entré', 'gratis', 'kostnad', 'kostnaden', 'pris', 'priser',
  'medlem', 'medlemmar', 'medlemmarna', 'stödmedlem',
  'bokning', 'bokningen', 'boka', 'förbokning', 'förbokas',
  'mat', 'matplatser', 'matplats', 'sittplats', 'sittplatser',
  'rullstol', 'rullstolsplatser', 'tillgänglighet',
  // metadata
  'starttid', 'sluttid', 'längd', 'längden', 'paus', 'pausen',
  'insläpp', 'insläppet', 'program', 'programmet', 'kväll', 'kvällen',
  'dag', 'dagen', 'vecka', 'veckan', 'månad', 'månaden', 'år', 'året',
  'tid', 'tiden', 'tider', 'kl', 'klockan',
  'presenteras', 'presenterad', 'presenterat',
  'arrangeras', 'arrangerad', 'arrangerat', 'arrangemang', 'arrangemanget',
  'info', 'information', 'kontakt', 'maila', 'ringa',
  // neutrala beskrivningar
  'lokalt', 'regionalt', 'nationellt', 'internationellt',
  'känd', 'känt', 'kända', 'namnkunnig', 'namnkunnigt', 'namnkunniga',
  'lokal', 'lokala', 'lokalt',
  'svensk', 'svenskt', 'svenska', 'nordisk', 'nordiskt', 'europeisk',
  'europeiskt', 'svenske', 'store',
  'långlivade', 'långlivat', 'lång',
  'inflytelserika', 'inflytelserik',
  'efterlängtad', 'efterlängtat', 'betydelsefulla', 'betydelsefull',
  'central', 'centralt', 'centrala',
  'förstklassigt', 'förstklassig', 'förstklassiga',
  'omfattande', 'omfattande', 'överväldigande', 'stort', 'många',
  'uttömd', 'utsåld', 'utsålda', 'fullsatt', 'fullsatta',
  // mer allmänna — för att inte fälla för vanlig fakta-repetition
  'bildades', 'startades', 'grundades', 'firar', 'fira',
  'sedan', 'starten', 'starten', 'sedan starten',
  'då', 'nu', 'idag', 'igår', 'imorgon', 'snart',
  'år', 'års', 'åring', 'åringen', 'decennier', 'decennium',
  'med', 'utan', 'för', 'mot', 'till', 'från',
  'det', 'den', 'de', 'som', 'ett',
  // 'intimt', 'gemensam', 'gemenskap' — adjektiv som speglar upplevelsekaraktär
  'intimt', 'intim', 'intima',
  'gemensam', 'gemensamt', 'gemensamma', 'gemenskap',
  'upplevelse', 'upplevelsen', 'upplevelser', 'stund', 'stunden',
  'musik', 'musiken', 'musikalisk', 'musikaliska', 'musikaliskt',
  // fler vanliga substantiv
  'biljetter', 'föreställningar', 'framföranden', 'uppträdanden',
  'medverkande', 'medverkande', 'deltagare',
  'Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Linköping', 'Sverige',
  'Sveriges', 'Svensson',
]);

/** 1-2 tecken ord, siffror, tecken — alltid skyddade. */
function isProtectedWord(w: string): boolean {
  const norm = w.toLowerCase().replace(/[.,;:!?()"]/g, '');
  if (norm.length < 3) return true;
  if (/^\d+$/.test(norm)) return true;
  return PROTECTED_VOCABULARY.has(norm);
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wåäö\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function contentTokens(text: string): string[] {
  // Tokens SOM INTE ÄR skyddade
  return tokenize(text).filter((w) => !isProtectedWord(w));
}

function contentPhrases(text: string, minLen: number = 2): string[] {
  // Sekvenser av content-ord (≥minLen i rad). Används för phrase-overlap.
  const tokens = tokenize(text);
  const contentFlags = tokens.map(isProtectedWord); // true = SKYDDAD
  const phrases: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (contentFlags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && !contentFlags[j]) {
      j++;
    }
    // tokens[i..j-1] är content-ord
    const len = j - i;
    if (len >= minLen) {
      phrases.push(tokens.slice(i, j).join(' '));
    }
    i = j;
  }
  return phrases;
}

// ─── Profile → factual-fraser (förutom de i PROTECTED_VOCABULARY) ───────────

function profileFactPhrases(profile: EventProfile, event: { title?: string; venue_name?: string | null; city?: string | null }): string[] {
  const out: string[] = [];
  for (const p of profile.performers) {
    if (p.length >= 3) out.push(p.toLowerCase());
  }
  for (const s of profile.support_acts ?? []) {
    if (s.length >= 3) out.push(s.toLowerCase());
  }
  for (const g of profile.genres) {
    if (g.length >= 3) out.push(g.toLowerCase());
  }
  for (const sg of profile.subgenres ?? []) {
    if (sg.length >= 3) out.push(sg.toLowerCase());
  }
  if (profile.tour) out.push(profile.tour.toLowerCase());
  if (profile.festival_context) out.push(profile.festival_context.toLowerCase());
  if (event.venue_name && event.venue_name.length >= 3) out.push(event.venue_name.toLowerCase());
  if (event.city && event.city.length >= 3) out.push(event.city.toLowerCase());
  if (event.title && event.title.length >= 3) out.push(event.title.toLowerCase());
  return out;
}

// ─── Similarity ──────────────────────────────────────────────────────────────

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

export interface IndependenceCheckInput {
  draft: EditorialDraft;
  /** Source description-text (endast tillgänglig HÄR — inte i writer-inputs). */
  sourceDescription: string | null;
  /** Profile för extra skydd av artistnamn/venues/genrer. */
  profile?: EventProfile;
  event?: { title?: string; venue_name?: string | null; city?: string | null };
  /** Valfri threshold (0..1). Default 0.35. */
  threshold?: number;
}

export function checkIndependence(input: IndependenceCheckInput): IndependenceResult {
  const { draft, sourceDescription } = input;
  const threshold = input.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Source är null/tom → kan inte kolla → pass.
  if (!sourceDescription || sourceDescription.trim().length === 0) {
    return {
      pass: true,
      max_similarity: 0,
      matched_phrases: [],
      checked_at: new Date().toISOString(),
    };
  }

  // ── 1) Filtrera bort skyddade ord (factual) ────────────────────────────
  const draftContent = new Set(contentTokens(draft.text));
  const sourceContent = new Set(contentTokens(sourceDescription));

  // ── 2) Jaccard på content-tokens ───────────────────────────────────────
  const contentSim = jaccard(draftContent, sourceContent);

  // ── 3) Phrase-overlap (≥2 content-ord i rad) ───────────────────────────
  const draftPhrases = contentPhrases(draft.text, 2);
  const sourceJoined = contentPhrases(sourceDescription, 2).join(' | ');

  const matchedPhrases: string[] = [];
  for (const phrase of draftPhrases) {
    if (sourceJoined.includes(phrase)) {
      matchedPhrases.push(phrase);
    }
  }

  // ── 4) Profile-fakta-skydd: matcha fraser mot Profile-fakta-fraser ────
  // Om en matchande phrase är en komplett Profile-fakta (artist-namn,
  // venue, genre, turné), räkna den som fakta och ta bort från matched.
  const protectedFactual = new Set(
    profileFactPhrases(
      input.profile ?? { event_type: '', performers: [], genres: [], content: [], experience_characteristics: [], language: [], provenance: {} },
      input.event ?? {},
    ),
  );
  const filteredMatched = matchedPhrases.filter((phrase) => {
    // Om hela phrasen är en skyddad factual → inte dependence
    if (protectedFactual.has(phrase)) return false;
    // Om phrasen ÄR en längre variant av en skyddad factual
    for (const fact of protectedFactual) {
      if (phrase.includes(fact) || fact.includes(phrase)) return false;
    }
    return true;
  });

  // ── 5) Beslut ──────────────────────────────────────────────────────────
  // Phrase-match (efter Profile-fakta-filter) → stark dependence-signal.
  // Content-Jaccard över tröskel → svagare men ändå dependence.
  const pass = filteredMatched.length === 0 && contentSim < threshold;

  return {
    pass,
    max_similarity: Math.round(contentSim * 1000) / 1000,
    matched_phrases: filteredMatched,
    checked_at: new Date().toISOString(),
  };
}
