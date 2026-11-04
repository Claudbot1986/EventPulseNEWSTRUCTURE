# Event-detalj (DetailsScreen / NewEventCard)

## Sub-features

Öppnas från Hem, Utforska och Karta — **samma** `DetailsScreen` (en komponent i `06-UI/App.js`, det finns ingen `screens/DetailsScreen.js`) med `NewEventCard`. Ingen agent-chattyta monteras.

- Rubrik: kategori-badge, datum/tid (`localTime`) och **plats bara när payloaden har venue/area**. **Rättat 2026-11-04:** sedan `a7e1c0b7` väljer Hem-selecten `venue_full_name` och mappningen är `venue_name || venue_full_name` (`HomeScreen.js:229`); Karta använder samma mappning (`KartaScreen.js:263`). Metaraden visas alltså när raden har venue — det är databeroende, inte strukturellt omöjligt.
- Titel, beskrivning (resolver `06-UI/utils/descriptionFallback.js` föredrar `editorial_description` → prosa; annars "Ingen beskrivning finns från …"), "Läs mer"-knapp (`testID="event-card-read-more"`).
- **Fem action-knappar** i kortets ikonrad:
  - `aria-label="Spara"` — hjärta (♡/♥). Efter tryck blir etiketten **"Ta bort sparning"**.
  - `aria-label="Visa karta"` — 📍. Efter tryck blir etiketten **"Dölj karta"**.
  - `aria-label="Lägg till i kalender"` — ◷
  - `aria-label="Dela"` — ↗
  - `aria-label="Fler alternativ"` — ⋯ (öppnar sheet)
- "Läs mer" **öppnar ticket-URL:en** (`onReadMore={handleOpenUrl}`) — beskrivningen klipps efter 10 rader och expanderas inte.
- Tillbaka: `"< Tillbaka"` (TouchableOpacity utan role/testID — verifierat live 2026-11-04: naket `<div>`, ingen `aria-label`).
- Hero-bilden är låst till **3:2** (`hooks/imageAspectCore.js`); trasig URL ger "EVENT"-placeholder.

## How to get to it (user POV)

Klicka på valfritt eventkort i Hem eller i en kategori i Utforska.

## Driving it with Playwright

Spec: `06-UI/e2e/event-detail-buttons.test.mjs` (3 tester, gröna 2026-11-04).

Nycklar:

- Detaljskärmen känns igen på `data-testid="event-card-read-more"`.
- Kortets egna knappar hittas på `aria-label`: Spara, Visa karta, Lägg till i kalender, Dela, Fler alternativ, Läs mer.
- Tryck sker via pointer-events (`pointerdown` + `pointerup` + `click`) — `.click()` i Playwright triggar inte RNW:s Pressable.
- Knappen "Visa karta" öppnar en modal med en `MapView` → på web renderar shimmen "Kartan är inte tillgänglig på webb".
- Rot-`aria-label` på kortet är `#<id> — <titel> — <datum> — <meta>` (`NewEventCard.js:157-159`) — inte `#<uuid> — <titel> — <meta>`.

Recept: öppna Hem → klicka första kortet → vänta på `event-card-read-more` → tryck varje knapp en i taget → kontrollera att skärmen är kvar och att inga konsolfel uppstår → tryck "Läs mer" → tryck "Tillbaka".

## Gotchas

- **Detaljskärmen var INTE scrollbar (fixat 2026-10-28).** `DetailsScreen` och `NewEventCard` saknade båda `ScrollView`, så allt under skärmkanten (beskrivning, "Läs mer", footer) klipptes bort på native — ingen scroll, ingen väg dit. På webb scrollade *dokumentet* av en tillfällig anledning (`overflow: visible`), vilket gömt felet i webbbygget. Nu ligger kortet i en `ScrollView` (`detailsScroll` + `detailsScrollContent`, `paddingBottom: 96`) på båda plattformar.
- **Tabbarn glidde bort när kortet scrollades (fixat 2026-10-28).** `AppShell.barWrapper` var `position: absolute` utan `position: relative` på en förfader → på webb positionerades den mot initial containing block och **scrollade med dokumentet** (742px → 245px, mitt på skärmen). På webb är den nu `fixed`; native behåller `absolute`.
- **Nested button (fixat 2026-10-28):** kortets rot var ett `Pressable` med `accessibilityRole="button"` utan `onPress` → i webb blev det en tom `<button>` som innehöll de fem action-knapparna + "Läs mer" → "In HTML, `<button>` cannot be a descendant of `<button>`" (hydration error). Fix: roten renderas som `View` när `onPress` saknas.
- **`Marker` var `null` i web-shimmen** → "Element type is invalid … got: null. Check the render method of `MapScreen`" när kartan öppnades. Fix: `Marker` är en no-op-komponent.
- **Hjärtets state är lokal** (`NewEventCard.js:166`) och `saved` skickas aldrig in ⇒ UI:et flippar men **återställs** när kortet avmonteras. **Rättat 2026-11-04:** det är inte "inget persisteras" — `handleSaveToggle` (`App.js:1621`) POSTar `/agent/feedback` och servern skriver en `user_interactions`-rad (`08-Agent/server.ts:871`), som `get_saved_events` läser. Det som saknas är **återhydrering**, inte lagring. Se `save-favorite.md`.
- **"Lägg till i kalender" och "Dela" är INTE native-only. Rättat 2026-11-04:** `expo-calendar` används inte alls i `06-UI`. Kalendern byggs som en `.ics`-URL (`agentClient.js:1418`) och öppnas via `Linking`; på web öppnar RNW `window.open`. `Share.share` mappas till `navigator.share` på web. Båda går alltså att köra — verifiera URL:en/popupen, inte "ingen krasch".
- Etiketterna **muterar**: ♡ → "Ta bort sparning", 📍 → "Dölj karta". Asserta på rätt etikett per steg.
- Dwell ≥3 s registreras när kortet avmonteras.
