/**
 * displayTitles.js — visningstitlar för ytor som läser Supabase direkt.
 *
 * Två av appens ytor går INTE via agentens feed:
 *   - Hem (`06-UI/screens/HomeScreen.js`) — läser `events_public` direkt
 *   - Karta (`06-UI/components/KartaScreen.helpers.js`) — läser `events_public` direkt
 *
 * Därför får de inte agentens `?locale=`-översättning automatiskt. Den här
 * modulen ger dem samma beteende:
 *
 *   1. Ett event vars titel innehåller tecken från ett skript som inte hör
 *      hemma i visningsspråket (t.ex. en rysk eller kinesisk titel i en
 *      svensk app) hämtar en översättning ur `event_translations`.
 *   2. Finns ingen översättning tas de främmande tecknen bort, och ett
 *      tomt resultat ger den generella rubriken — aldrig främmande tecken.
 *
 * Samma skriptidentifiering som DB-skriptet och agentens visningsskydd
 * (packages/shared/src/text/scriptScan.js) — en sanningskälla.
 */

import {
  findForeignScriptRuns,
  stripForeignScriptRuns,
} from '../../packages/shared/src/text/scriptScan.js';
import { getUiLanguage } from '../i18n/uiText';

export const GENERIC_EVENT_TITLE = 'Evenemang';

/**
 * Hämta och sätta `title_display` för events vars titel har ett skript som
 * inte hör hemma i visningsspråket. Rader utan sådana tecken lämnas orörda —
 * inget extra anrop görs för dem.
 *
 * @param {object} supabase  Supabase-client
 * @param {Array} rows       Eventrader
 * @param {string} [language]
 * @returns {Promise<void>}
 */
export async function attachDisplayTitles(supabase, rows, language = null) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const lang = language || getUiLanguage();
  if (!lang) return;

  const needsTranslation = rows.filter((row) => {
    const title = row?.title_sv || row?.title_en;
    return typeof title === 'string' && findForeignScriptRuns(title, lang).length > 0;
  });
  if (needsTranslation.length === 0) return;

  const ids = needsTranslation.map((row) => row.id);
  const { data } = await supabase
    .from('event_translations')
    .select('event_id,title')
    .eq('language', lang)
    .in('event_id', ids);
  if (!data || data.length === 0) return;

  const byEvent = new Map(data.map((row) => [row.event_id, row.title]));
  for (const row of needsTranslation) {
    const translated = byEvent.get(row.id);
    if (translated) row.title_display = translated;
  }
}

/**
 * Välj den titel som ska visas.
 *
 * Kedja: översättning → svenska → engelska → generell rubrik. Sedan
 * skyddsfilter: främmande skript tas bort. Ett tomt resultat ger den
 * generella rubriken — aldrig främmande tecken i en svensk app.
 *
 * @param {object} event
 * @param {string} [language]
 * @returns {string}
 */
export function pickDisplayTitle(event, language = null) {
  if (!event) return '';
  const candidates = [event.title_display, event.title_sv, event.title_en];
  const title = candidates.find((c) => typeof c === 'string' && c.trim());
  if (!title) return GENERIC_EVENT_TITLE;

  const lang = language || getUiLanguage();
  if (!lang) return title;
  if (findForeignScriptRuns(title, lang).length === 0) return title;

  const cleaned = stripForeignScriptRuns(title, lang).trim();
  return cleaned || GENERIC_EVENT_TITLE;
}
