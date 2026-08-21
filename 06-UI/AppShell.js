/**
 * AppShell — Phase 1 retention entry point.
 *
 * Wraps the existing App.js (which contains splash → details → homeScreen
 * for the "Utforska" tab) and adds a BottomTabBar with 4 destinations:
 *   - Hem         → HomeScreen (live data sections)
 *   - Utforska    → App.js (current behavior, default)
 *   - Notiser     → NotificationsScreen (empty state)
 *   - Profil      → ProfileScreen (saved + settings)
 *
 * The bar is absolutely positioned at the bottom, floating over the
 * content. The content (App.js's feed, placeholders) renders behind it
 * without padding gymnastics.
 *
 * Why a separate shell instead of editing App.js:
 *   - App.js is 1445 lines with substantial feed logic. A bare-metal
 *     edit to add tab state would be high-risk.
 *   - This shell keeps App.js untouched: when `activeTab === 'explore'`
 *     we render the entire App as-is. The bottom bar floats above it
 *     without any layout change to App.js's internals.
 *   - Each tab can evolve independently. Eventually HomeScreen will be
 *     promoted out of App.js and AppShell will route to it directly.
 *
 * The badge counts live on AppShell so individual tab screens can push
 * numbers into it via callbacks (e.g. HomeScreen calls
 * `onNotificationsCount(3)` when the agent surfaces 3 new matches).
 * For now badges are zero because no screen pushes them yet.
 *
 * Onboarding gate (#71):
 *   - First cold start after splash shows OnboardingScreen (multi-choice
 *     category preferences) until the user completes or skips.
 *   - Completion flag persisted via services/storage.js. Once set, the
 *     user is not shown the onboarding screen again unless storage is
 *     cleared.
 *   - Renders before any tab so tabs aren't visible during onboarding;
 *     tabs mount only after `onboardingComplete === true`.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import App from './App';
import { getItem, setItem } from './services/storage';

const TABS = ['home', 'explore', 'notifications', 'profile'];
const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
export const PENDING_AGENT_MESSAGE_KEY = 'eventpulse.pending_agent_message';

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('explore');
  const [badges, setBadges] = useState({});
  const [onboardingState, setOnboardingState] = useState('loading'); // 'loading' | 'needs' | 'done'

  useEffect(() => {
    let alive = true;
    getItem(ONBOARDING_COMPLETE_KEY)
      .then((value) => {
        if (!alive) return;
        setOnboardingState(value === '1' ? 'done' : 'needs');
      })
      .catch(() => {
        if (!alive) return;
        setOnboardingState('needs');
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleTabChange = (tabId) => {
    if (!TABS.includes(tabId)) return;
    setActiveTab(tabId);
  };

  const handleOnboardingComplete = () => {
    setOnboardingState('done');
  };

  // T0063 — chip tap: persist the prompt and jump to the explore tab so
  // App.js can read it on focus and surface the chosen prompt to the user.
  // AsyncStorage write is fire-and-forget; the activeTab state change is
  // synchronous and drives the actual UI navigation.
  const handleChipPress = (prompt) => {
    const text = prompt?.prompt_text;
    if (typeof text !== 'string' || text.length === 0) return;
    setItem(PENDING_AGENT_MESSAGE_KEY, text).catch(() => {
      // Storage failure is non-fatal — the tab still switches and the
      // user can still browse manually.
    });
    setActiveTab('explore');
  };

  if (onboardingState !== 'done') {
    return (
      <SafeAreaProvider>
        <View style={styles.container}>
          {onboardingState === 'loading' ? (
            <View style={styles.splashPlaceholder} />
          ) : (
            <OnboardingScreen onComplete={handleOnboardingComplete} />
          )}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {activeTab === 'explore' && <App />}
        {activeTab === 'home' && <HomeScreen onChipPress={handleChipPress} />}
        {activeTab === 'notifications' && <NotificationsScreen />}
        {activeTab === 'profile' && <ProfileScreen />}

        <View style={styles.barWrapper} pointerEvents="box-none">
          <BottomTabBar
            activeTab={activeTab}
            onChange={handleTabChange}
            badges={badges}
          />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  // BottomTabBar lives inside this absolutely-positioned box so it
  // floats over the content rather than pushing it. pointerEvents=none
  // means taps outside a button pass through (e.g. scrolling the feed
  // when the user accidentally taps the empty area of the bar).
  barWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  splashPlaceholder: {
    flex: 1,
    backgroundColor: '#000000',
  },
});