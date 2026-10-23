/**
 * Navigations- och CTA-titlar — aldrig ett event-namn.
 *
 * Varför: 2026-10-24 — C-körningen över 30 live-källor producerade 167
 * extraherade rader varav 26 (21 %) av de 123 datumberoende var rena
 * navigations- eller call-to-action-texter ("Köp biljetter", "På startsidan",
 * "Läs mer", "Datum" …). De är inte event — de är länkar som råkar ligga i
 * ett "kort" som även innehåller ett datum.
 *
 * Bevis (13 orelaterade domäner i samma körning — Generalization
 * Protection Rule: 2–3 domäner krävs):
 *   postmuseum, rival, oscarsteatern, tekniska-museet, hyroxukcom,
 *   wwwfaschingse, kammarencom, wwwnobelprizemuseumse, folkoperanse,
 *   dansenshus-sv, dramaten, malmo-opera, sparvag-city, umea-ik
 *
 * Negativ kontroll: av 12 120 events i Supabase matchar NOLL av dessa
 * titlar — varken exakt eller som delsträng. Så listan riskerar inte
 * att kasta bort riktiga events.
 *
 * REGEL: exakt matchning (efter normalisering). Delsträngsmatchning är
 * FÖRBJUDEN — "skolbiljetter" (riktigt event) innehåller "biljetter", och
 * "Läs mer om språkcafé …" (riktigt event) börjar med "Läs mer".
 */

/**
 * Fraser som är navigations-/CTA-texter. Matchas EXAKT efter normalisering
 * (gemener, hopplagda mellanrum, avslutande punktuation borttagen).
 */
const NAVIGATION_TITLES = new Set([
  // Biljett-CTA
  'köp biljetter',
  'köp biljett',
  'köp biljetter online',
  'boka biljetter',
  'biljetter',
  'biljetter här',
  'biljett',
  'köp',
  'boka',
  'buy tickets',
  'get tickets',
  'tickets',
  // Info-CTA
  'mer info',
  'more info',
  'mer info / more info',
  'läs mer',
  'read more',
  'läs mer om föreställningen',
  'läs mer och se fler datum',
  'click here',
  'klicka här',
  // Navigation
  'på startsidan',
  'nyheter',
  'äldre nyheter',
  'kalendarium',
  'på gång',
  'datum',
  'historik',
  'medverkande',
  'om föreställningen',
  'om evenemanget',
  'kontakt',
  'om oss',
  'menu',
  'meny',
]);

/**
 * Normaliserar en titel så att "Köp Biljetter.", "köp   biljetter" och
 * "köp biljetter" matchar samma fras.
 */
export function normaliseNavTitle(title: string | null | undefined): string {
  return (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:»«"'’”]+$/, '')
    .trim();
}

/**
 * Sant om titeln är en navigations-/CTA-fras och alltså inte kan vara
 * ett event-namn.
 */
export function isNavigationTitle(title: string | null | undefined): boolean {
  const normalised = normaliseNavTitle(title);
  if (!normalised) return false;
  return NAVIGATION_TITLES.has(normalised);
}

/** Antal fraser i listan — används av testet som negativ kontroll. */
export const NAVIGATION_TITLE_COUNT = NAVIGATION_TITLES.size;
