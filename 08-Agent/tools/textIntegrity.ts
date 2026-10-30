/**
 * textIntegrity.ts — visningsskydd för text som kommer från databasen.
 *
 * Eventens titel, beskrivning och lokalnamn kommer från källor som inte
 * alltid skriver på svenska. En rysk teaterföreställning eller en koreansk
 * lokalnamn är inte ett fel i databasen — men det ska inte visas som om det
 * vore svensk text i en svensk app.
 *
 * Ordningen är viktig:
 *
 *   1. ÖVERSKÄTTNING — server-side väljer redan `event_translations` för
 *      språket som begärs. Det är den riktiga lösningen: innehållet visas på
 *      det språk appen visar.
 *   2. RESERVEVENT — om den valda texten ändå innehåller främmande skript
 *      letar vi efter en annan tillgänglig översättning som passar.
 *   3. RENSNING — sista utväg: de främmande tecknen tas bort. Om inget
 *      användbart återstår behåller vi originalet hellre än att visa ett
 *      tomt kort: ett riktigt namn är bättre än ett tomt.
 *
 * Skriptidentifieringen är delad med DB-skriptet och verifieringsdrivern
 * (packages/shared/src/text/scriptScan.js) — en sanningskälla.
 */

import {
  findForeignScriptRuns,
  isCompatibleWithLanguage,
  stripForeignScriptRuns,
} from '../../packages/shared/src/text/scriptScan.js';

/**
 * Är texten visningssäker för språket som visas?
 */
export function isDisplaySafe(text: string | null | undefined, language: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text) return true;
  if (!language) return true;
  return isCompatibleWithLanguage(text, language);
}

/**
 * Välj den bästa texten från en lista med fallback-kedjor (t.ex.
 * [översättning, title_sv, title_en]).
 *
 * - Om språket inte är känt returneras den första texten oförändrad
 *   (ingen gissning utanför språket).
 * - Annars väljs den första text som INNEHÅLLER främmande skript.
 * - Om ingen är ren rensas den första, och originalet återställs om rensningen
 *   skulle tömma texten helt.
 */
export function pickDisplayText(
  candidates: Array<string | null | undefined>,
  language: string | null | undefined,
): string {
  const usable = candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  if (usable.length === 0) return '';
  if (!language) return usable[0];

  const clean = usable.find((text) => isDisplaySafe(text, language));
  if (clean) return clean;

  const stripped = stripForeignScriptRuns(usable[0], language);
  return stripped.trim().length > 0 ? stripped : usable[0];
}

/**
 * Skydda ett enskilt fält (lokalnamn, beskrivning).
 *
 * För lokalnamn är fallbacken särskilt viktig: `venues.name` är den
 * kurerade versionen, men `events.venue_full_name` är källans eget namn.
 * När den kurerade raden bär ett främmande skript använder vi källans namn
 * i stället — det är fortfarande rätt information, bara på ett annat språk.
 *
 * Om inget användbart återstår returneras en TOM sträng. Ett tomt
 * lokalnamn ("Plats ej angiven") är bättre än ett främmande skript i en
 * svensk app. Titlar hanteras av pickDisplayText, som aldrig tömmer en titel.
 */
export function guardDisplayText(
  text: string | null | undefined,
  language: string | null | undefined,
): string {
  if (typeof text !== 'string' || !text) return '';
  if (!language) return text;
  if (isDisplaySafe(text, language)) return text;
  return stripForeignScriptRuns(text, language).trim();
}

/**
 * Samma sak som guardDisplayText men med en uttrycklig reserv från en
 * alternativ källa (t.ex. källans eget lokalnamn).
 */
export function guardDisplayTextWithFallback(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
  language: string | null | undefined,
): string {
  if (typeof preferred === 'string' && preferred.trim() && isDisplaySafe(preferred, language)) {
    return preferred;
  }
  if (typeof fallback === 'string' && fallback.trim() && isDisplaySafe(fallback, language)) {
    return fallback;
  }
  return guardDisplayText(preferred, language);
}

/**
 * Antal främmande skript-runor i texten — används för att mäta och rapportera.
 */
export function countForeignRuns(text: string | null | undefined, language: string | null | undefined): number {
  if (typeof text !== 'string' || !text || !language) return 0;
  return findForeignScriptRuns(text, language).length;
}
