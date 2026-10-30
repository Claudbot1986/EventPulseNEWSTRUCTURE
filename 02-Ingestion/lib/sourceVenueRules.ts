/**
 * sourceVenueRules — källspecifika platsnamn.
 *
 * ROTSAK (2026-10-30): "Upploppet" syndes två gånger i Utforska (livespot
 * + kulturhuset) med identisk titel/datum/tid. Platsnamnen skiljde sig:
 * "Kulturhuset Stadsteatern" mot "Husby" — eftersom kulturhusets egen
 * API-källa skriver OMRÅDET i fältet tixVenue[].label, inte salen.
 *
 * Mätt 2026-10-30: 46 rader från kulturhuset-källorna bar fel platsnamn
 * ("Sergels torg" 128 st, "Skärholmen" 14 st, "Husby" 11 st) och gjorde
 * att samma föreställning syntes som dubblett.
 *
 * VARFÖR DETTA ÄR KÄLLSPECIFIKT OCH INTE EN GENERELL REGEL
 *
 * Generalization Protection Rule (CLAUDE.md): en regel som bara en domän
 * motiverar ska inte gå in i C-lagret. Här är det tvärtom — regeln gäller
 * EN källa, och just därför ligger den i en källtabell, inte i
 * dedup-reglerna. Alla andra källor skickar sina riktiga salnamn.
 *
 * VARFÖR DET LIGGER VID PERSISTENSGRÄNSEN (och inte i adaptern)
 *
 * Samma teater kommer in via minst tre vägar: den dedikerade adaptern
 * (kulturhuset.ts), sitemap/C-htmlGate (kulturhusetstadsteaternse) och
 * direkta insert-script. En adapter-fix skulle bara täcka väg 1. Här
 * appliceras regeln i normalizern — alla vägar går genom den.
 *
 * Bevis: `scripts/backfill-source-venues.mjs` (bakåt i tiden) +
 * `scripts/audit-duplicates.ts` (slår ihop det som fortfarande är kvar).
 */

export interface SourceVenueRule {
  /** Det kanoniska platsnamnet för källan. */
  canonicalVenue: string;
}

/**
 * Källor vars platsnamn är felaktiga. Nyckeln är källans `source`-id.
 */
export const SOURCE_VENUE_RULES: Record<string, SourceVenueRule> = {
  // kulturhusetstadsteatern.se — alla evenemang ligger på Kulturhuset
  // Stadsteatern. Källans egen label är området ("Sergels torg",
  // "Husby", "Skärholmen"), inte salnamnet.
  kulturhuset: { canonicalVenue: 'Kulturhuset Stadsteatern' },
  'kulturhuset-barn-ung': { canonicalVenue: 'Kulturhuset Stadsteatern' },
  kulturhusetstadsteaternse: { canonicalVenue: 'Kulturhuset Stadsteatern' },
  'kulturhuset-stadsteatern': { canonicalVenue: 'Kulturhuset Stadsteatern' },
};

/**
 * Returnera det kanoniska platsnamnet för en källa, eller null om källan
 * inte har någon särskild regel.
 *
 * @param source källans source-id
 */
export function canonicalVenueForSource(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_VENUE_RULES[source]?.canonicalVenue ?? null;
}

/**
 * Har källan en särskild platsregel?
 */
export function hasSourceVenueRule(source: string | null | undefined): boolean {
  return canonicalVenueForSource(source) !== null;
}

/**
 * GRANSKTA PLATS-ALIAS (par av platsnamn som betyder samma lokal).
 *
 * Mått 2026-10-30, efter att övriga dubbletter rensats bort: 4 grupper av
 * dubblettkort kvar i Utforska → Musik. Samma evenemang, samma tid — men
 * två källor skriver olika namn på samma lokal:
 *
 *     "Terra"     — "Garden, Konsert & Kongress"  vs  "Konsistoriegatan 7"
 *     "President" — "Slaktkyrkan"                  vs  "Styckmästergatan 10"
 *
 * VARFÖR INTE EN HEURISTIK
 *
 * En automatisk regel som slår ihop "Garden" med "The Secret Garden" (token
 * "garden" är en delsekvens) eller som slår ihop "Bonniers Konsthall" med
 * "Härnösands teater" (delade koordinater) gör mer skada än nytta. Mätning
 * av en sådan regel: den slog ihop 2 730 event i OREBRO, UMEÅ, JÖNKÖPING
 * och NORRKÖPING med "Kulturhuset Stadsteatern" — via transitiv kedja.
 *
 * Därför är detta en FAKTISK, GRANSKAD lista: varje par är kontrollerat
 * mot den andra radens adress eller mot ett tredje venue-namn som
 * innehåller båda ("Slaktkyrkan, Styckmästergatan 10, Stockholm" →
 * samma lokal som både "Slaktkyrkan" och "Styckmästergatan 10").
 *
 * Lägg till nya par här, med adressen som stöd — inte i en heuristik.
 */
export const VENUE_NAME_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // Garden, Konsert & Kongress (Linköping) ligger på Konsistoriegatan 7.
  ['Konsistoriegatan 7', 'Garden, Konsert & Kongress'],
  // Samma lokal, skrivet med bara lokalnamnet. Belägg: venue-raden "Garden"
  // (430791fe…) har adressen "Konsistoriegatan 7" — samma adress som
  // venue-raden "Konsistoriegatan 7" (5ababb4d…), som ovan är alias för
  // "Garden, Konsert & Kongress". Exakt-matchning, inte delsekvens:
  // "The Secret Garden" och "Rosendal Garden Party" är ANDRA lokaler och
  // påverkas inte.
  ['Garden', 'Garden, Konsert & Kongress'],
  // Slaktkyrkan har adressen Styckmästergatan 10 (venue-raderna
  // "Slaktkyrkan, Styckmästergatan 10, Stockholm" bekräftar kopplingen).
  ['Styckmästergatan 10', 'Slaktkyrkan'],
  // Samma lokal med ortnamnet i samma fält. Detta är den exakta sträng som
  // momentsapp skriver ("Styckmästergatan 10, Stockholm") — mätt 2026-10-30:
  // utan denna alias matchar ingen exakt-matchning, och "President"/
  // "Nemzzz" på Slaktkyrkan syntes som två kort med en timmes skillnad.
  ['Styckmästergatan 10, Stockholm', 'Slaktkyrkan'],
];

/**
 * Returnera det kanoniska namnet för ett platsnamn, eller null om namnet
 * inte har något alias.
 */
export function canonicalVenueName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  for (const [from, to] of VENUE_NAME_ALIASES) {
    if (trimmed.toLowerCase() === from.toLowerCase()) return to;
  }
  return null;
}
