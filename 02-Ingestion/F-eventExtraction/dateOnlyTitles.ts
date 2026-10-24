/**
 * Datum-formade titlar — en rubrik som bara är ett datum är inte ett
 * event-namn.
 *
 * Varför (2026-10-24): vasamuseet.se:s kalendersidor lägger datumet i en
 * `<h2>` OCH evenemangets namn i en `<h3>` i samma kort:
 *
 *   <div class="special-block-heading without-tags">
 *     <h2><span class="icon icon-clock"></span> 6 NOV, 14:30</h2>
 *   </div>
 *   <div class="calendar-event__info-container without-tags">
 *     <h3 class="heading-arrow lowercase">Gustav Adolf - dagen</h3>
 *   </div>
 *
 * Extractorn plockade den FÖRSTA rubriken i kortet och skrev därför in
 * "6 NOV, 14:30" som event-titel — sex events i databasen med skräptitel.
 *
 * Bevis (Generalization Protection Rule — 3 orelaterade domäner, samma
 * mönster: datumrubrik före titelfrubrik i samma kort):
 *   vasamuseet.se (6 kort) · fallan.nu (38 kort) · folkoperan.se (1 kort)
 *
 * Negativ kontroll: hela det extraherade korpuset (C- och D-körningarna)
 * gicks igenom — INGEN riktig event-titel är datumformad, så regeln
 * kastar inte bort något riktigt. Se dateOnlyTitles.test.ts.
 *
 * REGEL: hela texten måste vara datum. Ett datum med uttrycklig
 * fortsättning ("1 MAJ – EFTERFESTEN MED KSMB") är ett RIKTIGT
 * event-namn och får inte kastas.
 */

/**
 * Månadsord. Svenska fulla ord + svenska förkortningar + engelska
 * förkortningar.
 *
 * "may"/"march" saknas medvetet: de är vanliga engelska ord ("May" kan vara
 * ett namn) och det får hellre stå kvar som titel än kastas bort. "maj" täcker
 * maj på svenska.
 */
const MONTH_WORDS = [
  // Svenska, fulla ord
  'januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti',
  'september', 'oktober', 'november', 'december',
  // Svenska, förkortningar
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
  // Engelska, förkortningar (samma bokstäver som svenska förkortningar
  // förutom "oct" — "okt" täcker inte engelskans "oct")
  'oct',
];

/**
 * Alternativ som matchar ett helt datum:
 *   2026-11-06            06/11            06/11/2026
 *   6 nov                 6 nov 2026       6 nov, 14:30
 *   Nov 4, 2026           november 6       maj 2026
 *   4-6 september 2026    30 nov 2026, 18:00–20:00
 *   18:00
 *
 * Ett BART månadsord ("september", "maj") är INTE datum — det kan lika
 * gärna vara ett band- eller evenemangsnamn. Ett datum måste alltså
 * innehålla en dag eller ett år (utom ren tid, som inte är ett namn).
 */
const MONTH_ALT = MONTH_WORDS.join('|');

const DATE_ONLY_RX = new RegExp(
  '^(?:' +
    // 2026-11-06
    '\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}' +
    // 06/11 eller 06/11/2026
    '|\\d{1,2}[-./]\\d{1,2}(?:[-./]\\d{2,4})?' +
    // 6 nov / 6 nov 2026 / 6 nov, 2026
    '|\\d{1,2}\\s+(?:' + MONTH_ALT + ')\\b\\s*,?\\s*(?:\\d{4})?' +
    // nov 6 / nov 6, 2026 / november 6
    '|(?:' + MONTH_ALT + ')\\b\\s+\\d{1,2},?\\s*(?:\\d{4})?' +
    // 4-6 september 2026
    '|\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s+(?:' + MONTH_ALT + ')\\b\\s*,?\\s*(?:\\d{4})?' +
    // maj 2026
    '|(?:' + MONTH_ALT + ')\\b\\s+\\d{4}' +
    // 18:00 / 18:00–20:00 (ren tid — aldrig ett event-namn)
    '|\\d{1,2}[:.]\\d{2}(?:\\s*[-–]\\s*\\d{1,2}[:.]\\d{2})?' +
  ')' +
  // valfri tid: 14:30, 14.30, 18:00–20:00
  '(?:\\s*,?\\s*\\d{1,2}[:.]\\d{2}(?:\\s*[-–]\\s*\\d{1,2}[:.]\\d{2})?)?$',
  'i',
);

/**
 * Sant om texten bara består av datum — alltså INTE kan vara ett
 * event-namn.
 *
 * Tom text räknas inte som datum (den är inte ett datum, den saknas).
 */
export function isDateOnlyText(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return false;
  return DATE_ONLY_RX.test(trimmed);
}

/**
 * Väljer den första titeln bland kandidater som INTE bara är ett datum.
 *
 * Ordningen är given (t.ex. h1 → h2 → h3 → [class*="title"] …) och den
 * första användbara kandidaten vinner — precis som förut. Skillnaden är
 * bara att en kandidat som är ett rent datum hoppas över, så att den
 * riktiga titlen längre ned i kortet kan vinna.
 *
 * Om ALLA kandidater är datum returneras den första av dem — då finns
 * ingen bättre titel, och vi tappar inte eventet.
 */
export function pickTitleCandidate(candidates: string[]): string {
  const usable = candidates
    .map(c => (c ?? '').trim().replace(/\s+/g, ' '))
    .filter(c => c.length >= 2 && c.length <= 200);
  if (usable.length === 0) return '';
  const real = usable.find(c => !isDateOnlyText(c));
  return real ?? usable[0];
}
