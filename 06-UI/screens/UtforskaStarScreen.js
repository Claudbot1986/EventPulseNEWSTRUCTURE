/**
 * UtforskaStarScreen — dev-only sektion för visuell verifiering av
 * EU AI Act Art. 50 AI-stämpel på de 10 första bucket-bilderna.
 *
 * Bakgrund (2026-08-29): Efter 3 dagars felsökning visade det sig att
 * `eventImage` i App.js saknade aspect-lock → på bred web croppades
 * stämpeln (x=800-1000) bort horisontellt. Denna skärm har:
 *   - samma wrapper-storlek som prod-Utforska (maxWidth: 420, height: 280)
 *     så 1:1-jämförelse är möjlig
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
const PREFIX = 'ai-stamped';

// De 10 första bilderna i `ai-stamped/` (alphabetical sort).
//
// Hårdkodade eftersom vi vill verifiera EXAKT dessa — agent API är inte
// alltid tillgängligt och smoke-testet ska vara reproducerbart.
//
// Detta är INTE samma tio som tidigare. De ursprungliga tio blev
// trippel-stämplade under felsökningen 2026-08-29 (tre staplade plattor,
// effektiv opacitet ~0.93) och uteslöts ur `ai-originals/`. Se
// `08-Agent/storage/README-ai-originals.md`.
const FIRST_TEN = [
  { file: 'aaprockyaviciiarena-aviciiarena.png',                                    label: '#1' },
  { file: 'abonnentkonsertstillhetochventyr-.png',                                  label: '#2' },
  { file: 'abonnentkonsertstillhetochventyr-medradiosymfonikernaradiokrenrssland-.png', label: '#3' },
  { file: 'abramisbramamagbootsthehouse-thehouse.png',                              label: '#4' },
  { file: 'abuneinchristvswarhol-sergelstorg.png',                                  label: '#5' },
  { file: 'adamoleniuskollektivetlivet-kollektivetlivet.png',                       label: '#6' },
  { file: 'adelsfestivalen2026adelsfestivalen2026-adelsfestivalen2026.png',         label: '#7' },
  { file: 'admelioraencore-encore.png',                                             label: '#8' },
  { file: 'afrorave-debaserstrand.png',                                             label: '#9' },
  { file: 'afterworkikonstbaren-sergelstorg.png',                                   label: '#10' },
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
            10 första bilderna ur `ai-stamped/`, byggda 2026-08-29.{'\n'}
            Orange "● AI-genererad"-pill ska synas NERE TILL VÄNSTER.{'\n'}
            {'\n'}
            Bilderna visar TVÅ stämplar. Den vänstra är den nya (platta
            0.20 opacitet). Den högra är en legacy-stämpel (0.82) som är
            inbakad i originalen och inte går att ta bort.{'\n'}
            {'\n'}
            Pipeline: ai-originals/ → build_ai_stamped.ts → ai-stamped/.{'\n'}
            Safe-zone: x=24-304, y=740-788 (1024×1024-bild).
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Samma vy som prod-Utforska (width 100%, maxWidth 420, height 280)</Text>
        <Text style={styles.sectionSub}>
          maxWidth 420 → aspect ≤ 1.5:1 → stämpeln (1024-bild x=800-1000, y=740-788) syns.
        </Text>
        {FIRST_TEN.map((item) => (
          <View key={item.file} style={styles.card} testID={`star-card-${item.label}`}>
            <Image
              source={{ uri: imageUrl(item.file) }}
              style={styles.imageProd}
              resizeMode="cover"
              testID={`star-img-${item.label}`}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel}>{item.label}</Text>
              <Text style={styles.cardFile} numberOfLines={1}>{item.file}</Text>
            </View>
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
  imageProd: {
    // Identisk med prod-Utforska `eventImage` (06-UI/App.js:1480):
    //   width: '100%', maxWidth: 420, height: 280, backgroundColor: appBg
    // Håller aspect ≤ 1.5:1 så stämpeln (x=800-1000) inte croppas bort
    // av resizeMode="cover" på bred web/desktop.
    width: '100%',
    maxWidth: 420,
    height: 280,
    backgroundColor: TOKENS.appBg,
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
});
