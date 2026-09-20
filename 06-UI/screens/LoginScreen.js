/**
 * LoginScreen — Phase 1 email-link (magic link) + Apple Sign In entry point.
 *
 * Magic-link flow:
 *   1. User enters email → tap "Skicka magic link"
 *   2. supabaseAuth.signInWithOtp sends an email with a deep link to
 *      eventpulse://auth/callback?token_hash=...&type=magiclink
 *   3. User opens the link on the same device (or scans a QR on desktop)
 *   4. AppShell's Linking listener (see MagicLinkHandlerScreen below)
 *      picks up the URL, verifies the OTP, and routes the user back to
 *      the app — already signed in.
 *
 * Apple Sign In flow (Fas 2.5, iOS-only — App Store §4.8):
 *   1. User taps "Fortsätt med Apple" (iOS-only).
 *   2. expo-apple-authentication opens the native Apple Sign In sheet.
 *   3. The identity_token + full_name are POSTed to /agent/auth/apple,
 *      which delegates JWT verification to Supabase.
 *   4. The resolved session is saved via the same saveAuthSession path
 *      as magic-link, then onSuccess(session) is invoked.
 *
 * This screen owns the *send* side only; the verify side lives in
 * MagicLinkHandlerScreen so we can unit-test the parsing logic
 * separately from React.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';

import { signInWithEmail, signInWithApple, authRedirectTo } from '../services/supabaseAuthClient';
import { saveAuthSession } from '../services/storage';
import { useI18n } from '../i18n';

/**
 * Looser-than-RFC email check; Supabase does the authoritative
 * validation server-side. We just want to catch obvious typos
 * (`asdf`, empty string, missing `@`) so the user gets feedback
 * before burning a Supabase rate-limited OTP send.
 */
function looksLikeEmail(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  // One '@', non-empty local part, non-empty domain, at least one dot.
  const at = trimmed.indexOf('@');
  if (at < 1 || at !== trimmed.lastIndexOf('@')) return false;
  const domain = trimmed.slice(at + 1);
  if (domain.length < 3 || !domain.includes('.')) return false;
  return true;
}

