// HemScreen — Hem-sektionen komponerar flera EventPulseCarousel.
//
// Per PLAN_HEM_SECTION.md § Fas 3:
// - 3 karuseller i Jev-prioritering: "Din helg" > "Smak" > "Ikväll"
// - States: default | loading | error | empty
// - Hardkodad data (sandbox) — INTE Supabase
// - paddingTop: 48 binding (SPACING.md § "Page / section top padding")
// - Smak prominent för gästläge (Jev-beslut 2026-09-23)
//
// Props:
//   state         'default' | 'loading' | 'error' | 'empty' (default 'default')
//   showAllStates boolean — sandbox-preview: renderar alla 4 states staplade
//                          med etiketter. Produktion sätter aldrig detta.
//
// Inline-struktur istället för ScrollView: yttre skärm i App.js äger
// vertikal scroll. Horisontell scroll lever inuti varje EventPulseCarousel.

import { StyleSheet, Text, View } from 'react-native';
import EventPulseCarousel from './EventPulseCarousel';

// Tokens (DESIGN_SYSTEM.md binding 2026-09-24).
const TOKENS = {
  color: {
    bg: '#000000',
    eyebrow: '#FFB454',
    title: '#F7F2EA',
    bannerBg: '#15151B',
    bannerText: '#F7F2EA',
    bannerBorder: '#2A2A33',
    errorBg: '#2A1518',
    errorText: '#FF8B7A',
    errorBorder: '#5A2026',
    stateLabel: '#727B8D',
  },
  font: {
    eyebrow: { size: 11, weight: '800', letterSpacing: 1.6 },
    title: { size: 28, weight: '900', letterSpacing: -0.8 },
    banner: { size: 14, weight: '600' },
    stateLabel: { size: 10, weight: '700', letterSpacing: 1.2 },
  },
  space: {
    eyebrowToTitle: 4,
    titleToCarousels: 24,
    screenTop: 48, // binding
    bannerPad: 16,
    stateLabelGap: 8,
    stateGap: 32,
  },
};

// Hardkodade data — sandbox, ingen Supabase. Byts till riktiga adapter-
// anrop när HemScreen flyttas till 06-UI/components/.
const HELG_CARDS = [
  {
    id: 'helg-1',
    title: 'Konsert på Fasching — jazzkväll',
    subtitle: 'Lör',
    imageUrl: require('../assets/tile-1.png'),
  },
  {
    id: 'helg-2',
    title: 'Brunch på Kontrast',
    subtitle: 'Sön',
    imageUrl: require('../assets/tile-2.png'),
  },
  {
    id: 'helg-3',
    title: 'Standup på Norra Bantorget',
    subtitle: 'Fre',
    imageUrl: require('../assets/tile-3.png'),
  },
  {
    id: 'helg-4',
    title: 'Festival i Tantolunden',
    subtitle: 'Lör',
    imageUrl: require('../assets/tile-4.png'),
  },
  {
    id: 'helg-5',
    title: 'Teater — Det Gröna Tehuset',
    subtitle: 'Sön',
    imageUrl: require('../assets/tile-5.png'),
  },
];

const SMAK_CARDS = [
  {
    id: 'smak-1',
    title: 'Jazz & smooth — Fasching, Stampen',
    subtitle: 'Jazz',
    imageUrl: require('../assets/tile-2.png'),
  },
  {
    id: 'smak-2',
    title: 'Indie-kvällar på Debaser',
    subtitle: 'Indie',
    imageUrl: require('../assets/tile-5.png'),
  },
  {
    id: 'smak-3',
    title: 'Standup & skratt — Norra Bantorget',
    subtitle: 'Skratt',
    imageUrl: require('../assets/tile-3.png'),
  },
  {
    id: 'smak-4',
    title: 'Elektroniskt — Slakthusområdet',
    subtitle: 'Dans',
    imageUrl: require('../assets/tile-1.png'),
  },
  {
    id: 'smak-5',
    title: 'Konst & utställning — Moderna',
    subtitle: 'Konst',
    imageUrl: require('../assets/tile-4.png'),
  },
];

