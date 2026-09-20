/**
 * Expo push token helper — S5 (Din helg weekly push, 2026-09-20).
 *
 * expo-notifications CANNOT be used in Expo Go: since SDK 53 the sandbox has
 * no remote-push support and calling into the module throws / misbehaves.
 * This module therefore loads the package lazily through a try/catch
 * `require`, so:
 *   - Expo Go / simulator: every call resolves to a graceful
 *     `warning: 'unavailable'` result — no crash, no import side effects.
 *   - Dev build / TestFlight / App Store: real permission flow + token.
 *
 * Token delivery: after OS permission is granted we ask Expo for the push
 * token and persist it via agentClient.registerPushToken, which also flips
 * `din_helg_push_enabled` in user_preferences.preferences.
 *
 * The EAS project id is read from app.json → expo.extra.eas.projectId (via
 * expo-constants). Without it `getExpoPushTokenAsync` resolves to
 * `undefined` — surfaced here as warning 'no-project-id'.
 */

import Constants from 'expo-constants';

import { registerPushToken } from './agentClient';

// Module cache: undefined = not probed yet, null = unavailable (Expo Go),
// object = the expo-notifications module.
let notificationsModule;

function loadNotifications() {
  if (notificationsModule !== undefined) return notificationsModule;
  // Expo Go reports appOwnership === 'expo'. Remote push is unsupported
  // there regardless of whether the JS module loads (SDK 53+), so we treat
  // the runtime as unavailable up front — the opt-in surfaces stay hidden.
  const ownership = Constants.appOwnership;
  if (ownership === 'expo') {
    notificationsModule = null;
    return null;
  }
  try {
    // Metro bundles whatever it can resolve statically; in runtimes without
    // the native module, guard ALL use behind this require.
    // eslint-disable-next-line global-require
    const mod = require('expo-notifications');
    notificationsModule = mod || null;
  } catch (_err) {
    notificationsModule = null;
  }
  return notificationsModule;
}

function loadDevice() {
  try {
    // eslint-disable-next-line global-require
    const mod = require('expo-device');
    return mod || null;
  } catch (_err) {
    return null;
  }
}

/**
 * @returns {boolean} true when push CAN work in this runtime (native module
 * present). Does NOT check OS permission status.
 */
export function isPushRuntimeAvailable() {
  return loadNotifications() !== null;
}

function getEasProjectId() {
  const config = Constants.expoConfig || Constants.manifest || {};
  const id = config?.extra?.eas?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Ask the OS for notification permission and, when granted, fetch + persist
 * the Expo push token. Also enables the Din helg weekly push flag — the only
 * caller is the Din helg opt-in surface (pre-permission prompt / Profile
 * toggle).
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   granted: boolean,
 *   token?: string,
 *   warning?: 'unavailable'|'no-project-id'|'denied'|'token'|'network',
 * }>}
 */
export async function enableDinHelgPush() {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return { ok: false, granted: false, warning: 'unavailable' };
  }
  const Device = loadDevice();
  if (Device && Device.isDevice === false) {
    // Simulator: permission flow technically runs but no token is issued.
    return { ok: false, granted: false, warning: 'unavailable' };
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current?.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested?.status;
    }
    if (status !== 'granted') {
      return { ok: false, granted: false, warning: 'denied' };
    }

    const projectId = getEasProjectId();
    if (!projectId) {
      return { ok: false, granted: true, warning: 'no-project-id' };
    }
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = typeof tokenResponse?.data === 'string' ? tokenResponse.data : null;
    if (!token) {
      return { ok: false, granted: true, warning: 'token' };
    }

    const stored = await registerPushToken({
      pushToken: token,
      dinHelgPushEnabled: true,
    });
    if (!stored?.ok) {
      return { ok: false, granted: true, token, warning: stored?.warning || 'network' };
    }
    return { ok: true, granted: true, token };
  } catch (_err) {
    return { ok: false, granted: false, warning: 'unavailable' };
  }
}

/**
 * Turn the Din helg weekly push flag off (Profile toggle). We keep the
 * stored token — the follow-push surface may still use it, and re-enabling
 * should not need a new OS prompt.
 *
 * @returns {Promise<{ ok: boolean, warning?: string }>}
 */
export async function disableDinHelgPush() {
  return registerPushToken({ dinHelgPushEnabled: false });
}
