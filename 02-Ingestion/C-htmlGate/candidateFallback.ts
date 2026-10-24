/**
 * Kandidatordningen för C-gatens fallback — ren logik, testad utan nät.
 *
 * Bakgrund (2026-10-24): C0 rankar kandidater (eventDensity), men bara
 * VINNAREN testas vidare. När vinnaren ger inga sparbara datum dog källan,
 * även om C0 redan hittat en annan kandidat som innehåller events — och
 * även om källans egen deklarerade URL hade events.
 *
 * Mätning på två live-källor:
 *   - engelbrekt.se: C0-vinnare /aktiviteter gav 0 events, men ROT-sidan
 *     har 2 riktiga datumlagda events (Lördagsmiddag, Julbord 2026-11-20).
 *   - storkyrkan.se (storkyrkan-2): C0-vinnare /kalender?... svarade
 *     HTTP 404, men ROT-sidan har 4 riktiga datumlagda events.
 *
 * Ordningen är: C0:s övriga toppkandidater först (de är mätta och rankade),
 * källans egen URL sist (den är deklarerad, men inte rankad — därför sist).
 */

export interface FallbackCandidate {
  url: string;
  /** Varför kandidaten testas — hamnar i loggen och i traces. */
  reason: string;
}

export interface TopCandidate {
  url: string;
  eventDensityScore: number;
}

/**
 * Bygg fallback-listan.
 *
 * @param topCandidates C0:s rankade kandidater (vinnaren ligger normalt först)
 * @param primaryUrl    URL som redan testats (C0-vinnaren eller url-varianten)
 * @param declaredUrl   källans egen URL — testas som sista kandidat
 * @param limit         max antal C0-kandidater (förutom declaredUrl) att testa
 */
export function buildFallbackCandidates(
  topCandidates: TopCandidate[] | undefined | null,
  primaryUrl: string,
  declaredUrl: string | null | undefined,
  limit: number,
): FallbackCandidate[] {
  const alreadyTried = new Set<string>(primaryUrl ? [primaryUrl] : []);
  const alternatives: FallbackCandidate[] = (topCandidates ?? [])
    .filter((c) => c && c.url && !alreadyTried.has(c.url))
    .slice(0, limit)
    .map((c) => ({ url: c.url, reason: `next-candidate (density=${c.eventDensityScore})` }));

  // Källans egen URL som SISTA kandidat (fix R′).
  if (declaredUrl && !alreadyTried.has(declaredUrl)) {
    alternatives.push({ url: declaredUrl, reason: 'declared-url' });
  }

  return alternatives;
}
