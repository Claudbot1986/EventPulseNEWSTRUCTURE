/**
 * net-error.mjs — ärlig felklassning för nätverks- och API-fel.
 *
 * Varför (2026-10-28). Tre nätter i rad (26/27/28 okt) loggade kedjan
 * "exit=0" medan den producerade NOLL events. Rotorsaken var två lager:
 *
 *   1. Nätverksstacken dog (EADDRNOTAVAIL mot både 127.0.0.1:6379 och
 *      externa värdar — ingen HTTP-status nåddes).
 *   2. Koden översatte det tysta transportfelet till "klar".
 *
 * Klassningen här gör (1) och (2) oskiljbara: varje fel får ett klassnamn
 * ur ett slutet värdefärum, och kedjan kan räkna på "transport ⇒ inte klart".
 *
 * Klasserna:
 *   transport — nätverket nådde inte servern (DNS, connect, timeout, reset).
 *               Kedjan KAN INTE ha frågat om något. exit 69 (EX_UNAVAILABLE).
 *   auth      — servern svarade men nekade (401/403, fel nyckel).
 *               Kedjan frågade och fick nej. exit 77 (EX_NOPERM).
 *   http      — servern svarade med felstatus (4xx/5xx).
 *               Kedjan frågade och fick fel svar. exit 69/70 beroende på 5xx.
 *   empty     — servern svarade 200 med noll användbara rader.
 *               Kedjan frågade och fick inget. INTE ett fel i sig — men
 *               får aldrig rapporteras som "klar" utan att nämnas.
 *   logic     — kodfel, trasig data, programmeringsfel. exit 70.
 *
 * "empty" och "auth" är medvetet INTE transport: de betyder att kedjan
 * faktiskt nådde fram. Det är skillnaden mellan "nätet dog" och
 * "nyckeln saknas" — vilket var det ingen kunde se i loggen.
 */

/** @typedef {'transport'|'auth'|'http'|'empty'|'logic'} ErrorClass */

/** Alla giltiga felklasser — används för att validera en medförd klass. */
const ERROR_CLASSES = new Set(['transport', 'auth', 'http', 'empty', 'logic']);

/** errno-värden som betyder "servern nåddes aldrig". */
const TRANSPORT_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EADDRNOTAVAIL',
  'EADDRINUSE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * Plocka ut den djupaste felkedjan (cause-kedjan) — felen kan vara
 * nestad flera nivåer: TypeError: fetch failed → cause: Error → cause: {code}.
 *
 * @param {unknown} err
 * @returns {unknown[]}
 */
function errorChain(err) {
  const chain = [];
  let current = err;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = /** @type {{cause?: unknown}} */ (current).cause;
  }
  return chain;
}

/**
 * Hitta ett errno-kod i felkedjan.
 *
 * @param {unknown} err
 * @returns {string | null}
 */
export function errnoOf(err) {
  for (const link of errorChain(err)) {
    const code = /** @type {{code?: unknown, errno?: unknown}} */ (link).code ?? /** @type {{errno?: unknown}} */ (link).errno;
    if (typeof code === 'string' && TRANSPORT_ERRNOS.has(code)) return code;
  }
  return null;
}

/**
 * Mönster för transportfel i ren text. Används när felet inte finns som
 * objekt — bara som en loggrad (barnprocessens stderr, cron-step-output).
 *
 * Listan är samma som TRANSPORT_ERRNOS, plus de engelska fraserna Node/undici
 * skriver ("fetch failed", "socket hang up"), de meddelanden ioredis ger när
 * Redis dör mitt i en körning, och svenska felrader vi själva producerar
 * ("transport-fel").
 *
 * 2026-10-28 — ioredis-felen lades till efter mätning mot en död Redis
 * (127.0.0.1:9). Utan dem blev "Connection is closed." ett 'logic'-fel, och
 * kedjan avslutade exit 0 = grön medan Redis faktiskt var död — exakt det
 * fel som hela fail-fast-stremmen ska fånga.
 */
