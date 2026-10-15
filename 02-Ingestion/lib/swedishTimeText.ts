/**
 * swedishTimeText — extract Swedish time-of-day from free text.
 *
 * Background (2026-10-14): Several EventPulse source pages display event times
 * in plain text, not in JSON-LD structured data. Examples:
 *   - livespot.se shows "kl. 19.00" in the event detail UI
 *   - jarfalla/upplevjarfalla.se shows "15:00 - 17:00" inside `<td>` cells
 *   - arkdes.se shows "Klockan 17:30–19:00" inside `<p>` blocks
 *
 * Universal JSON-LD / URL-date extractors miss these. This util provides a single
 * regex-based extraction strategy that can be reused by all adapters and by
 * the universal extractor.
 *
 * Per CLAUDE.md Generalization Protection Rule: this util is intentionally
 * pattern-only (no site-specific URL gates). It only recognises Swedish
 * time-of-day wording — it does NOT invent times when no tid is present.
 *
 * 2026-10-14: extracted from arkdes adapter (formerly inline `parseKlockan`).
 */

/**
 * Result of parsing a Swedish time-of-day string.
 * Both fields are HH:MM 24-hour strings (e.g. "19:30"). Either may be
 * undefined when not present in the input.
 */
export interface KlockanParseResult {
  start?: string;
  end?: string;
}

/**
 * Normalise a single "H:MM" or "HH:MM" or "H.MM" or "HH.MM" string to "HH:MM".
 * Returns null if not a valid clock value.
 */
function normaliseClock(raw: string): string | null {
  // Match 1-2 digits, optional separator (:. or .), then 2 digits.
  const m = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Parse Swedish time-of-day from a short string fragment.
 *
 * Accepts (case-insensitive):
 *   "kl. 19:00"
 *   "kl. 19.00"
 *   "kl 19:00"
 *   "Klockan 17:30–19:00"   (en-dash)
 *   "Klockan 17:30-19:00"   (hyphen)
 *   "19:30-21:00"           (no leading word)
 *   "17:30"                 (single time, no end)
 *
 * Returns undefined values (NOT empty strings) when fields are missing,
 * so downstream code can distinguish "no time found" from "00:00".
 */
export function parseKlockan(s: string): KlockanParseResult {
  if (!s) return {};

  // Strip leading Swedish time words like "kl.", "kl", "Klockan", "Klockan:".
  // Keep the rest intact so we can still parse the digits.
  const cleaned = s.replace(/^\s*(kl\.?|klockan:?)\s*/i, '').trim();
  if (!cleaned) return {};

  // Pattern: HH:MM[-–]HH:MM (or HH.MM)
  const range = cleaned.match(
    /(\d{1,2}[:.]\d{2})\s*[–-]\s*(\d{1,2}[:.]\d{2})/
  );
  if (range) {
    const start = normaliseClock(range[1]);
    const end = normaliseClock(range[2]);
    const out: KlockanParseResult = {};
    if (start) out.start = start;
    if (end) out.end = end;
    return out;
  }

  // Single time HH:MM (or HH.MM)
  const single = cleaned.match(/(\d{1,2}[:.]\d{2})/);
  if (single) {
    const start = normaliseClock(single[1]);
    if (start) return { start };
  }

  return {};
}

/**
 * Find a Swedish time-of-day anywhere in a larger text fragment.
 *
 * Prefers patterns prefixed by "kl.", "kl", or "Klockan". Falls back to
 * a bare "HH:MM-HH:MM" or "HH:MM" if nothing else matches.
 *
 * Returns null when nothing recognisable is found (NOT an empty object —
 * callers must check for null to distinguish "missing" from "00:00").
 */
export function findKlockanInText(s: string): KlockanParseResult | null {
  if (!s) return null;

  // Priority 1: words like "kl. 19:00" / "Klockan 17:30-19:00"
  // Allow optional Swedish time-word prefix.
  const withWord = s.match(
    /\b(?:kl\.?|klockan:?)\s*(\d{1,2}[:.]\d{2}(?:\s*[–-]\s*\d{1,2}[:.]\d{2})?)/i
  );
  if (withWord) {
    const parsed = parseKlockan(withWord[0]);
    if (parsed.start) return parsed;
  }

  // Priority 2: bare "HH:MM-HH:MM" (no leading word).
  // Require non-digit on both sides to avoid grabbing parts of larger sequences.
  const range = s.match(
    /(?<!\d)(\d{1,2}[:.]\d{2})\s*[–-]\s*(\d{1,2}[:.]\d{2})(?!\d)/
  );
  if (range) {
    const start = normaliseClock(range[1]);
    const end = normaliseClock(range[2]);
    if (start && end) return { start, end };
  }

  // Priority 3: bare "HH:MM" with colon separator only (no prefix word).
  // Dot-only single time ("1.25") is intentionally rejected because it
  // collides with prices, version numbers, and decimal fractions in body
  // text. Sites that use dotted bare times (rare) should be parsed via
  // parseKlockan() with surrounding context, not via this util.
  const single = s.match(/(?<!\d)(\d{1,2}:\d{2})(?!\d)/);
  if (single) {
    const start = normaliseClock(single[1]);
    if (start) return { start };
  }

  return null;
}