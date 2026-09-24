// 06-UI-sandbox/App.js — minimal stub som visar 4 tabs (Hem / Utforska /
// Karta / Profil) med karusell-sektionen som första synliga komponent.
// När du bygger nya UI-komponenter lägger du dem under ./components och
// importerar dem här.
//
// Designprinciper för sandbox:
//  - Inga providers, ingen auth, inga services, inga riktiga event-data.
//  - Sektioner = helt svarta Views, så layout-buggar syns mot bakgrunden.
//  - AI-genererade bilder (BFL/FLUX) stämplas med "● AI-genererad" via
//    scripts/stamp-tiles.mjs. Källfilerna är numera runtime/ai-image-
//    smoketest/images/ — tmp/explore-tiles/ används inte längre.
//  - Ingen Zustand/Redux/React Query. Använd useState om du behöver state.
//
// När en komponent är klar: kopiera in den i 06-UI/components/ för hand.
// Sandboxen har INGEN build-pipeline som rör 06-UI/.

import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import EventPulseCard from './components/EventPulseCard';
import { COMPONENT_REGISTRY } from './components/registry';

const TABS = [
  { key: 'home', label: 'Hem' },
  { key: 'explore', label: 'Utforska' },
  { key: 'map', label: 'Karta' },
  { key: 'profile', label: 'Profil' },
];

function TabBar({ active, onChange }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tabbar">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Screen({ tabKey }) {
  const label = TABS.find((t) => t.key === tabKey)?.label ?? '';

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>SANDBOX</Text>
      <Text style={styles.title}>{label}</Text>

      {/* EventPulseCard showcase (fas 1 av PLAN_HEM_SECTION.md). Tre
          instanser sida vid sida — testar require-bild, annan require-bild
          och ingen-bild → placeholder.
          Clip + edge-bleed (marginHorizontal: -20, height 166, overflow
          hidden) är carousel-nivå, inte kort-nivå — fas 2 (EventPulseCarousel)
          äger detta mönster. */}
      <Text style={styles.eventPulseCardEyebrow}>EVENTPULSECARD</Text>
      <View style={styles.eventPulseCardClip}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.eventPulseCardRow}
        >
          <EventPulseCard
            title="Helgens alla händelser i Stockholm"
            subtitle="Helg"
            imageSource={require('./assets/tile-1.png')}
          />
          <EventPulseCard
            title="Konserter, teater och barhäng ikväll"
            subtitle="Ikväll"
            imageSource={require('./assets/tile-3.png')}
          />
          <EventPulseCard
            title="Gratis event denna vecka — utforska utan att spendera"
            subtitle="Gratis"
          />
        </ScrollView>
      </View>

      {/* Helt svarta sektioner — buggar i spacing/layout syns mot #000. */}
      <View style={styles.blackSection} />
      <View style={styles.blackSectionShort} />

      {/* Komponent-lista (option A). Visar varje komponent i sandboxen med
          namn, filsökväg, beskrivning och en rendered preview.
          Driven av COMPONENT_REGISTRY — när nya komponenter läggs till i
          components/ dyker de automatiskt upp här. */}
      <Text style={styles.componentsEyebrow}>KOMPONENTER</Text>
      {COMPONENT_REGISTRY.map((item) => {
        const Preview = item.Component;
        return (
          <View key={item.id} style={styles.componentItem}>
            <Text style={styles.componentName}>{item.name}</Text>
            <Text style={styles.componentFile}>{item.file}</Text>
            <Text style={styles.componentDescription}>{item.description}</Text>
            <View style={styles.componentPreview}>
              <Preview {...item.sampleProps} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <SafeAreaView style={styles.root}>
      <Screen tabKey={activeTab} />
      <TabBar active={activeTab} onChange={setActiveTab} />
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
    padding: 20,
    gap: 16,
    backgroundColor: '#000000',
  },
  eyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: '#F7F2EA',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  blackSection: {
    height: 96,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#0A0A0A',
  },
  blackSectionShort: {
    height: 48,
    backgroundColor: '#000000',
  },
  eventPulseCardEyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 16,
  },
  eventPulseCardRow: {
    paddingHorizontal: 20,
    gap: 16,
  },
  eventPulseCardClip: {
    marginHorizontal: -20,
    height: 166,
    overflow: 'hidden',
  },
  componentsEyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 24,
  },
  componentItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  componentName: {
    color: '#F7F2EA',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  componentFile: {
    color: '#727B8D',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: 'Courier',
  },
  componentDescription: {
    color: '#9AA3B5',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    lineHeight: 18,
  },
  componentPreview: {
    marginTop: 12,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    backgroundColor: '#000000',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabLabel: {
    color: '#727B8D',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tabLabelActive: {
    color: '#FFB454',
  },
});