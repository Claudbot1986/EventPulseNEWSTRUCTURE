/**
 * EventPulse — Agent-first entry (Phase 1).
 *
 * This file replaces the legacy browse-first App.js as the root of the
 * Expo app. It mounts the private /agent/chat surface (AgentScreen)
 * and drops the anon-Supabase path entirely — the agent API is the
 * only entry point for events.
 *
 * Phase 0 step 5: Expo agent shell.
 * Phase 0 step 6: stop anon dump as the product read path.
 */

import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import AgentScreen from './app/AgentScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <AgentScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
