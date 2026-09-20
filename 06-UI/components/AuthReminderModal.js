/**
 * AuthReminderModal — NOW#2 sync/backup prompt for anonymous guests.
 *
 * Shown to guests on an anonymous Supabase session (bootstrapSession in
 * AppShell): their taste already accumulates server-side, but it is tied
 * to a throwaway identity on THIS device. The pitch is therefore
 * sync/backup — "behåll din smak på alla enheter" — not access.
 * Per launch-plan user decision (2026-09-06): the popup surfaces after
 * 30 s in-app so it does not interrupt first-impression exploration, and
 * offers a permanent "Påminn mig inte igen" opt-out stored in AsyncStorage.
 *
 * Visibility contract (enforced by AppShell, not by the modal itself):
 *   - User is on an ANONYMOUS session (not a permanent magic-link/Apple one).
 *   - User has not previously dismissed with the checkbox.
 *
 * The modal is purely UI — it does NOT import supabaseAuthClient.
 * AppShell owns auth navigation: the primary button calls the supplied
 * `onRegister` callback which AppShell wires to its LoginScreen flow.
 *
 * Styling follows the existing EventPulse palette (warm cream
 * #F7F2EA on dark) so it lands as part of the surface, not a
 * third-party dialog.
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';

import { useI18n } from '../i18n';

/**
 * @typedef {object} AuthReminderModalProps
 * @property {boolean} visible
 * @property {() => void} onRegister
 * @property {(opts?: { permanently?: boolean }) => void} onDismiss
 */

/**
 * Pure-presentational modal. AppShell owns the visibility timer and the
 * "should I show this" check; the modal just renders + emits actions.
 *
 * @param {AuthReminderModalProps} props
 * @returns {JSX.Element}
 */
export default function AuthReminderModal({ visible, onRegister, onDismiss }) {
  const { t } = useI18n();
  const [permanently, setPermanently] = useState(false);

  const handleDismiss = useCallback(() => {
    onDismiss({ permanently });
  }, [onDismiss, permanently]);

  const handleRegister = useCallback(() => {
    onRegister();
  }, [onRegister]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{t('authReminder.title')}</Text>
          <Text style={styles.body}>{t('authReminder.body')}</Text>

          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={handleRegister}
            accessibilityRole="button"
            accessibilityLabel={t('common.addEmail')}
          >
            <Text style={styles.primaryLabel}>{t('common.addEmail')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel={t('authReminder.later')}
          >
            <Text style={styles.secondaryLabel}>{t('authReminder.later')}</Text>
          </Pressable>

          <View style={styles.optOutRow}>
            {/* Custom Pressable row on ALL platforms — CheckBox was removed
                from react-native core (RN 0.86: undefined component → crash
                "Element type is invalid" when this modal first rendered).
                2026-09-13. */}
            <Pressable
              onPress={() => setPermanently((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: permanently }}
              style={styles.optOutPressable}
            >
              <View style={[styles.checkbox, permanently && styles.checkboxChecked]} />
              <Text style={styles.optOutLabel}>{t('authReminder.optOut')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  title: {
    color: '#F7F2EA',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: '#CFC9BC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  primary: {
    backgroundColor: '#F7F2EA',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryLabel: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '700',
  },
  secondary: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryLabel: {
    color: '#CFC9BC',
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.75,
  },
  optOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optOutPressable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optOutLabel: {
    color: '#8A8478',
    fontSize: 13,
    marginLeft: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#8A8478',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    backgroundColor: '#F7F2EA',
    borderColor: '#F7F2EA',
  },
});