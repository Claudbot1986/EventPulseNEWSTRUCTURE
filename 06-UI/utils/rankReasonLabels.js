/**
 * RankReason → { icon, label, fullLabel } mapping.
 *
 * Source of truth for the enum: 08-Agent/types.ts (RankReason).
 * No free text. Each label is a short, deterministic phrase derived from the
 * enum value. Per vault 03-Patterns/40-UX-Research-Decisions.md:
 *   - Inline compact (icon + short label) under the card.
 *   - Max 2-3 visible, "visa mer" if more.
 *   - Never free text. Never tooltip-only on mobile.
 *
 * If a new enum value is added on the backend, add it here — do NOT pass the
 * raw string through to the UI. Unknown values are filtered out by the caller
 * (see resolveReason).
 */

const SV = {
  time_fit: {
    icon: '🕒',
    label: 'Bra tid',
    fullLabel: 'Matchar tidsfönstret',
  },
  under_budget: {
    icon: '💰',
    label: 'Under budget',
    fullLabel: 'Inom din budget',
  },
  over_budget: {
    icon: '💸',
    label: 'Över budget',
    fullLabel: 'Över angiven budget',
  },
  category_match: {
    icon: '🎯',
    label: 'Rätt kategori',
    fullLabel: 'Matchar din kategori',
  },
  exclude_match: {
    icon: '🚫',
    label: 'Inte exkluderad',
    fullLabel: 'Uppfyller dina undantag',
  },
  not_ended: {
    icon: '✅',
    label: 'Inte avslutad',
    fullLabel: 'Eventet har inte avslutats',
  },
  high_confidence: {
    icon: '✨',
    label: 'Hög kvalitet',
    fullLabel: 'Hög datakvalitet',
  },
  low_confidence: {
    icon: '⚠️',
    label: 'Låg kvalitet',
    fullLabel: 'Låg datakvalitet — verifiera',
  },
  stale: {
    icon: '🕰️',
    label: 'Gammal data',
    fullLabel: 'Data kan vara gammal',
  },
};

const EN = {
  time_fit: {
    icon: '🕒',
    label: 'Time fit',
    fullLabel: 'Matches your time window',
  },
  under_budget: {
    icon: '💰',
    label: 'Under budget',
    fullLabel: 'Within your budget',
  },
  over_budget: {
    icon: '💸',
    label: 'Over budget',
    fullLabel: 'Over your budget',
  },
  category_match: {
    icon: '🎯',
    label: 'Category match',
    fullLabel: 'Matches your category',
  },
  exclude_match: {
    icon: '🚫',
    label: 'Not excluded',
    fullLabel: 'Meets your exclusions',
  },
  not_ended: {
    icon: '✅',
    label: 'Still on',
    fullLabel: 'Event has not ended',
  },
  high_confidence: {
    icon: '✨',
    label: 'High quality',
    fullLabel: 'High data quality',
  },
  low_confidence: {
    icon: '⚠️',
    label: 'Low quality',
    fullLabel: 'Low data quality — verify',
  },
  stale: {
    icon: '🕰️',
    label: 'Stale data',
    fullLabel: 'Data may be out of date',
  },
};

const TABLES = { sv: SV, en: EN };

/**
 * Resolve a single RankReason to a label entry. Returns null if the enum
 * value is unknown — caller must filter, never substitute a guess.
 */
export function resolveReason(reason, language = 'sv') {
  if (!reason || typeof reason !== 'string') {
    return null;
  }
  const table = TABLES[language] || TABLES.sv;
  const entry = table[reason];
  return entry ? { key: reason, ...entry } : null;
}

/**
 * Resolve an array of reasons. Filters out unknown values. Preserves the
 * order given by the server (ranker emits reasons in push order, which is
 * roughly semantic — neutral/positive first, negative last).
 */
export function resolveReasons(reasons, language = 'sv') {
  if (!Array.isArray(reasons)) {
    return [];
  }
  return reasons.map((r) => resolveReason(r, language)).filter(Boolean);
}
