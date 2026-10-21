# verify-bfl-zoom-pipeline/features — index

Detta är feature-map för BFL-header-knapparna på dashboarden (port 7777). Speglar `09-ScrapingSupervisor/dashboard/public/index.html` raderna 27–82 och deras handlers i `app.js` raderna 2864–2983.

| # | Feature | Fil | Status | Endpoint | Pipeline-script |
|---|---|---|---|---|---|
| 1 | `btn-bfl-zoom-run` (lila) | `zoom-variation.md` | live | `POST /api/bfl/zoom-run {count: N}` | `bfl-zoom-orchestrate.ts` → `bfl-zoom-batch.ts` |
| 2 | `btn-bfl-zoom-auto` (grön) | `auto-fill.md` | live (delvis — UX-buggar kända) | `POST /api/bfl/zoom-run {auto: true}` | `computeAutoFillCount()` i `server.ts:2398` → samma som #1 |
| 3 | `bfl-zoom-count` (input) | `zoom-count-input.md` | live | input till #1 | klient-validering i `app.js:2925` |
| 4 | `btn-bfl-compare-flux2` (blå) | `model-compare-flux2.md` | live (experiment) | `POST /api/bfl/compare-test {model:"bfl-flux-2-pro"}` | `tools/bfl-model-compare.mjs` |
| 5 | `btn-bfl-compare-minimax` (orange) | `model-compare-minimax.md` | live (experiment) | `POST /api/bfl/compare-test {model:"minimax-image-01"}` | samma som #4 |

Status-kolumnen speglar dashboardens faktiska beteende. `live` = knappen fungerar via UI-klick; `experiment` = lever men är inte en del av produkt-flödet (modell-jämförelse).

## Cross-cutting concerns (INTE egna feature-filer)

| Sak | Plockas upp i |
|---|---|
| Status-rad `bfl-zoom-status` / `bfl-compare-status` | `zoom-variation.md`, `auto-fill.md`, `model-compare-*.md` |
| `tmp/bfl_runs/zoom_<id>.json` / `compare_<id>.json` (run-state) | varje feature |
| `state/zoom-coverage.json` (coverage-tracking) | `zoom-variation.md`, `auto-fill.md` |
| `local_image_library_stamped/<cat>/zoom_*.webp` (output) | `zoom-variation.md`, `auto-fill.md` |
| `tmp/bfl_model_compare_<runId>/` (compare output) | `model-compare-*.md` |
| Befintlig `btn-bfl-generate` + modal | UTANFÖR denna skill (äldre pipeline) |
| BFL-credits header-ruta | UTANFÖR denna skill |

## Kända UX-buggar (2026-10-18)

| # | Problem | Berörd feature | Känd sedan |
|---|---|---|---|
| B1 | `setZoomButtonsDisabled()` disablar inte `btn-bfl-zoom-auto` (bara run-knapp + input) → användaren kan dubbelklicka → två körningar parallellt | `auto-fill.md` | 2026-10-18 → **FIXED** (`btnAuto.disabled = disabled` i `setZoomButtonsDisabled()`; Playwright: `btnAutoDisabled=true` genom hela körningen) |
| B2 | Auto-fill med state-fullt returnerar `count=N stor` men `imageCount=0`. UI visar `0/N → klar` som ser ut som "inget hände" | `auto-fill.md` | 2026-10-18 |
| B3 | `bfl-zoom-status` fastnar på `genererar… 0/N` om orchestrator-processen dör innan `child.on('close')` skriver `status="success"` | `zoom-variation.md`, `auto-fill.md` | 2026-10-18 |
| B5 | `#bfl-zoom-status` (CSS) `position: absolute; top: 100%` utan positionerad förälder → renderas längst ner på sidan, inte under knappen | `auto-fill.md` | 2026-10-18 → **FIXED** (Playwright `bottom: 196/900` ✓) |
| B6 | `#bfl-compare-status` har samma CSS-bugg som B5 → model-compare-knapparnas status-rad också off-screen | `model-compare-flux2.md`, `model-compare-minimax.md` | 2026-10-18 → **FIXED** (`position: relative` på `.header-row` ger ankare åt alla status-rader) |
| B7 | Auto-open på model-compare success är en no-op (`app.js:2803` kastar bort svaret från `/api/bfl/compare-test/open`) — Finder öppnas inte automatiskt som doc påstår | `model-compare-flux2.md`, `model-compare-minimax.md` | 2026-10-18 → **ej fixad** (out-of-scope för denna PR — produkt-bugg, inte doc-drift) |
| B8 | `computeAutoFillCount()` läste `state.totals` rakt av utan disk-sync — risk för duplicerade prompts eftersom state ofta glider ifrån disk (Supabase `image_library` ofullständig + tidigare batcher inte alla `registerCombo`-ade) | `auto-fill.md` | 2026-10-19 → **FIXED** (`reconcileFromDisk()` körs som steg 2 i computeAutoFillCount, state persistas därefter; 10→53 unika combos bekräftat efter sync) |
| B9 | `writeRunStateProgress` skrev `imageCount: okCount` (per-kategori-räknare) istället för total — UI-räknaren återställdes vid varje kategori-byte → visade `1/10` hela tiden trots att 7+ bilder skapades på disk. Användarens exakta klagomål: "ofta stog det 0/10 trots att det såg ut som att flera bilder genererades". | `zoom-variation.md`, `auto-fill.md` | 2026-10-19 → **FIXED** (`writeRunStateProgress(args, totalOkCount + okCount, ...)` i `bfl-zoom-batch.ts:533`; verifierat via batch A: count tickade 0→1→…→10 monotont) |

## Varje feature-fil har fyra H2:er

`Sub-features`, `How to get to it (user POV)`, `Driving it with curl`, `Gotchas`.

Drift i någon av dessa är `verify-bfl-zoom-pipeline`-skillens ansvar — produktkod-drift rapporteras separat.