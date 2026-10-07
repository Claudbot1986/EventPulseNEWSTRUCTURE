/**
 * LegalModal — in-app display of privacy policy and terms of service.
 *
 * Why we ship this inside the app (not just a website link):
 *   1. Apple App Store reviewers look for in-app access to legal text.
 *   2. Users on a new install can read the policy BEFORE any signup.
 *   3. Same source of truth pattern: identical content lives on
 *      https://eventpulse.nu/privacy/ and /villkor/ — this modal mirrors it.
 *
 * Content parity:
 *   - SV: mirrors /privacy/ and /villkor/ on eventpulse.nu.
 *   - EN: mirrors /en/privacy/ and /en/terms/.
 *   - IT: same scope, app language drives which one renders.
 *
 * The text is i18n-driven via the keys in i18n/strings/*.js under the `legal.*`
 * namespace. If the website text changes, the in-app text MUST be updated in
 * lockstep — a single source of truth check happens during the launch-readiness
 * audit (see 02-Operations/2026-10-04-Privacy-LAUNCH-Compliance-Plan.md).
 *
 * DRAFT banner:
 *   Every section shows a draft banner until the operator confirms the text
 *   has been reviewed by counsel. The `_legalDraftOnly` i18n key is "1" while
 *   the policy is an AI-draft, "0" once the operator has signed it off.
 *
 * Off-app reference:
 *   The footer always links to the canonical web URL so a reviewer, regulator
 *   or curious user can read the long version with full formatting.
 */

import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
} from 'react-native';

import { useI18n } from '../i18n';

// Mirrors 06-UI/screens/ProfileScreen.js TOKENS — duplicated locally
// to avoid a cross-cutting refactor. If app tokens change, mirror here too.
const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#0B0B0B',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22 },
  radius: { md: 12 },
};

const SECTION_KIND = {
  PRIVACY: 'privacy',
  TERMS: 'terms',
};

/**
 * Canonical web URL per kind — keep in sync with site/_redirects.
 * The app shows these as an off-app "read with full formatting" affordance.
 */
const WEB_URLS = {
  privacy: {
    sv: 'https://eventpulse.nu/privacy/',
    en: 'https://eventpulse.nu/en/privacy/',
    it: 'https://eventpulse.nu/en/privacy/',
  },
  terms: {
    sv: 'https://eventpulse.nu/villkor/',
    en: 'https://eventpulse.nu/en/terms/',
    it: 'https://eventpulse.nu/en/terms/',
  },
};

/**
 * @typedef {object} LegalModalProps
 * @property {boolean} visible
 * @property {'privacy' | 'terms'} kind
 * @property {() => void} onClose
 */

/**
 * @param {LegalModalProps} props
 * @returns {JSX.Element}
 */
