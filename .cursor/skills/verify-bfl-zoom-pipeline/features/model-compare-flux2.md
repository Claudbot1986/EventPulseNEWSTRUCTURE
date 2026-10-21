# model-compare-flux2 — feature #4 (live, experiment)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` rad 39–45 (`#btn-bfl-compare-flux2`) och dess handler i `app.js` (sök efter `startCompareRun('bfl-flux-2-pro')`).

UI-flödet för **modell-jämförelse-experiment**: genererar 3 bilder (3 default-kategorier: music, theatre-drama, community) med BFL flux-2-pro-modellen. Skiljer sig från #1 — skriver INTE till `image_library` / Supabase / `local_image_library`, bara till en tillfällig `tmp/bfl_model_compare_<runId>/` för inspektion.

## Sub-features

- **POST `/api/bfl/compare-test`** — `server.ts:2676`. Body: `{model: "bfl-flux-2-pro"}`. Returnerar `{ok, runId, outDir, model, pid}`.
- **Modell-validering** — `COMPARE_MODELS = new Set(['bfl-flux-2-pro', 'minimax-image-01'])` på `server.ts:2643`. Andra modeller → 400 `model måste vara en av ...`.
- **Output-dir** — default ny `tmp/bfl_model_compare_<runId>/`. Kan delas mellan körningar om klienten skickar `{model, outDir: "<abs-path-under-PROJECT_ROOT>"}` (UI gör detta via `/api/bfl/compare-test/out-dir`-endpoint). Servern validerar att `parsed.outDir` börjar med `PROJECT_ROOT` (`server.ts:2693`); relativa paths och paths utanför projektroten tystas till en ny parent.
- **Spawn** — `tools/bfl-model-compare.mjs` med `--no-open` (UI öppnar mappen själv vid success via `/api/bfl/compare-test/open?dir=...`, **INTE** no-op).
- **Output** — `tmp/<parent>/bfl-flux-2-pro/<safeCat>.jpg` (när `--out-dir` delas mellan knapparna, UI-flödet) eller `tmp/<parent>/<safeCat>.jpg` (standalone). 3 kategorier × 1 bild = 3 filer per körning. **Inga per-bild `.json`-sidecars** — bara `manifest.json` + `README.txt` en gång per körning (`bfl-model-compare.mjs:228, 229-250`).
- **Ingen state-coverage** — experimentet skriver inte till `state/zoom-coverage.json`. Bilder persisteras inte i Stockholm-graphen.
- **Status-rad** — `#bfl-compare-status` (`rgba(220, 38, 38, 0.92)` — rent röd, EJ orange-röd). Visar `startar…` → `genererar…` → `✓ klar` eller `✗ misslyckades`. Anchor: `position: relative` på `.header-row` (`style.css:39-46`), `right: 0` på status-rad → vänsterjusterad från knapparna.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Tryck **F5** för färskt state.
3. Header-radens mittensektion har två compare-knappar:
   - **🅱️ BFL flux-2-pro** (blå) — denna feature.
   - **🟧 MiniMax image-01** (orange) — feature #5.
4. Klicka **🅱️ BFL flux-2-pro**. Statusrad `#bfl-compare-status` visar förlopp.
5. Vid success öppnas output-mappen i Finder (via `/api/bfl/compare-test/open?dir=...`).

## Driving it with curl

```bash
# 1. Starta BFL flux-2-pro
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/compare-test \
  -H "Content-Type: application/json" \
  -d '{"model":"bfl-flux-2-pro"}')
echo "$RESP" | python3 -m json.tool
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
OUTDIR=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["outDir"])')
echo "runId=$RUNID outDir=$OUTDIR"

# 2. Polla (max ~2 min för 3 bilder)
for i in $(seq 1 80); do
  S=$(curl -s "http://localhost:7777/api/bfl/compare-test/$RUNID/status")
  STATUS=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  IMG=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(len(r.get("images",[])))')
  echo "  $(date +%T) status=$STATUS images_done=$IMG"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done

# 3. Verifiera 3 .jpg i modellens undermapp (UI-flödet delar outDir)
find "$OUTDIR/bfl-flux-2-pro" -name '*.jpg' | wc -l
# → förväntat: 3 (music, theatre-drama, community)

# 4. Inspektera manifest + per-bild-filnamn
ls -la "$OUTDIR/manifest.json" "$OUTDIR/README.txt"
find "$OUTDIR/bfl-flux-2-pro" -name '*.jpg' | sort
# → musik.jpg, theatre-drama.jpg, community.jpg (inte .png, inte <model>_<idx>-mönster)
```

