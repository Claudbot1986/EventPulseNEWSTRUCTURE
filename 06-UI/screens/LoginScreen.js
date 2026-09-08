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

import { signInWithEmail, signInWithApple, AUTH_DEEP_LINK } from '../services/supabaseAuthClient';
import { saveAuthSession } from '../services/storage';

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

export default function LoginScreen({ onCancel, onSuccess }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [appleState, setAppleState] = useState('idle'); // 'idle' | 'signing' | 'error'
  const [appleErrorMsg, setAppleErrorMsg] = useState('');

  const handleSend = useCallback(async () => {
    if (!looksLikeEmail(email)) {
      setState('error');
      setErrorMsg('Ogiltig email — kontrollera stavningen.');
      return;
    }
    setState('sending');
    setErrorMsg('');
    const { error } = await signInWithEmail(email.trim());
    if (error) {
      setState('error');
      setErrorMsg(error);
      return;
    }
    setState('sent');
  }, [email]);

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
      setAppleErrorMsg('Apple Sign In är inte tillgängligt på den här enheten.');
      return;
    }
    if (result.error === 'apple_sign_in_ios_only') {
      setAppleState('error');
      setAppleErrorMsg('Apple Sign In fungerar bara på iOS.');
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
      setAppleErrorMsg(result.error || 'Kunde inte logga in med Apple.');
      return;
    }
    try {
      await saveAuthSession(result.session);
    } catch (_err) {
      // Persistence failed — surface a generic error and let the user retry.
      setAppleState('error');
      setAppleErrorMsg('Kunde inte spara sessionen — försök igen.');
      return;
    }
    if (typeof onSuccess === 'function') {
      onSuccess(result.session);
    }
  }, [onSuccess]);

  const showAppleButton = Platform.OS === 'ios';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Logga in med email</Text>
        <Text style={styles.body}>
          Vi skickar en magisk länk till din email. Klicka på den för att
          logga in — inget lösenord behövs.
        </Text>

        {state === 'sent' ? (
          <View style={styles.sentBox}>
            <Text style={styles.sentTitle}>Kolla din inkorg</Text>
            <Text style={styles.sentBody}>
              Vi har skickat en inloggningslänk till {email.trim()}. Öppna
              länken på samma enhet för att logga in.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={handleChangeEmail}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryLabel}>Använd annan email</Text>
            </Pressable>
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
                  accessibilityLabel="Fortsätt med Apple"
                >
                  {appleState === 'signing' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.appleLabel}>Fortsätt med Apple</Text>
                  )}
                </Pressable>
                {appleState === 'error' && appleErrorMsg ? (
                  <Text style={styles.errorText}>{appleErrorMsg}</Text>
                ) : null}
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>eller</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            ) : null}

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="din@email.com"
              placeholderTextColor="#8A8478"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={state !== 'sending'}
              accessibilityLabel="Email-adress"
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
              accessibilityLabel="Skicka magic link"
            >
              {state === 'sending' ? (
                <ActivityIndicator color="#1A1A1A" />
              ) : (
                <Text style={styles.primaryLabel}>Skicka magic link</Text>
              )}
            </Pressable>

            {typeof onCancel === 'function' ? (
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={onCancel}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryLabel}>Avbryt</Text>
              </Pressable>
            ) : null}

            <Text style={styles.deepLinkHint}>
              Länken öppnar appen via {AUTH_DEEP_LINK}
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