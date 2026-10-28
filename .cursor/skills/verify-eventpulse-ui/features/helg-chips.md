# Helg-chips + intent-pipeline

## Sub-features

- **Synliga chiptexter** i Utforska: "Gratis", "Live", "Skratt", "Stämningsfullt", "Helg", "Imorgon" (`App.js:683-690`, `i18n/strings/sv.js:218-229`).
- Curated/suggested-chips ("Klassisk konsert ikväll i Stockholm?", "Konserter i Stockholm under 200 kronor?" …) finns i `utils/chipCatalog.testkit.ts` men renderas bara i `HEM-QUARANTINE` → **ej monterade**.
- **Det finns inga chips på Hem i byggen.** `AppShell.handleChipPress` är död kod (ingen konsument).
- Flödet som är kodat: chip → JSON `{text,hints}` till `eventpulse.pending_agent_message` → Utforska → `resolvePromptIntent` → filter → `GET /agent/feed`.
- Bannern "DU FRÅGADE" (utan kolon) visar chiptexten i Utforska.
- Filterbadge är **avstängd** (`App.js:141`) — filtret appliceras men visas inte.

## How to get to it (user POV)

**I den utskickade appen: ingen väg.** De synliga Utforska-tiles ("Gratis", "Helg", …) är dev-gated (`EXPO_PUBLIC_EXPLORE_TILES`) och leder till en kategorivy, inte till intent-filter.

## Driving it with Playwright

Ingen spec ännu — pipeline:n är **verified-unreachable via UI**. Den kan bara verifieras genom att mata in det wire-format en knapptryckning skulle skapa:

```js
await page.addInitScript(
  (v) => localStorage.setItem('eventpulse.pending_agent_message', v),
  JSON.stringify({ text: 'Gratis evenemang i Stockholm i helgen?', hints: { budget: 'free', day_filter: 'weekend' } }),
);
```

Sedan: öppna appen → klicka Utforska → bannern "DU FRÅGADE" + chiptexten ska synas → feed-anropet ska ha `from`/`days` enligt `weekendIntent`.

## Gotchas

- **Bannerns text är "DU FRÅGADE" utan kolon.** Den gamla harnessen sökte på "DU FRÅGADE:" och träffade aldrig — testet passade bara via en OR-fallback.
- Hem-chipsen som harnessen testade ("Konserter") finns bara i onboarding-text och i den omonterade katalogen → `test.skip()` i `home.test.mjs`.
- `chipCatalog` finns bara som `.testkit.ts` — ingen runtime-modul. FEATURE_MAP § 15 är fel på den punkten.
- Tidsberoende: "Helg", "Imorgon" och Helg-filter bygger på `weekendIntent` (lör/sön).
- Två tabbars gör `[role="tab"]` "Hem" till två träffar → risk för strict-mode-fel.
