# Karta

## Sub-features

- Fliken "Karta" visar Stockholmskartan med eventmarkörer, räknare ("Idag · 881", "Helgen · 883", "Alla · 3500"), ett TOTAL/VISIBLE-metrorum och filterlägen.
- Under/över kartan läggs en **hit-detection-overlay** med en osynlig `Pressable` per marker (`testID="marker-hit-<event-id>"`), max 80 st. Overlayen renderas även på web — ett osynligt tryck kan därför öppna `MapEventCard` där.
- `MapView` + `Marker` kommer från `react-native-maps` → **native-only**. På web renderar shimmen en panel: "Kartan är inte tillgänglig på webb / Öppna appen i Expo Go för full kartvy."
- `MapEventCard` (radlistan under kartan) visas när en marker/overlay trycks; "Läs mer" öppnar samma detaljskärm som Hem.

## How to get to it (user POV)

Klicka "Karta" i bottenstaplen.

## Driving it with Playwright

Spec: `06-UI/e2e/app-tabs.test.mjs` (fliken "Karta" täcks av fliktestet). Full kartverifiering är **verified-unreachable på web**.

Recept (webb):

1. Klicka fliken "Karta".
2. Vänta på texten "Kartan är inte tillgänglig på webb".
3. Assera att **inga** fel kastas (`pageerror` ska vara tomt) och att räknarna visas ("Idag ·", "Helgen ·", "Alla ·").
4. Markör-overlayen renderas även på web (`marker-hit-*`), men den trycker inga riktiga pins.

Native-verifiering (kräver Expo Go + GPS): öppna Karta, tryck en markör, läs kortet, tryck "Läs mer" → detaljskärmen ska öppnas.

## Gotchas

- **Två krascher var här, båda fixade 2026-10-28:**
  1. `web-shims/react-native-maps.js` exporterade `Marker = null` → React kastade "Element type is invalid: expected a string … but got: null. Check the render method of `MapScreen`" → **hela appen** kraschade när Karta-fliken öppnades. Nu är `Marker` en no-op-komponent.
  2. `KartaScreen.js` läste `projectedMarkers` i `useCallback`-deps långt **före** `const projectedMarkers = useMemo(...)` → "Cannot access 'projectedMarkers' before initialization" (temporal dead zone) vid render. **Detta fel uppmättes live i webb-bundlen** (stack: `at KartaScreen`) och försvann efter flytten — det är alltså inte en källkodshypotes utan ett reproducerat fel. Deklarationen är nu flyttad ovanför första läsningen.
- `Marker` får aldrig vara `null` i shimmen — komponenten måste finnas även om den inte gör något. Det finns **ingen ErrorBoundary i 06-UI**, så en null-export avmonterar hela trädet (vit skärm).
- Shimmens `MapView` sprider alla props vidare på en `View` → native-only-proppar (`provider`, `showsCompass`, `clusterColor`) hamnar som ogiltiga DOM-attribut.
- Räknarna ("Idag · 881") kommer från serverns `total`, inte från antalet renderade rader.
- `react-native-maps` importerar native-only moduler → shimmen i `metro.config.js` är obligatorisk för webbbygget.
- FEATURE_MAP § 6 pekar på `06-UI/utils/mapProjection.js` — filen ligger i `06-UI/components/mapProjection.js`.
