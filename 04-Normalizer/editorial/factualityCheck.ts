/**
 * factualityCheck.ts — verifierar att alla materiella påståenden i draft
 * stöds av EventProfile + EventPulse-data.
 *
 * Pipeline-steg 5 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * Approach (deterministisk, ingen LLM):
 *   1. Dela draft i claims (meningar).
 *   2. Extrahera keyword claims från varje mening (kapitaliserade fraser,
 *      nummer, artist-namn). Generella adjektiv ("unik", "magisk") ignoreras.
 *   3. För varje claim, kontrollera om det stöds av Profile.performers,
 *      Profile.genres, Profile.event_type, Profile.setting, Profile.venue.
 *   4. Unsupported claims → returnera dem för regeneration.
 *
 * Steg 5/15 i P7 Definition of Done.
 */

import type { EditorialDraft, FactualityResult, EventProfile } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generiska adjektiv / superlativer som inte räknas som claims.
 * Vi vill inte att "unikt", "magiskt", "spektakulärt" ska trigga fail —
 * de är stilistiska och Profilen stödjer dem per definition om Writer
 * väljer att använda dem.
 */
const STYLISTIC_ADJECTIVES: ReadonlySet<string> = new Set([
  'unikt', 'unik', 'unika',
  'magiskt', 'magisk', 'magiska',
  'spektakulärt', 'spektakulär', 'spektakulära',
  'fantastiskt', 'fantastisk', 'fantastiska',
  'helt', 'fullständigt', 'totalt',
  'stämningsfullt', 'stämningsfull', 'stämningsfulla',
  'mysigt', 'mysig', 'mysiga',
  'intimt', 'intim', 'intima',
  'storslaget', 'storslagen', 'storslagna',
  'exklusivt', 'exklusiv', 'exklusiva',
  'legendariskt', 'legendarisk', 'legendariska',
  'klassikt', 'klassisk', 'klassiska',
  'modernt', 'modern', 'moderna',
  'nyskapande', 'nyskapande',
  'överraskande', 'överraskande',
  'populärt', 'populär', 'populära',
]);

/** Substantiv som räknas som generella/icke-claim. */
const GENERIC_NOUNS: ReadonlySet<string> = new Set([
  'kväll', 'konsert', 'föreställning', 'upplevelse', 'event', 'evenemang',
  'musik', 'musiken', 'låt', 'låtarna', 'låtar',
  'scen', 'scenen', 'scener',
  'publik', 'publiken', 'åhörare',
  'rum', 'rummet', 'lokalen', 'salen', 'hallen',
]);

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function isStylisticOrCommon(w: string): boolean {
  const lower = normalize(w);
  return STYLISTIC_ADJECTIVES.has(lower) || GENERIC_NOUNS.has(lower);
}

/**
 * Extrahera keyword claims från text. En claim är en sekvens av
 * kapitaliserade ord (artist-namn, verk-namn) eller fraser med siffror.
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];

  // Kapitaliserade fraser (2+ ord kapitaliserade).
  const capPhraseRx = /\b([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = capPhraseRx.exec(text)) !== null) {
    claims.push(m[1]);
  }

  // Enskilda kapitaliserade ord som INGT är i början av en mening.
  // Heuristik: hoppa över om föregående tecken är "." och nästa är mellanslag.
  const singleCapRx = /(?<![.!?]\s)(?<!^)\b([A-ZÅÄÖ][a-zåäö]{2,})\b/g;
  while ((m = singleCapRx.exec(text)) !== null) {
    claims.push(m[1]);
  }

  // Siffror i anslutning till substantiv ("3 timmar", "200 kr").
  const numberRx = /\b(\d+\s*(?:min|tim|minuter|timmar|kr|sek|personer|st))\b/gi;
  while ((m = numberRx.exec(text)) !== null) {
    claims.push(m[1]);
  }

  return Array.from(new Set(claims));
}

// ─── Profile → stödsetekningar ────────────────────────────────────────────────

interface Stödbas {
  phrases: Set<string>;     // normalized fraser att jämföra mot
  rawPhrases: string[];     // original-form för loggning
}

/**
 * Bygg en stödbas av allt som Profile + EventPulse-data stödjer.
 * Om en claim återfinns i nån av dessa (case-insensitive innehåll) →
 * stöds.
 */
function buildStödbas(
  profile: EventProfile,
  event: { title?: string; venue_name?: string | null; city?: string | null },
): Stödbas {
  const phrases = new Set<string>();
  const raw: string[] = [];

  const add = (s: string | null | undefined) => {
    if (!s) return;
    const norm = normalize(s);
    if (norm.length >= 3) {
      phrases.add(norm);
      raw.push(s);
    }
  };

  // Performers
  for (const p of profile.performers) add(p);
  for (const s of profile.support_acts ?? []) add(s);

  // Genres
  for (const g of profile.genres) add(g);
  for (const sg of profile.subgenres ?? []) add(sg);

  // Setting + content
  if (profile.setting) add(profile.setting);
  for (const c of profile.content) add(c);
  for (const ec of profile.experience_characteristics) add(ec);
  for (const t of profile.themes ?? []) add(t);

  // Special guests, festival_context, tour
  if (profile.festival_context) add(profile.festival_context);
  if (profile.tour) add(profile.tour);
  for (const sg of profile.special_guests ?? []) add(sg);

  // Event-data
  if (event.title) add(event.title);
  if (event.venue_name) add(event.venue_name);
  if (event.city) add(event.city);

  return { phrases, rawPhrases: raw };
}

function isSupported(claim: string, stödbas: Stödbas): boolean {
  const norm = normalize(claim);

  // Skippa tomma / för korta.
  if (norm.length < 3) return true;

  // Skippa stilistiska/generiska termer.
  if (isStylisticOrCommon(norm)) return true;

  // Skippa fraser som mestadels består av adjektiv/ord från stoplist.
  const words = norm.split(/\s+/);
  if (words.every((w) => isStylisticOrCommon(w))) return true;

  // Direkt träff?
  for (const phrase of stödbas.phrases) {
    if (phrase.includes(norm) || norm.includes(phrase)) {
      return true;
    }
  }

  // Ord-för-ord-träff (claim-ord som matchar stödfras-ord).
  for (const w of words) {
    if (w.length < 4) continue;
    for (const phrase of stödbas.phrases) {
      if (phrase.includes(w)) {
        return true;
      }
    }
  }

  return false;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export interface FactualityCheckInput {
  draft: EditorialDraft;
  profile: EventProfile;
  event: {
    title?: string;
    venue_name?: string | null;
    city?: string | null;
  };
}

/**
 * Verifiera draft mot Profile + event-data.
 *
 * Returnerar PASS om alla materiella claims stöds, FAIL annars.
 * unsupported_claims innehåller de claims som inte kunde verifieras.
 */
export function checkFactuality(input: FactualityCheckInput): FactualityResult {
  const { draft, event } = input;
  const stödbas = buildStödbas(input.profile, event);

  const claims = extractClaims(draft.text);
  const supported: string[] = [];
  const unsupported: string[] = [];

  for (const claim of claims) {
    if (isSupported(claim, stödbas)) {
      supported.push(claim);
    } else {
      unsupported.push(claim);
    }
  }

  return {
    pass: unsupported.length === 0,
    unsupported_claims: unsupported,
    supported_claims: supported,
    checked_at: new Date().toISOString(),
  };
}