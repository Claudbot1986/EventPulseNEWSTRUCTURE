// Component registry — enkel manifestfil för sandbox-komponenter.
// Varje entry beskriver en komponent + hur den ska previewas i list-vyn.
//
// När en ny komponent läggs till i components/:
//   1. Importera den här.
//   2. Lägg till en entry i COMPONENT_REGISTRY med id, name, file,
//      description, Component och sampleProps.
//
// Sandbox-only. Importeras inte av 06-UI/.

import EventPulseCard from './EventPulseCard';
import EventPulseCarousel from './EventPulseCarousel';
import EventPulseSenaste from './EventPulseSenaste';
import HemScreen from './HemScreen';
import HemSupabase from './HemSupabase';

export const COMPONENT_REGISTRY = [
  {
    id: 'event-pulse-card',
    name: 'EventPulseCard',
    description:
      'Återanvändbart kort (bild + titel + subtitle). ' +
      'Opacity 0.7 på press, placeholder när bild saknas.',
    Component: EventPulseCard,
    sampleProps: {
      title: 'Helgens alla händelser i Stockholm',
      subtitle: 'Helg',
      imageSource: require('../assets/tile-1.png'),
    },
  },
  {
    id: 'event-pulse-carousel',
    name: 'EventPulseCarousel',
    description:
      'Horisontell karusell (header + N EventPulseCard). ' +
      'Edge-bleed -20/+20, skeleton-laddning, döljs vid tom data.',
    Component: EventPulseCarousel,
    sampleProps: {
      headerText: 'Tid',
      cards: [
        {
          id: 'helg',
          title: 'Helgens alla händelser',
          subtitle: 'Helg',
          imageUrl: require('../assets/tile-1.png'),
        },
        {
          id: 'ikvall',
          title: 'Ikväll i Stockholm',
          subtitle: 'Ikväll',
          imageUrl: require('../assets/tile-2.png'),
        },
        {
          id: 'gratis',
          title: 'Gratis den här veckan',
          subtitle: 'Gratis',
          imageUrl: require('../assets/tile-3.png'),
        },
        {
          id: 'stamning',
          title: 'Stämningsfullt — lugn, långsam, vacker',
          subtitle: 'Stämningsfullt',
          imageUrl: require('../assets/tile-4.png'),
        },
        {
          id: 'skratt',
          title: 'Skratt — standup & komedi',
          subtitle: 'Skratt',
          imageUrl: require('../assets/tile-5.png'),
        },
      ],
    },
  },
  {
    id: 'hem-screen',
    name: 'HemScreen',
    description:
      'Hem-sektion med 3 karuseller (Din helg > Smak > Ikväll). ' +
      'States: default / loading / error / empty. paddingTop 48 (binding). ' +
      'showAllStates=true visar alla 4 staplade i sandbox-preview.',
    Component: HemScreen,
    sampleProps: {
      showAllStates: true,
    },
  },
  {
    id: 'event-pulse-senaste',
    name: 'EventPulseSenaste',
    description:
      '"Senaste"-sektion med Spotify-stil tiles (kvadratisk 130-bild, ' +
      '14/800 rubrik, 12/500 muted subtitle). Samma edge-bleed/skeleton/' +
      'empty som EventPulseCarousel.',
    Component: EventPulseSenaste,
    sampleProps: {
      headerText: 'Senaste',
      cards: [
        {
          id: 'senaste-1',
          title: 'Peaceful Piano',
          subtitle: 'Spellista • Spotify',
          imageUrl: require('../assets/tile-1.png'),
        },
        {
          id: 'senaste-2',
          title: 'Creative Flow',
          subtitle: 'Spellista • hayes',
          imageUrl: require('../assets/tile-2.png'),
        },
        {
          id: 'senaste-3',
          title: 'Från Victoria',
          subtitle: 'Spellista',
          imageUrl: require('../assets/tile-3.png'),
        },
        {
          id: 'senaste-4',
          title: 'Gillade låtar',
          subtitle: 'Spellista • Spotify',
          imageUrl: require('../assets/tile-4.png'),
        },
        {
          id: 'senaste-5',
          title: 'Indie Mix 2026',
          subtitle: 'Spellista',
          imageUrl: require('../assets/tile-5.png'),
        },
      ],
    },
  },
  {
    id: 'hem-supabase',
    name: 'Hem-supabase',
    description:
      'Sandbox-version av Hem* med RIKTIGA Supabase-data (events_public view). ' +
      'Spegel av hur Hem* i 06-UI ska se ut — samma 5 sektioner i ordning ' +
      'För dig → Senaste → Ikväll → Helgen → Upptäck, samma minnes-funktion. ' +
      'Konfig: 06-UI-sandbox/.env måste ha EXPO_PUBLIC_SUPABASE_URL/ANON_KEY.',
    Component: HemSupabase,
    sampleProps: {},
  },
];
