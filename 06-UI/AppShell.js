/**
 * AppShell — Phase 1 retention entry point.
 *
 * Wraps the existing App.js (Utforska) with a BottomTabBar:
 *   Hem / Utforska / Notiser / Profil.
 *
 * One SafeAreaProvider for the whole tree, with initialWindowMetrics, so
 * Expo Go does not paint a blank black frame while insets are measured
 * (or when this shell remounts after onboarding).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import UserPickerScreen from './screens/UserPickerScreen';
import LoginScreen from './screens/LoginScreen';
import MagicLinkHandlerScreen from './screens/MagicLinkHandlerScreen';
import UtforskaStarScreen from './screens/UtforskaStarScreen';
import NetworkBanner from './components/NetworkBanner';
import AuthReminderModal from './components/AuthReminderModal';
import App from './App';
import {
  getItem,
  setItem,
  saveAuthSession,
  PENDING_AGENT_MESSAGE_KEY,
  getAuthPopupDismissed,
  setAuthPopupDismissed,
} from './services/storage';
import { analyticsClient } from './services/analyticsClient';
import { NetworkProvider } from './services/networkContext';
import { isAuthDeepLink } from './services/deepLinkRouter';

// Dev-only feature flag: när TRUE lägger vi till 5:e tab "Utforska*" som
// visar de 10 första AI-bilderna i en kontrollerad vy för visuell
// verifiering av EU AI Act Art. 50-stämpeln. MÅSTE vara FALSE i prod.
const EXPLORE_STAR_ENABLED = process.env.EXPO_PUBLIC_EXPLORE_STAR_ENABLED === 'true';

const TABS = ['home', 'explore', 'notifications', 'profile'];
if (EXPLORE_STAR_ENABLED) TABS.push('explore-star');
const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
const STORAGE_BUDGET_MS = 800;
/** Delay before the AuthReminderModal appears for users who are still on
 *  the public anon identity (UserPicker test profile). Per launch-plan
 *  user decision 2026-09-06: 30 s — short enough for conversion, long
 *  enough not to interrupt first-impression exploration. */
