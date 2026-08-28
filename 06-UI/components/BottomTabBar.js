/**
 * BottomTabBar — primary navigation (Phase 1 retention).
 *
 * 4 tabs: Home / Explore / Notifications / Profile
 *
 * Design choices, mapped to research + UI-DESIGN.md spec:
 *
 *   1. Four tabs total. Apple HIG + NN/g say 3-5 tabs is the sweet spot
 *      for thumb-reach and recognition. We use 4 (the upper bound of
 *      "always-visible"). Five feels like a tabbar graveyard.
 *
 *   2. Order: Home → Explore → Notifications → Profile.
 *      Home (default landing) is leftmost because that's the thumb's
 *      natural zone for "where I start". Profile is rightmost because
 *      it's used least.
 *
 *   3. Messages was deliberately dropped. The reference image had
 *      Messages, but the user marked it optional. Building a 1:1 chat
 *      surface with no real back-end would be a fake feature — every
 *      conversation would be a local stub. See memory
 *      `feedback_no_fake_events.md`: no surfaced feature without a real
 *      backing system.
 *
 *   4. Badge on Notifications. The badge makes tab-bar navigation
 *      halfway-decent as a re-engagement surface — when a new event
 *      matches user preferences, the agent emits a notification, the
 *      user sees the dot, taps Notifications, sees what they got. This
 *      is the cheapest possible "come back tomorrow" loop.
 *
 *   5. Pure-black canvas + transparent backgrounds. Matches
 *      `docs/UI-DESIGN.md` exactly. The bar is transparent; only a thin
 *      top border separates it from the content above.
 *
 *   6. Active state: warmvit icon + label, accent-yellow indicator dot.
 *      Inactive: muted text, no dot. Avoids bold-vs-thin weight change
 *      (which can feel jumpy) — colour is the only signal.
 *
 * Contract:
 *   - Fully controlled: parent owns `activeTab` state.
 *   - `onChange(tabId)` fires on tap.
 *   - `badges` is an optional `{ [tabId]: number }` map. `null`/`0` =
 *     no badge.
 *   - Renders fixed to the bottom of the screen via the parent
 *     SafeAreaView / View — this component does NOT manage layout
 *     itself, so it slots into existing screens without wrapping logic.
 *
 * No PropTypes / TypeScript: this project is a plain `.js` Expo app
 * (see `06-UI/package.json`). The shapes are documented above.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// TOKENS — duplicated inline so this component has zero coupling to
// App.js's internal consts. The numbers come from `docs/UI-DESIGN.md`
// (the locked spec). If the spec changes, change both.
const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#000000',
    surfaceRaised: 'transparent',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#332516',
    white: '#FFFFFF',
  },
  space: { xs: 4, sm: 8, md: 12 },
  radius: { sm: 8, md: 12, lg: 20 },
  fontSize: { xs: 10, sm: 11, md: 13, lg: 16 },
};

// TABS — single source of truth. Order here = visual order in the bar.
// `icon` is an Ionicons name. `label` is short Swedish/English mix
// matching the rest of the UI.
const TABS = [
  { id: 'home',          icon: 'home-outline',         iconActive: 'home',           label: 'Hem' },
  { id: 'explore',       icon: 'compass-outline',      iconActive: 'compass',        label: 'Utforska' },
  { id: 'notifications', icon: 'notifications-outline', iconActive: 'notifications', label: 'Notiser' },
  { id: 'profile',       icon: 'person-circle-outline', iconActive: 'person-circle', label: 'Profil' },
];

function TabBarButton({ tab, isActive, badge, onPress }) {
  const color = isActive ? TOKENS.color.text : TOKENS.color.textMuted;
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={tab.label}
      activeOpacity={0.7}
      onPress={() => onPress(tab.id)}
      style={styles.tabButton}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={isActive ? tab.iconActive : tab.icon}
          size={22}
          color={color}
        />
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {tab.label}
      </Text>
      {isActive && <View style={styles.activeIndicator} />}
    </TouchableOpacity>
  );
}

export default function BottomTabBar({ activeTab, onChange, badges = {} }) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => (
        <TabBarButton
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTab}
          badge={badges[tab.id] || 0}
          onPress={onChange}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: TOKENS.color.appBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.color.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8, // iOS home-indicator inset
    paddingTop: TOKENS.space.sm,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: TOKENS.space.xs,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: TOKENS.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: TOKENS.color.appBg,
    fontSize: TOKENS.fontSize.xs,
    fontWeight: '700',
  },
  label: {
    fontSize: TOKENS.fontSize.xs,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: TOKENS.color.accent,
  },
});
