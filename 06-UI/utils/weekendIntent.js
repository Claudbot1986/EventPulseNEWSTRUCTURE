/**
 * Weekend-intent detection for pending prompt chips (2026-09-20).
 *
 * HomeScreen chips like "Gratis i helgen" / "Vad händer i helgen?" hand their
 * prompt text to the explore tab via PENDING_AGENT_MESSAGE_KEY. The explore
 * view used to just show the banner text over the unfiltered week list —
 * users landed on "imorgon, måndag" instead of the weekend.
 *
 * This matcher decides whether a prompt refers to the weekend (helgen),
 * across the 10 supported locales, so App.js can apply the real 'helgen'
 * time filter. Kept in its own module so vitest can pin every locale.
 */

const WEEKEND_TERMS = [
  'helg',           // sv/no/da: helgen, helg
  'weekend',        // en/nl/da
  'wochenende',     // de
  'viikonloppu',    // fi
  'week-end',       // fr
  '周末',           // zh-Hans
  'fine settimana', // it
];

/** @param {unknown} text @returns {boolean} */
export function hasWeekendIntent(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const hay = text.toLowerCase();
  return WEEKEND_TERMS.some((term) => hay.includes(term));
}
