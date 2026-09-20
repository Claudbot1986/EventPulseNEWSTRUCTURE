/**
 * CodeEntryScreen — 6-digit email-code entry, the PRIMARY login path.
 *
 * Why this exists (2026-09-20): Hotmail/Outlook SafeLinks prefetches
 * single-use magic links at delivery and burns the token before the user
 * taps — the user lands on "ogiltig länk" through no fault of the app.
 * A typed code is immune to mail scanners, needs no web hop, and behaves
 * identically in Expo Go / TestFlight / App Store. The magic link stays in
 * the email as a small fallback; MagicLinkHandlerScreen keeps handling it.
 *
 * Input architecture: a single hidden, transparent TextInput laid over six
 * styled boxes. This gets number-pad keyboard, iOS oneTimeCode autofill,
 * paste-distributes-digits and backspace navigation from the platform for
 * free, while the boxes render purely from one immutable string — no
 * per-box state to keep in sync (repo immutability rule).
 *
 * Props mirror MagicLinkHandlerScreen's contract so AppShell can treat the
 * two auth screens identically:
 *   - `email`: the address the code was sent to (displayed to the user).
 *   - `mode`: 'signin' | 'link' — decides GoTrue's verify type
 *     ('email' vs 'email_change') inside verifyEmailOtpCode.
 *   - `onSuccess(session)`: persist + flip userState (AppShell-owned).
 *   - `onCancel`: return to the login screen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  normalizeEmailCode,
  signInWithEmail,
  verifyEmailOtpCode,
} from '../services/supabaseAuthClient';
import { useI18n } from '../i18n';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 60;

function errorMessageFor(t, key) {
  switch (key) {
    case 'expired_or_invalid_code':
      return t('codeEntry.errInvalid');
    case 'rate_limited':
      return t('codeEntry.errRateLimited');
    case 'timeout':
      return t('codeEntry.errTimeout');
    default:
      return t('codeEntry.errGeneric');
  }
}

export default function CodeEntryScreen({ email, mode = 'signin', onSuccess, onCancel }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState('idle'); // 'idle' | 'verifying' | 'error' | 'success'
  const [errorMsg, setErrorMsg] = useState('');
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_S);
  const [resendState, setResendState] = useState('idle'); // 'idle' | 'sending' | 'error'
  const [resendError, setResendError] = useState('');
  const [currentMode, setCurrentMode] = useState(mode);

  const inputRef = useRef(null);
  const shake = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(null);

  // Resend countdown. A fresh code just arrived when the screen mounts, so
  // the cooldown starts ticking immediately.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => () => {
    if (shakeAnim.current) shakeAnim.current.stop();
  }, [shakeAnim]);

  const runShake = useCallback(() => {
    shake.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]);
    shakeAnim.current = anim;
    anim.start();
  }, [shake]);

  const submit = useCallback(async (rawCode) => {
    const normalized = normalizeEmailCode(rawCode);
    const { session, error } = await verifyEmailOtpCode(email, normalized, currentMode);
    if (error || !session) {
      setPhase('error');
      setErrorMsg(errorMessageFor(t, error));
      runShake();
      setCode('');
      setPhase('idle');
      return;
    }
    setPhase('success');
    if (typeof onSuccess === 'function') {
      onSuccess(session);
    }
  }, [email, currentMode, onSuccess, runShake, t]);

  // Auto-submit as soon as the sixth digit lands.
  useEffect(() => {
    if (phase === 'idle' && normalizeEmailCode(code).length === CODE_LENGTH) {
      setPhase('verifying');
      submit(code);
    }
  }, [code, phase, submit]);

  const handleChange = useCallback((text) => {
    setErrorMsg('');
    setCode(normalizeEmailCode(text));
  }, []);

  const handleResend = useCallback(async () => {
    if (resendIn > 0 || resendState === 'sending') return;
    setResendState('sending');
    setResendError('');
    const { error, mode: newMode } = await signInWithEmail(email);
    if (error) {
      setResendState('error');
      setResendError(error === 'timeout'
        ? t('codeEntry.resendTimeout')
        : t('codeEntry.resendFailed'));
      return;
    }
    // Server may have flipped mode (e.g. address turned out to be taken) —
    // the next verification must use the type the server actually sent.
    setCurrentMode(newMode);
    setResendState('idle');
    setResendIn(RESEND_COOLDOWN_S);
  }, [resendIn, resendState, email, t]);

  const focusInput = useCallback(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const boxes = [];
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const filled = i < code.length;
    const isActive = i === code.length && phase === 'idle';
    boxes.push(
      <View
        key={i}
        style={[
          styles.digitBox,
          filled && styles.digitBoxFilled,
          isActive && styles.digitBoxActive,
          phase === 'error' && styles.digitBoxError,
          phase === 'success' && styles.digitBoxSuccess,
        ]}
      >
        <Text style={styles.digit}>{filled ? code[i] : ''}</Text>
      </View>
    );
  }

  const busy = phase === 'verifying';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>{t('codeEntry.title')}</Text>
        <Text style={styles.body}>
          {t('codeEntry.body', { email })}
          {currentMode === 'link' ? t('codeEntry.bodyLinkSuffix') : ''}
        </Text>

        <Pressable onPress={focusInput} accessibilityLabel={t('codeEntry.boxesA11y')} accessibilityRole="none">
          <Animated.View
            style={[styles.boxRow, { transform: [{ translateX: shake }] }]}
            pointerEvents="none"
          >
            {boxes}
          </Animated.View>
          <TextInput
            ref={inputRef}
            style={styles.hiddenInput}
            value={code}
            onChangeText={handleChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            maxLength={CODE_LENGTH}
            caretHidden
            editable={!busy && phase !== 'success'}
            accessibilityLabel={t('codeEntry.inputA11y')}
          />
        </Pressable>

        {busy ? <Text style={styles.status}>{t('codeEntry.verifying')}</Text> : null}
        {phase === 'success' ? <Text style={styles.statusSuccess}>{t('codeEntry.success')}</Text> : null}
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.secondary,
            (pressed || resendIn > 0 || resendState === 'sending') && styles.dimmed,
          ]}
          onPress={handleResend}
          disabled={resendIn > 0 || resendState === 'sending'}
          accessibilityRole="button"
          accessibilityLabel={t('codeEntry.resendA11y')}
        >
          <Text style={styles.secondaryLabel}>
            {resendState === 'sending'
              ? t('codeEntry.resendSending')
              : resendIn > 0
                ? t('codeEntry.resendCooldown', { seconds: resendIn })
                : t('codeEntry.resend')}
          </Text>
        </Pressable>
        {resendError ? <Text style={styles.errorText}>{resendError}</Text> : null}

        <Text style={styles.hint}>{t('codeEntry.linkHint')}</Text>

        {typeof onCancel === 'function' ? (
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={onCancel}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryLabel}>{t('codeEntry.changeEmail')}</Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#F7F2EA',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: '#CFC9BC',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 32,
    maxWidth: 340,
  },
  boxRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  digitBox: {
    width: 48,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitBoxFilled: {
    borderColor: '#F7F2EA',
  },
  digitBoxActive: {
    borderColor: '#F7F2EA',
    borderWidth: 2,
  },
  digitBoxError: {
    borderColor: '#FF6B6B',
  },
  digitBoxSuccess: {
    borderColor: '#7CC98F',
  },
  digit: {
    color: '#F7F2EA',
    fontSize: 24,
    fontWeight: '700',
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
  status: {
    color: '#8A8478',
    fontSize: 14,
    marginBottom: 16,
  },
  statusSuccess: {
    color: '#7CC98F',
    fontSize: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 340,
  },
  secondary: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  secondaryLabel: {
    color: '#CFC9BC',
    fontSize: 14,
    fontWeight: '500',
  },
  dimmed: {
    opacity: 0.5,
  },
  hint: {
    color: '#5C5852',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
});
