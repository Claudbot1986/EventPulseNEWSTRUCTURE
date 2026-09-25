// HemStar — retention-optimerad Hem-sektion byggd från grunden (sandbox).
//
// Sandbox-preview av den planerade Hem*-sektionen för 06-UI/. Denna
// komponent demonstrerar:
//
//   - Sektionsordning enligt användarens val 2026-09-25 (Jevs memory_first
//     överskriven — se feedback_fordig_first.md):
//       För dig → Senaste → Ikväll → Helgen → Upptäck
//   - "Senaste" använder EventPulseSenaste (Spotify-stil rail) med en
//     minnesfunktion: klick på Senaste-kort väger ×2 (snabbval) och
//     ökar signal-count → Senaste-railen rangordnas om vid varje klick.
//   - Övriga karuseller använder EventPulseCarousel (kvadrat 150 px).
//   - "Upptäck" = K3 utforskningsreserv (~10% av flödet, opåverkad av
//     smakboost — sandbox: hårdkodad kuraterad shortlist).
//
// Sandbox-mockat: signaler sparas i komponentens lokala useState —
// nollställs vid omladdning. I 06-UI/ ersätts detta av
// `recordEventInteraction` + AsyncStorage-counter (se build-prompt § 5).
// I sandbox-demo kan du klicka Senaste-kort för att se hur rangordningen
// förändras — varje klick flyttar upp det i Senaste-railen.
//
// Respekterar sandbox-regler:
//   - Inga providers, ingen auth, ingen state utanför komponenten.
//   - Inget Supabase-/agent-anrop — sandbox är isolerad labb.
//   - paddingTop: 48 binding (SPACING.md).

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import EventPulseCarousel from './EventPulseCarousel';
import EventPulseSenaste from './EventPulseSenaste';

const TOKENS = {
  color: {
    bg: '#000000',
    eyebrow: '#FFB454',
    title: '#F7F2EA',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    bannerBg: '#1A1108',
    bannerBorder: '#FFB454',
    reset: '#FFB454',
    divider: '#1A1A1A',
  },
  font: {
    eyebrow: { size: 11, weight: '800', letterSpacing: 1.6 },
    title: { size: 28, weight: '900', letterSpacing: -0.8 },
    banner: { size: 12, weight: '500' },
    reset: { size: 11, weight: '700', letterSpacing: 0.6 },
  },
  space: {
    screenTop: 48,
    eyebrowToTitle: 4,
    titleToSubtitle: 8,
    subtitleToBanner: 20,
    bannerToFirst: 24,
    sectionGap: 24,
    padX: 20,
    bannerPad: 14,
    bannerRadius: 10,
  },
};

// Vikter (Jev-granskade 2026-09-25; skillnaden mot 5/3/1 är försumbar):
const W_READ_MORE = 3;
const W_CLICK = 2;
const W_IMPRESSION = 1;

// Hårdkodad rå pool som speglar agent-/feed-svaret. I 06-UI/ ersätts detta
// av /agent/feed?from=today-7d&days=14. Här är det statiskt så sandbox kan
// demonstrera omrangering utan Supabase.
const SENASTE_POOL = [
  { id: 'hemstar-1', title: 'Jazz på Fasching',           subtitle: 'Igår kväll', imageUrl: require('../assets/tile-1.png') },
  { id: 'hemstar-2', title: 'Standup — Norra Bantorget',  subtitle: 'I fredags',  imageUrl: require('../assets/tile-3.png') },
  { id: 'hemstar-3', title: 'Indie på Debaser',           subtitle: 'I söndags',  imageUrl: require('../assets/tile-5.png') },
  { id: 'hemstar-4', title: 'Brunch på Kontrast',         subtitle: 'I lördags',  imageUrl: require('../assets/tile-2.png') },
  { id: 'hemstar-5', title: 'Teater — Gröna Tehuset',     subtitle: 'Två dagar sedan', imageUrl: require('../assets/tile-4.png') },
  { id: 'hemstar-6', title: 'Festival i Tantolunden',     subtitle: 'I fredags',  imageUrl: require('../assets/tile-4.png') },
  { id: 'hemstar-7', title: 'Pubhäng — Pelikan',          subtitle: 'Tre dagar sedan', imageUrl: require('../assets/tile-2.png') },
  { id: 'hemstar-8', title: 'DJ-kväll på Berns',          subtitle: 'I söndags',  imageUrl: require('../assets/tile-5.png') },
];

const IKVALL = [
  { id: 'helg-1', title: 'Konsert på Fasching — jazzkväll',  subtitle: 'Ikväll 19:00', imageUrl: require('../assets/tile-1.png') },
  { id: 'helg-2', title: 'Live på Debaser',                  subtitle: 'Ikväll 20:30', imageUrl: require('../assets/tile-5.png') },
  { id: 'helg-3', title: 'Öppen scen — Södra Teatern',       subtitle: 'Ikväll 21:00', imageUrl: require('../assets/tile-3.png') },
  { id: 'helg-4', title: 'Pubhäng — Pelikan',                subtitle: 'Ikväll 18:00', imageUrl: require('../assets/tile-2.png') },
  { id: 'helg-5', title: 'DJ-kväll på Berns',                subtitle: 'Ikväll 22:00', imageUrl: require('../assets/tile-4.png') },
];

