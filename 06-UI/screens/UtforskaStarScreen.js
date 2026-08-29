/**
 * UtforskaStarScreen — dev-only sektion för visuell verifiering av
 * EU AI Act Art. 50 AI-stämpel på de 10 första bucket-bilderna.
 *
 * Bakgrund (2026-08-29): Efter 3 dagars felsökning visade det sig att
 * `eventImage` i App.js saknade aspect-lock → på bred web croppades
 * stämpeln (x=800-1000) bort horisontellt. Denna skärm har:
 *   - aspectRatio: 1 wrapper (1:1 cover-crop) — stämpeln syns alltid
 *   - hårdkodade URL:er till de 10 första restamplade bilderna
 *   - dev-banner som tydligt visar att det är en dev-only-sektion
 *
 * Feature flagga: EXPO_PUBLIC_EXPLORE_STAR_ENABLED=true
 * Om flaggan är false döljs hela tab-routen i AppShell/BottomTabBar.
 *
 * Visuell verifiering: kör `python3 scripts/verify_utforska_star.py`
 * efter `expo start --web --port 8081` för per-bild-screenshot.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const SUPABASE_URL = 'https://bsllkpvkowwndhhxtlln.supabase.co';
const BUCKET = 'event-posters';
const PREFIX = 'ai-generated';

// De 10 första bucket-bilderna (alphabetical sort, samma som
// restamp_all_event_posters.ts --limit=10 producerade 2026-08-29).
// Hårdkodade eftersom vi vill verifiera EXAKT dessa — agent API är inte
// alltid tillgängligt och smoke-test ska vara reproducerbart.
const FIRST_TEN = [
  { file: '-.png',                                       label: '#1' },
  { file: '-banan-kompaniet.png',                        label: '#2' },
  { file: '-bioskandia.png',                             label: '#3' },
  { file: '-cirkus.png',                                 label: '#4' },
  { file: '-mariatorget3.png',                           label: '#5' },
  { file: '-tyrol.png',                                  label: '#6' },
  { file: '10cc-konsertsalen.png',                       label: '#7' },
  { file: '5secondsofsummer-everyonesastarworldtourplatinumtickets-hovet.png', label: '#8' },
  { file: '6lackfllan-fllan.png',                        label: '#9' },
  { file: 'aaprocky-dontbedumbworldtourplatinumtickets-.png', label: '#10' },
];

function imageUrl(file) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PREFIX}/${file}`;
}

export default function UtforskaStarScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner} testID="utforska-star-banner">
          <Text style={styles.bannerKicker}>DEV-SEKTION</Text>
          <Text style={styles.bannerTitle}>Utforska*</Text>
          <Text style={styles.bannerBody}>
            10 första AI-bilder, restämplade 2026-08-29.{'\n'}
            Aspect 1:1 — orange "● AI"-pill ska synas i nedre höger.{'\n'}
            {'\n'}
            Pipeline: 08-Agent/tools/ai_compliance.ts → applyAiCompliance.{'\n'}
            Safe-zone: x=800-1000, y=740-788 (1024×1024-bild).
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Inzoomad vy (1:1, ingen marginal)</Text>
        {FIRST_TEN.map((item) => (
          <View key={item.file} style={styles.card} testID={`star-card-${item.label}`}>
            <View style={styles.imageWrap}>
              <Image
                source={{ uri: imageUrl(item.file) }}
                style={styles.image}
                resizeMode="cover"
                testID={`star-img-${item.label}`}
              />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel}>{item.label}</Text>
              <Text style={styles.cardFile} numberOfLines={1}>{item.file}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.sectionLabel}>Normaliserad vy (motsvarande prod-Utforska, 1.5:1)</Text>
        <Text style={styles.sectionSub}>
          Med maxWidth=420 håller prod-Utforska aspect ≤ 1.5:1 — stämpeln syns.
        </Text>
        {FIRST_TEN.slice(0, 3).map((item) => (
          <View key={`narrow-${item.file}`} style={styles.cardNarrow}>
            <Image
              source={{ uri: imageUrl(item.file) }}
              style={styles.imageNarrow}
              resizeMode="cover"
            />
            <Text style={styles.cardLabel}>{item.label}</Text>
          </View>
        ))}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const TOKENS = {
  appBg: '#000000',
  surface: '#15151B',
  border: '#1A1A1A',
  accent: '#FFB454',
  text: '#F7F2EA',
  textMuted: '#A9B0BE',
  textSoft: '#727B8D',
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: TOKENS.appBg,
  },
  scroll: {
    padding: 16,
  },
  banner: {
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: TOKENS.accent,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  bannerKicker: {
    color: TOKENS.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  bannerTitle: {
    color: TOKENS.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  bannerBody: {
    color: TOKENS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionLabel: {
    color: TOKENS.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionSub: {
    color: TOKENS.textSoft,
    fontSize: 11,
    marginTop: -8,
    marginBottom: 12,
  },
  card: {
    backgroundColor: TOKENS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TOKENS.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  imageWrap: {
    aspectRatio: 1, // 1:1 cover-crop → hela bilden synlig, stämpel i SE-hörn syns
    width: '100%',
    backgroundColor: TOKENS.appBg,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    padding: 12,
  },
  cardLabel: {
    color: TOKENS.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardFile: {
    color: TOKENS.textMuted,
    fontSize: 12,
  },
  cardNarrow: {
    backgroundColor: TOKENS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TOKENS.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  imageNarrow: {
    width: '100%',
    height: 280,
    maxWidth: 420,
    backgroundColor: TOKENS.appBg,
  },
});
