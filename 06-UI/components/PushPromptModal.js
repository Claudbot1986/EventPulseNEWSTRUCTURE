/**
 * PushPromptModal — pre-permission screen for the weekly Din helg push
 * (S5, 2026-09-20).
 *
 * Shown ONCE after the user's first save (AsyncStorage flag in App.js) per
 * the push research: ask in context with a concrete teaser of what the
 * notification looks like, before burning the one-shot OS permission dialog.
 * Accept → the real OS permission flow runs (pushTokenClient).
 *
 * Renders nothing when `visible` is false. All copy via i18n.
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

import { useI18n } from '../i18n';

const COLORS = {
  backdrop: 'rgba(0, 0, 0, 0.72)',
  card: '#0B0B0B',
  border: '#1A1A1A',
  accent: '#FFB454',
  accentSoft: '#332516',
  primaryLabel: '#1A1206',
  text: '#F7F2EA',
  textMuted: '#A9B0BE',
};

export default function PushPromptModal({ visible, onAccept, onDecline }) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDecline}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="push-prompt-modal">
          <Text style={styles.title}>{t('pushPrompt.title')}</Text>
          <Text style={styles.body}>{t('pushPrompt.body')}</Text>
          <View style={styles.example}>
            <Text style={styles.exampleText}>{t('pushPrompt.example')}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={onAccept}
            accessibilityRole="button"
            testID="push-prompt-accept"
          >
            <Text style={styles.primaryLabel}>{t('pushPrompt.accept')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={onDecline}
            accessibilityRole="button"
            testID="push-prompt-decline"
          >
            <Text style={styles.secondaryLabel}>{t('pushPrompt.decline')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.backdrop,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  example: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    padding: 12,
    marginBottom: 16,
  },
  exampleText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  primary: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryLabel: {
    color: COLORS.primaryLabel,
    fontSize: 15,
    fontWeight: '700',
  },
  secondary: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryLabel: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.8 },
});
