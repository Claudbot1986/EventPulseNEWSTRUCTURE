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
    // 2026-10-03: 12pt (var 13) så alla fyra knappar med counts ryms på
    // EN rad på iPhone-bredd (375pt). numberOfLines + adjustsFontSizeToFit
    // skyddar mot framtida filter-texter som växer.
    label: { size: 12, weight: '700', letterSpacing: 0.2 },
  },
  space: {
    padX: 16, // var 20 — sparat 8pt för knapparna
    buttonGap: 4, // var 8 — tre gaps × 4 = 12pt sparat
    buttonPad: 8, // var 12 — fyra knappar × 4pt × 2 sidor = 32pt sparat
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
              adjustsFontSizeToFit
              minimumFontScale={0.75}
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
    // flexWrap default = 'nowrap' — alla fyra knapparna ligger på EN rad.
    // flex: 1 på varje knapp ger lika-delad bredd så de fyller hela
    // skärmbredden oavsett hur counts varierar.
  },
  button: {
    flex: 1, // dela skärmbredden lika mellan de fyra knapparna
    minHeight: 44, // iOS minimum touch-target (a11y)
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