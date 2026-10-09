# save-favorite feature

> Stream B.1 (Agent Trust Plan 2026-10-09): feature-as-directory pilot.

## Vad

`save-favorite` är en fristående feature-modul som kapslar in *Spara event*-beteendet:

- API-lagret (toggle-save, läsa sparade, synka till backend)
- UI-lagret (SaveButton-komponent, ikon-toggle, a11y-label)
- Tester (vitest)
- Migration: importera från `06-UI/features/save-favorite/feature.ui` istället för inline-state i `NewEventCard.js`

## Filer

```
features/save-favorite/
├── README.md                ← det här dokumentet
├── feature.api.js           ← save-state API (toggle/get/observe)
├── feature.ui.js            ← SaveButton-komponent
├── feature.test.ts          ← vitest för båda
└── feature.types.ts         ← delade typer (SaveState, SaveResult)
```

## Konvention: feature-as-directory

Pstack-princip om feature-as-directory:
- **Inga rör-orsaker i övriga delar av 06-UI** — NewEventCard, EventPulseSenasteCard, EventPulseCard fortsätter fungera oförändrat via bakåtkompatibla hooks.
- **State är centraliserat** — spara-state lagras i `save-favorite`-modulen, inte duplicerat på flera komponenter.
- **Cross-cutting concerns** (auth, storage, analytics) importeras via befintliga patterns.

## Migration (bakåtkompatibel)

`NewEventCard.js` lämnar vi oförändrad idag. Den använder fortsatt lokalt state + `onSave` callback. Den NYA feature-modulen är ett alternativ för nya consumers:

```javascript
// NY stil (valfritt — antas i nästa PR)
import { SaveButton, useSaveState } from '../features/save-favorite/feature.ui';

function MyNewCard({ eventId }) {
  const { isSaved, toggle } = useSaveState(eventId);
  return <SaveButton isSaved={isSaved} onToggle={toggle} />;
}

// GAMMAL stil (behålls oförändrad)
<NewEventCard onSave={(next) => console.log('saved=', next)} />
```

## Test

`feature.test.ts` är fristående och kan köras med:

```
npx vitest run 06-UI/features/save-favorite/feature.test.ts
```

## Roadmap

- **B.1 idag:** struktur finns. Konsument-migration sker vid nästa save-feature-bug.
- **Senare:** migrera `EventPulseSenasteCard.js`, `DetailsScreen` (om tillämpligt) att använda `useSaveState`.
