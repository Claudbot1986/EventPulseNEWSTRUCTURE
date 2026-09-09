/**
 * AuthReminderModal — Phase 1 retention prompt for email registration.
 *
 * Shown to users who are still on the public anon identity (UserPicker
 * test profile, no Supabase auth session). Per launch-plan user decision
 * (2026-09-06): the popup surfaces after 30 s in-app so it does not
 * interrupt first-impression exploration, and offers a permanent
 * "Påminn mig inte igen" opt-out stored in AsyncStorage.
 *
 * Visibility contract (enforced by AppShell, not by the modal itself):
 *   - User is NOT logged in via Supabase magic link.
 *   - User has not previously dismissed with the checkbox.
 *
 * The modal is purely UI — it does NOT import supabaseAuthClient.
 * AppShell owns auth navigation (the LoginScreen lives in a separate
 * Phase 2 task; today the [Registrera] button calls the supplied
 * `onRegister` callback which AppShell wires to its own flow).
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
  CheckBox,
  Platform,
} from 'react-native';

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
          <Text style={styles.title}>Få en mer personlig upplevelse</Text>
          <Text style={styles.body}>
            Registrera din email så kan vi komma ihåg dina favoriter och
            rekommendera evenemang som passar just dig.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={handleRegister}
            accessibilityRole="button"
            accessibilityLabel="Registrera email"
          >
            <Text style={styles.primaryLabel}>Registrera</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Senare"
          >
            <Text style={styles.secondaryLabel}>Senare</Text>
          </Pressable>

          <View style={styles.optOutRow}>
            {Platform.OS === 'web' ? (
              // CheckBox from react-native-web lacks a stable label slot
              // across versions; use a Pressable+Text row for parity.
              <Pressable
                onPress={() => setPermanently((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: permanently }}
                style={styles.optOutPressable}
              >
                <View style={[styles.checkbox, permanently && styles.checkboxChecked]} />
                <Text style={styles.optOutLabel}>Påminn mig inte igen</Text>
              </Pressable>
            ) : (
              <CheckBox
                value={permanently}
                onValueChange={setPermanently}
                style={styles.checkboxNative}
              />
            )}
            {Platform.OS !== 'web' && (
              <Text style={styles.optOutLabel}>Påminn mig inte igen</Text>
            )}
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
  checkboxNative: {
    width: 18,
    height: 18,
  },
});