const IKVALL_CARDS = [
  {
    id: 'ikvall-1',
    title: 'Live på Debaser',
    subtitle: 'Ikväll',
    imageUrl: require('../assets/tile-1.png'),
  },
  {
    id: 'ikvall-2',
    title: 'Öppen scen — Södra Teatern',
    subtitle: 'Ikväll',
    imageUrl: require('../assets/tile-3.png'),
  },
  {
    id: 'ikvall-3',
    title: 'DJ-kväll på Berns',
    subtitle: 'Ikväll',
    imageUrl: require('../assets/tile-5.png'),
  },
  {
    id: 'ikvall-4',
    title: 'Pubhäng — Pelikan',
    subtitle: 'Ikväll',
    imageUrl: require('../assets/tile-2.png'),
  },
];

function ErrorBanner({ message }) {
  return (
    <View
      style={bannerStyles.errorBanner}
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <Text style={bannerStyles.errorText}>{message}</Text>
    </View>
  );
}

function EmptyBanner({ message }) {
  return (
    <View
      style={bannerStyles.emptyBanner}
      accessibilityRole="text"
      accessibilityLabel={message}
    >
      <Text style={bannerStyles.emptyText}>{message}</Text>
    </View>
  );
}

// Renderar EN state. showAllStates-mode wrappar 4 kopior av detta med labels.
function HemScreenBody({ state }) {
  if (state === 'loading') {
    return (
      <>
        <EventPulseCarousel headerText="Din helg" loading skeletonCount={4} />
        <EventPulseCarousel headerText="Smak" loading skeletonCount={4} />
        <EventPulseCarousel headerText="Ikväll" loading skeletonCount={4} />
      </>
    );
  }

  if (state === 'error') {
    return (
      <ErrorBanner message="Kunde inte ladda händelser. Försök igen om en stund." />
    );
  }

  if (state === 'empty') {
    return (
      <EmptyBanner message="Inga händelser just nu — kolla tillbaka senare." />
    );
  }

  // default
  return (
    <>
      <EventPulseCarousel headerText="Din helg" cards={HELG_CARDS} />
      <EventPulseCarousel headerText="Smak" cards={SMAK_CARDS} />
      <EventPulseCarousel headerText="Ikväll" cards={IKVALL_CARDS} />
    </>
  );
}

function StateLabel({ label }) {
  return <Text style={styles.stateLabel}>{label}</Text>;
}

export default function HemScreen({ state = 'default', showAllStates = false }) {
  if (showAllStates) {
    return (
      <View style={styles.root}>
        <StateLabel label="STATE: DEFAULT" />
        <HemScreenBody state="default" />
        <StateLabel label="STATE: LOADING" />
        <HemScreenBody state="loading" />
        <StateLabel label="STATE: ERROR" />
        <HemScreenBody state="error" />
        <StateLabel label="STATE: EMPTY" />
        <HemScreenBody state="empty" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>Välkommen tillbaka</Text>
      <Text style={styles.title}>Hem</Text>
      <HemScreenBody state={state} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: TOKENS.space.screenTop, // binding SPACING.md
    paddingBottom: 48,
    backgroundColor: TOKENS.color.bg,
  },
  eyebrow: {
    color: TOKENS.color.eyebrow,
    fontSize: TOKENS.font.eyebrow.size,
    fontWeight: TOKENS.font.eyebrow.weight,
    letterSpacing: TOKENS.font.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: TOKENS.space.eyebrowToTitle,
  },
  title: {
    color: TOKENS.color.title,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
    marginBottom: TOKENS.space.titleToCarousels,
  },
  stateLabel: {
    color: TOKENS.color.stateLabel,
    fontSize: TOKENS.font.stateLabel.size,
    fontWeight: TOKENS.font.stateLabel.weight,
    letterSpacing: TOKENS.font.stateLabel.letterSpacing,
    textTransform: 'uppercase',
    marginTop: TOKENS.space.stateGap,
    marginBottom: TOKENS.space.stateLabelGap,
  },
});

const bannerStyles = StyleSheet.create({
  errorBanner: {
    padding: TOKENS.space.bannerPad,
    backgroundColor: TOKENS.color.errorBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: TOKENS.color.errorBorder,
  },
  errorText: {
    color: TOKENS.color.errorText,
    fontSize: TOKENS.font.banner.size,
    fontWeight: TOKENS.font.banner.weight,
  },
  emptyBanner: {
    padding: TOKENS.space.bannerPad,
    backgroundColor: TOKENS.color.bannerBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: TOKENS.color.bannerBorder,
  },
  emptyText: {
    color: TOKENS.color.bannerText,
    fontSize: TOKENS.font.banner.size,
    fontWeight: TOKENS.font.banner.weight,
  },
});
