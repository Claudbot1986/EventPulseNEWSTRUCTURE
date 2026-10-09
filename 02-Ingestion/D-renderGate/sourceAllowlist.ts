/**
 * D-render pilot source allowlist (Val C, 2026-10-09).
 *
 * Per CLAUDE.md "DO NOT BUILD YET": D-render as default path is forbidden.
 * This allowlist is the GATE that makes the pilot source-specific: only
 * the 5 sourceIds below may invoke the render endpoint. Adding a new
 * source requires editing this constant (not just calling the API).
 *
 * Sources come from C-htmlGate batch-209 traces, all currently
 * routeSuggestion='D' + exitReason='C1_STRONG_JS_RENDER_D_SIGNAL'.
 *
 * Note: "Stockholm" in the user's request maps to these 5 C1-flagged
 * sources. Effective URLs are listed in the runner's sourceOverrideMap;
 * hallsberg/jonkoping/jarfalla are NOT in Stockholm municipality, but
 * they're in the batch-209 D-route set we agreed to pilot.
 */
export const RENDER_PILOT_SOURCES: ReadonlySet<string> = new Set([
  'dramaten',
  'hallsberg',
  'jonkoping',
  'djurgarden',
  'jarfalla',
  // 2026-10-09 — Fas F: Stockholm-prioriterade källor som tidigare hade
  // 0 events via C-pipelinen (URL död eller D-route-fails). D-render +
  // universal-extractor ger nu events.
  'fotografiska',
  'stockholm-jazz-festival',
  'thatsup-stockholm-events',
  'visit-stockholm',
  'sparvag-city',
]);

/**
 * Hard-coded URL for each pilot source. The runner falls back to this
 * if the request omits `url`. Keeping URLs explicit (not in a JSON file)
 * means the pilot is grep-able and self-documenting.
 *
 * Update this when a pilot source's calendar URL changes.
 */
export const RENDER_PILOT_URLS: Readonly<Record<string, string>> = {
  dramaten:   'https://www.dramaten.se/repertoar/amnesi',
  hallsberg:  'https://www.hallsberg.se/visit-hallsberg.html',
  jonkoping:  'https://www.jonkoping.se/evenemangskalender/evenemangskalender',
  // 2026-10-09 — Val C fas B: rätt URL hittad via 01-Sources/RawSources/
  // djurgardens-if.md (3arena listar Djurgården-fotboll som evenemang).
  // Original URL pekade på kalendarium.html (fel sida, 0 events).
  djurgarden: 'https://3arena.se/evenemang/sport/djurgarden-fotboll/',
  // 2026-10-09 — Val C fas B: rätt URL hittad via 03-Queue/.../D/
  // jarfalla.jsonl (3 events redan extraherade från denna URL).
  // Original URL pekade på företagsnätverk-dropdown (fel sida, 0 events).
  jarfalla:   'https://www.jarfalla.se/omsorgochstod/barnungaochfamilj/evenemangforfamiljer.4.4bd0a201194307b97542ee34.html',
  // 2026-10-09 — Fas F: Stockholm-förtätning. C-pipelinen gav 0 events
  // för fotografiska (URL död enligt RawSources). stockholm.fotografiska.com/sv
  // är den fungerande URL:en — verifierad 2026-10-09, 4 events.
  fotografiska: 'https://stockholm.fotografiska.com/sv',
  // Stockholm Jazz Festival — verifierad 2026-10-09, 1 event.
  'stockholm-jazz-festival': 'https://www.stockholmjazz.se',
  // Thatsup Stockholm events listing.
  'thatsup-stockholm-events': 'https://thatsup.se/stockholm/events',
  // Visit Stockholm "biggest upcoming events" artikel.
  'visit-stockholm': 'https://www.visitstockholm.com/see-do/attractions/biggest-upcoming-events',
  // Spårvägsmuseet "Aktuellt" — guidade visningar etc.
  'sparvag-city': 'https://www.sparvagsmuseet.se/se-och-gora/aktuellt/',
};

export function isPilotSource(sourceId: string): boolean {
  return RENDER_PILOT_SOURCES.has(sourceId);
}
