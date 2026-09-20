/**
 * Toast — transient bottom pill (Din helg S2, 2026-09-20).
 *
 * Used for save micro-feedback ("Sparad — vi lär oss din smak"). Fades in,
 * holds two seconds, fades out, then calls onHide so the parent unmounts it.
 * pointerEvents="none" — it never swallows taps. Self-contained styling:
 * the colors mirror App.js TOKENS (accent/accentSoft/text) on purpose so the
 * component stays dependency-free.
 */

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

const HOLD_MS = 2_000;

export default function Toast({ message, onHide }) {
  const opacity = useRef(new Animated.Value(0)).current;
  // onHide can be a fresh closure each render — keep the latest without
  // restarting the animation.
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onHideRef.current?.();
    });
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
    alignItems: 'center',
    backgroundColor: '#332516',
    borderColor: '#FFB454',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  text: {
    color: '#F7F2EA',
    fontSize: 13,
    fontWeight: '600',
  },
});
