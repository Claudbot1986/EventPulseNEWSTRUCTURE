# model-compare-minimax — feature #5 (live, experiment)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` rad 46–52 (`#btn-bfl-compare-minimax`) och dess handler i `app.js` (sök efter `startCompareRun('minimax-image-01')`).

Samma experiment-flöde som feature #4 men med **MiniMax image-01** istället för BFL flux-2-pro. Syftet är att operatören ska kunna jämföra samma prompts (3 default-kategorier) mellan de två modellerna sida vid sida.

## Sub-features

- **POST `/api/bfl/compare-test`** — body: `{model: "minimax-image-01"}`. Returnerar `{ok, runId, outDir, model, pid}`.
- **Modell-validering** — samma som #4. Andra modeller → 400.
- **Output** — `tmp/<parent>/minimax-image-01/<safeCat>.jpg` (när `--out-dir` delas mellan knapparna, UI-flödet) eller `tmp/<parent>/<safeCat>.jpg` (standalone). 3 filer per körning. **Inga per-bild `.json`-sidecars** — bara `manifest.json` + `README.txt` per körning.
- **Delad parent-mapp** — UI försöker dela `outDir` med #4 så båda modellerna hamnar i samma parent (via `/api/bfl/compare-test/out-dir`-endpoint).
- **Status-rad** — `#bfl-compare-status` (samma som #4, delad).
- **Ingen state-coverage** — som #4.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Tryck **F5**.
3. Header-radens mittensektion: klicka **🟧 MiniMax image-01** (orange knapp).
4. Statusrad visar förlopp, output-mapp öppnas vid success.

## Driving it with curl

```bash
# 1. Hämta senaste outDir från tidigare körning (eller hoppa över om första körningen)
SHARED_OUTDIR=$(curl -s http://localhost:7777/api/bfl/compare-test/out-dir \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("outDir",""))')
echo "shared outDir: $SHARED_OUTDIR"

# 2. Starta MiniMax med delad outDir om möjligt
if [ -n "$SHARED_OUTDIR" ]; then
  RESP=$(curl -s -X POST http://localhost:7777/api/bfl/compare-test \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"minimax-image-01\",\"outDir\":\"$SHARED_OUTDIR\"}")
else
  RESP=$(curl -s -X POST http://localhost:7777/api/bfl/compare-test \
    -H "Content-Type: application/json" \
    -d '{"model":"minimax-image-01"}')
fi
echo "$RESP" | python3 -m json.tool
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
OUTDIR=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["outDir"])')

# 3. Polla
for i in $(seq 1 80); do
  S=$(curl -s "http://localhost:7777/api/bfl/compare-test/$RUNID/status")
  STATUS=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  echo "  $(date +%T) status=$STATUS"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done

# 4. Verifiera 3 .jpg i modellens undermapp
find "$OUTDIR/minimax-image-01" -name '*.jpg' | wc -l
# → förväntat: 3

# 5. Om delad parent: båda modellerna i sina respektive undermappar
find "$OUTDIR/bfl-flux-2-pro" -name '*.jpg' | wc -l   # 3 om delad
find "$OUTDIR/minimax-image-01" -name '*.jpg' | wc -l
```

**Förväntat:**

| check | förväntat |
|---|---|
| POST returnerar `ok=true` | ja |
| POST returnerar `outDir` | ja (samma som #4 om delad, annars ny) |
| Status slut `success` | ja |
| `<outDir>/minimax-image-01/*.jpg` innehåller 3 filer | ja |
| Om delad parent: båda modellerna i samma dir (sina undermappar) | ja |

## Gotchas

**B6/B7 (se #4):** samma CSS-positionerings-bugg FIXED, samma auto-open-mekanism (auto-open FUNGERAR via `/api/bfl/compare-test/open`, INTE no-op — se `model-compare-flux2.md` B7-korrigering). Båda gäller även denna feature.

**Delad parent-mapp är page-load-scoped** — `compareBtnState.sharedOutDir` (`app.js:2841-2843`) ligger i JS-modulminne, INTE sessionStorage. Sidans 15-min-meta-refresh tömmer den, så efter refresh får första klick en ny `tmp/bfl_model_compare_<runId>`-parent (INTE samma som före refresh). Två parallella curl-POSTs delar inte heller parent — varje får sin egen.

**Att köra samma modell två gånger till samma outDir skriver över filer utan varning** — `tools/bfl-model-compare.mjs:144-161` skriver `safeCat.jpg` (ej versionsprefixat). Andra körningen överskriver första körningens `music.jpg`/`theatre-drama.jpg`/`community.jpg` i samma undermapp. Detta påverkar både flux2- och MiniMax-knappen om man delar parent.

**Samma gotchas som #4**, plus:

**MiniMax image-01 är samma modell som feature #1 (zoom-pipelinen) använder.** Båda feature #1 och denna feature kör MiniMax image-01 — men med olika prompts:
- #1: 10 zoom × 3 pose × 3 ljus = 90 unika M3-genererade prompts.
- Denna: 3 default-prompter (en per kategori) från `tools/bfl-model-compare.mjs` (cached från M3-batch).

Jämförelsen är **bara** meningsfull mot feature #4 (BFL flux-2-pro), inte mot feature #1.

**Klientens `outDir`-delning kan fallera om `compare-test/out-dir` returnerar null.** Då får denna körning en ny parent. Verifiera i UI:t att båda modellerna hamnar i samma mapp.

**Status-raden delas mellan #4 och #5.** Om båda körs parallellt (via curl) kommer statusraden att visa den senaste körningens status. UI:t pollar bara den senaste, så det är OK i normala fall.