const TRANSPORT_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|EADDRNOTAVAIL|EADDRINUSE|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EPIPE|UND_ERR_[A-Z_]+)\b|fetch failed|socket hang up|getaddrinfo|transport-fel|timed? ?out|Connection is closed\.|Stream isn't writeable|enableOfflineQueue options is false/i;

/**
 * Mönster för auth-fel i ren text.
 *
 * NOTE: råa "401"/"403" räcker INTE — i en loggrad kan de vara antal
 * (t.ex. "403 poster"), inte en statuskod. Kräv därför kontext
 * ("HTTP 401", "status=403") eller en tydlig auktorisationsfras.
 *
 * NOTE: alternativen MÅSTE ligga på samma rad. Ett `|` i början av en rad
 * är inte en fortsättning av föregående reguljärt uttryck — JS tolkar det
 * som bitvis OR, vilket gör AUTH_PATTERN till 0 och `.test()` kastar
 * TypeError. Felet var latent: classifyMessage nådde AUTH_PATTERN bara
 * när texten INTE matchade transportmönstret, så det kastade precis när
 * kedjan behövde klassa ett auth- eller http-fel. Upptäckt av
 * scripts/lib/net-error.test.ts (2026-10-28).
 */
const AUTH_PATTERN = /\b(?:unauthorized|forbidden|invalid api[ _-]?key|missing api[ _-]?key|api[ _-]?key.*(?:invalid|not|missing))\b|\b(?:http|status(?:\s*code)?|code)\s*[:= ]\s*(?:401|403)\b/i;

/**
 * Markerare för en VALFRI berikning vars fel inte får fälla kedjan.
 *
 * Varför (2026-10-28). Editorial Engine (LLM-beskrivning) är opt-in och
 * per-event: den fångar sitt eget fel och låter eventet sparas ändå. Men
 * felet skrevs till stderr som "fetch failed" — och kedjans klassificering
 * av stderr såg ett transportfel i ett steg som avslutade exit=0 med 5402
 * persisterade events. Kedjan gick röd på en fullständigt lyckad körning,
 * vilket är lika skadligt som den gamla gröna ljugen: operatören slutar
 * lita på exit 69.
 *
 * Konventionen: en delsystem som äger ett fel skriver ut DEGRADED på raden.
 * Kedjan räknar raden som en rapporterad försämring (syns i
 * `status.json:degradedSteps[]`) i stället för som ett dolt transportfel.
 *
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function isDegradedLine(text) {
  return typeof text === 'string' && /\bDEGRADED\b/.test(text);
}

/**
 * Dela upp stderr i "rapporterad försämring" och "övrigt".
 *
 * @param {string | null | undefined} text
 * @returns {{ degraded: string[], rest: string }}
 */
export function splitDegraded(text) {
  const degraded = [];
  const rest = [];
  for (const line of (text ?? '').split('\n')) {
    if (isDegradedLine(line)) degraded.push(line);
    else rest.push(line);
  }
  return { degraded, rest: rest.join('\n') };
}

/**
 * Rader som betyder "vi försöker igen" — ska inte räknas som fel.
 *
 * En nätverksfläck som övergick till framgång är inte ett transportfel.
 */
export const RETRY_PATTERN = /retry|retrying|försök(ar)? igen|will retry/i;

/**
 * Allvarlighetsordning mellan klasserna — samma prioritet som
 * classifyMessage: transport slår auth, auth slår http, http slår logic.
 */
const CLASS_SEVERITY = { logic: 0, empty: 0, http: 1, auth: 2, transport: 3 };

/**
 * Klassificera en FELTEXT — t.ex. en rad från ett barnprocessens stderr.
 *
 * Detta är vägen som gör "steget säger exit=0 men loggen innehåller
 * ECONNREFUSED" upptäckbart. Utan den skulle kedjan fortsätta säga "klar"
 * medan nätet varit dödt hela natten.
 *
 * @param {string | null | undefined} text
 * @returns {ErrorClass}
 */
export function classifyMessage(text) {
  if (!text) return 'logic';
  if (TRANSPORT_PATTERN.test(text)) return 'transport';
  if (AUTH_PATTERN.test(text)) return 'auth';
  if (/\b(?:http|status)\s*5\d\d\b/i.test(text)) return 'http';
  if (/\b(?:http|status)\s*4\d\d\b/i.test(text)) return 'http';
  return 'logic';
}

