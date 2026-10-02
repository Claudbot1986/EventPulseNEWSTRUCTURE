/**
 * DateRangePicker — kalender-grid (månad) för Utforska sök (2026-10-02).
 *
 * Visar en månad-kalender med två-stegs val: första tap = start-datum,
 * andra tap = slut-datum. Om andra tap är före första byter vi dem.
 *
 * Snabbval-chips ovanför kalendern: Idag / Imorgon / Helg / 7 dagar /
 * 30 dagar / Alla (raderar intervallet).
 *
 * Designspråk: mörkt tema, accent orange (`#FFB454`) — samma som Hem-
 * sidans Utforska-sektion. Använder `react-native-calendars` för kalender-
 * griden; vi renderar den manuellt istället för via deras färdiga
 * `Agenda` / `ExpandableCalendar` så vi kan styra layout, modalitet
 * och i18n helt själva.
 *
 * Props:
 *   visible           : bool   — om modalen är synlig
 *   onClose           : fn()   — stäng modal utan att applicera
 *   value             : { from: string|null, to: string|null }
 *                                 — nuvarande val (ISO YYYY-MM-DD)
 *   onChange          : fn({ from, to }) — applicera nya val
 *   today             : Date   — referensdag (default new Date())
 *   language          : string — 'sv' | 'en' för kalender-veckodagar/månader
 *
 * Pure presentational — ingen fetch, ingen global state. SearchScreen
 * ansvarar för att skicka in value och lagra onChange-resultatet.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

// ── i18n för kalendern ──────────────────────────────────────────────────
// LocaleConfig måste sättas FÖRE första render av Calendar — det är en
// global singleton i react-native-calendars. Vi registrerar en svensk
// och en engelsk locale en gång per modul-load.
LocaleConfig.locales.sv = {
  monthNames: [
    'januari','februari','mars','april','maj','juni',
    'juli','augusti','september','oktober','november','december',
  ],
  monthNamesShort: ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'],
  dayNames: ['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'],
  dayNamesShort: ['sön','mån','tis','ons','tor','fre','lör'],
};
LocaleConfig.locales.en = {
  monthNames: [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ],
  monthNamesShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  dayNames: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  dayNamesShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
};
LocaleConfig.defaultLocale = 'sv';

// ── Tema — matchar Utforska-sektionens tokens ───────────────────────────
const TOKENS = {
  color: {
    bg: '#000000',
    surface: '#111114',
    surfaceAlt: '#1A1A1A',
    text: '#FFFFFF',
    textMuted: '#A9B0BE',
    textSoft: '#6F7785',
    accent: '#FFB454',
    accentSoft: 'rgba(255, 180, 84, 0.18)',
    border: '#222229',
  },
  font: {
    title: { size: 18, weight: '800', letterSpacing: -0.2 },
    section: { size: 11, weight: '800', letterSpacing: 1.6 },
    chip: { size: 12, weight: '700' },
    body: { size: 14, weight: '500' },
    bodyBold: { size: 14, weight: '700' },
  },
};

// ── Snabbval-chips ─────────────────────────────────────────────────────
// quickRange + isoOf + nextWeekday bor i utils/dateRange.js — extraherade
// 2026-10-02 så de kan testas utan att importera react-native-calendars
// (som drar in native-moduler och kraschar vitest).
import { quickRange, QUICK_RANGE_KEYS, isoOf } from '../utils/dateRange';

// ── Marked dates för Calendar ──────────────────────────────────────────
// Calendar tar en `markedDates`-prop med shape:
// { 'YYYY-MM-DD': { startingDay, endingDay, color, textColor } }
function buildMarkedDates(value, todayIsoStr) {
  const { from, to } = value;
  if (!from && !to) return {};
  // Enda dagen — markera som single-day range.
  if (from && (!to || from === to)) {
    return {
      [from]: {
        startingDay: true,
        endingDay: true,
        color: TOKENS.color.accent,
        textColor: '#000000',
      },
      ...(todayIsoStr && todayIsoStr !== from
        ? { [todayIsoStr]: { disabled: true, disableTouchEvent: true } }
        : {}),
    };
  }
  if (!from || !to) return {};
  // Multi-day range: rendera alla dagar mellan from..to som markerade.
  const out = {};
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if (start > end) return out; // defensivt — UI borde swap:a innan hit
  const cur = new Date(start);
  while (cur <= end) {
    const iso = isoOf(cur);
    const isStart = iso === from;
    const isEnd = iso === to;
    out[iso] = {
      startingDay: isStart,
      endingDay: isEnd,
      color: TOKENS.color.accent,
      textColor: '#000000',
    };
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ── Huvudkomponent ─────────────────────────────────────────────────────
export default function DateRangePicker({
  visible,
  onClose,
  onApply,
  value = { from: null, to: null },
  today = new Date(),
  language = 'sv',
}) {
  // Lokalt draft-state — användaren kan mixtra utan att förälderns
  // value uppdateras förrän "Klar" trycks. Mönstret speglar andra
  // datumväljare i branschen (iOS DatePicker, Android Material).
  const [draft, setDraft] = useState(value);
  const [pendingStart, setPendingStart] = useState(null);

  // När modalen öppnas, initiera draft från prop:value (föräldern är
  // single-source-of-truth mellan sessioner). useMemo så vi inte
  // startar om useState onödigt.
  const todayIso = useMemo(() => isoOf(today), [today]);
  // Sätt LocaleConfig i enlighet med språk — körs som effect så det
  // händer EFTER mount men FÖRE Calendar:s render. LocaleConfig är en
  // global singleton i react-native-calendars; vi vill inte mutera
  // den under render (kan orsaka inkonsistens i StrictMode).
  useEffect(() => {
    LocaleConfig.defaultLocale = language === 'en' ? 'en' : 'sv';
  }, [language]);

  const marked = useMemo(() => buildMarkedDates(draft, todayIso), [draft, todayIso]);

  const handleDayPress = (day) => {
    // day.dateString är YYYY-MM-DD från react-native-calendars.
    const picked = day.dateString;
    // Två-stegs val: första tap = start, andra tap = end.
    if (!pendingStart || (draft.from && draft.to)) {
      // Starta ett nytt val
      setPendingStart(picked);
      setDraft({ from: picked, to: null });
      return;
    }
    // Andra tap — bestäm ordning
    if (picked < pendingStart) {
      setDraft({ from: picked, to: pendingStart });
    } else if (picked === pendingStart) {
      // Samma dag = en-dags intervall
      setDraft({ from: picked, to: picked });
    } else {
      setDraft({ from: pendingStart, to: picked });
    }
    setPendingStart(null);
  };

  const handleClear = () => {
    setDraft({ from: null, to: null });
    setPendingStart(null);
  };

  const handleQuick = (key) => {
    const next = quickRange(key, today);
    setDraft(next);
    setPendingStart(null);
  };

  const handleApply = () => {
    onApply?.(draft);
    onClose?.();
  };

  // Reset draft när modalen öppnas (synka med parent value).
  // Använder useState-init via key i parent istället, men vi lägger
  // ändå en useEffect-liknande guard med onLayout om det behövs.
  // Här: enkel inline — förälderns key-prop på <DateRangePicker>
  // garanterar att draft återinitieras vid remount.

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Stäng datumväljare"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {language === 'en' ? 'Pick a date range' : 'Välj datumintervall'}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Stäng"
              style={({ pressed }) => [styles.headerClose, pressed && styles.pressed]}
            >
              <Text style={styles.headerCloseText}>✕</Text>
            </Pressable>
          </View>

          {/* Snabbval */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickRow}
          >
            {QUICK_RANGE_KEYS.map((key) => {
              const isActive =
                JSON.stringify(quickRange(key, today)) ===
                JSON.stringify(draft);
              return (
                <Pressable
                  key={key}
                  onPress={() => handleQuick(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  style={({ pressed }) => [
                    styles.chip,
                    isActive && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.chipText, isActive && styles.chipTextActive]}
                  >
                    {QUICK_RANGE_LABELS[language]?.[key] || key}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Kalender — wrapper ger mörk bakgrund och döljer bibliotekets
              intern-styling så vi kan styra hela utseendet. */}
          <View style={styles.calendarWrap}>
            <Calendar
              current={draft.from || todayIso}
              minDate={todayIso}
              maxDate={'2031-12-31'}
              onDayPress={handleDayPress}
              markingType="period"
              markedDates={marked}
              theme={{
                backgroundColor: TOKENS.color.surface,
                calendarBackground: TOKENS.color.surface,
                textSectionTitleColor: TOKENS.color.textMuted,
                dayTextColor: TOKENS.color.text,
                monthTextColor: TOKENS.color.text,
                arrowColor: TOKENS.color.accent,
                todayTextColor: TOKENS.color.accent,
                textDisabledColor: TOKENS.color.textSoft,
                // Mörk temaoverride — bibliotekets defaults ljusnar
                // komponenten om man inte sätter dessa explicit.
                textMonthFontWeight: '800',
                textDayFontWeight: '500',
                textDayHeaderFontWeight: '700',
                textMonthFontSize: 16,
                textDayFontSize: 14,
                textDayHeaderFontSize: 11,
              }}
            />
          </View>

          {/* Footer — info-rad + knappar */}
          <View style={styles.footer}>
            <Text style={styles.summary}>
              {draft.from && draft.to
                ? draft.from === draft.to
                  ? `${draft.from}`
                  : `${draft.from} → ${draft.to}`
                : draft.from
                  ? `${draft.from} → …`
                  : (language === 'en' ? 'All future events' : 'Alla framtida events')}
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                onPress={handleClear}
                accessibilityRole="button"
                accessibilityLabel={language === 'en' ? 'Clear' : 'Rensa'}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGhostText}>
                  {language === 'en' ? 'Clear' : 'Rensa'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleApply}
                accessibilityRole="button"
                accessibilityLabel={language === 'en' ? 'Apply' : 'Klar'}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnPrimaryText}>
                  {language === 'en' ? 'Apply' : 'Klar'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const QUICK_RANGE_LABELS = {
  sv: {
    today: 'Idag',
    tomorrow: 'Imorgon',
    weekend: 'Helg',
    '7days': '7 dagar',
    '30days': '30 dagar',
    all: 'Alla',
  },
  en: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    weekend: 'Weekend',
    '7days': '7 days',
    '30days': '30 days',
    all: 'All',
  },
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: TOKENS.color.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 16,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.surfaceAlt,
  },
  headerCloseText: {
    color: TOKENS.color.text,
    fontSize: 14,
    fontWeight: '700',
  },
  quickRow: {
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: TOKENS.color.surfaceAlt,
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: TOKENS.color.accent,
  },
  chipText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.chip.size,
    fontWeight: TOKENS.font.chip.weight,
  },
  chipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  calendarWrap: {
    backgroundColor: TOKENS.color.surface,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 12,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.color.border,
    paddingTop: 12,
  },
  summary: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.body.size,
    fontWeight: TOKENS.font.body.weight,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: TOKENS.color.surfaceAlt,
  },
  btnGhostText: {
    color: TOKENS.color.text,
    fontSize: 14,
    fontWeight: '700',
  },
  btnPrimary: {
    backgroundColor: TOKENS.color.accent,
  },
  btnPrimaryText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.5,
  },
});
