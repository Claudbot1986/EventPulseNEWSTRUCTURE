/**
 * Title Quality Gate — reject events whose title is too generic to be useful.
 *
 * Why: 2026-09-27 — Folkoperan adapter produced 106 events with title="Folkoperan"
 * because the buyingflow page-titel for abonnemangspaket is literally "Folkoperan".
 * Adapter was fixed at the source, but we need a defense-in-depth gate so the
 * same class of bug can't pollute the corpus again from any other source.
 *
 * Rule: reject before persistence if the title:
 *  - equals or contains the source id (e.g. source="folkoperan", title="Folkoperan")
 *  - is empty / whitespace-only / < 3 chars
 *  - is purely punctuation / symbols
 *  - is a placeholder ("TBD", "TODO", "Coming soon", "Test", "Placeholder")
 *  - is just a date pattern ("2026-09-27", "27/9 2026")
 *
 * The gate is intentionally narrow — false positives would silently drop real events.
 * Suspicious-but-not-rejected titles are NOT blocked here; only obvious garbage is.
 */

export interface TitleGateResult {
  ok: boolean;
  reason?: string;
  /** Normalised form for logging (lowercase, collapsed whitespace). */
  normalised?: string;
}

const PLACEHOLDER_TITLES = new Set([
  'tbd',
  'tbh',
  'tba',
  'todo',
  'coming soon',
  'soon',
  'placeholder',
  'test',
  'sample',
  'lorem ipsum',
  'untitled',
  'okänd',
  'unknown',
  'saknar titel',
]);

const SOURCE_NAME_VARIANTS = (source: string): string[] => {
  const s = source.trim().toLowerCase();
  if (!s) return [];
  return [s, s.replace(/-/g, ' '), s.replace(/-/g, '')];
};

const DATE_ONLY_RX = /^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\s\/.]\d{1,2}[\s\/.]\d{2,4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\s*$/;
const PUNCT_ONLY_RX = /^[\s\p{P}\p{S}]+$/u;

export function evaluateTitle(title: string | undefined | null, source: string): TitleGateResult {
  const trimmed = (title ?? '').trim();
  const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ');

  if (normalised.length === 0) {
    return { ok: false, reason: 'empty', normalised };
  }
  if (normalised.length < 3) {
    return { ok: false, reason: 'too-short', normalised };
  }
  if (PUNCT_ONLY_RX.test(trimmed)) {
    return { ok: false, reason: 'punctuation-only', normalised };
  }
  if (PLACEHOLDER_TITLES.has(normalised)) {
    return { ok: false, reason: 'placeholder-text', normalised };
  }
  if (DATE_ONLY_RX.test(trimmed)) {
    return { ok: false, reason: 'date-only', normalised };
  }

  // Source-name match: title equals source (e.g. source=folkoperan, title=Folkoperan)
  // or matches a single word from a hyphenated source id (e.g. source=billetto-stockholm,
  // title=billetto). Compound titles like "Folkoperan Foajé: Carmen..." are accepted —
  // they're real sub-venue names from the folkoperan catalog, not generic page titles.
  const sourceVariants = SOURCE_NAME_VARIANTS(source);
  if (sourceVariants.includes(normalised)) {
    return { ok: false, reason: 'title-equals-source', normalised };
  }
  // Source tokens from a hyphenated/underscored id (e.g. "billetto-stockholm" →
  // ["billetto", "stockholm"]). If the title is short AND equals one of these tokens,
  // it's a generic page-title leak.
  const sourceTokens = source.toLowerCase().split(/[-_\s]+/).filter(t => t.length >= 4);
  if (sourceTokens.length > 0 && normalised.length <= 24 && trimmed.split(/\s+/).length <= 3) {
    for (const token of sourceTokens) {
      if (normalised === token) {
        return { ok: false, reason: 'title-equals-source-token', normalised };
      }
    }
  }

  return { ok: true, normalised };
}

/**
 * Bulk-pollution detector (Block B).
 *
 * Tracks per-source per-normalised-title counts within the current worker process
 * and rejects events that exceed a hard threshold (default 50) for the same
 * (source, normalised title) pair. Warns at 10+.
 *
 * Why: 2026-09-27 — we want to catch adapter regressions where the same source
 * produces hundreds of events with the same title, even if Block A doesn't fire
 * (e.g. the title is technically a real string but the adapter is in a loop).
 *
 * State is process-local and resets on worker restart — that's fine because the
 * threshold is for detecting spikes, not gradual accumulation.
 *
 * Not exported: only the worker entry point should call this.
 */
const BLOCK_B_WARN = 10;
const BLOCK_B_REJECT = 50;
const blockBCounters = new Map<string, number>();

export interface BlockBResult {
  ok: boolean;
  count: number;
  rejected: boolean;
}

export function checkBlockB(title: string, source: string): BlockBResult {
  const normalised = (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalised.length === 0) return { ok: true, count: 0, rejected: false };
  const key = `${source}::${normalised}`;
  const count = (blockBCounters.get(key) ?? 0) + 1;
  blockBCounters.set(key, count);
  if (count >= BLOCK_B_REJECT) {
    return { ok: false, count, rejected: true };
  }
  return { ok: true, count, rejected: false };
}

/** Test-only — reset the in-process counter. */
export function _resetBlockB(): void {
  blockBCounters.clear();
}