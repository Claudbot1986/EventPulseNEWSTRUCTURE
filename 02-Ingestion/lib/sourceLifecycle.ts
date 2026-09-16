/**
 * Source Lifecycle — orsaks-taxonomi och helpers för käll-livscykel.
 *
 * Denna fil är den centrala platsen för att klassificera VARFÖR en källa
 * misslyckas. ReasonCode används av:
 * - quarantineGuard.ts (skip-check i gates)
 * - lifecycle-admin.ts (CLI för manuella beslut)
 * - supervisor-dashboarden (UI-klassificering)
 *
 * Designprincip:
 * - Maskinell enum (inte fri text) → möjliggör aggregering, filter, auto-triggers.
 * - Hierarki med prefix (network.*, anti_bot.*, http.*, …) → utökningsbart.
 * - classifyError() mappar fri text (lastRoutingReason) till ReasonCode när möjligt.
 */

export type ReasonCode =
  // ── Nätverk / transport ────────────────────────────────────────────────
  | 'network.timeout'
  | 'network.dns'
  | 'network.ssl'
  | 'network.redirect_loop'
  | 'network.geo_block'
  | 'network.unknown'
  // ── Anti-bot / skydd ──────────────────────────────────────────────────
  | 'anti_bot.cloudflare'
  | 'anti_bot.captcha'
  | 'anti_bot.fingerprint'
  | 'anti_bot.unknown'
  // ── HTTP-status (när vi inte vet mer) ─────────────────────────────────
  | 'http.403'
  | 'http.404'
  | 'http.410'
  | 'http.429'
  | 'http.5xx'
  // ── Juridiskt / avsiktligt blockerade ─────────────────────────────────
  | 'legal.robots_disallow'
  | 'legal.paywall'
  | 'legal.login_required'
  // ── Render / klient-side ──────────────────────────────────────────────
  | 'render.spa_only'
  | 'render.js_required'
  | 'render.shadow_dom'
  // ── Schema / innehållsform ───────────────────────────────────────────
  | 'schema.no_events_on_entry'
  | 'schema.wrong_entry_page'
  | 'schema.needs_subpage'
  | 'schema.likely_js_render'
  | 'schema.low_confidence_jsonld'
  // ── Adapter / parser ──────────────────────────────────────────────────
  | 'adapter.known_broken'
  | 'adapter.parser_regression'
  | 'adapter.hash_collision'
  // ── Täckning / scope ──────────────────────────────────────────────────
  | 'coverage.outside_stockholm'
  | 'coverage.duplicate_of'
  | 'coverage.out_of_scope'
  // ── Oklassificerat ────────────────────────────────────────────────────
  | 'unknown';