**Förväntat:**

| check | förväntat |
|---|---|
| POST returnerar `ok=true` | ja |
| POST returnerar `outDir` under `tmp/` | ja |
| Status slut `success` | ja |
| `<outDir>/bfl-flux-2-pro/*.jpg` innehåller 3 filer (music, theatre-drama, community) | ja |
| `<outDir>/manifest.json` + `<outDir>/README.txt` finns | ja |
| Inget skrivs till `image_library` / Supabase / `state/zoom-coverage.json` | ja (verifiera genom diff mot baseline) |

## Gotchas

**B6 (CSS-bugg, FIXED 2026-10-18): `#bfl-compare-status` har samma positionerings-bugg som `#bfl-zoom-status`** — `position: absolute; top: 100%` utan positionerad förälder → status-raden renderas utanför viewport. Fix: `position: relative` på `.header-row` ger ankare åt alla `.bfl-ingestion-status`-rader. Verifierat med Playwright (`bottom: 200/900` ✓).

**B7 (KORRIGERAD 2026-10-19): auto-open FUNGERAR, inte en no-op.** Tidigare doc påstod att "auto-open är en no-op" pga `app.js:2803` som kastar bort svaret från `/api/bfl/compare-test/out-dir`. Detta var en feltolkning — `/out-dir`-fetch ÄR dead code (bara ett extra anrop), men **auto-open fungerar via `/api/bfl/compare-test/open`** (`app.js:2808`) som faktiskt kör `execFile('open', [resolved], { timeout: 3000 })` på macOS (`server.ts:2835`). På icke-macOS plattformar är det en silent failure (kommandot finns inte), men på macOS öppnas Finder med markerade filer. Notera: `tools/bfl-model-compare.mjs` startas med `--no-open` (`server.ts:2719`), så scriptets egen auto-open är avstängd — däremot ÖPPNAR servern via `/api/bfl/compare-test/open` vid success.

**Inte samma modell som befintlig `btn-bfl-generate`.** Den äldre knappen kör `flux-pro-1.1`. Denna kör `flux-2-pro` (nyare BFL-modell). Syftet är att utvärdera om byte är värt det.

**Inte en del av Stockholm-graphen.** Bilder persisteras inte i `image_library` eller via `_upload_bfl_to_library.ts`. De är tillfälliga, bara för visuell inspektion. Vill du ha dem i graphen: ladda ner via `outDir` och kör uppladdnings-scriptet manuellt.

**Default-kategorier hårdkodade i `server.ts:2581`:** `['music', 'theatre-drama', 'community']`. Inget sätt att välja via UI eller curl.

**`outDir` delas mellan knapparna automatiskt.** Första klick → ny `tmp/bfl_model_compare_<runId>/`. Andra klick (miniMax) → UI hämtar `outDir` från `/api/bfl/compare-test/out-dir` och skickar med, så båda modellerna hamnar i samma parent. Verifiera genom att köra flux-2-pro först, sen MiniMax, sen kolla `find tmp/bfl_model_compare_* -name '*flux-2-pro*'` och `-name '*minimax*'` — båda ska vara i samma parent.

**Status-rad (`#bfl-compare-status`) är separat från `#bfl-zoom-status`.** Båda kan vara synliga samtidigt utan konflikt.

**Modell-compare är INTE detached.** Om dashboard-processen dör under körning dör också compare-processen (till skillnad från zoom-pipelinen som är detached). För experiment-tolk är det OK; för produktion skulle man vilja ha detached här också.

**Klient cachar `outDir` i module-level state (`compareBtnState.sharedOutDir`, `app.js:2825-2827`), INTE sessionStorage.** Detta innebär: om sidan auto-refresh:ar (var 15:e minut via `<meta http-equiv="refresh" content="900">` på `index.html:6`) töms cachen. Efter refresh blir första klickets `outDir` från ett nytt `tmp/bfl_model_compare_<runId>`-dir, INTE samma som före refresh. Andra klienten-effekten: `/api/bfl/compare-test/out-dir`-endpointen läser **senast skapade** `tmp/bfl_runs/compare_*.json`-filen (vilken ackumuleras — ingen cleanup), så outDir kan peka på en körning från dagar sedan om man startar om servern.