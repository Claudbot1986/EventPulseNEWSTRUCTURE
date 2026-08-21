/**
 * AppShell — Phase 1 retention entry point.
 *
 * Wraps the existing App.js (which contains splash → details → homeScreen
 * for the "Utforska" tab) and adds a BottomTabBar with 4 destinations:
 *   - Hem         → placeholder (full impl in #72)
 *   - Utforska    → App.js (current behavior, default)
 *   - Notiser     → placeholder (empty state)
 *   - Profil      → placeholder (saved + settings)
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
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import App from './App';

const TABS = ['home', 'explore', 'notifications', 'profile'];

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('explore');
  const [badges, setBadges] = useState({});

  const handleTabChange = (tabId) => {
    if (!TABS.includes(tabId)) return;
    setActiveTab(tabId);
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {activeTab === 'explore' && <App />}
        {activeTab === 'home' && <HomeScreen />}
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
});