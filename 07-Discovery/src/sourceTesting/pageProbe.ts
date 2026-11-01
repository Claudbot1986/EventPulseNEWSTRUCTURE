/**
 * pageProbe — hämta en rads DETALJSIDA och läs vad sidan själv säger.
 *
 * Varför (2026-11-01, användarens iakttagelse): "info om eventet kan även
 * ligga utanför självaste biljettkortet på en hemsida." Två saker följer av det:
 *
 *   1. BESLUT. P3D promote:ar på beviset "det persisterats events". Det är
 *      sant för en blogg också. Mätt på kollaboration.se: 10 rader, av vilka
 *      TITELMÖNSTREN fångar 4 — men sidans egen JSON-LD säger `Article`, och
 *      det fångar dem alla. Titeln ensam räcker inte; sidans deklaration
 *      avgör.
 *
 *   2. DATA. Radens `url` pekar på evenemangssidan, men vi besöker den
 *      aldrig — där står beskrivningen, platsen och bilden. Se
 *      `02-Ingestion/tools/detailEnrichment.ts`.
 *
 * Signalen är ENSIDIG, och det är viktigt:
 *   - `Article`/`NewsArticle` i JSON-LD → ÄR en artikel (bevis).
 *   - Ingen `Event`-typ → bevisar INTE att det är en artikel. Mätt:
 *     royaldjurgarden.se/julmarknad-pa-nordiska-museet ÄR ett riktigt
 *     evenemang men saknar JSON-LD helt, och bär dessutom `og:type=article`.
 *     En gate som blockerade på og:type ensamt hade tagit bort en bra källa.
 */

import { extractDetailFacts, isFetchableUrl } from '../../../02-Ingestion/tools/detailEnrichment.js';
import type { SourceCandidatePageSignal } from './types.js';

export interface ProbeRow {
  title: string;
  url?: string;
  /** Sidan raden HÄMTADES från. Om url === sourceUrl är raden en listningsrad. */
  sourceUrl?: string;
}

export interface ProbeOptions {
  /** Max antal sidor att hämta. */
  limit?: number;
  /** Timeout per fetch i ms. */
  timeoutMs?: number;
  /** Använd detta för tester. */
  fetchImpl?: (url: string) => Promise<{ status: number; body: string }>;
}

/**
 * Hämta radernas detaljsidor och returnera deras egna deklarationer.
 *
 * Endast DETALJRADER (url ≠ sourceUrl) är bevis. En rad vars url är samma
 * som listningssidan säger ingenting om just den raden — sidan beskriver
 * hela listan, inte evenemanget.
 *
 * 2026-11-01 — mätt på musikaliskase.se: 30 rader, ALLA med url ===
 * sourceUrl (kategorisidor som /musikstilar/popmusik/). Sidorna bär
 * JSON-LD-typen `article` — en mallartefakt, inte ett bevis. Gaten blockerade
 * en källa med 30 riktiga evenemang (livenation-shows). Med detaljraderna
 * blir sidbeviset noll, och rubrikerna ("TYLA – THE A*POP WORLD TOUR") bär
 * evenemangsformen → källan släpps igenom.
 */
export async function probeRowPages(
  rows: ProbeRow[],
  options: ProbeOptions = {},
): Promise<SourceCandidatePageSignal[]> {
  const limit = options.limit ?? 5;
  const timeoutMs = options.timeoutMs ?? 12000;
  const fetchImpl =
    options.fetchImpl ??
    (async (url: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; EventPulse page-probe/1.0)' },
        });
        const body = await res.text();
        return { status: res.status, body };
      } finally {
        clearTimeout(timer);
      }
    });

  const normalize = (u: unknown) => String(u ?? '').replace(/\/+$/, '');
  const fetchable = rows.filter((r) => isFetchableUrl(r.url));
  // Detaljrad: pekar på en egen sida, inte på listan den lästes från.
  const detailRows = fetchable.filter((r) => {
    const src = normalize(r.sourceUrl);
    return !src || normalize(r.url) !== src;
  });
  const candidates = detailRows.slice(0, limit);

  const signals: SourceCandidatePageSignal[] = [];
  for (const row of candidates) {
    const base: SourceCandidatePageSignal = { title: row.title };
    if (!row.url) {
      signals.push(base);
      continue;
    }
    try {
      const res = await fetchImpl(row.url);
      if (!res.body || res.status >= 400) {
        signals.push(base);
        continue;
      }
      const facts = extractDetailFacts(res.body);
      signals.push({
        title: row.title,
        jsonLdTypes: facts.jsonLdTypes,
        ogType: facts.ogType,
        description: facts.description,
      });
    } catch {
      // Nätverksfel — vi vet ingenting, och "vet inte" blockerar aldrig.
      signals.push(base);
    }
  }
  return signals;
}
