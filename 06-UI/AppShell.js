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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Platform, Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import CodeEntryScreen from './screens/CodeEntryScreen';
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
  PENDING_EVENT_KEY,
} from './services/storage';
import { bootstrapSession } from './services/supabaseAuthClient';
import { analyticsClient } from './services/analyticsClient';
import { NetworkProvider } from './services/networkContext';
import { isAuthDeepLink } from './services/deepLinkRouter';
import { useAuthReminder } from './services/useAuthReminder';
import { LanguageProvider } from './i18n';

// Dev-only feature flag: när TRUE lägger vi till 5:e tab "Utforska*" som
// visar de 10 första AI-bilderna i en kontrollerad vy för visuell
// verifiering av EU AI Act Art. 50-stämpeln. MÅSTE vara FALSE i prod.
const EXPLORE_STAR_ENABLED = process.env.EXPO_PUBLIC_EXPLORE_STAR_ENABLED === 'true';

const TABS = ['home', 'explore', 'notifications', 'profile'];
if (EXPLORE_STAR_ENABLED) TABS.push('explore-star');
const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
const STORAGE_BUDGET_MS = 800;
// Cold-start branding: the logo splash stays up at least this long even if
// identity bootstrap finishes faster. Root-owned, shown exactly once per
// process — the old per-tab App splash (which flashed black on every
// Utforska open) is gone.
const SPLASH_MIN_MS = 3000;
// Absolute ceiling for the explore-readiness gate (2026-09-20): the splash
// waits for Utforska's first feed load, but a stalled network must never
// park the user on a black frame. At the cap we unblock and let the tab
// tree's own loading/error surfaces take over.
const SPLASH_MAX_MS = 10000;
export { PENDING_AGENT_MESSAGE_KEY };

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('home');
  const [onboardingState, setOnboardingState] = useState('loading'); // 'loading' | 'needs' | 'done'
  const [userState, setUserState] = useState('loading'); // 'loading' | 'guest' | 'logged_in'
  const [showLogin, setShowLogin] = useState(false);
  // Magic-link deep-link callback URL — when non-null AppShell renders
  // MagicLinkHandlerScreen instead of the rest of the tree. The handler
  // calls onSuccess(session) → persist + start analytics + flip gate;
  // or onCancel() to drop back to the public surface.
  const [magicLinkUrl, setMagicLinkUrl] = useState(null);
  // Email-OTP (primary login since 2026-09-20): when non-null AppShell
  // renders CodeEntryScreen for this address. `pendingEmailMode` decides
  // GoTrue's verify type ('email' for signin, 'email_change' for the
  // guest-linking flow) inside verifyEmailOtpCode.
  const [pendingEmail, setPendingEmail] = useState(null);
  const [pendingEmailMode, setPendingEmailMode] = useState('signin');

  // Splash timing refs — see maybeHideSplash below.
  const splashShownAtRef = useRef(Date.now());
  const splashHiddenRef = useRef(false);
  // Explore-readiness gate (2026-09-20, "hängde sig" report): the splash
  // used to drop at 3s, so a Hem chip tap could mount Utforska cold — mid
  // fetch of every Hem section — and freeze the JS thread. Now Utforska
  // mounts EAGERLY behind the splash and the splash holds until its first
  // feed load settles (success or error), capped by SPLASH_MAX_MS.
  const [exploreReady, setExploreReady] = useState(false);
  const handleExploreReady = useCallback(() => setExploreReady(true), []);
  // Ref mirror of "the tab tree is coming but Utforska hasn't signaled" —
  // maybeHideSplash reads refs (never stale closures) because its callers
  // fire synchronously right after setState.
  const splashBlockedRef = useRef(false);
  // Keep-alive tabs: a tab is mounted the first time it is activated and then
  // kept mounted (display:none while inactive) so switching tabs never
  // remounts/refetches. 'home' is the landing tab so it starts mounted.
  const mountedTabsRef = useRef({ home: true });

  // Guest auth nudge (AuthReminderModal). Timing contract 2026-09-20: first
  // nudge ~3 min in, ongoing registration pauses it, an abandoned attempt
  // earns one 2-min retry — policy + timers live in the hook; the shell
  // only supplies "is any auth surface on screen" and navigation.
  const authFlowActive = showLogin || !!pendingEmail || !!magicLinkUrl;
  const {
    visible: authReminderVisible,
    handleRegister: handleAuthReminderRegister,
    handleDismiss: handleAuthReminderDismiss,
  } = useAuthReminder({
    isGuest: userState === 'guest',
    authFlowActive,
    onRegister: () => setShowLogin(true),
  });

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
  // an error and calls onCancel → back to the guest surface.
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
    // If the session came via the email fallback link while a code entry was
    // pending, drop the auth surfaces too so the user lands on the tab tree.
    setPendingEmail(null);
    setShowLogin(false);
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

  // Splash lifecycle: the native splash was frozen at module level
  // (index.js → preventAutoHideAsync). We hide it once onboarding+bootstrap
  // have settled AND the minimum branding time has elapsed. Both gate points
  // call maybeHideSplash; the first one to satisfy the constraint wins.
  const maybeHideSplash = useCallback(() => {
    if (splashHiddenRef.current) return;
    if (splashBlockedRef.current) return; // Utforska hasn't signaled yet
    const wait = SPLASH_MIN_MS - (Date.now() - splashShownAtRef.current);
    if (wait > 0) {
      setTimeout(maybeHideSplash, wait);
      return;
    }
    splashHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Declared BEFORE the triggers below so the blocked-ref is always fresh
  // when they call maybeHideSplash (same flush, effects run in order).
  useEffect(() => {
    // Gate applies only once the tab tree is on its way. Onboarding and
    // auth deep-link surfaces render INSTEAD of the tab tree — Utforska
    // never mounts behind them, so the gate must stay out of their way.
    splashBlockedRef.current =
      onboardingState === 'done' && !magicLinkUrl && !pendingEmail && !exploreReady;
  }, [onboardingState, magicLinkUrl, pendingEmail, exploreReady]);

  useEffect(() => {
    if (exploreReady) maybeHideSplash();
  }, [exploreReady, maybeHideSplash]);

  // Hard cap — never park on the splash if the network stalls outright.
  useEffect(() => {
    const id = setTimeout(() => {
      splashBlockedRef.current = false;
      maybeHideSplash();
    }, SPLASH_MAX_MS);
    return () => clearTimeout(id);
  }, [maybeHideSplash]);

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
        if (alive) maybeHideSplash();
      });

    return () => {
      alive = false;
      clearTimeout(budget);
    };
  }, [maybeHideSplash]);

  // NOW#2 bootstrap: once onboarding is done, guarantee a Supabase session
  // exists — persisted session reused, expired one refreshed, otherwise a
  // one-time signInAnonymously(). Every guest thereby carries a real
  // auth.users.id, so taste rows accumulate across restarts (NOW#1 server
  // side accepts the anon JWT as-is). userState derives from the identity:
  // anonymous → 'guest' (AuthReminderModal + Profil-login branch still
  // apply), permanent → 'logged_in'. A bootstrap failure (offline on first
  // launch) still opens the public tab tree; personalized sections then
  // render their retry/empty states until a session exists.
  // The shell owns the analytics session/flush-loop lifecycle for permanent
  // accounts only — anonymous guests keep analytics off (user_interactions
  // is the declared funnel source for them).
  useEffect(() => {
    if (onboardingState !== 'done') return;
    let alive = true;
    const budget = setTimeout(() => {
      // Same storage-hang guard as onboarding — never park on a splash.
      if (alive) {
        setUserState((s) => (s === 'loading' ? 'guest' : s));
      }
    }, STORAGE_BUDGET_MS);

    bootstrapSession()
      .then(async ({ state }) => {
        if (!alive) return;
        if (state === 'logged_in') {
          await analyticsClient.sessionStart(Platform.OS);
          analyticsClient.startFlushLoop();
          setUserState('logged_in');
        } else {
          setUserState('guest');
        }
      })
      .catch(() => {
        if (alive) setUserState('guest');
      })
      .finally(() => {
        clearTimeout(budget);
        if (alive) maybeHideSplash();
      });

    return () => {
      alive = false;
      clearTimeout(budget);
    };
  }, [onboardingState, maybeHideSplash]);

  const handleTabChange = (tabId) => {
    if (!TABS.includes(tabId)) return;
    // Lazy keep-alive: mount on first activation, keep mounted afterwards
    // (hidden via display:none) so tab switches never remount or refetch.
    mountedTabsRef.current[tabId] = true;
    setActiveTab(tabId);
  };

  const handleOnboardingComplete = () => {
    setOnboardingState('done');
  };

  const handleUserLoggedOut = () => {
    // Session wipe + queue drain already happened in ProfileScreen; the
    // shell only drops back to the guest surface (tabs stay visible —
    // logout never blocks browsing).
    setUserState('guest');
  };

  // Hand-off nonce (2026-09-20, "låst läge" fix): explore's <App> stays
  // mounted via keep-alive tabs, so its AsyncStorage drains only re-run when
  // this counter changes. Every chip/card hand-off bumps it.
  const [chipNonce, setChipNonce] = useState(0);

  const handleChipPress = (prompt) => {
    const text = prompt?.prompt_text;
    if (typeof text !== 'string' || text.length === 0) return;
    setItem(PENDING_AGENT_MESSAGE_KEY, text).catch(() => {});
    setChipNonce((n) => n + 1);
    setActiveTab('explore');
  };

  // Home-screen event card tap → hand the whole EventCard to the explore
  // tab. App.js's drain effect (deps [chipNonce]) opens its DetailsScreen
  // for the pending event. JSON round-trip keeps AppShell free of EventCard
  // shape knowledge beyond the id guard.
  const handleHomeCardPress = (event) => {
    if (!event || typeof event.id !== 'string' || event.id.length === 0) return;
    setItem(PENDING_EVENT_KEY, JSON.stringify(event)).catch(() => {});
    setChipNonce((n) => n + 1);
    setActiveTab('explore');
  };

  const handleLoginCancel = () => {
    setShowLogin(false);
  };

  // Email-OTP handoff: LoginScreen fired a code email successfully. Swap
  // straight to CodeEntryScreen (no flash of the login form in between).
  const handleEmailSent = useCallback((email, mode) => {
    setPendingEmail(email);
    setPendingEmailMode(mode === 'link' ? 'link' : 'signin');
    setShowLogin(false);
  }, []);

  // User backed out of code entry → return to the login form.
  const handleCodeCancel = useCallback(() => {
    setPendingEmail(null);
    setShowLogin(true);
  }, []);

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
        <Image
          source={require('./assets/splash.png')}
          style={styles.splashLogo}
          resizeMode="contain"
        />
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
    );
  } else if (onboardingState === 'needs') {
    body = <OnboardingScreen onComplete={handleOnboardingComplete} />;
  } else if (userState === 'loading') {
    body = (
      <View style={styles.splashPlaceholder}>
        <Image
          source={require('./assets/splash.png')}
          style={styles.splashLogo}
          resizeMode="contain"
        />
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
    );
  } else if (showLogin) {
    // Triggered by any surface's onOpenLogin (guest nudge, Notiser-auth
    // state, AuthReminderModal "Registrera"). Renders the
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
        onEmailSent={handleEmailSent}
      />
    );
  } else if (pendingEmail) {
    // Email-OTP code entry (primary auth path). onSuccess reuses the magic
    // link success handler verbatim — persist + analytics + flip to
    // logged_in — so the post-login UX is identical across paths.
    body = (
      <CodeEntryScreen
        email={pendingEmail}
        mode={pendingEmailMode}
        onSuccess={handleMagicLinkSuccess}
        onCancel={handleCodeCancel}
      />
    );
  } else {
    body = (
      <>
        <NetworkBanner />
        {/*
          Utforska mounts EAGERLY with the tab tree — not on first visit.
          Its initial feed load runs behind the splash gate (onExploreReady),
          so Hem chip taps never hit a cold, still-loading explore tree
          ("hängde sig", 2026-09-20). Hidden via tabHidden until visited.
        */}
        <View style={activeTab === 'explore' ? styles.tabPanel : styles.tabHidden}>
          <App
            onUserLoggedOut={handleUserLoggedOut}
            onOpenLogin={() => setShowLogin(true)}
            chipNonce={chipNonce}
            onExploreReady={handleExploreReady}
            isActive={activeTab === 'explore'}
          />
        </View>
        {mountedTabsRef.current.home && (
          <View style={activeTab === 'home' ? styles.tabPanel : styles.tabHidden}>
            <HomeScreen onChipPress={handleChipPress} onCardPress={handleHomeCardPress} />
          </View>
        )}
        {mountedTabsRef.current.notifications && (
          <View style={activeTab === 'notifications' ? styles.tabPanel : styles.tabHidden}>
            <NotificationsScreen
              onOpenLogin={() => setShowLogin(true)}
              isActive={activeTab === 'notifications'}
            />
          </View>
        )}
        {mountedTabsRef.current.profile && (
          <View style={activeTab === 'profile' ? styles.tabPanel : styles.tabHidden}>
            <ProfileScreen
              onLoggedOut={handleUserLoggedOut}
              onOpenLogin={() => setShowLogin(true)}
            />
          </View>
        )}
        {EXPLORE_STAR_ENABLED && mountedTabsRef.current['explore-star'] && (
          <View style={activeTab === 'explore-star' ? styles.tabPanel : styles.tabHidden}>
            <UtforskaStarScreen />
          </View>
        )}
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
    <LanguageProvider>
      <NetworkProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <View style={styles.container}>{body}</View>
        </SafeAreaProvider>
      </NetworkProvider>
    </LanguageProvider>
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
  tabPanel: {
    flex: 1,
  },
  tabHidden: {
    flex: 1,
    display: 'none',
  },
  splashPlaceholder: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashLogo: {
    width: 180,
    height: 180,
    marginBottom: 24,
  },
  splashText: {
    color: '#F7F2EA',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
});
