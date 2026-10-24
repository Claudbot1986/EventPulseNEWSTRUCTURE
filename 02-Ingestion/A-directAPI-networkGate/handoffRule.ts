/**
 * handoffRule — skiljer en HANDOFF från ett VERKLIGT FEL i A-gaten.
 *
 * Bakgrund (2026-10-24). A-gaten skrev utfallet till statusmaskinen med
 * `success: false` UTAN error-sträng när källan inte hade JSON-LD. Utan
 * error-sträng föll utfallet i den generiska felgrenen → consecutiveFailures++
 * → auto-quarantine vid 5. Källan begravdes innan B/C hunnit köra den.
 *
 * Lösningen för handoff-felet var att ge handoffen en egen status (`routed`).
 * Men det får INTE bli så att ett TRANSPORTFEL också räknas som handoff:
 * då kan en död sajt aldrig begravas, eftersom A-gaten är den enda gaten som
 * ser transportfelet och källan bara skickas vidare.
 *
 * Regeln är därför snäv:
 *   - routing-beslut  → handoff (källan svarade, prövas i nästa spår)
 *   - transportfel    → fel (källan svarade inte, ska kunna begravas)
 *
 * Transportfelen är INTE handoff:
 *   - 'Fetch failed: HTTP 404' / timeout / SSL / DNS — sajten finns inte
 *   - 'adapter ... finns inte i registret' / 'kastade' — adaptern är trasig
 *   - 'source not found in sources/' — filen är borta
 *
 * `no-jsonld-or-no-events` är däremot ett routing-beslut: sidan laddade,
 * men JSON-LD saknas. Källan prövas då i B-gatens nätverksspår.
 *
 * SEDAN 2026-10-24 tillkom en tredje kategori: BOT-VÄGG. En sajt som svarar
 * 401/403/406/429 lever och har events — den vägrar bara plain HTTP-klienten.
 * A-gaten räknade sådana som transportfel, räknade dem i felräknaren och
 * auto-karantänade momentsapp.no efter fem försök (mätt: källans
 * consecutiveFailures var 5, sista routing-reason "toolA(preA): Fetch failed:
 * HTTP 429") trots att D-gatens riktiga browser hämtar samma sida med 1 904
 * events. Bot-väggar är därför handoffar — de följer samma väg som
 * `no-jsonld-or-no-events`: vidare till nästa gate, där C-gatens egen
 * bot-vägg-regel routar dem till D-renderGate.
 *
 * Samma statusklasser används i C-gaten (se `02-Ingestion/lib/botWallRule.ts`).
 * 404 och 5xx räknas INTE som bot-vägg — där är felet verkligt.
 */

import { detectBotWall } from '../lib/botWallRule';

/**
 * Fel som betyder "sidan svarade, men den här vägen gav inget" → nästa spår.
 *
 * `rss-feed-route` är ett routing-beslut av samma slag: källans URL är en
 * feed (preferredPath='rss'), inte en HTML-sida. JSON-LD finns inte i en
 * feed, så A-gatens JSON-LD-försök misslyckas strukturellt. Källan ska
 * vidare till B-gatens RSS-spår, inte räknas som fel.
 */
const ROUTING_ERRORS: readonly string[] = ['no-jsonld-or-no-events', 'rss-feed-route'];

/**
 * Är utfallet en handoff (källan lever men ska prövas i nästa gate)?
 *
 * @param success  A-gatens framgångsflagga
 * @param error    felmeddelandet, om något
 */
export function classifyRoutingHandoff(success: boolean, error?: string): boolean {
  if (success) return false;
  const message = String(error ?? '').trim();
  if (!message) return false;
  if (ROUTING_ERRORS.includes(message)) return true;
  // Bot-vägg: sajten lever men vägrar plain HTTP. Inte ett transportfel.
  return detectBotWall(message) !== null;
}
