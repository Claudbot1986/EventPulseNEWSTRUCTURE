/**
 * MagicLinkHandlerScreen — verifies the OTP and routes the user onward.
 *
 * Why a dedicated screen instead of inline Linking logic:
 *   - Verification has its own loading + error states that deserve a
 *     real surface (a tiny toast is not enough — failed magic links are
 *     the most common Phase 1 auth bug report).
 *   - AppShell can route this screen into the navigation stack on cold
 *     start (when the user opens the deep link with the app killed) and
 *     in-place (when the app is already foregrounded).
 *
 * The screen is rendered with two props by AppShell:
 *   - `url`: the full deep-link URL (e.g. eventpulse://auth/callback?token_hash=...)
 *   - `onSuccess(session)`: persist + flip userState to 'logged_in'.
 *   - `onCancel`: route back to the public surface so the user is never
 *     stuck on this screen if verification fails.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

import {
  parseAuthDeepLink,
  verifyOtpToken,
  setSessionFromTokens,
} from '../services/supabaseAuthClient';
import { useI18n } from '../i18n';

export default function MagicLinkHandlerScreen({ url, onSuccess, onCancel }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('verifying'); // 'verifying' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const run = useCallback(async () => {
    const parsed = parseAuthDeepLink(url);
    if (!parsed) {
      setPhase('error');
      setErrorMsg(t('magicLink.errInvalid'));
      return;
    }

    let session = null;
    let error = null;
    if (parsed.access_token) {
      ({ session, error } = await setSessionFromTokens(parsed.access_token, parsed.refresh_token));
    } else if (parsed.token_hash) {
      ({ session, error } = await verifyOtpToken({
        token_hash: parsed.token_hash,
        type: parsed.type,
      }));
    } else if (parsed.email && parsed.token) {
      ({ session, error } = await verifyOtpToken({
        email: parsed.email,
        token: parsed.token,
      }));
    } else {
      error = t('magicLink.errNoToken');
    }

    if (error || !session) {
      setPhase('error');
      setErrorMsg(error || t('magicLink.errVerify'));
      return;
    }

    if (typeof onSuccess === 'function') {
      onSuccess(session);
    }
  }, [url, onSuccess, t]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <View style={styles.container}>
      {phase === 'verifying' ? (
        <>
          <ActivityIndicator color="#F7F2EA" />
          <Text style={styles.label}>{t('magicLink.verifying')}</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t('magicLink.errTitle')}</Text>
          <Text style={styles.body}>{errorMsg}</Text>
          {typeof onCancel === 'function' ? (
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.primaryLabel}>{t('magicLink.backToApp')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    color: '#CFC9BC',
    marginTop: 12,
    fontSize: 14,
  },
  title: {
    color: '#F7F2EA',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    color: '#CFC9BC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: '#F7F2EA',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  primaryLabel: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});