const HELGEN = [
  { id: 'helg-w1', title: 'Brunch på Kontrast',              subtitle: 'Lör 11:00',    imageUrl: require('../assets/tile-2.png') },
  { id: 'helg-w2', title: 'Standup — Norra Bantorget',       subtitle: 'Fre 20:00',    imageUrl: require('../assets/tile-3.png') },
  { id: 'helg-w3', title: 'Festival i Tantolunden',          subtitle: 'Lör 14:00',    imageUrl: require('../assets/tile-4.png') },
  { id: 'helg-w4', title: 'Teater — Gröna Tehuset',          subtitle: 'Sön 18:00',    imageUrl: require('../assets/tile-5.png') },
  { id: 'helg-w5', title: 'Jazz på Stampen',                 subtitle: 'Lör 21:00',    imageUrl: require('../assets/tile-1.png') },
];

const FORDIG = [
  { id: 'dig-1', title: 'Klassiskt — Konserthuset',          subtitle: 'Matchar din smak', imageUrl: require('../assets/tile-1.png') },
  { id: 'dig-2', title: 'Vinbar — Östermalm',                subtitle: 'Populärt i helgen', imageUrl: require('../assets/tile-2.png') },
  { id: 'dig-3', title: 'Konsttur — Moderna',                subtitle: 'Nytt för dig', imageUrl: require('../assets/tile-4.png') },
  { id: 'dig-4', title: 'Löpgrupp — Hagaparken',             subtitle: 'Fri entré', imageUrl: require('../assets/tile-5.png') },
  { id: 'dig-5', title: 'Läsning — Stadsbiblioteket',        subtitle: 'Lugn kväll', imageUrl: require('../assets/tile-3.png') },
];

// K3 utforskningsreserv: opåverkad av smakboost, sandbox-version = en
// kort, bred shortlist som representerar "det du INTE skulle få annars".
// I 06-UI/ tas detta från /agent/feed med lägst score-klientfilter.
const UPPTACK = [
  { id: 'upp-1', title: 'Spelkväll — Rollspelskaféet',       subtitle: 'Bortom din bubbla', imageUrl: require('../assets/tile-3.png') },
  { id: 'upp-2', title: 'Folkmusik — Skansen',               subtitle: 'Bortom din bubbla', imageUrl: require('../assets/tile-4.png') },
  { id: 'upp-3', title: 'Boule — Tantolunden',               subtitle: 'Bortom din bubbla', imageUrl: require('../assets/tile-2.png') },
  { id: 'upp-4', title: 'Bokläsning — Söderbokhandeln',      subtitle: 'Bortom din bubbla', imageUrl: require('../assets/tile-5.png') },
  { id: 'upp-5', title: 'Bridge — BKk Online',               subtitle: 'Bortom din bubbla', imageUrl: require('../assets/tile-1.png') },
];

const SENASTE_LIMIT = 5;
const SCREEN_PADDING = TOKENS.space.padX;

// Score-funktion (pure). Synkad med build-prompt § 5.
function scoreFor(signalsForId) {
  if (!signalsForId) return 0;
  return (
    W_READ_MORE * (signalsForId.readMoreClicks || 0)
  + W_CLICK    * (signalsForId.clicks || 0)
  + W_IMPRESSION * (signalsForId.impressions || 0)
  );
}

function signalCountFor(signals, id) {
  const s = signals[id];
  if (!s) return 0;
  return (s.readMoreClicks || 0) + (s.clicks || 0) + (s.impressions || 0);
}

