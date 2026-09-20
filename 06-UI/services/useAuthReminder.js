/**
 * useAuthReminder — React shell around authReminderPolicy.
 *
 * Owns everything about the guest "behåll din smak" nudge EXCEPT
 * navigation: timers, visibility, the permanent AsyncStorage opt-out and
 * the session-scoped authEngaged/shown flags. AppShell keeps rendering
 * AuthReminderModal and deciding where the "Registrera" button navigates.
 *
 * Timing contract (user decision 2026-09-20, logic lives in
 * authReminderPolicy.js):
 *   - ~3 min before the first nudge; an ongoing registration pauses it;
 *     an abandoned registration earns one retry after 2 min; logged-in or
 *     permanently-dismissed users never see it.
 *
 * All session flags are refs — a nudge that fired or a registration that
 * was touched should not survive anything except a full app reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAuthPopupDismissed, setAuthPopupDismissed } from './storage';
import { nextReminderDelay } from './authReminderPolicy';

/**
 * @param {object} opts
 * @param {boolean} opts.isGuest          Anonymous session right now?
 * @param {boolean} opts.authFlowActive   Login / code-entry / magic-link
 *                                        surface currently on screen?
 * @param {() => void} [opts.onRegister]  Navigation callback for the modal's
 *                                        primary button (AppShell-owned).
 * @returns {{ visible: boolean,
 *             handleRegister: () => void,
 *             handleDismiss: (opts?: { permanently?: boolean }) => void }}
 */
export function useAuthReminder({ isGuest, authFlowActive, onRegister }) {
  const [visible, setVisible] = useState(false);
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  const [permanentlyDismissed, setPermanentlyDismissed] = useState(false);
  const authEngagedRef = useRef(false);
  const shownRef = useRef(false);

  // Load the permanent opt-out once (alive guard — the nudge must never
  // race an AsyncStorage read and pop over a just-logged-in screen).
  useEffect(() => {
    let alive = true;
    getAuthPopupDismissed()
      .then((d) => {
        if (!alive) return;
        setPermanentlyDismissed(!!d);
        setDismissedLoaded(true);
      })
      .catch(() => {
        if (alive) setDismissedLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isGuest) {
      // Logged in (or still loading) — silence everything immediately.
      setVisible(false);
      return undefined;
    }
    if (authFlowActive) {
      // Registration in progress: pause the nudge and remember that the
      // user engages with auth — an abandon from here earns the 2-min retry.
      authEngagedRef.current = true;
      setVisible(false);
      return undefined;
    }
    if (!dismissedLoaded) return undefined;

    const delayMs = nextReminderDelay({
      isGuest,
      authFlowActive,
      authEngaged: authEngagedRef.current,
      shownThisSession: shownRef.current,
      permanentlyDismissed,
    });
    if (delayMs === null) return undefined;

    const t = setTimeout(() => {
      shownRef.current = true;
      authEngagedRef.current = false; // consumed — a retry-nudge shown does not chain more nudges
      setVisible(true);
    }, delayMs);
    return () => clearTimeout(t);
  }, [isGuest, authFlowActive, dismissedLoaded, permanentlyDismissed]);

  const handleRegister = useCallback(() => {
    authEngagedRef.current = true;
    setVisible(false);
    if (typeof onRegister === 'function') onRegister();
  }, [onRegister]);

  const handleDismiss = useCallback((opts) => {
    if (opts && opts.permanently) {
      setPermanentlyDismissed(true);
      setAuthPopupDismissed(true).catch(() => {});
    }
    setVisible(false);
  }, []);

  return { visible, handleRegister, handleDismiss };
}
