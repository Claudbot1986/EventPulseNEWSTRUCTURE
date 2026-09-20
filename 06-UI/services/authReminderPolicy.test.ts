/**
 * Tests for authReminderPolicy — the pure decision of WHEN the guest
 * "behåll din smak" nudge may surface.
 *
 * User decision 2026-09-20: first nudge after ~3 min (was 30 s); starting
 * registration (login open / code email sent) pauses it; abandoning the
 * flow earns one retry after 2 min; completed registration or the
 * permanent opt-out silences it for good.
 *
 * Run:  npx vitest run 06-UI/services/authReminderPolicy.test.ts
 */

import { describe, it, expect } from 'vitest';

import {
  AUTH_REMINDER_INITIAL_MS,
  AUTH_REMINDER_RETRY_MS,
  nextReminderDelay,
} from './authReminderPolicy';

const guestBrowsing = {
  isGuest: true,
  authFlowActive: false,
  authEngaged: false,
  shownThisSession: false,
  permanentlyDismissed: false,
};

describe('nextReminderDelay', () => {
  it('gäst utan auth-beröring → 3-minuters första påminnelse', () => {
    expect(nextReminderDelay(guestBrowsing)).toBe(AUTH_REMINDER_INITIAL_MS);
    expect(AUTH_REMINDER_INITIAL_MS).toBe(3 * 60 * 1000);
  });

  it('pågående registrering (authFlowActive) → pausad, ingen timer', () => {
    expect(nextReminderDelay({ ...guestBrowsing, authFlowActive: true })).toBeNull();
  });

  it('avbruten registrering (authEngaged) → 2-minuters retry', () => {
    expect(nextReminderDelay({ ...guestBrowsing, authEngaged: true })).toBe(AUTH_REMINDER_RETRY_MS);
    expect(AUTH_REMINDER_RETRY_MS).toBe(2 * 60 * 1000);
  });

  it('redan visad denna session → ingen ny påminnelse', () => {
    expect(nextReminderDelay({ ...guestBrowsing, shownThisSession: true })).toBeNull();
  });

  it('visad + ny auth-beröring efteråt → en retry till (2 min)', () => {
    expect(
      nextReminderDelay({ ...guestBrowsing, shownThisSession: true, authEngaged: true })
    ).toBe(AUTH_REMINDER_RETRY_MS);
  });

  it('permanent dismissed → aldrig, oavsett övrigt läge', () => {
    expect(
      nextReminderDelay({ ...guestBrowsing, permanentlyDismissed: true })
    ).toBeNull();
    expect(
      nextReminderDelay({ ...guestBrowsing, permanentlyDismissed: true, authEngaged: true })
    ).toBeNull();
  });

  it('inloggad (inte gäst) → aldrig', () => {
    expect(nextReminderDelay({ ...guestBrowsing, isGuest: false })).toBeNull();
    expect(
      nextReminderDelay({ ...guestBrowsing, isGuest: false, authEngaged: true })
    ).toBeNull();
  });
});
