/**
 * NetworkBanner — offline indicator that floats above the tab bar.
 *
 * Shown when GET /agent/health fails for 30+ seconds. Hidden immediately
 * on any successful API call (via markOnline()).
 *
 * Design tokens mirror BottomTabBar.js so the banner feels native to the UI.
 *
 * T0073 — MVP-gap network resilience.
 */

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkContext } from '../services/networkContext';

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#000000',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#332516',
    warning: '#E5534B',   // red for offline indicator
    warningSoft: '#2A1A1A',
  },
  space: { xs: 4, sm: 8, md: 12 },
  fontSize: { xs: 10, sm: 11, md: 13, lg: 16 },
};

export default function NetworkBanner() {
  const { isConnected } = useNetworkContext();

  if (isConnected) return null;

  return (
    <View style={styles.banner} pointerEvents="none" role="alert" aria-label="Ingen nätanslutning">
      <Ionicons
        name="wifi-outline"
        size={14}
        color={TOKENS.color.warning}
        style={styles.icon}
      />
      <Text style={styles.text} numberOfLines={1}>
        Ingen anslutning — vi visar senast cachad data
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.warningSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.color.warning,
    paddingVertical: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: Platform.OS === 'ios' ? 30 : 10, // below status bar
  },
  icon: {
    marginRight: 6,
    opacity: 0.9,
  },
  text: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
