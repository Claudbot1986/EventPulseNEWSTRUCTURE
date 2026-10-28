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
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import KartaScreen from './screens/KartaScreen';
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

// 2026-10-03: Karta-tab between Utforska and Notiser. Order is
// Hem → Utforska → Karta → Notiser → Profil — same order as BottomTabBar.
const TABS = ['home', 'explore', 'map', 'notifications', 'profile'];
if (EXPLORE_STAR_ENABLED) TABS.push('explore-star');
const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
const STORAGE_BUDGET_MS = 800;
// Cold-start branding: the logo splash stays up at least this long even if
// identity bootstrap finishes faster. Root-owned, shown exactly once per
// process — the old per-tab App splash (which flashed black on every
// Utforska open) is gone.
const SPLASH_MIN_MS = 3000;
// 2026-10-04 — Konsistent branded startskärm ("EventPulse" i vitt på svart)
// på VARJE cold-start. Tidigare visades splashPlaceholder bara under korta
// loading-states, så när onboarding redan var gjord såg man nästan ingen
// startscreen alls — bara den nativa splash-bilden under ~3s, sen tab-trädet.
// coldStartDone blir true först när både bootstrap OCH SPLASH_MIN_MS har
// passerat; tills dess renderas startscreenen ("EventPulse"-text på svart)
// ovanpå app-flödet.
// På så sätt blir "startscreeen" identisk varje gång appen startas — ingen
// roulett mellan "iblandet förut splashPlaceholder, ibland inte".
const COLD_START_MIN_MS = SPLASH_MIN_MS;
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
  // 2026-10-02 (Utforska sök): sök-overlay-state. När användaren trycker
  // på sök-knappen — från vilken tab som helst — switchar vi till
  // Utforska (activeTab='explore') och sätter showSearch=true. App.js
  // mountar då SearchScreen som overlay istället för HomeScreen.
  // Utan detta skulle SearchScreen mountas inuti Utforska-tabben som är
  // gömd om Hem är aktiv → 0×0-display-ingen användaren ser inget.
  const [showSearch, setShowSearch] = useState(false);
  const openSearch = useCallback(() => {
    setActiveTab('explore');
    setShowSearch(true);
  }, []);
  const closeSearch = useCallback(() => setShowSearch(false), []);
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
  // 2026-10-04 — Konsistent branded startskärm: coldStartDone blir true
  // först när både bootstrap OCH COLD_START_MIN_MS har passerat. Detta
  // gör att splashPlaceholder ("EventPulse" i vitt på svart) visas varje
  // cold-start, inte bara sporadiskt under loading-states. Onboarding/
  // auth-flöden override:ar splashen — den visas bara när inget annat ska
  // visas.
  const [coldStartDone, setColdStartDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setColdStartDone(true), COLD_START_MIN_MS);
    return () => clearTimeout(id);
  }, []);
  // 2026-10-04 — Synlig "startscreeen" hela tiden: native splash från
  // expo-splash-screen ligger OS-nivå över JS-trädet och täcker vår egen
  // splashPlaceholder. hideSplashNow() gömmer native-splashen OMEDELBART
  // när JS-trädet är redo, så vår egen text-splash blir den synliga
  // startscreenen. maybeHideSplash behåller SPLASH_MIN_MS-grinden för
  // bakåtkompatibilitet (gamla anropsvägar), men JS-splash-grenen kallar
  // hideSplashNow istället.
  const hideSplashNow = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  // Hämta native-splashen så fort AppShell har monterat första gången —
  // splashPlaceholder ("EventPulse"-text på svart) finns redan i JS-trädet
  // (vid onboardingState=='loading' eller !coldStartDone), så användaren
  // ser vår startscreen istället för den tomma native-bilden. Utan detta
  // skulle native-splashen täcka vår splashPlaceholder under hela
  // SPLASH_MIN_MS-perioden och användaren skulle inte se texten alls.
  useEffect(() => {
    hideSplashNow();
  }, [hideSplashNow]);
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

  // 2026-10-03 — Return-to-origin-tab for hem/karta/explore-star taps that
  // route through PENDING_EVENT_KEY. When the user taps a card from the
  // Karta-tab → AppShell switches activeTab to 'explore' so App.js can
  // mount DetailsScreen. Without this ref, tapping "< Tillbaka" would
  // land the user on Utforska instead of back on Karta. We snapshot the
  // originating tab right before the switch and clear the ref once it's
  // restored (one card-tap → one round-trip).
  const previousTabRef = useRef(null);
  // 2026-10-03 — Karta-reload på back-from-detail. När användaren kom
  // från Karta-fliken, öppnade DetailsScreen, och trycker "< Tillbaka"
  // vill vi inte att det inzoomade kart-läget ska följa med tillbaka
  // (kan också utlösa samma krasch som uppstod vid zoom). mapReloadEpoch
  // används som React-key på KartaScreen — vid inkrement tvingar React
  // en full unmount/remount som återställer region→INITIAL_REGION,
  // selectedEvent→null, events→re-fetch.
  const [mapReloadEpoch, setMapReloadEpoch] = useState(0);
  const handleDetailBack = useCallback(() => {
    const targetTab = previousTabRef.current;
    if (targetTab) {
      setActiveTab(targetTab);
      previousTabRef.current = null;
      if (targetTab === 'map') {
        setMapReloadEpoch((k) => k + 1);
      }
    }
  }, []);

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
  // (index.js → preventAutoHideAsync). 2026-10-04 — native splashen döljs
  // nu OMEDELBART vid mount via hideSplashNow (se useEffect ovan om), så
  // vår egen splashPlaceholder ("EventPulse" i vitt på svart) är den
  // synliga startscreenen. maybeHideSplash behålls som no-op-fallback för
  // bakåtkompatibilitet (alla call sites kollar splashHiddenRef.current först).
  // Tidigare höll maybeHideSplash native-splashen i SPLASH_MIN_MS, vilket
  // täckte vår JS-splash — användaren såg bara en tom native-bild i 3s.
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

    // 2026-10-18 — TEST-BYPASS: om EXPO_PUBLIC_SKIP_ONBOARDING='1' sätts
    // hoppas OnboardingScreen över utan att koden i OnboardingScreen.js
    // ändras. Användaren (Tomor) sa 2026-10-18: "stäng av välkomstskärmen
    // tillfälligt, släng inte bort den, koppla ur bara".
    //
    // Expo bäddar in EXPO_PUBLIC_* via babel-plugin-transform-inline-env-vars
    // vid bundle-time. Värdet är "1" om Metro startades med
    // EXPO_PUBLIC_SKIP_ONBOARDING=1 i sin process env. Övriga tider är det
    // ett annat värde / undefined.
    //
    // Vid punkter där `process.env.EXPO_PUBLIC_SKIP_ONBOARDING` av oklar
    // anledning inte packas upp korrekt i dev-bundle, håller vi även
    // en explicit flagga. Sätt `globalThis.__SKIP_ONBOARDING__ = true`
    // i webbläsar-/devtools-konsolen som extra pålitlig bypass.
    const envSkip =
      process.env.EXPO_PUBLIC_SKIP_ONBOARDING === '1' ||
      (typeof globalThis !== 'undefined' && globalThis.__SKIP_ONBOARDING__ === true);
    if (envSkip) {
      if (alive) setOnboardingState('done');
      return () => { alive = false; };
    }

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

  // Home chip tap → hand the prompt to Utforska. When the chip carries
  // structured intent (curated: category_slug/budget/day_filter/time_of_day;
  // suggested: category) it travels as JSON { text, hints } so Utforska can
  // apply the filters the chip label promises — plain text stays the wire
  // format otherwise (deep links / recent searches) (2026-09-20).
  const handleChipPress = (prompt) => {
    const text = prompt?.prompt_text;
    if (typeof text !== 'string' || text.length === 0) return;
    const hints = {};
    for (const key of ['category', 'category_slug', 'budget', 'day_filter', 'time_of_day', 'curated_id', 'mood']) {
      const value = prompt?.[key];
      if (typeof value === 'string' && value.length > 0) hints[key] = value;
    }
    const payload = Object.keys(hints).length > 0 ? JSON.stringify({ text, hints }) : text;
    // Nonce bumps only AFTER the write lands — the explore drain reads on
    // nonce change, so bumping early could race the AsyncStorage write.
    setItem(PENDING_AGENT_MESSAGE_KEY, payload)
      .catch(() => {})
      .finally(() => setChipNonce((n) => n + 1));
    setActiveTab('explore');
  };

  // Home-screen event card tap → hand the whole EventCard to the explore
  // tab. App.js's drain effect (deps [chipNonce]) opens its DetailsScreen
  // for the pending event. JSON round-trip keeps AppShell free of EventCard
  // shape knowledge beyond the id guard.
  //
  // 2026-10-03 — previousTabRef snapshot: användaren kom ofta från Karta
  // eller Hem; vi vill att < Tillbaka ska återställa dem dit, inte lämna
  // dem på Utforska. Ref rensas efter återställning så upprepade tappar
  // inte fastnar.
  const handleHomeCardPress = (event) => {
    if (!event || typeof event.id !== 'string' || event.id.length === 0) return;
    previousTabRef.current = activeTab;
    setItem(PENDING_EVENT_KEY, JSON.stringify(event))
      .catch(() => {})
      .finally(() => setChipNonce((n) => n + 1));
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
  } else if (!coldStartDone) {
    // 2026-10-04 — Konsistent branded startskärm ("EventPulse" i vitt på
    // svart) på VARJE cold-start. När onboardingState='done',
    // userState='logged_in'/'guest' och inga auth-ytor är öppna,
    // renderar vi splashPlaceholder tills COLD_START_MIN_MS har passerat.
    // 2026-10-04 — Ingen våg-bild, bara text. splashLogo-stilen är borttagen.
    // Auth-flöden ovanför override:ar — splashen visar sig bara när inget
    // annat ska visas.
    body = (
      <View style={styles.splashPlaceholder}>
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
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
            // 2026-10-28 — AppShell äger den synliga tabbarn (BottomTabBar).
            // App.js: egen 3-tabbar låg under den, överlappande och klickbar
            // → dubbla "Karta"/"Profil"-knappar med olika beteende. Döljs.
            hideInternalTabBar
            // 2026-10-02 (Utforska sök): showSearch + callbacks så App
            // kan rendera SearchScreen som overlay oavsett activeTab.
            showSearch={showSearch}
            onCloseSearch={closeSearch}
            onOpenSearchFromHome={openSearch}
            // 2026-10-03 — Tillbaka på DetailsScreen återställer activeTab
            // till den flik användaren kom ifrån (Karta / Hem / osv).
            onDetailBack={handleDetailBack}
          />
        </View>
        {mountedTabsRef.current.home && (
          <View style={activeTab === 'home' ? styles.tabPanel : styles.tabHidden}>
            <HomeScreen onCardPress={handleHomeCardPress} userState={userState} />
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
        {mountedTabsRef.current.map && (
          <View style={activeTab === 'map' ? styles.tabPanel : styles.tabHidden}>
            {/* mapReloadEpoch i key = force-remount på back-from-detail
                så INITIAL_REGION återställs (se handleDetailBack). */}
            <KartaScreen key={`map-${mapReloadEpoch}`} onEventPress={handleHomeCardPress} />
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
  splashText: {
    // 2026-10-04 — Rent vitt (#FFFFFF) på svart botten. Tidigare användes
    // cream/off-white (#F7F2EA) + en pulse-våg-bild (splash.png) ovanför.
    // Användaren vill ha ren EventPulse-branding: bara text, ingen bild.
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
});
