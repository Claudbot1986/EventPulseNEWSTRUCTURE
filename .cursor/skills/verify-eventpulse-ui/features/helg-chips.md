# Helg-chips + intent-pipeline

## Sub-features

- **I den utskickade appen syns inga chiptexter.** Utforska har 18 kategorirutor. De "smak"-tiles som beskrivs i `App.js:687-750` (Gratis, Live, Skratt, Stämningsfullt, Helg, Imorgon) renderas **bara om `EXPO_PUBLIC_EXPLORE_TILES` är satt** (`App.js:690`, annars `null`). Definitioner: `App.js:698-705`, etiketter `i18n/strings/sv.js:230-241`.
- Curated/suggested-chips ("Klassisk konsert ikväll i Stockholm?", "Konserter i Stockholm under 200 kronor?" …) finns i `utils/chipCatalog.testkit.ts` men renderas bara i `HEM-QUARANTINE` → **ej monterade**.
- **Det finns inga chips på Hem i byggen.** `AppShell.handleChipPress` (`AppShell.js:449-464`) är död kod — ingen konsument (AppShell renderar `HomeScreen` med bara `onCardPress`/`userState`, `AppShell.js:605`).
- Flödet som är kodat: chip → JSON `{text,hints}` till `eventpulse.pending_agent_message` (`services/storage.js:40`) → Utforska → `resolvePromptIntent` (`utils/promptIntent.js:127-222`) → filter → `GET /agent/feed`.
- Bannern "DU FRÅGADE" (utan kolon) visar chiptexten i Utforska (`i18n/strings/sv.js:297`).
- Filterbadge är **avstängd** (`App.js:141`) — filtret appliceras men visas inte.
- En tile-tryckning går **inte** genom intent-pipelinen: `onTilePress = handleExploreDetailPress` (`App.js:2294-2296, 2353`) öppnar `ExploreDetailScreen` med en tile-specifik feed-route (`utils/tileRoutes.js:102-155`). **Det leder alltså till en feed-vy, inte till en kategorivy och inte till intent-filter.**

## How to get to it (user POV)

**I den utskickade appen: ingen väg.** De synliga Utforska-tiles ("Gratis", "Helg", …) är dev-gated (`EXPO_PUBLIC_EXPLORE_TILES`) och leder till en feed-vy, inte till intent-filter.

## Driving it with Playwright

Ingen spec ännu — pipeline:n är **verified-unreachable via UI**. Den kan bara verifieras genom att mata in det wire-format en knapptryckning skulle skapa:

```js
await page.addInitScript(
  (v) => localStorage.setItem('eventpulse.pending_agent_message', v),
  JSON.stringify({ text: 'Gratis evenemang i Stockholm i helgen?', hints: { budget: 'free', day_filter: 'weekend' } }),
);
```

Sedan: öppna appen → klicka Utforska → bannern "DU FRÅGADE" + chiptexten ska synas → feed-anropet ska ha `from` = kommande fredag och `days=7` (bara `from` flyttas; `days` är fast 7 — `App.js:928-933, 1097`).

## Gotchas

- **Bannerns text är "DU FRÅGADE" utan kolon.** Den gamla harnessen sökte på "DU FRÅGADE:" och träffade aldrig — testet passade bara via en OR-fallback.
- Hem-chipsen som harnessen testade ("Konserter") finns bara i onboarding-text och i den omonterade katalogen. **Rättat 2026-11-04:** `home.test.mjs` skippar inte längre — testet assertar nu att det finns **0** knappar med EXAKT accessible name "Konserter" (den gamla `getByText('Konserter')` träffade ett evenemang som råkar ha titeln "Konserter").
- `chipCatalog` finns bara som `.testkit.ts` — ingen runtime-modul (importeras bara av `promptIntent.test.ts` och `chipSimulation.test.ts`). FEATURE_MAP § 15 är fel på den punkten.
- Tidsberoende: "Helg", "Imorgon" och Helg-filter bygger på `weekendIntent` (lör/sön).
- **En** tabbar i DOM ⇒ `[role="tab"]` "Hem" ger **en** träff, inte två. Rättat 2026-11-04.
- Det är **okänt** om `EXPO_PUBLIC_EXPLORE_TILES` är satt i dev-miljön — ingen tracked fil sätter det.