export default function LegalModal({ visible, kind, onClose }) {
  const { t, language } = useI18n();

  // Defensive: kind must be a known string. If a parent passes a typo we
  // fall back to privacy rather than rendering nothing — empty modals
  // surprise users.
  const safeKind = kind === SECTION_KIND.TERMS ? SECTION_KIND.TERMS : SECTION_KIND.PRIVACY;

  // The language pick falls back from IT to EN to SV — matches the app's
  // standard i18n fallback chain. The web URL always exists for all three
  // languages because the SV and EN pages exist; IT does not yet have a
  // localised page, so IT users land on the EN version with a notice from
  // the banner copy.
  const webUrl = useMemo(
    () => WEB_URLS[safeKind][language] || WEB_URLS[safeKind].sv,
    [safeKind, language]
  );

  // Pull all section keys for the active kind. The i18n dictionary is flat —
  // we discover sections by iterating a fixed ordered list defined here.
  // Adding a new section requires editing both this array AND the i18n files.
  const sections = useMemo(() => buildSections(safeKind, t), [safeKind, t]);

  const title = t(`legal.${safeKind}.title`);
  const lastUpdated = t(`legal.${safeKind}.lastUpdated`);
  const draftOnly = t('_legalDraftOnly') === '1';

  const openWeb = () => {
    Linking.openURL(webUrl).catch(() => {
      // Best-effort. Silently fail — the in-app text is the canonical read.
    });
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('legal.close')}
            testID="legal-modal-close"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            hitSlop={12}
          >
            <Text style={styles.closeButtonLabel}>{t('legal.close')}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          {/* DRAFT banner — visible while the text is still AI-drafted. */}
          {draftOnly ? (
            <View style={styles.callout}>
              <Text style={styles.calloutTitle}>{t('legal.draftBannerTitle')}</Text>
              <Text style={styles.calloutBody}>{t('legal.draftBannerBody')}</Text>
            </View>
          ) : null}

          <Text style={styles.meta}>
            {t('legal.lastUpdatedLabel')} {lastUpdated}
          </Text>

          {/* Sections */}
          {sections.map((section, idx) => (
            <View key={idx} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.body ? (
                <Text style={styles.sectionBody}>{section.body}</Text>
              ) : null}
              {section.bullets && section.bullets.length > 0 ? (
                <View style={styles.bullets}>
                  {section.bullets.map((bullet, bidx) => (
                    <Text key={bidx} style={styles.bullet}>
                      {'\u2022 '}{bullet}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))}

          {/* Footer: web reference */}
          <View style={styles.footer}>
            <Text style={styles.footerLabel}>{t('legal.readOnWebLabel')}</Text>
            <Pressable
              onPress={openWeb}
              accessibilityRole="link"
              testID="legal-modal-web-link"
            >
              <Text style={styles.footerLink} numberOfLines={1}>
                {webUrl}
              </Text>
            </Pressable>
            <Text style={styles.footerNote}>{t('legal.webMirrorNote')}</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * @param {'privacy' | 'terms'} kind
 * @param {(key: string, vars?: object) => string} t
 * @returns {{ title: string, body?: string, bullets?: string[] }[]}
 */
function buildSections(kind, t) {
  // Ordered list of section ids per kind. The i18n keys MUST exist for every
  // combination. SV is the fallback language in i18n/strings/sv.js.
  const sectionIds =
    kind === SECTION_KIND.TERMS
      ? [
          't1',
          't2',
          't3',
          't4',
          't5',
          't6',
          't7',
          't8',
          't9',
          't10',
          't11',
          't12',
          't13',
          't14',
        ]
      : [
          'p1',
          'p2a',
          'p2b',
          'p2c',
          'p2d',
          'p3',
          'p4',
          'p5',
          'p6',
          'p7',
          'p8',
          'p9',
          'p10',
          'p11',
        ];

  return sectionIds.map((sid) => {
    const title = t(`legal.${kind}.${sid}.title`);
    const body = t(`legal.${kind}.${sid}.body`);
    const bulletsRaw = t(`legal.${kind}.${sid}.bullets`);
    const bullets = bulletsRaw
      ? bulletsRaw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
      : null;
    return { title, body, bullets };
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.md,
    paddingTop: Platform.OS === 'ios' ? 56 : TOKENS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.appBg,
  },
  title: {
    flex: 1,
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '700',
  },
  closeButton: {
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  closeButtonLabel: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  scrollContent: {
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xxl,
  },
  callout: {
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.accent,
    borderRadius: TOKENS.radius.md,
    padding: TOKENS.space.lg,
    marginBottom: TOKENS.space.lg,
  },
  calloutTitle: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
    marginBottom: TOKENS.space.xs,
  },
  calloutBody: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.sm,
    lineHeight: 18,
  },
  meta: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.xl,
  },
  section: {
    marginBottom: TOKENS.space.xl,
  },
  sectionTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
    marginBottom: TOKENS.space.sm,
  },
  sectionBody: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
  },
  bullets: {
    marginTop: TOKENS.space.sm,
  },
  bullet: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
    marginBottom: TOKENS.space.xs,
  },
  footer: {
    marginTop: TOKENS.space.xxl,
    paddingTop: TOKENS.space.lg,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.border,
  },
  footerLabel: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.xs,
  },
  footerLink: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerNote: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    marginTop: TOKENS.space.sm,
    lineHeight: 18,
  },
});

LegalModal.SECTION_KIND = SECTION_KIND;