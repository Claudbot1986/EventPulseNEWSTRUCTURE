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

export const COMPONENT_REGISTRY = [
  {
    id: 'event-pulse-card',
    name: 'EventPulseCard',
    file: 'components/EventPulseCard.js',
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
];