/**
 * Strömmande klassificering av stderr — O(1) minne, hela strömmen täckt.
 *
 * VARFÖR (2026-10-28). Kedjan höll stegets stderr i en begränsad buffert
 * (32 KB början + 32 KB slut) och klassade DEN texten. Mätt på en verklig
 * logg — `worker-drain-2026-10-28T06-07-38-030Z.err.log`, 1 213 321 byte —
 * låg den enda transportmarkören ("fetch failed") på byte 119 988, alltså i
 * den kastade mitten. Kedjan klassade steget som 'logic', avslutade exit 0
 * och skrev "klar" — precis det tysta fel den här kedjan finns för att döda.
 *
 * Lösningen är inte att behålla mer text (då står vi tillbaka vid 583 KB
 * felrader), utan att INTE kasta bort signal: vi läser varje rad medan den
 * kommer och behåller bara det som klassningen behöver — den värsta
 * felklassen och antalet DEGRADED-rader. Mitten behövs inte, men den får
 * inte försvinna heller.
 *
 * Ekvivalens mot classifyMessage: mönstren är radbundna (inga `^`/`$` med
 * `m`-flagga), så att klassa rad för rad och ta den värsta klassen ger samma
 * svar som att klassa hela texten. DEGRADED-rader och retry-rader hoppas
 * över — de är inte fel (se isDegradedLine och RETRY_PATTERN).
 *
 * @returns {{
 *   append: (text: string) => void,
 *   flush: () => void,
 *   readonly worstClass: ErrorClass,
 *   readonly degradedCount: number,
 * }}
 */
export function createStreamingClassifier() {
  let partial = '';
  let worst = /** @type {ErrorClass} */ ('logic');
  let degradedCount = 0;

  /** @param {string} line */
  function consider(line) {
    if (!line.trim()) return;
    if (isDegradedLine(line)) {
      degradedCount += 1;
      return;
    }
    if (RETRY_PATTERN.test(line)) {
      // 2026-10-28 — retry-rader är inte fel, men de får inte FÖRSVINNA.
      // Före detta kastades raden bort helt, så en rad som både sa "will
      // retry" och bar en transportmarkör ("fetch failed") rapporterades
      // inte alls — kedjan kunde inte skilja "nätverksfläck som retry
      // räddade" från "fel som aldrig syntes". Nu rapporteras den som en
      // FÖRSÄMRING (degradedCount), inte som ett transportfel: kedjan går
      // inte röd på en fläck som gick över, men informationen finns kvar.
      if (TRANSPORT_PATTERN.test(line)) degradedCount += 1;
      return;
    }
    const cls = classifyMessage(line);
    if (CLASS_SEVERITY[cls] > CLASS_SEVERITY[worst]) worst = cls;
  }

  return {
    append(text) {
      if (!text) return;
      const combined = partial + text;
      const parts = combined.split('\n');
      // Sista delen är inte en komplett rad ännu — den kan fortsätta i nästa
      // chunk. Utan detta skulle en markör som delas mellan två chunks gå
      // förlorad.
      partial = parts.pop() ?? '';
      for (const line of parts) consider(line);
    },

    flush() {
      if (!partial) return;
      consider(partial);
      partial = '';
    },

    get worstClass() {
      return worst;
    },

    get degradedCount() {
      return degradedCount;
    },
  };
}

/**
 * Klassificera ett fel.
 *
 * @param {unknown} err
 * @returns {ErrorClass}
 */
export function classifyError(err) {
  if (err === null || err === undefined) return 'logic';

  // 1. HTTP-svar som vi fångat (t.ex. { status, body }) — explicit svar.
  const status = /** @type {{status?: unknown, statusCode?: unknown}} */ (err)?.status
    ?? /** @type {{statusCode?: unknown}} */ (err)?.statusCode;
  if (typeof status === 'number' && status >= 100 && status < 600) {
    if (status === 401 || status === 403) return 'auth';
    return 'http';
  }

  // 2. Transportfel i cause-kedjan.
  if (errnoOf(err)) return 'transport';

  // 3. "fetch failed" utan källa = nätverksfel i Node 18+.
  const message = String(/** @type {{message?: unknown}} */ (err)?.message ?? err);
  return classifyMessage(message);
}

