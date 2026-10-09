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
  djurgarden: 'https://www.djurgarden.se/kalendarium.html',
  jarfalla:   'https://www.jarfalla.se/foretagochnaringsliv/foretagsnatverkochevenemang.4.7174b53f19482f39e501d8ed.html',
};

export function isPilotSource(sourceId: string): boolean {
  return RENDER_PILOT_SOURCES.has(sourceId);
}
