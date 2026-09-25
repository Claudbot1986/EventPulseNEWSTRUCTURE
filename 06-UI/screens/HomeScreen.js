/**
 * HomeScreen — HEM-SEKTION I KARANTÄN (2026-09-25).
 *
 * Original HomeScreen.js + helpers (`./home/`) flyttade till
 * 06-UI/HEM-QUARANTINE/screens/ — koden är oförändrad och redo att
 * återställas när Hem* är redo för 06-UI/. Hem-tabben i BottomTabBar
 * finns kvar (Hem/Utforska/Notiser/Profil) och pekar hit.
 *
 * Vad detta innebär:
 *   - `mountedTabsRef.current.home` är true → HomeScreen monteras som
 *     förut, men prop-handlers (onChipPress, onCardPress) kommer aldrig
 *     att anropas (stubben ignorerar dem). AppShell-handlers lever
 *     kvar oförändrade så återställning är en-till-ett.
 *   - BottomTabBar / TABS / route-flippet i AppShell orört.
 *   - Sandbox-versionen Hem-supabase (06-UI-sandbox/components/HemSupabase.js)
 *     är den aktiva utvecklingsytan just nu — den läser riktig Supabase-
 *     data via events_public view och validerar hur Hem* ska se ut.
 *
 * Återställning: flytta tillbaka filerna från HEM-QUARANTINE/screens/
 * till screens/, ta bort denna stub. Inga andra kodändringar krävs.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.banner}>
        <Text style={styles.eyebrow}>HEM-SEKTION I KARANTÄN</Text>
        <Text style={styles.title}>Hem är pausad</Text>
        <Text style={styles.body}>
          Hem-trädet är satt i karantän 2026-09-25. Originalfilerna ligger
          i 06-UI/HEM-QUARANTINE/screens/ — HomeScreen.js (1 721 rader) +
          helpers (cardTimeLabel, happeningNow, weekendDates) — oförändrade.
        </Text>
        <Text style={styles.body}>
          Hem-tabben finns kvar — du kan trycka på den, men innehållet är
          denna banner tills Hem* återställs.
        </Text>
        <Text style={styles.body}>
          Aktiv utveckling: 06-UI-sandbox/components/HemSupabase.js
          (riktig Supabase-data via events_public view, 5 sektioner i
          ordning För dig → Senaste → Ikväll → Helgen → Upptäck).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  banner: {
    margin: 20,
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: '#FFB454',
  },
  eyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#F7F2EA',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 16,
  },
  body: {
    color: '#F7F2EA',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 12,
  },
});
