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
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import BottomTabBar from './components/BottomTabBar';
import HomeScreen from './screens/HomeScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import NetworkBanner from './components/NetworkBanner';
import App from './App';
import { getItem, setItem, PENDING_AGENT_MESSAGE_KEY } from './services/storage';
import { NetworkProvider } from './services/networkContext';

const TABS = ['home', 'explore', 'notifications', 'profile'];
const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
const STORAGE_BUDGET_MS = 800;
export { PENDING_AGENT_MESSAGE_KEY };

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('home');
  const [onboardingState, setOnboardingState] = useState('loading'); // 'loading' | 'needs' | 'done'

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

  const handleTabChange = (tabId) => {
    if (!TABS.includes(tabId)) return;
    setActiveTab(tabId);
  };

  const handleOnboardingComplete = () => {
    setOnboardingState('done');
  };

  const handleChipPress = (prompt) => {
    const text = prompt?.prompt_text;
    if (typeof text !== 'string' || text.length === 0) return;
    setItem(PENDING_AGENT_MESSAGE_KEY, text).catch(() => {});
    setActiveTab('explore');
  };

  let body;
  if (onboardingState === 'loading') {
    body = (
      <View style={styles.splashPlaceholder}>
        <Text style={styles.splashText}>EventPulse</Text>
      </View>
    );
  } else if (onboardingState === 'needs') {
    body = <OnboardingScreen onComplete={handleOnboardingComplete} />;
  } else {
    body = (
      <>
        <NetworkBanner />
        {activeTab === 'explore' && <App />}
        {activeTab === 'home' && <HomeScreen onChipPress={handleChipPress} />}
        {activeTab === 'notifications' && <NotificationsScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
        <View style={styles.barWrapper} pointerEvents="box-none">
          <BottomTabBar
            activeTab={activeTab}
            onChange={handleTabChange}
            badges={{}}
          />
        </View>
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
