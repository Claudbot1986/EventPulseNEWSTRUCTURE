import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { analyticsClient } from '../services/analyticsClient';

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#15151B',
    border: '#1A1A1A',
    borderStrong: '#3A4254',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#332516',
    positive: '#7FD9A4',
    danger: '#FF7597',
    black: '#000000',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 },
  radius: { sm: 10, md: 16, lg: 22, pill: 999 },
};

/**
 * UserPickerScreen — three fictitious test accounts the user can tap to
 * "log in" with. The chosen account is persisted in AsyncStorage and used
 * as the device_id_hash for analytics events sent to localhost:7778.
 *
 * GDPR consent gate:
 * - The user must explicitly accept "skicka anonym användningsdata till
 *   localhost:7778" before any analytics event leaves the device.
 * - Consent is persisted (analytics.consent = '1') so the gate does not
 *   reappear on subsequent cold starts. Opt-out is handled by
 *   analyticsClient.setOptOut(), callable from ProfileScreen.
 * - Until consent === true, analyticsClient.sessionStart / startFlushLoop
 *   are no-ops even if accidentally called.
 */
export default function UserPickerScreen({ onUserPicked }) {
  const [pickedUser, setPickedUser] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    analyticsClient.getConsent()
      .then((alreadyConsented) => {
        if (cancelled) return;
        setConsentChecked(alreadyConsented);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = (userId) => {
    setPickedUser(userId);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!pickedUser) {
      setError('Välj en testprofil först.');
      return;
    }
    if (!consentChecked) {
      setError('Du måste godkänna datainsamlingen för att fortsätta.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await analyticsClient.setConsent(true);
      await analyticsClient.setActiveUser(pickedUser);
      await analyticsClient.sessionStart(Platform.OS);
      analyticsClient.startFlushLoop();
      onUserPicked(pickedUser);
    } catch (err) {
      const msg = err?.message || 'Något gick fel.';
      setError(msg);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[UserPicker] analytics init error:', msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Välj testprofil</Text>
        <Text style={styles.title}>Vem är du just nu?</Text>
        <Text style={styles.subtitle}>
          Tre fiktiva användare för att testa aktivitetsspårning i
          övervakningsverktyget på port 7778.
        </Text>
      </View>

      <View style={styles.list}>
        {analyticsClient.TEST_USERS.map((user) => {
          const selected = pickedUser === user.id;
          return (
            <TouchableOpacity
              key={user.id}
              style={[styles.card, selected && styles.cardSelected]}
              onPress={() => handlePick(user.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Logga in som ${user.label}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user.id.slice(-1).toUpperCase()}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{user.label}</Text>
                <Text style={styles.cardSub}>{user.sub}</Text>
                <Text style={styles.cardHandle}>@{user.id}</Text>
              </View>
              <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                {selected && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.consentBlock}>
        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => setConsentChecked((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consentChecked }}
          accessibilityLabel="Godkänn att anonym användningsdata skickas till localhost:7778"
        >
          <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
            {consentChecked && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            Jag godkänner att anonym användningsdata (inga personuppgifter,
            inga riktiga id:n — bara en hash och händelser) skickas till
            localhost:7778 för att förbättra appen. Jag kan när som helst
            återkalla samtycket.
          </Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.confirmButton,
            (!pickedUser || !consentChecked || submitting) && styles.confirmButtonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!pickedUser || !consentChecked || submitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Bekräfta val och fortsätt"
        >
          {submitting ? (
            <ActivityIndicator color={TOKENS.color.black} />
          ) : (
            <Text style={styles.confirmButtonText}>Fortsätt</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.footerText}>
          Allt skickas anonymt till localhost:7778 — ingen PII, ingen
          insamling av riktiga uppgifter.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  header: {
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.xl,
    paddingBottom: TOKENS.space.lg,
  },
  kicker: {
    color: TOKENS.color.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: TOKENS.space.sm,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: TOKENS.space.sm,
  },
  list: {
    paddingHorizontal: TOKENS.space.xl,
    gap: TOKENS.space.md,
    paddingTop: TOKENS.space.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.lg,
    paddingVertical: TOKENS.space.lg,
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.lg,
  },
  cardSelected: {
    borderColor: TOKENS.color.accent,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 84, 0.4)',
  },
  avatarText: {
    color: TOKENS.color.accent,
    fontSize: 20,
    fontWeight: '900',
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: TOKENS.color.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardSub: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  cardHandle: {
    color: TOKENS.color.textSoft,
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: TOKENS.radius.pill,
    borderWidth: 2,
    borderColor: TOKENS.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: TOKENS.color.accent,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.accent,
  },
  consentBlock: {
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.lg,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.md,
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    padding: TOKENS.space.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: TOKENS.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: TOKENS.color.accent,
    borderColor: TOKENS.color.accent,
  },
  checkboxTick: {
    color: TOKENS.color.black,
    fontWeight: '900',
    fontSize: 14,
    lineHeight: 16,
  },
  consentText: {
    flex: 1,
    color: TOKENS.color.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: TOKENS.color.danger,
    fontSize: 13,
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.sm,
    textAlign: 'left',
  },
  footer: {
    paddingHorizontal: TOKENS.space.xl,
    paddingVertical: TOKENS.space.lg,
    gap: TOKENS.space.sm,
  },
  confirmButton: {
    backgroundColor: TOKENS.color.accent,
    paddingVertical: TOKENS.space.md,
    borderRadius: TOKENS.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  confirmButtonDisabled: {
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  confirmButtonText: {
    color: TOKENS.color.black,
    fontSize: 15,
    fontWeight: '900',
  },
  footerText: {
    color: TOKENS.color.textSoft,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});