const AUTH_REMINDER_DELAY_MS = 30 * 1000;
export { PENDING_AGENT_MESSAGE_KEY };

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('home');
  const [onboardingState, setOnboardingState] = useState('loading'); // 'loading' | 'needs' | 'done'
  const [userState, setUserState] = useState('loading'); // 'loading' | 'logged_in' | 'logged_out'
  const [authReminderVisible, setAuthReminderVisible] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  // Magic-link deep-link callback URL — when non-null AppShell renders
  // MagicLinkHandlerScreen instead of the rest of the tree. The handler
  // calls onSuccess(session) → persist + start analytics + flip gate;
  // or onCancel() to drop back to the public surface.
  const [magicLinkUrl, setMagicLinkUrl] = useState(null);

  // Magic-link deep-link routing.
  //
  // Two surfaces:
  //   - Cold-start: app launched via the magic link while killed →
  //     `Linking.getInitialURL()` returns the URL on first mount.
  //   - Warm-start: app already foregrounded, OS delivers the link as a
  //     'url' event (user tapped the email link while the app was open).
  //
  // Both paths set `magicLinkUrl`, which mounts MagicLinkHandlerScreen.
  // The handler either verifies and calls onSuccess(session), or surfaces
  // an error and calls onCancel → UserPickerScreen.
  useEffect(() => {
    let cancelled = false;
    let sub;
    const handle = (url) => {
      if (cancelled || !url || !isAuthDeepLink(url)) return;
      setMagicLinkUrl(url);
    };
    Linking.getInitialURL()
      .then((url) => { if (url) handle(url); })
      .catch(() => {});
    sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => {
      cancelled = true;
      if (sub) sub.remove();
    };
  }, [isAuthDeepLink]);

  const handleMagicLinkSuccess = useCallback(async (session) => {
    // Persist the verified session so subsequent /agent/* calls carry the
    // Bearer JWT. Then start analytics + the flush loop (AppShell owns
    // these per the Phase 1 handoff contract — App.js no longer starts
    // them). Finally flip userState to logged_in which auto-unmounts the
    // handler screen.
    try {
      await saveAuthSession(session);
    } catch (_err) {
      // Storage write failed — surface as if the magic link never landed.
      setMagicLinkUrl(null);
      return;
    }
    try {
      await analyticsClient.sessionStart(Platform.OS);
      analyticsClient.startFlushLoop();
    } catch (_err) {
      // Analytics start is best-effort; the user is still logged in via
      // the persisted session, which is the source of truth for /agent/*.
    }
    setUserState('logged_in');
    setMagicLinkUrl(null);
  }, []);

  const handleMagicLinkCancel = useCallback(() => {
    // Verification failed or user backed out. Clear any partial session
    // and return to the public surface — never leave the user stuck on
    // the verifying screen.
    saveAuthSession(null).catch(() => {});
    setMagicLinkUrl(null);
  }, []);

  const handleLoginSuccess = useCallback(async (_session) => {
    // Apple Sign In (Fas 2.5): the LoginScreen has already persisted the
    // session via saveAuthSession before calling us. We only need to start
    // analytics + flip userState so the tab tree mounts. Mirrors the
    // tail of handleMagicLinkSuccess above so the user-visible UX is
    // identical between the two paths.
    try {
      await analyticsClient.sessionStart(Platform.OS);
      analyticsClient.startFlushLoop();
    } catch (_err) {
      // Best-effort: the persisted session is the source of truth.
    }
    setUserState('logged_in');
    setShowLogin(false);
  }, []);

  useEffect(() => {
    let alive = true;
    const budget = setTimeout(() => {
      // Never stay on a blank black frame if AsyncStorage hangs.
      if (alive) {
        setOnboardingState((s) => (s === 'loading' ? 'done' : s));
      }
    }, STORAGE_BUDGET_MS);

    getItem(ONBOARDING_COMPLETE_KEY)
      .then((value) => {
        if (!alive) return;
        setOnboardingState(value === '1' ? 'done' : 'needs');
      })
      .catch(() => {
        if (!alive) return;
        setOnboardingState('needs');
      })
      .finally(() => {
        clearTimeout(budget);
      });

    return () => {
      alive = false;
      clearTimeout(budget);
    };
  }, []);

  // Resolve the persisted analytics test profile once onboarding is done.
  // The shell owns the session / flush-loop lifecycle: a restored user gets
  // session_start + the loop here (App.js no longer starts them), and the
  // full-screen UserPickerScreen shows whenever no profile is active.
  useEffect(() => {
    if (onboardingState !== 'done') return;
    let alive = true;
    const budget = setTimeout(() => {
      // Same storage-hang guard as onboarding — never park on a splash.
      if (alive) {
        setUserState((s) => (s === 'loading' ? 'logged_out' : s));
      }
    }, STORAGE_BUDGET_MS);

    analyticsClient
      .getActiveUser()
      .then(async (user) => {
        if (!alive) return;
        if (user) {
          await analyticsClient.sessionStart(Platform.OS);
          analyticsClient.startFlushLoop();
          setUserState('logged_in');
        } else {
          setUserState('logged_out');
        }
      })
      .catch(() => {
        if (alive) setUserState('logged_out');
      })
      .finally(() => {
        clearTimeout(budget);
      });

    return () => {
      alive = false;
      clearTimeout(budget);
    };
  }, [onboardingState]);

  const handleTabChange = (tabId) => {
    if (!TABS.includes(tabId)) return;
    setActiveTab(tabId);
  };

  const handleOnboardingComplete = () => {
    setOnboardingState('done');
  };

  const handleUserPicked = () => {
    // UserPickerScreen already ran setConsent + setActiveUser + the
    // per-profile identity swap + sessionStart + startFlushLoop — the
    // shell only flips the gate so no duplicate session fires.
    setUserState('logged_in');
  };

  const handleUserLoggedOut = () => {
    // Queue drain + key removal already happened in ProfileScreen via
    // analyticsClient.logout(); the shell only flips the gate.
    setUserState('logged_out');
  };

  const handleChipPress = (prompt) => {
    const text = prompt?.prompt_text;
    if (typeof text !== 'string' || text.length === 0) return;
    setItem(PENDING_AGENT_MESSAGE_KEY, text).catch(() => {});
    setActiveTab('explore');
  };

  // Auth-reminder popup: only show once the user has reached the
  // public-anon surface (UserPicker test profile) AND has not
  // previously opted out via the "Påminn mig inte igen" checkbox.
  // Phase 2 will introduce real Supabase auth — when that lands, gate
  // this further on "no auth_session in storage" so logged-in users
  // never see the nudge.
  useEffect(() => {
    if (userState !== 'logged_in') return undefined;

    let alive = true;
    let dismissed = false;
    getAuthPopupDismissed()
      .then((d) => {
        if (!alive || d) { dismissed = true; return; }
      })
      .catch(() => {});

    const t = setTimeout(() => {
      if (alive && !dismissed) setAuthReminderVisible(true);
    }, AUTH_REMINDER_DELAY_MS);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [userState]);

  const handleAuthReminderRegister = () => {
    // Phase 1 launch: wire the popup's "Registrera" button to the real
    // email-link LoginScreen. We close the popup and flip into login
    // mode; the LoginScreen renders inside the same body slot so the
    // tab bar disappears until the user completes the flow or backs out.
    // The MagicLinkHandlerScreen (registered as the deep-link target in
    // App.js or in this shell's Linking listener — see TODO below) flips
    // userState to 'logged_in' after the OTP verifies, which auto-
    // unmounts the LoginScreen.
    setAuthReminderVisible(false);
    setShowLogin(true);
  };

  const handleAuthReminderDismiss = (opts) => {
    const permanently = !!(opts && opts.permanently);
    if (permanently) {
      setAuthPopupDismissed(true).catch(() => {});
    }
    setAuthReminderVisible(false);
  };

  const handleLoginCancel = () => {
    setShowLogin(false);
  };

  let body;
  // Magic-link callback is the highest-priority route — it must show
  // regardless of onboarding / user-state so a user opening the email
  // link before finishing onboarding can still complete sign-in.
  if (magicLinkUrl) {
    body = (
      <MagicLinkHandlerScreen
        url={magicLinkUrl}
        onSuccess={handleMagicLinkSuccess}
        onCancel={handleMagicLinkCancel}
      />
    );
  } else if (onboardingState === 'loading') {
    body = (
      <View style={styles.splashPlaceholder}>
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
    );
  } else if (onboardingState === 'needs') {
    body = <OnboardingScreen onComplete={handleOnboardingComplete} />;
  } else if (userState === 'loading') {
    body = (
      <View style={styles.splashPlaceholder}>
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
    );
  } else if (userState === 'logged_out') {
    body = <UserPickerScreen onUserPicked={handleUserPicked} />;
  } else if (showLogin) {
    // Triggered by AuthReminderModal's "Registrera" button. Renders the
    // email-link LoginScreen on top of the tab tree; when the magic link
    // is verified the deep-link handler sets a fresh Supabase session and
    // flips userState to 'logged_in', unmounting this screen automatically.
    //
    // Apple Sign In (Fas 2.5 / App Store §4.8): the screen handles the
    // entire auth round-trip itself — it persists the session via
    // saveAuthSession and calls onSuccess(session) when done, so we flip
    // straight into the logged_in branch without going through the
    // deep-link round-trip.
    body = (
      <LoginScreen
        onCancel={handleLoginCancel}
        onSuccess={handleLoginSuccess}
      />
    );
  } else {
    body = (
      <>
        <NetworkBanner />
        {activeTab === 'explore' && <App onUserLoggedOut={handleUserLoggedOut} />}
        {activeTab === 'home' && <HomeScreen onChipPress={handleChipPress} />}
        {activeTab === 'notifications' && (
          <NotificationsScreen onOpenLogin={() => setShowLogin(true)} />
        )}
        {activeTab === 'profile' && (
          <ProfileScreen onLoggedOut={handleUserLoggedOut} />
        )}
        {activeTab === 'explore-star' && EXPLORE_STAR_ENABLED && <UtforskaStarScreen />}
        <View style={styles.barWrapper} pointerEvents="box-none">
          <BottomTabBar
            activeTab={activeTab}
            onChange={handleTabChange}
            badges={{}}
          />
        </View>
        <AuthReminderModal
          visible={authReminderVisible}
          onRegister={handleAuthReminderRegister}
          onDismiss={handleAuthReminderDismiss}
        />
      </>
    );
  }

  return (
    <NetworkProvider>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.container}>{body}</View>
      </SafeAreaProvider>
    </NetworkProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  barWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  splashPlaceholder: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    color: '#F7F2EA',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
});
