// MapFilterBar.js — 4 filter-knappar under MapCanvas.
//
// UX-regel från Ticketmaster API-praktiken: "Display active filters
// as removable chips so users always understand what's in effect".
// Vi förenklar: aktiva knappen är orange (`#FFB374`), andra är muted.
//
// EventPulse UI-konventioner (06-UI-sandbox/.../ui/UI_RULES.md):
//   - minHeight 44pt (iOS touch-target)
//   - `accessibilityRole="button"`, `accessibilityLabel` per tydlig,
//     `accessibilityState.selected` för aktiv knapp
//   - inga pill-radisar på allt i onödan (8pt på radie är OK för
//     knappar eftersom to memory design system använder det)

import { Pressable, StyleSheet, Text, View } from 'react-native';

const TOKENS = {
  color: {
    bg: '#000000',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    accent: '#FFB454',
    border: '#1A1A1A',
    activeBorder: '#FFB454',
  },
  font: {
    label: { size: 13, weight: '700', letterSpacing: 0.4 },
  },
  space: {
    padX: 20,
    buttonGap: 8,
    buttonPad: 12,
    buttonRadius: 8,
  },
};

const FILTERS = [
  { id: 'today', label: 'Idag' },
  { id: 'weekend', label: 'Helgen' },
  { id: 'next_weekend', label: 'Nästa helg' },
  { id: 'all', label: 'Alla' },
];

export default function MapFilterBar({ activeMode, onChange, counts }) {
  return (
    <View
      style={styles.bar}
      accessibilityRole="tablist"
      accessibilityLabel="Kartfilter"
    >
      {FILTERS.map((f) => {
        const isActive = f.id === activeMode;
        const count = counts && counts[f.id];
        const label = count != null ? `${f.label} · ${count}` : f.label;
        return (
          <Pressable
            key={f.id}
            onPress={() => onChange(f.id)}
            accessibilityRole="tab"
            accessibilityLabel={`Visa ${f.label}`}
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [
              styles.button,
              isActive && styles.buttonActive,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text
              style={[styles.buttonText, isActive && styles.buttonTextActive]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: TOKENS.space.padX,
    paddingVertical: 12,
    backgroundColor: TOKENS.color.bg,
    gap: TOKENS.space.buttonGap,
    flexWrap: 'wrap',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: TOKENS.space.buttonPad,
    paddingVertical: 8,
    borderRadius: TOKENS.space.buttonRadius,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonActive: {
    borderColor: TOKENS.color.activeBorder,
    backgroundColor: 'rgba(255,180,254,0.08)',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.label.size,
    fontWeight: TOKENS.font.label.weight,
    letterSpacing: TOKENS.font.label.letterSpacing,
  },
  buttonTextActive: {
    color: TOKENS.color.accent,
  },
});

export { TOKENS as MAP_FILTER_BAR_TOKENS };
export { FILTERS as MAP_FILTERS };