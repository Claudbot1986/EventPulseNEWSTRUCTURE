/**
 * Description Routing — väljer description_sv / description_en från raw.description.
 *
 * Tre regler, i prioritet:
 *
 * 1. Om raw.detected_language === 'sv' → använd raw.description som description_sv
 *    OCH som description_en (behåll båda, samma källa).
 *
 * 2. Om raw.title innehåller svenska tecken (å/ä/ö) → troligen svenskt evenemang;
 *    använd raw.description som description_sv också (befintlig regel sedan 2026-09-29).
 *
 * 3. NY (2026-10-02, plan §5.2): Om description_sv är null efter (1)+(2), OCH venue.country
 *    === 'SE' OCH raw.description har tillräcklig längd (>10 tecken) → använd raw.description
 *    som description_sv. Detta hanterar scrape-källor där extractorn sätter description_en
 *    för titlar som saknar å/ä/ö men evenemanget FAKTISKT är i Sverige (t.ex.
 *    "Dexys Midnight Runners" på Göta Lejon).
 *
 * Säkerhetsvillkor:
 * - description_sv får ALDRIG överskriva ett redan satt värde (rule 1+2 har företräde).
 * - Vi sätter description_sv ENDAST om venue.country === 'SE'. Om venue saknas eller
 *   inte är svenskt, lämnas description_sv = null.
 * - raw.description måste vara ≥10 tecken för att inte fånga placeholder-mönster
 *   ("|" mellan titel/datum/venue, tomma strängar, etc).
 *
 * Kontrakt: rent funktion, inga sidoeffekter. Lätt att enhetstesta.
 */

export interface VenueInfo {
  country: string | null;          // 'SE' / 'NO' / 'DK' / null = okänt
}

export interface DescriptionRoutingInput {
  rawDescription: string | null | undefined;
  detectedLanguage: string | null | undefined;  // 'sv' / 'en' / null
  title: string | null | undefined;
  venue: VenueInfo | null;          // null om venue saknas helt
  /** Floor för vad som räknas som riktig description (default 10 — se descriptionFallback.js) */
  minLength?: number;
}

export interface DescriptionRoutingOutput {
  description_sv: string | null;
  description_en: string | null;
  /** Vilken regel som slog in för description_sv (för loggning/audit). */
  sv_rule: 'detected-sv' | 'title-has-sv-chars' | 'swedish-venue-fallback' | 'none';
  /** Vilken regel som slog in för description_en. */
  en_rule: 'detected-en' | 'detected-sv-mirrored' | 'none';
}

const DEFAULT_MIN_LENGTH = 10;
const SWEDISH_CHARS_RX = /[åäöÅÄÖ]/;

export function routeDescription(input: DescriptionRoutingInput): DescriptionRoutingOutput {
  const minLen = input.minLength ?? DEFAULT_MIN_LENGTH;
  const raw = (input.rawDescription ?? '').trim();
  const hasRealDescription = raw.length >= minLen;
  const titleHasSwedish = SWEDISH_CHARS_RX.test(input.title ?? '');

  // Step 1: en-route
  // Befintligt beteende (normalizer.ts:484): description_en = raw.description när den finns.
  // Vi behåller det. Language detection är ett SV-route-problem, inte ett EN-route-problem —
  // description_en ska innehålla text oavsett om extractorn bekräftat språk eller ej.
  let description_en: string | null = null;
  let en_rule: DescriptionRoutingOutput['en_rule'] = 'none';

  if (hasRealDescription) {
    description_en = raw;
    en_rule = input.detectedLanguage === 'sv' ? 'detected-sv-mirrored' : 'detected-en';
  }

  // Step 2: sv-route (rule 1 → rule 2 → rule 3)
  let description_sv: string | null = null;
  let sv_rule: DescriptionRoutingOutput['sv_rule'] = 'none';

  if (hasRealDescription) {
    if (input.detectedLanguage === 'sv') {
      description_sv = raw;
      sv_rule = 'detected-sv';
    } else if (titleHasSwedish) {
      description_sv = raw;
      sv_rule = 'title-has-sv-chars';
    } else if (input.venue?.country === 'SE') {
      // Rule 3 (5.2): venue.country === 'SE' → description_en speglas till description_sv
      // Kräver description_en att vara satt (så vi inte skapar description_sv utan description_en).
      if (description_en) {
        description_sv = raw;
        sv_rule = 'swedish-venue-fallback';
      }
    }
  }

  return {
    description_sv,
    description_en,
    sv_rule,
    en_rule,
  };
}

/** Test-only — exponera konstanter för enhetstester. */
export const __test__ = {
  DEFAULT_MIN_LENGTH,
  SWEDISH_CHARS_RX,
};