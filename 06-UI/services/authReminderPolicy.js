/**
 * authReminderPolicy — pure decision logic for the guest auth nudge
 * (AuthReminderModal, "behåll din smak").
 *
 * User decision 2026-09-20 (supersedes the 2026-09-06 30 s launch rule):
 *   - First nudge after ~3 minutes of guest browsing — enough time for a
 *     first impression before asking for anything.
 *   - An ONGOING registration (login screen open, code email sent, magic
 *     link verifying) pauses the nudge: showing it over the auth surfaces
 *     would interrupt the exact action it promotes.
 *   - ABANDONING that registration earns one more nudge after 2 minutes.
 *   - A completed registration flips userState → not a guest → never again.
 *   - The permanent "Påminn mig inte igen" opt-out silences it forever.
 *
 * Pure + exported separately from the React hook so the timing contract is
 * vitest-testable without rendering (same pattern as parseAuthDeepLink).
 */

/** First nudge for an untouched guest session. */
export const AUTH_REMINDER_INITIAL_MS = 3 * 60 * 1000;

/** Retry nudge after an abandoned registration attempt. */
export const AUTH_REMINDER_RETRY_MS = 2 * 60 * 1000;

/**
 * @param {object} state
 * @param {boolean} state.isGuest            Anonymous Supabase session?
 * @param {boolean} state.authFlowActive     Login/code/magic-link screen open?
 * @param {boolean} state.authEngaged        User touched registration since
 *                                           the last shown nudge?
 * @param {boolean} state.shownThisSession   Nudge already shown this session?
 * @param {boolean} state.permanentlyDismissed  AsyncStorage opt-out?
 * @returns {number | null} Milliseconds until the nudge may show, or null
 *                          when no timer should be scheduled.
 */
export function nextReminderDelay({
  isGuest,
  authFlowActive,
  authEngaged,
  shownThisSession,
  permanentlyDismissed,
}) {
  if (!isGuest) return null;
  if (permanentlyDismissed) return null;
  if (authFlowActive) return null;
  if (shownThisSession && !authEngaged) return null;
  return authEngaged ? AUTH_REMINDER_RETRY_MS : AUTH_REMINDER_INITIAL_MS;
}
