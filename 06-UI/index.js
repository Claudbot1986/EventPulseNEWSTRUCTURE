import { registerRootComponent } from 'expo';

// AppShell wraps App.js (browse-first) with a BottomTabBar giving 4 tabs:
// Hem / Utforska / Notiser / Profil. Default tab is 'explore' so the
// existing App.js feed stays the landing surface until HomeScreen is
// promoted to its real implementation (#72).
//
// History:
//  - 2026-08-21 reverted to App.js (browse-first) per user request
//  - 2026-08-21 added AppShell + BottomTabBar for retention (4-tab nav)
//
// The agent-first App-agent.js + AgentScreen.js remain on disk for later.
import AppShell from './AppShell';

registerRootComponent(AppShell);
