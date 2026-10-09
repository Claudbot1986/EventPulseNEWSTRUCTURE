/**
 * save-favorite feature — UI-lagret.
 *
 * Stream B.1: feature-as-directory-pilot.
 * Export av SaveButton + helper useSaveState re-export.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useSaveState } from './feature.api';
import { getString } from '../../i18n/strings';

interface SaveButtonProps {
  eventId: string;
  userId?: string | null;
  /** Anpassad färg för sparat-läge (default saffron-orange). */
  savedColor?: string;
  /** Anpassad färg för osparat-läge (default neutral). */
  unsavedColor?: string;
}

export const ICON_SAVE = '☆';
export const ICON_SAVED = '★';

export function SaveButton({ eventId, userId, savedColor, unsavedColor }: SaveButtonProps) {
  const { isSaved, toggle, pending } = useSaveState(eventId, userId);
  const icon = isSaved ? ICON_SAVED : ICON_SAVE;
  const color = isSaved ? (savedColor ?? '#F0B01C') : (unsavedColor ?? '#777');
  const a11y = isSaved
    ? getString('common.unsaveEvent')
    : getString('common.saveEvent');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={toggle}
      disabled={pending}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
    >
      <Text style={[styles.icon, { color }]}>{icon}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 8, paddingVertical: 4 },
  btnPressed: { opacity: 0.6 },
  icon: { fontSize: 22, lineHeight: 26 },
});

export { useSaveState } from './feature.api';
