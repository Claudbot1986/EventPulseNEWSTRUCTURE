# verify-bfl-adaptive-fill/features — index

Feature-map för dashboardens adaptiva bildfyllning (port 7777). Speglar
`09-ScrapingSupervisor/dashboard/public/index.html` (header-raden) och
`app.js` (`startAdaptiveRun`, `pollAdaptiveRun`, `initBflCompareButtons`).

| # | Feature | Fil | Status | Endpoint | Pipeline |
|---|---|---|---|---|---|
| 1 | `btn-bfl-compare-minimax` (orange) | `adaptive-fill-button.md` | live | `POST /api/bfl/adaptive-run {count:N}` | `scripts/adaptive_image_gen.ts` |
| 2 | `bfl-adaptive-count` (input) | `adaptive-count-input.md` | live | input till #1 | klientvalidering `app.js` |
| 3 | `bfl-adaptive-progress` (bar) | `progress-bar.md` | live | `GET /api/bfl/adaptive-run/:id/status` | `progress.json` |
| 4 | Serverns körningsskydd | `concurrency-guard.md` | live | 409 + `run.lock` | `findAdaptiveRuns()` + `acquireLock()` |
| 5 | Publicering till appen | `publish-to-app.md` | live | — | upload → prune → repair |
| 6 | Slutverifiering i appen | `app-image-verification.md` | live | — | `scripts/verify_app_event_images.mjs` |

## Cross-cutting concerns (INTE egna feature-filer)

| Sak | Plockas upp i |
|---|---|
| `#bfl-adaptive-status` / `#bfl-adaptive-progress` | `adaptive-fill-button.md`, `progress-bar.md` |
| `runtime/adaptive-image-gen/runs/<runId>/` | varje feature |
| `local_image_library_stamped_v2/<cat>/zoom_*_adp_*.webp` | `adaptive-fill-button.md`, `publish-to-app.md` |
| `BFL-generator/tmp/cluster_<cat>.json` (promptkälla) | `adaptive-fill-button.md` |
| `btn-bfl-compare-flux2` + gammal compare-test | **UTANFÖR** denna skill → `verify-bfl-zoom-pipeline` |
| `btn-bfl-zoom-run` / `btn-bfl-zoom-auto` | **UTANFÖR** → `verify-bfl-zoom-pipeline` |

## Historik

| Datum | Förändring | Konsekvens |
|---|---|---|
| 2026-10-29 | `#btn-bfl-compare-minimax` byttes från "3 bilder · jämför-test" till "N bilder · adaptiv fill" | Knappen kör nu produktionspipelinen i `scripts/adaptive_image_gen.ts`. Den gamla jämförelsefunktionen finns kvar för **flux-2-pro**-knappen och täcks av `verify-bfl-zoom-pipeline`. `model-compare-minimax.md` i den skillen är **inaktuell** för denna knapp. |

## Varje feature-fil har fyra H2:er

`Sub-features`, `How to get to it (user POV)`, `Driving it with curl`, `Gotchas`.
