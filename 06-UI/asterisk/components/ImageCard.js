import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';

export default function ImageCard({ image, onApprove }) {
  const approved = image.approved;

  return (
    <View style={styles.card}>
      <View style={styles.imageWrap}>
        {image.b64 ? (
          <Image
            source={{ uri: `data:image/png;base64,${image.b64}` }}
            style={styles.img}
            resizeMode="cover"
          />
        ) : image.error ? (
          <View style={[styles.img, styles.errorBox]}>
            <Text style={styles.errorText}>{image.error}</Text>
          </View>
        ) : (
          <View style={[styles.img, styles.placeholder]}>
            <Text style={styles.placeholderText}>⏳</Text>
          </View>
        )}

        <View style={styles.badge}>
          <Text style={styles.badgeText}>AI</Text>
        </View>
      </View>

      <Text style={styles.styleLabel} numberOfLines={1}>
        {image.styleLabel}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.actionBtn,
            styles.approveBtn,
            approved === true && styles.approveBtnActive,
          ]}
          onPress={() => onApprove(true)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.actionText,
              approved === true && styles.actionTextActive,
            ]}
          >
            ✓
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionBtn,
            styles.rejectBtn,
            approved === false && styles.rejectBtnActive,
          ]}
          onPress={() => onApprove(false)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.actionText,
              approved === false && styles.actionTextActive,
            ]}
          >
            ✗
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 8,
    marginBottom: 12,
  },
  imageWrap: { position: 'relative' },
  img: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 32, color: '#555' },
  errorBox: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  errorText: { color: '#ff8888', fontSize: 11, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  styleLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 6,
  },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#222',
  },
  approveBtn: {},
  approveBtnActive: { backgroundColor: '#22cc88' },
  rejectBtn: {},
  rejectBtnActive: { backgroundColor: '#cc4444' },
  actionText: { color: '#888', fontSize: 16, fontWeight: '700' },
  actionTextActive: { color: '#000' },
});