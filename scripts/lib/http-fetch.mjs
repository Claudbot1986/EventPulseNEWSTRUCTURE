/**
 * http-fetch.mjs — skilj på "servern svarade nej" och "servern svarade inte".
 *
 * VARFÖR (2026-10-28). Mätt på riktig körning (direct-jsonld, 2026-10-28):
 * 10 av 139 källor svarade 403/406/429 — de svarade alltså, men nekade vår
 * förfrågan. Skriptet skrev alla som "fetch failed", och den texten
 * klassificeras som TRANSPORTFEL (scripts/lib/net-error.mjs). Kedjan gick
 * därför röd med exit 69 — "nätet dog" — medan nätet var friskt och 129 av
 * 139 källor svarade normalt.
 *
 * Det är samma fel som den gröna ljugen, fast omvänt: kedjan rapporterade
 * en orsak som inte var den verkliga. Operatören leds till att söka fel på
 * nätverket i stället för på bot-spärrar.
 *
 * REGELN.
 *   - Kasta            → nätverket nådde inte fram (transport).
 *   - Svar med 4xx/5xx → servern svarade, men nekade (refused).
 *   - Svar med 2xx     → allt var bra.
 *
 * Modulen är beroendefri (ingen Redis, ingen Supabase) så att regeln kan
 * testas med en falsk fetch — samma princip som 03-Queue/drainOutcome.mjs.
 */

/** Standard-timeout för en enskild förfrågan. */
export const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * @typedef {{
 *   ok: true,
 *   text: string,
 *   status: number,
 * }} FetchOk
 * @typedef {{
 *   ok: false,
 *   kind: 'refused',
 *   status: number,
 * }} FetchRefused
 * @typedef {FetchOk | FetchRefused} FetchResult
 */

/**
 * Hämta text. Kastar vidare transportfel (nätverket nådde inte fram) så
 * att anroparen kan klassa dem med classifyError().
 *
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   headers?: Record<string, string>,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<FetchResult>}
 */
export async function fetchText(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    // 2xx → text. 4xx/5xx → servern svarade men nekade: det är INTE ett
    // transportfel, och det ska inte rapporteras som ett.
    if (!response.ok) {
      return { ok: false, kind: 'refused', status: response.status };
    }
    return { ok: true, text: await response.text(), status: response.status };
  } catch (err) {
    // 2026-10-28 — en avbruten förfrågan är ett TIMEOUT, inte ett kodfel.
    // Node kastar AbortError ("This operation was aborted"), och kedjan
    // klassar den texten som 'logic' (exit 70) — vilket vore osant: servern
    // svarade inte i tid. Med ETIMEDOUT blir klassen 'transport' (exit 69).
    if (controller.signal.aborted) {
      const timeoutError = new Error(`timeout efter ${timeoutMs} ms — förfrågan avbröts`);
      /** @type {Error & { code?: string }} */ (timeoutError).code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Beskriv en vägran på ett sätt som INTE kan misstas för en autentiserings-
 * fel eller ett transportfel.
 *
 * VARFÖR. Kedjan klassar barnprocessers stderr på text (net-error.mjs).
 * "HTTP 403" matchar auth-mönstret ("http 403" ⇒ auth ⇒ exit 77) och
 * "fetch failed" matchar transportmönstret (⇒ exit 69). En offentlig
 * webbsida som blockerar en bot är varken det ena eller det andra — den
 * svarade, vi fick bara nej. Formuleringen här innehåller därför varken
 * "http"+"403" eller "fetch failed".
 *
 * @param {number} status
 * @returns {string}
 */
export function describeRefusal(status) {
  return `vägrade vår förfrågan (svarskod ${status})`;
}
