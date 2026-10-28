# Event-detalj (DetailsScreen / NewEventCard)

## Sub-features

Öppnas från Hem, Utforska, Karta och agent-chattens rekommendationer — **samma** `DetailsScreen` (`06-UI/App.js`) med `NewEventCard`.

- Rubrik: kategori-badge, datum/tid (`localTime`), plats.
- Titel, beskrivning (eller "Ingen beskrivning finns från …"), "Läs mer"-knapp (`testID="event-card-read-more"`).
- **Fem action-knappar** i kortets ikonrad:
  - `aria-label="Spara"` — hjärta (♡/♥)
  - `aria-label="Visa karta"` — 📍
  - `aria-label="Lägg till i kalender"` — ◷
  - `aria-label="Dela"` — ↗
  - `aria-label="Fler alternativ"` — ⋯ (öppnar sheet)
- "Läs mer" expanderar beskrivningen.
- Tillbaka: `"< Tillbaka"` (TouchableOpacity utan role/testID).

## How to get to it (user POV)

Klicka på valfritt eventkort i Hem eller i en kategori i Utforska.

## Driving it with Playwright

Spec: `06-UI/e2e/event-detail-buttons.test.mjs`.

Nycklar:

- Detaljskärmen känns igen på `data-testid="event-card-read-more"`.
- Kortets egna knappar hittas på `aria-label`: Spara, Visa karta, Lägg till i kalender, Dela, Fler alternativ, Läs mer.
- Tryck sker via pointer-events (`pointerdown` + `pointerup` + `click`) — `.click()` i Playwright triggar inte RNW:s Pressable.
- Knappen "Visa karta" öppnar en modal med en `MapView` → på web renderar shimmen "Kartan är inte tillgänglig på webb".

Recept: öppna Hem → klicka första kortet → vänta på `event-card-read-more` → tryck varje knapp en i taget → kontrollera att skärmen är kvar och att inga konsolfel uppstår → tryck "Läs mer" → tryck "Tillbaka".

## Gotchas

- **Detaljskärmen var INTE scrollbar (fixat 2026-10-28).** `DetailsScreen` och `NewEventCard` saknade båda `ScrollView`, så allt under skärmkanten (beskrivning, "Läs mer", footer) klipptes bort på native — ingen scroll, ingen väg dit. På webb scrollade *dokumentet* av en tillfällig anledning (`overflow: visible`), vilket gömt felet i webbbygget. Nu ligger kortet i en `ScrollView` (`detailsScroll` + `detailsScrollContent`, `paddingBottom: 96`) på båda plattformar.
- **Tabbarn glidde bort när kortet scrollades (fixat 2026-10-28).** `AppShell.barWrapper` var `position: absolute` utan `position: relative` på en förfader → på webb positionerades den mot initial containing block och **scrollade med dokumentet** (742px → 245px, mitt på skärmen). På webb är den nu `fixed`; native behåller `absolute`.
- **Nested button (fixat 2026-10-28):** kortets rot var ett `Pressable` med `accessibilityRole="button"` utan `onPress` → i webb blev det en tom `<button>` som innehöll de fem action-knapparna + "Läs mer" → "In HTML, `<button>` cannot be a descendant of `<button>`" (hydration error). Fix: roten renderas som `View` när `onPress` saknas.
- **`Marker` var `null` i web-shimmen** → "Element type is invalid … got: null. Check the render method of `MapScreen`" när kartan öppnades. Fix: `Marker` är en no-op-komponent.
- **Spara/♡ persisterar ingenting** på detaljskärmen: `NewEventCard.js` håller `useState(Boolean(saved))` och `saved` skickas aldrig in. Hjärtet är en bild i skärmminnet. Se `save-favorite.md`.
- "Lägg till i kalender" och "Dela" är **native-only** (expo-calendar / native share) → på web kan de bara verifieras som "ingen krasch".
- Kortets rot-`aria-label` innehåller `#<uuid> — <titel> — <meta>`.
