# model-compare-minimax — feature #5 (FLYTTAD 2026-10-29)

> **Inaktuell som feature.** Knappen `#btn-bfl-compare-minimax` är inte längre en
> modell-jämförelsetest. Den blev **adaptiv fill** 2026-10-29: den fyller
> EventPulses bildbibliotek med N nya bilder via `scripts/adaptive_image_gen.ts`.
>
> Den nuvarande betydningen, sub-features, körrecept och gotchas finns i
> **`verify-bfl-adaptive-fill`** (se `features/adaptive-fill-button.md`).
>
> `POST /api/bfl/compare-test {model:"minimax-image-01"}` finns kvar i servern
> och fungerar, men **ingen UI-knapp leder dit** — bara `btn-bfl-compare-flux2`
> gör det. Det gamla compare-flödet är alltså bara nåbart via curl.

## Vad som ändrades

| Före (2026-10-18 … 2026-10-29) | Efter (2026-10-29) |
|---|---|
| `POST /api/bfl/compare-test {model:"minimax-image-01"}` | `POST /api/bfl/adaptive-run {count:N}` |
| 3 testbilder → `tmp/bfl_model_compare_*/` | N nya biblioteksbilder → `local_image_library_stamped_v2/` |
| Ingen status/progress | Egen statusrad + progress-bar |
| Skrev INTE till image_library/Supabase | Skriver INTE till Supabase (publicering är ett separat steg) |
| Undertext: "3 bilder · jämför-test" | Undertext: "N bilder · adaptiv fill" |

## Varför

Modell-jämförelsen var ett engångsexperiment. Behovet som faktiskt fanns var
ett sätt att **fylla på biblioteket** — och det ska gå via produktionspipelinen
(kvotplan → generering → M3-granskning → grind), inte via ett experimentverktyg.

## Vad som fortfarande gäller

- **Delad parent-mapp** (`/api/bfl/compare-test/out-dir`) — gäller bara
  flux-2-pro-knappen nu.
- **Auto-open av output-mappen** (`/api/bfl/compare-test/open`) — gäller bara
  flux-2-pro-knappen nu.
- **Statusraden `#bfl-compare-status`** — delas nu bara av flux-2-pro-knappen.
  Den gamla MiniMax-statusraden är ersatt av `#bfl-adaptive-status`.

## Gotchas

- **`scripts/verify_bfl_buttons.mjs` får INTE köra `model-compare` för
  minimax** — den skulle klicka adaptiv-fill-knappen och förvänta sig ett
  compare-svar. Feature-kommandot `model-compare` gäller numera bara
  `bfl-flux-2-pro`.
- **Selector `#btn-bfl-compare-minimax` finns kvar** (id:t ändrades inte) men
  betyder något helt annat. Ett test som klickar på det och förväntar sig 3
  jämförelsebilder i `tmp/` är trasigt — det får nu en 300-skillig körning i
  biblioteket.
