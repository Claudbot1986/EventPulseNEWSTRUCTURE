import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

/**
 * Horisontell chip-lista. Förväntar events med:
 *   { id, title_sv | title, venue_name | venue, category_slug | category }
 */
export default function EventPicker({ events, selected, onSelect }) {
  if (!events || events.length === 0) {
    return (
      <Text style={styles.empty}>
        Inga events att visa — kontrollera att Supabase returnerar data.
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {events.map(ev => {
        const active = selected?.id === ev.id;
        const title = ev.title_sv || ev.title || 'Titel saknas';
        const venue = ev.venue_name || ev.venue || 'Plats ej angiven';
        return (
          <TouchableOpacity
            key={ev.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(ev)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text
              style={[styles.chipSub, active && styles.chipSubActive]}
              numberOfLines={1}
            >
              {venue}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingRight: 16 },
  empty: { color: '#888', fontSize: 13, paddingVertical: 12 },
  chip: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 140,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#aaa', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#000' },
  chipSub: { color: '#666', fontSize: 11, marginTop: 2 },
  chipSubActive: { color: '#444' },
});