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
];
