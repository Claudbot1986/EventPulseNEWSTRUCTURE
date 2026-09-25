// 06-UI-sandbox/App.js — två sidor: komponentlista + komponent-detalj.
// Sida 1: lista med alla entries i COMPONENT_REGISTRY. Varje rad är en
// länk som öppnar sin komponent på sida 2. Navigation: useState (sandbox-
// konventioner: inga providers, ingen auth, ingen data-state).
//
// När en komponent är klar: kopiera in den i 06-UI/components/ för hand.

import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COMPONENT_REGISTRY } from './components/registry';

function ComponentListItem({ item, onSelect }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onSelect(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Öppna komponent ${item.name}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemDescription}>{item.description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function ComponentDetail({ item, onBack }) {
  const ShowcaseComponent = item.Component;
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.padX}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Tillbaka till komponentlistan"
        >
          <Text style={styles.backText}>‹ Komponenter</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{item.name.toUpperCase()}</Text>
        <View style={styles.showcase}>
          <ShowcaseComponent {...item.sampleProps} />
        </View>
        <Text style={styles.itemDescription}>{item.description}</Text>
      </View>
    </ScrollView>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(null);
  const selectedItem = selectedId
    ? COMPONENT_REGISTRY.find((entry) => entry.id === selectedId)
    : null;

  return (
    <SafeAreaView style={styles.root}>
      {selectedItem ? (
        <ComponentDetail item={selectedItem} onBack={() => setSelectedId(null)} />
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={[styles.eyebrow, styles.padX]}>KOMPONENTER</Text>
          {COMPONENT_REGISTRY.map((item) => (
            <ComponentListItem key={item.id} item={item} onSelect={setSelectedId} />
          ))}
        </ScrollView>
      )}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  screen: {
    // iPhone-status / dynamic island: 20 räcker inte — "KOMPONENTER" / "‹ Komponenter"
    // överlappade klockan. 40 ger andrum under safe-area.
    paddingTop: 40,
    paddingBottom: 48,
    backgroundColor: '#000000',
  },
  padX: {
    paddingHorizontal: 20,
  },
  eyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
  },
  itemName: {
    color: '#F7F2EA',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  itemDescription: {
    color: '#9AA3B5',
    fontSize: 13,
    fontWeight: '200',
    marginTop: 6,
    lineHeight: 18,
  },
  chevron: {
    color: '#727B8D',
    fontSize: 28,
    marginLeft: 12,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 16,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backText: {
    color: '#FFB454',
    fontSize: 14,
    fontWeight: '700',
  },
  showcase: {
    marginTop: 16,
    marginBottom: 8,
  },
});