function HemStar() {
  const [signals, setSignals] = useState({}); // { eventId: { clicks, readMoreClicks, impressions } }

  // Senaste-rail: rangordna pool efter signal-score, ta topp 5.
  // Tom historik (alla scores = 0) ⇒ kallstart-fallback: poolen i
  // ursprunglig ordning. Så användaren ser direkt vad Senaste visar
  // även utan interaktion.
  const senaste = useMemo(() => {
    const ranked = SENASTE_POOL
      .map((event) => ({ ...event, _score: scoreFor(signals[event.id]) }))
      .sort((a, b) => b._score - a._score);
    const top = ranked.slice(0, SENASTE_LIMIT);
    return top.map(({ _score, ...rest }) => rest);
  }, [signals]);

  const totalSignals = useMemo(
    () => Object.values(signals).reduce((acc, s) => acc + signalCountFor(s), 0),
    [signals],
  );

  // Hanterare — håller signals lokalt. I 06-UI/ anropas här
  // recordEventInteraction (best-effort) + AsyncStorage-counter.
  const handleSenasteClick = (event) => {
    setSignals((prev) => ({
      ...prev,
      [event.id]: {
        ...(prev[event.id] || {}),
        clicks: (prev[event.id]?.clicks || 0) + 1,
      },
    }));
  };

  const handleResetSignals = () => setSignals({});

  // Inject onPress på Senaste-kort så minnet faktiskt kan demonstreras.
  // hookas in via wrapper eftersom EventPulseSenaste-komponenten inte
  // propagerar onPress idag (sandbox-ren — håll komponenten smal).
  const senasteWithHandlers = senaste.map((card) => ({
    ...card,
    onPress: () => handleSenasteClick({ id: card.id }),
  }));

  // Root: <View> istället för <ScrollView> — App.js:s ComponentDetail-vy
  // äger redan vertikal scroll, en nested vertikal ScrollView äter
  // gesterna så inget ritas ut (sandbox-fällan 2026-09-25).
  return (
    <View style={styles.scroll} testID="hem-star-screen">
      <Text style={styles.eyebrow}>PERSONLIG HEMSEKTION</Text>
      <Text style={styles.title}>Hem*</Text>
      <Text style={styles.subtitle}>
        Första sektionen är För dig (användarens val 2026-09-25 — Jevs memory_first överskriven, n={totalSignals} signaler just nu).
      </Text>

      <View style={styles.devBanner} accessibilityRole="text" testID="hem-star-banner">
        <Text style={styles.devBannerText}>
          SANDBOX-PREVIEW. Klicka Senaste-kort för att se rangordningen förändras.
          Minne nollställs vid omladdning. ↻ återställer direkt.
        </Text>
      </View>

      <Pressable
        onPress={handleResetSignals}
        accessibilityRole="button"
        accessibilityLabel="Återställ signaler"
        style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
      >
        <Text style={styles.resetText}>↻ Återställ signaler ({totalSignals} st)</Text>
      </Pressable>

      {/* Sektionsordning enligt användarens val 2026-09-25 — Jevs memory_first
          (Senaste först) överskriven. Först = personlig rekommendation,
          sedan Senaste (memory), sedan Ikväll/Helgen, sist K3-reserv. */}
      <EventPulseCarousel headerText="För dig" cards={FORDIG} />

      {/* Senaste-rail med minnesfunktion (×3 read_more / ×2 click / ×1 impression).
          Notera 2026-09-25: "Läs mer"-bandet togs bort på användarens begäran.
          read_more-affordance kan återinföras via en variant av
          EventPulseSenasteCard om/när det behövs — vikten finns kvar i
          scoreFor och aktiveras så snart någon sätter readMoreClicks > 0. */}
      <EventPulseSenaste headerText="Senaste" cards={senasteWithHandlers} />

      {/* Övriga karuseller — samma mönster som 06-UI/components/EventPulseCarousel */}
      <EventPulseCarousel headerText="Ikväll" cards={IKVALL} />
      <EventPulseCarousel headerText="Helgen" cards={HELGEN} />
      <EventPulseCarousel headerText="Upptäck" cards={UPPTACK} />
    </View>
  );
}

// Hjälp-hook för "läs mer" — exporterad så App.js kan trigga readMore-signal
// från en separat knapp om man vill (sandbox-frivilligt).
HemStar.__scoreFor = scoreFor;
HemStar.__SENASTE_POOL_SIZE = SENASTE_POOL.length;
HemStar.__W_READ_MORE = W_READ_MORE;
HemStar.__W_CLICK = W_CLICK;
HemStar.__W_IMPRESSION = W_IMPRESSION;

const styles = StyleSheet.create({
  scroll: {
    paddingTop: TOKENS.space.screenTop,
    paddingBottom: 48,
    paddingHorizontal: TOKENS.space.padX,
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
    marginBottom: TOKENS.space.titleToSubtitle,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: TOKENS.space.subtitleToBanner,
    lineHeight: 18,
  },
  devBanner: {
    backgroundColor: TOKENS.color.bannerBg,
    borderWidth: 1,
    borderColor: TOKENS.color.bannerBorder,
    borderRadius: TOKENS.space.bannerRadius,
    padding: TOKENS.space.bannerPad,
    marginBottom: 16,
  },
  devBannerText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.banner.size,
    fontWeight: TOKENS.font.banner.weight,
    lineHeight: 17,
  },
  resetButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: TOKENS.space.bannerToFirst,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: TOKENS.color.divider,
  },
  resetButtonPressed: {
    opacity: 0.6,
  },
  resetText: {
    color: TOKENS.color.reset,
    fontSize: TOKENS.font.reset.size,
    fontWeight: TOKENS.font.reset.weight,
    letterSpacing: TOKENS.font.reset.letterSpacing,
  },
});

export default HemStar;