export default function LoginScreen({ onCancel, onSuccess, onEmailSent }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  // NOW#3: 'link' = the email will be attached to the current anonymous
  // guest account (same user.id, taste follows); 'signin' = classic login.
  const [sentMode, setSentMode] = useState('signin');
  const [appleState, setAppleState] = useState('idle'); // 'idle' | 'signing' | 'error'
  const [appleErrorMsg, setAppleErrorMsg] = useState('');

  const handleSend = useCallback(async () => {
    if (!looksLikeEmail(email)) {
      setState('error');
      setErrorMsg(t('login.invalidEmail'));
      return;
    }
    setState('sending');
    setErrorMsg('');
    const { error, mode } = await signInWithEmail(email.trim());
    if (error) {
      setState('error');
      setErrorMsg(error);
      return;
    }
    setSentMode(mode);
    // Primary path (2026-09-20): hand off to the 6-digit code entry screen
    // via AppShell — the typed code is Hotmail-SafeLinks-proof, unlike the
    // link. The 'sent' box below stays as a defensive fallback for any host
    // that does not pass onEmailSent.
    if (typeof onEmailSent === 'function') {
      onEmailSent(email.trim(), mode);
      return;
    }
    setState('sent');
  }, [email, onEmailSent, t]);

  const handleChangeEmail = () => {
    setState('idle');
    setErrorMsg('');
  };

  const handleApple = useCallback(async () => {
    setAppleState('signing');
    setAppleErrorMsg('');
    const result = await signInWithApple();
    if (result.error === 'apple_sign_in_unavailable') {
      setAppleState('error');
      setAppleErrorMsg(t('login.appleUnavailable'));
      return;
    }
    if (result.error === 'apple_sign_in_ios_only') {
      setAppleState('error');
      setAppleErrorMsg(t('login.appleIosOnly'));
      return;
    }
    if (result.user_cancelled) {
      // Cancellation is not an error — leave the screen in its current state.
      setAppleState('idle');
      setAppleErrorMsg('');
      return;
    }
    if (result.error || !result.session) {
      setAppleState('error');
      setAppleErrorMsg(result.error || t('login.appleFailed'));
      return;
    }
    try {
      await saveAuthSession(result.session);
    } catch (_err) {
      // Persistence failed — surface a generic error and let the user retry.
      setAppleState('error');
      setAppleErrorMsg(t('login.sessionSaveFailed'));
      return;
    }
    if (typeof onSuccess === 'function') {
      onSuccess(result.session);
    }
  }, [onSuccess, t]);

  const showAppleButton = Platform.OS === 'ios';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('login.title')}</Text>
        <Text style={styles.body}>{t('login.body')}</Text>

        {state === 'sent' ? (
          <View style={styles.sentBox}>
            <Text style={styles.sentTitle}>{t('login.sentTitle')}</Text>
            <Text style={styles.sentBody}>
              {sentMode === 'link'
                ? t('login.sentBodyLink', { email: email.trim() })
                : t('login.sentBodySignin', { email: email.trim() })}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={handleChangeEmail}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryLabel}>{t('login.useOtherEmail')}</Text>
            </Pressable>
            {/* Exit affordance: without this the sent state is a dead end —
                the only way out was force-closing the app (discovered live
                2026-09-20). Mirrors the Avbryt guard below. */}
            {typeof onCancel === 'function' ? (
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={onCancel}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryLabel}>{t('common.close')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {showAppleButton ? (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.appleButton,
                    (pressed || appleState === 'signing') && styles.pressed,
                  ]}
                  onPress={handleApple}
                  disabled={appleState === 'signing'}
                  accessibilityRole="button"
                  accessibilityLabel={t('login.appleContinue')}
                >
                  {appleState === 'signing' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.appleLabel}>{t('login.appleContinue')}</Text>
                  )}
                </Pressable>
                {appleState === 'error' && appleErrorMsg ? (
                  <Text style={styles.errorText}>{appleErrorMsg}</Text>
                ) : null}
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>{t('login.or')}</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            ) : null}

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('login.emailPlaceholder')}
              placeholderTextColor="#8A8478"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={state !== 'sending'}
              accessibilityLabel={t('login.emailA11y')}
              onSubmitEditing={handleSend}
              returnKeyType="send"
            />

            {state === 'error' && errorMsg ? (
              <Text style={styles.errorText}>{errorMsg}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.primary,
                (pressed || state === 'sending') && styles.pressed,
              ]}
              onPress={handleSend}
              disabled={state === 'sending'}
              accessibilityRole="button"
              accessibilityLabel={t('login.sendMagicLink')}
            >
              {state === 'sending' ? (
                <ActivityIndicator color="#1A1A1A" />
              ) : (
                <Text style={styles.primaryLabel}>{t('login.sendMagicLink')}</Text>
              )}
            </Pressable>

            {typeof onCancel === 'function' ? (
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={onCancel}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryLabel}>{t('common.cancel')}</Text>
              </Pressable>
            ) : null}

            {/* Dev/teknisk hint: visar exakt vart mejlets länk pekar i just
                den här miljön (exp:// i Expo Go, https-sidan i byggda appar). */}
            <Text style={styles.deepLinkHint}>
              {t('login.linkLandsAt', { url: authRedirectTo() })}
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scroll: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    color: '#F7F2EA',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  body: {
    color: '#CFC9BC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F7F2EA',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 12,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    marginBottom: 12,
  },
  primary: {
    backgroundColor: '#F7F2EA',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryLabel: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '700',
  },
  appleButton: {
    backgroundColor: '#000000',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F7F2EA',
  },
  appleLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  dividerLabel: {
    color: '#8A8478',
    fontSize: 12,
    marginHorizontal: 12,
  },
  secondary: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryLabel: {
    color: '#CFC9BC',
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.75,
  },
  deepLinkHint: {
    color: '#5C5852',
    fontSize: 11,
    marginTop: 16,
    textAlign: 'center',
  },
  sentBox: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  sentTitle: {
    color: '#F7F2EA',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  sentBody: {
    color: '#CFC9BC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
});