/**
 * Klassificera ett HTTP-svar. 2xx = inget fel.
 *
 * @param {{ok?: boolean, status?: number}} res
 * @returns {ErrorClass | null}
 */
export function classifyHttpResponse(res) {
  if (!res) return 'logic';
  if (res.ok) return null;
  if (res.status === 401 || res.status === 403) return 'auth';
  return 'http';
}

/**
 * Plocka ut en läsbar text ur ett fel — även när det INTE är en Error.
 *
 * Varför (2026-10-28). PostgREST (Supabase) returnerar {code, message,
 * details, hint} — ett plain object. `String(obj)` ger "[object Object]",
 * så ett verkligt transportfel ("fetch failed") skrevs ut som
 * "[object Object]" i kedjans logg. Då gick det inte att avgöra om
 * felet var transport, auth eller kodfel — och kedjan avslutade med
 * exit 1 i stället för 69.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function errorText(err) {
  if (err === null || err === undefined) return 'okänt fel';
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const message = /** @type {{message?: unknown}} */ (err).message;
    if (typeof message === 'string' && message.trim()) return message;
    const code = /** @type {{code?: unknown}} */ (err).code;
    if (typeof code === 'string' && code.trim()) return code;
    // Sista utväg: lista FÄLTNAMN, inte värden — "[object Object]" säger
    // ingenting, och värden kan i värsta fall innehålla hemligheter.
    const keys = Object.keys(err);
    if (keys.length > 0) return `objekt med fälten: ${keys.join(', ')}`;
  }
  return String(err);
}

/**
 * Klassa ett fel som eventuellt redan bär en klass.
 *
 * Varför (2026-10-28). Lager som fångar och omsluter ett fel (t.ex.
 * repository-lagret i 07-Discovery/src/sourceTesting) sätter `errorClass`
 * på det nya Error-objektet. Att sedan klassa OM det omsluta felet
 * kastade bort den informationen: grundfelet "fetch failed" blev
 * "Failed to insert ...: [object Object]" → 'logic' → exit 1, i stället
 * för transport → exit 69. Kedjan sa då "ett steg gick sönder" när
 * världen egentligen var död.
 *
 * @param {unknown} err
 * @returns {ErrorClass}
 */
export function classifyWithCarried(err) {
  const carried = /** @type {{errorClass?: unknown}} */ (err)?.errorClass;
  if (typeof carried === 'string' && ERROR_CLASSES.has(carried)) {
    return /** @type {ErrorClass} */ (carried);
  }
  return classifyError(err);
}

/**
 * Bygg ett fyndigt felmeddelande: "Redis unavailable (EADDRNOTAVAIL)".
 * Hemligheter maskeras aldrig — nycklar skrivs inte i felmeddelanden.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  const errno = errnoOf(err);
  const message = errorText(err).replace(/\s+/g, ' ').trim();
  const short = message.length > 180 ? `${message.slice(0, 177)}…` : message;
  return errno ? `${short} (${errno})` : short;
}

/**
 * Exitkod per felklass. Kedjan använder samma skala överallt.
 *
 *   69 EX_UNAVAILABLE — servern nåddes inte / svarade fel
 *   70 EX_SOFTWARE     — kodfel
 *   75 EX_TEMPFAIL     — tillfälligt fel, försök igen senare
 *   77 EX_NOPERM       — autentisering/auktorisering nekad
 *
 * @param {ErrorClass} errorClass
 * @returns {number}
 */
export function exitCodeFor(errorClass) {
  switch (errorClass) {
    case 'transport':
      return 69;
    case 'auth':
      return 77;
    case 'http':
      return 69;
    case 'empty':
      return 0;
    case 'logic':
      return 70;
    default:
      return 70;
  }
}
