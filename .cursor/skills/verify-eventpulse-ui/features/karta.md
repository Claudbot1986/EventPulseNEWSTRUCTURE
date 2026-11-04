# Karta

## Sub-features

- Fliken "Karta" visar Stockholmskartan med eventmarkörer, räknare ("Idag · 206", "Helgen · 675", "Nästa helg · 552", "Alla · 3500"), ett TOTAL/VISIBLE-metrorum och filterlägen. **Fyra** filterlägen, inte tre.
- Under/över kartan läggs en **hit-detection-overlay** med en osynlig `Pressable` per marker (`testID="marker-hit-<event-id>"`), max 80 st. Overlayen renderas även på web — ett osynligt tryck kan därför öppna `MapEventCard` där.
- `MapView` kommer från **`react-native-map-clustering`** (kapslar in `react-native-maps`); bara `Marker` och `PROVIDER_DEFAULT` importeras direkt från `react-native-maps`. `provider={PROVIDER_DEFAULT}` (= `undefined`) = plattformens standard = **MapKit på iOS**. Det finns INGEN `PROVIDER_APPLE` i `react-native-maps` 1.29.11 — bara `PROVIDER_DEFAULT` (= `undefined`) och `PROVIDER_GOOGLE` (= `'google'`).
- `MapView` + `Marker` är **native-only**. På web renderar shimmen en panel: "Kartan är inte tillgänglig på webb / Öppna appen i Expo Go för full kartvy." Klusterbubblorna (t.ex. "671", "2") ritas ändå av clustering-biblioteket ovanför shimmen.
- `MapEventCard` är ett **overlay-kort** fäst i kartans nederkant (inte en radlista under kartan) och visas när en marker/overlay trycks; "Läs mer" öppnar samma detaljskärm som Hem. Kortet visar titel + metarad + pillor + en **72×72-bild** (eller "EVENT"-placeholder) — ingen lokalnamn, ingen beskrivning.
- Karta läser **direkt från `events_public`** (paginerat 500/sida, ≤7 sidor, Stockholm-bbox) — den frågar **inte** `/agent/feed`.

## How to get to it (user POV)

Klicka "Karta" i bottenstaplen.

## Driving it with Playwright

Spec: `06-UI/e2e/app-tabs.test.mjs` (fliken "Karta" täcks av fliktestet). Full kartverifiering är **verified-unreachable på web**.

Recept (webb):

1. Klicka fliken "Karta".
2. Vänta på `[data-testid="karta-screen-ready"]` och texten "Kartan är inte tillgänglig på webb".
3. Assera att **fyra** filterknappar syns med `aria-label` "Visa Idag", "Visa Helgen", "Visa Nästa helg", "Visa Alla" och att texterna "Idag · ", "Helgen · ", "Nästa helg · ", "Alla · " finns. Assera att "TOTAL" och "VISIBLE" syns.
4. Assera att **inga** fel kastas (`pageerror` ska vara tomt) och att antalet `[data-testid^="marker-hit-"]` är > 0 men ≤ 80.
5. Markör-overlayen renderas även på web (`marker-hit-*`), men den trycker inga riktiga pins.

Native-verifiering (kräver Expo Go + GPS): öppna Karta, tryck en markör, läs kortet, tryck "Läs mer" → detaljskärmen ska öppnas.

**Bevis 2026-11-04:** `06-UI/e2e/visual-regression/baseline/screen-karta-darwin.png` visar rätt vy (karta-panel + 4 filter + TOTAL 3500 / VISIBLE 675). Specen navigerar via flik-klick — routes fungerar inte (appen har ingen router).

## Gotchas

- **Två krascher var här, båda fixade 2026-10-28:**
  1. `web-shims/react-native-maps.js` exporterade `Marker = null` → React kastade "Element type is invalid: expected a string … but got: null. Check the render method of `MapScreen`" → **hela appen** kraschade när Karta-fliken öppnades. Nu är `Marker` en no-op-komponent.
  2. `KartaScreen.js` läste `projectedMarkers` i `useCallback`-deps långt **före** `const projectedMarkers = useMemo(...)` → "Cannot access 'projectedMarkers' before initialization" (temporal dead zone) vid render. **Detta fel uppmättes live i webb-bundlen** (stack: `at KartaScreen`) och försvann efter flytten — det är alltså inte en källkodshypotes utan ett reproducerat fel. Deklarationen är nu flyttad ovanför första läsningen.
- `Marker` får aldrig vara `null` i shimmen — komponenten måste finnas även om den inte gör något. Det finns **ingen ErrorBoundary i 06-UI**, så en null-export avmonterar hela trädet (vit skärm).
- Shimmens `MapView` sprider alla props vidare på en `View` — men RNW filtrerar bort okända props (`pickProps`), så `provider`/`showsCompass`/`clusterColor` hamnar INTE som ogiltiga DOM-attribut. `onPress` filtreras också bort ⇒ "tryck på kartan för att stänga kortet" är **webb-inert**.
- Shimmens `PROVIDER_DEFAULT` har värdet `'default'` (webb), medan bibliotekets egen är `undefined` — på iOS är båda MapKit.
- Räknarna ("Idag · 206") räknas **klient-side** över de hämtade Supabase-raderna — Karta-tabben frågar inte `/agent/feed` och har ingen server-`total`.
- `react-native-maps` importerar native-only moduler → shimmen i `metro.config.js` är obligatorisk för webbbygget.
- FEATURE_MAP § 6 pekar på `06-UI/utils/mapProjection.js` — filen ligger i `06-UI/components/mapProjection.js`.
- **Rättat 2026-11-04:** kartleverantören är `PROVIDER_DEFAULT`, inte `PROVIDER_APPLE` — det senare finns inte i `react-native-maps` 1.29.11. Se `06-UI/screens/KartaScreen.js` (kommentar) och `MapScreen.js`.