export const ALL_REASON_CODES: readonly ReasonCode[] = [
  'network.timeout', 'network.dns', 'network.ssl', 'network.redirect_loop',
  'network.geo_block', 'network.unknown',
  'anti_bot.cloudflare', 'anti_bot.captcha', 'anti_bot.fingerprint', 'anti_bot.unknown',
  'http.403', 'http.404', 'http.410', 'http.429', 'http.5xx',
  'legal.robots_disallow', 'legal.paywall', 'legal.login_required',
  'render.spa_only', 'render.js_required', 'render.shadow_dom',
  'schema.no_events_on_entry', 'schema.wrong_entry_page', 'schema.needs_subpage',
  'schema.likely_js_render', 'schema.low_confidence_jsonld',
  'adapter.known_broken', 'adapter.parser_regression', 'adapter.hash_collision',
  'coverage.outside_stockholm', 'coverage.duplicate_of', 'coverage.out_of_scope',
  'unknown',
] as const;

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && (ALL_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Människovänlig etikett för ReasonCode (svenska, för dashboard och loggar).
 */
export const REASON_LABELS: Record<ReasonCode, string> = {
  'network.timeout': 'Timeout',
  'network.dns': 'DNS-uppslag misslyckades',
  'network.ssl': 'TLS/SSL-fel',
  'network.redirect_loop': 'Oändlig redirect-loop',
  'network.geo_block': 'Geo-blockerad',
  'network.unknown': 'Nätverksfel (okänt)',
  'anti_bot.cloudflare': 'Cloudflare-skydd',
  'anti_bot.captcha': 'CAPTCHA',
  'anti_bot.fingerprint': 'Bot-fingerprinting',
  'anti_bot.unknown': 'Anti-bot (okänt)',
  'http.403': 'HTTP 403 — förbjuden',
  'http.404': 'HTTP 404 — ej hittad',
  'http.410': 'HTTP 410 — borttagen',
  'http.429': 'HTTP 429 — rate-limited',
  'http.5xx': 'HTTP 5xx — serverfel',
  'legal.robots_disallow': 'robots.txt blockerar',
  'legal.paywall': 'Betald tjänst',
  'legal.login_required': 'Inloggning krävs',
  'render.spa_only': 'SPA — ingen SSR',
  'render.js_required': 'JS krävs för rendering',
  'render.shadow_dom': 'Shadow DOM',
  'schema.no_events_on_entry': 'Inga events på entry-sidan',
  'schema.wrong_entry_page': 'Fel entry-sida',
  'schema.needs_subpage': 'Behöver subpage-discovery',
  'schema.likely_js_render': 'Sannolikt JS-renderad',
  'schema.low_confidence_jsonld': 'JSON-LD extraherad med låg säkerhet',
  'adapter.known_broken': 'Adapter trasig',
  'adapter.parser_regression': 'Parser-regression',
  'adapter.hash_collision': 'Dedup-hash-kollision',
  'coverage.outside_stockholm': 'Utanför Stockholm-scope',
  'coverage.duplicate_of': 'Duplicerar annan källa',
  'coverage.out_of_scope': 'Utanför agent scope',
  'unknown': 'Okänd orsak',
};

/**
 * Klassificerar en felsträng (fri text från gates) till en ReasonCode.
 * Används när befintliga rader i runtime/postTestC-manual-review.jsonl eller
 * runtime/sources_status.jsonl (med fältet lastRoutingReason) behöver en
 * maskinklassificering.
 *
 * Returnerar alltid en giltig ReasonCode — default 'unknown' om inget matchar.
 */
export function classifyError(errorText: string | null | undefined): ReasonCode {
  if (!errorText) return 'unknown';
  const s = errorText.toLowerCase();

  // HTTP-status (kontrollera tidigt för att fånga specifika fall)
  if (/\b403\b/.test(s) || s.includes('forbidden')) return 'http.403';
  if (/\b404\b/.test(s) || s.includes('not found')) return 'http.404';
  if (/\b410\b/.test(s) || s.includes('gone')) return 'http.410';
  if (/\b429\b/.test(s) || s.includes('rate limit') || s.includes('too many requests')) return 'http.429';
  if (/\b5\d\d\b/.test(s)) return 'http.5xx';

  // Nätverk
  if (s.includes('timeout') || s.includes('timed out')) return 'network.timeout';
  if (s.includes('enotfound') || s.includes('dns') || s.includes('getaddrinfo')) return 'network.dns';
  if (s.includes('cert') || s.includes('ssl') || s.includes('tls') || s.includes('altname')) return 'network.ssl';
  if (s.includes('redirect') && s.includes('exceeded')) return 'network.redirect_loop';

  // Anti-bot
  if (s.includes('cloudflare')) return 'anti_bot.cloudflare';
  if (s.includes('captcha')) return 'anti_bot.captcha';
  if (s.includes('fingerprint') || s.includes('datadome') || s.includes('perimeterx')) {
    return 'anti_bot.fingerprint';
  }

  // Schema
  if (s.includes('no-jsonld') || s.includes('no json-ld') || s.includes('no events')) {
    return 'schema.no_events_on_entry';
  }
  if (s.includes('wrong entry') || s.includes('not the entry')) return 'schema.wrong_entry_page';
  if (s.includes('likely_js_render') || s.includes('js render') || s.includes('javascript')) {
    return 'schema.likely_js_render';
  }
  if (s.includes('low confidence')) return 'schema.low_confidence_jsonld';

  // Legal
  if (s.includes('paywall') || s.includes('paid')) return 'legal.paywall';
  if (s.includes('login') || s.includes('auth required')) return 'legal.login_required';
  if (s.includes('robots.txt')) return 'legal.robots_disallow';

  return 'unknown';
}

/**
 * Beslutsstöd: vilka ReasonCode-kategorier bör aldrig auto-skickas till
 * D-renderGate (anti-bot / paywall blir värre av försök).
 */
export function isRenderHostile(reason: ReasonCode): boolean {
  return (
    reason.startsWith('anti_bot.') ||
    reason === 'legal.paywall' ||
    reason === 'legal.login_required' ||
    reason === 'coverage.outside_stockholm'
  );
}

/**
 * Beslutsstöd: vilka ReasonCode-kategorier bör auto-skickas till manuell
 * review-kö (istället för att bara öka consecutiveFailures).
 */
export function shouldTriggerManualReview(reason: ReasonCode): boolean {
  return (
    reason === 'schema.low_confidence_jsonld' ||
    reason === 'schema.wrong_entry_page' ||
    reason === 'adapter.parser_regression' ||
    reason === 'legal.paywall' ||
    reason.startsWith('anti_bot.') ||
    reason === 'coverage.outside_stockholm'
  );
}

/**
 * Auto-quarantine-tröskel: konsekutiva misslyckanden innan en källa
 * automatiskt flyttas till sources/_quarantine/.
 *
 * Användaren har explicit valt N=5 (se plan: eventual-leaping-plum.md §E).
 */
export const AUTO_QUARANTINE_THRESHOLD = 5;
