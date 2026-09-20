import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

// AppShell wraps App.js (Utforska) with a BottomTabBar giving 4 tabs:
// Hem / Utforska / Notiser / Profil. Default tab is 'home'.
//
// History:
//  - 2026-08-21 reverted to App.js (browse-first) per user request
//  - 2026-08-21 added AppShell + BottomTabBar for retention (4-tab nav)
//  - 2026-09-20 native splash now owned by AppShell: preventAutoHide here
//    (module level), AppShell hides it after bootstrap + min 3 s logo.
//
// The agent-first App-agent.js + AgentScreen.js remain on disk for later.
import AppShell from './AppShell';

// Keep the native splash visible until AppShell has bootstrapped identity AND
// the minimum branding time has passed. Without this the OS releases the
// launch image on the first JS frame and the user sees a black gap before
// the app paints.
SplashScreen.preventAutoHideAsync().catch(() => {});

registerRootComponent(AppShell);
