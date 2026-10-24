/**
 * Per-source title exclusions — source-specific config, inte en global regel.
 *
 * Varför: 2026-10-24 — två källor lämnade navigationsrubriker som extraherade
 * "events": "Hitta hit" (länk till Google Maps), "Om konserten", "Biljettinformation",
 * "Platsöversikt Stora salen", "Andra tillfällen" (rubriker på biljettsidan).
 * De är länkar och sektionsrubriker som råkar ligga i ett kort med ett datum —
 * inte event. De skapade dessutom felaktiga rader i databasen, där en rad bar
 * en dedup_hash som tillhörde en annan företrädesdag (se occurrence-split-gaten).
 *
 * Per CLAUDE.md Generalization Protection Rule får sådana här titlar INTE läggas
 * i en gemensam negativ lista på grund av en enda sajt: varje titel här kommer
 * från exakt EN domän (konserthuset-2 respektive wwwsfotose). Regeln säger:
 * "If only one domain exhibits an issue: Do NOT change C0/C1/C2. Do NOT
 * generalize. Suggest: source adapter, source-specific config, or manual review."
 *
 * Därför ligger uteslutningarna HÄR, i källans egen metadata, och inte i någon
 * delad heuristik. Ingen scoring-vikt, ingen IGNORE_PATTERN, ingen global
 * titelordlista rörs.
 *
 * Formatet är EXAKT matchning efter normalisering (gemener, hopplagda mellanrum,
 * avslutande punktuation borttagen) — samma normalisering som navigationTitles.ts.
 * Delsträngsmatchning är förbjuden: "biljettinformation" ska inte kunna fälla
 * "biljettinformation inför konserten".
 */

import { getSource } from '../tools/sourceRegistry';

/** Metadata-nyckeln i källans source-truth-fil. */
export const IGNORE_TITLES_METADATA_KEY = 'ignoreTitles';

/**
 * Normaliserar en titel så att "Hitta hit.", "hitta   hit" och "Hitta hit"
 * matchar samma fras.
 */
export function normaliseExcludedTitle(title: string | null | undefined): string {
  return (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:»«"'’”]+$/, '')
    .trim();
}

/** Cache per källa — importen läser samma källa många gånger. */
const exclusionCache = new Map<string, Set<string>>();

/**
 * De titlar som ska uteslutas för en källa, normaliserade.
 * Tom mängd = källan har inga uteslutningar.
 */
export function getSourceTitleExclusions(sourceId: string): Set<string> {
  const cached = exclusionCache.get(sourceId);
  if (cached) return cached;

  const exclusions = new Set<string>();
  try {
    const source = getSource(sourceId);
    const raw = source?.metadata?.[IGNORE_TITLES_METADATA_KEY];
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const normalised = normaliseExcludedTitle(entry);
        if (normalised) exclusions.add(normalised);
      }
    }
  } catch {
    // Källfilen kan saknas eller vara trasig — då gäller inga uteslutningar.
  }

  exclusionCache.set(sourceId, exclusions);
  return exclusions;
}

/**
 * Sant om titeln är utesluten för just den här källan.
 *
 * Ren funktion utöver registry-läsningen — gaten och importern använder
 * samma kodväg, så en gaten som speglar importern speglar också detta.
 */
export function isExcludedTitle(sourceId: string, title: string | null | undefined): boolean {
  const exclusions = getSourceTitleExclusions(sourceId);
  if (exclusions.size === 0) return false;
  return exclusions.has(normaliseExcludedTitle(title));
}

/** Test-only — tömmer registry-cachen. */
export function _resetExclusionCache(): void {
  exclusionCache.clear();
}
