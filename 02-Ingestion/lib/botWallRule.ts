/**
 * botWallRule.ts — känner igen bot-väggar i fetch-fel.
 *
 * Bakgrund (2026-10-24). Gates som hämtar med plain HTTP (axios) träffar
 * sajter som vägrar svara på plain HTTP-klienter:
 *
 *   - cirkus.se      → 429 med `x-vercel-mitigated: challenge` (Vercel-bot)
 *   - momentsapp.no  → 403/429 (bot-skydd)
 *   - dn.se          → 406 (Nyhetsbladets bot-regel)
 *   - billetto.se    → 403 (listningen är en SPA)
 *
 * Detta är INTE rate-limiting och INTE en död sajt — sidan lever och har
 * events. Utan en gemensam regel skrev varje gate "fetch error" och begravde
 * källan: A-gaten auto-karantänade momentsapp.no efter fem 429:or
 * (2026-10-24, mätt i runtime/sources_status.jsonl) innan den ens nådde
 * C- eller D-gaten.
 *
 * Mätning 2026-10-24: Scrapingbee (riktig browser, D-gatens verktyg) hämtar
 * ALLA tre med fullt innehåll — cirkus.se 430 kB / 117 datum, momentsapp.no
 * 251 kB / 235 datum, dn.se 840 kB / 20 datum. Källan ska alltså routas till
 * D-renderGate, inte begravas.
 *
 * Regeln bygger på HTTP-statusklasser, inte på någon enskild sajt — vilket
 * är det Generalization Protection Rule kräver. 404 och 5xx räknas INTE
 * hit: där är felet verkligt (sidan saknas / servern är nere).
 */

/** HTTP-statusar som betyder "klienten blockeras", inte "sidan är död". */
export const CLIENT_BLOCK_STATUSES: readonly number[] = [401, 403, 406, 429];

/**
 * Returnerar HTTP-statusen om felet är en bot-vägg, annars null.
 *
 * @param fetchError felmeddelandet från fetchHtml, t.ex. "HTTP 403"
 */
export function detectBotWall(fetchError?: string | null): number | null {
  const message = String(fetchError ?? '');
  if (!message) return null;

  const match = message.match(/HTTP\s+(\d{3})/i);
  if (!match) return null;

  const status = Number(match[1]);
  return CLIENT_BLOCK_STATUSES.includes(status) ? status : null;
}
