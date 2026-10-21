# zoom-variation — feature #1 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` rad 69–75 (`#btn-bfl-zoom-run`) och dess handler i `app.js` raderna 2924–2946 (`startZoomRun`).

UI-flödet där operatören startar en parallell bildgenererings-pipeline med **anpassat antal bilder** via MiniMax-modellen. Inte samma som befintlig `btn-bfl-generate` — denna är fristående och rör inte äldre pipeline-filer.

## Sub-features

- **POST `/api/bfl/zoom-run`** — `server.ts:2451`. Body: `{count: number}` eller `{auto: true}`. Returnerar `{ok, runId, count, autoNote?, pid}`.
- **Spawn orchestrator** — `bfl-zoom-orchestrate.ts` (detached, unref'd) → `bfl-zoom-batch.ts` (också detached, med `--run-id` delad).
- **Status polling** — klienten pollar `/api/bfl/zoom-run/:runId/status` var 1500 ms. UI visar `genererar… <imageCount>/<count> <lastLogLine>`.
- **Run-state på disk** — `tmp/bfl_runs/zoom_<runId>.json`. Skrivs av både orchestrator (stdout/stderr lines → log[]) och batch (via `writeRunStateProgress()`).
- **Output** — `local_image_library_stamped/<cat>/zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.webp` + `.json` per bild.
- **State-aware skip** — batch skippar `(tag, zoom, pose, light)`-kombinationer som redan finns i `state/zoom-coverage.json`. UI-räknaren rör sig inte för dessa (räknar bara `✓`).
- **Viktad zoom-fördelning** (`ZOOM_WEIGHTS` i `BFL-generator/lib/zoom-prompter.ts`):
  EC/CU/MCU får 0.25 vardera, resterande 7 zoom (MED/MLS/LS/WIDE/XW/EST/AER) delar 0.25 jämnt.
  Resultat för olika counts (weighted + largest-remainder):
  - count=5 → `{EC:2, CU:2, MCU:1}` (100% close-ups)
  - count=10 → `{EC:3, CU:3, MCU:3, MED:1}` (90% close-ups + 10% medium)
  - count=20 → `{EC:5, CU:5, MCU:5, MED:1, MLS:1, LS:1, WIDE:1, XW:1}` (75% close-ups + 25% wide)
  - count=50 → `{EC:12, CU:12, MCU:12, MED:2, MLS:2, LS:2, WIDE:2, XW:2, EST:2, AER:2}` (72% close-ups + 28% wide)
- **Stämpel** — sharp composite med SVG: `STAMP_TEXT='AI-generated'`. Metadata-flagga `stamped: true`.
- **Auto-open output-mapp** — vid `status=success` öppnar UI:n `local_image_library_stamped/` via `/api/bfl/compare-test/open?dir=...` (delad endpoint).
- **Status-rad hide** — 5 s efter success gömms statusraden; 6 s efter fel.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/` i webbläsare.
2. Sidan auto-refreshar var 15 min. För färskt state: tryck **F5**.
3. Längst upp i header-radens högra del finns blocket `#bfl-zoom-wrap`:
   - `#bfl-zoom-count` — number input, default `10`, range 1–500.
   - `#btn-bfl-zoom-auto` — grön knapp "🎯 Auto-fill".
   - `#btn-bfl-zoom-run` — lila knapp "🪄 Zoom-variation".
4. Skriv in önskat antal i input (eller låt stå på 10).
5. Klicka **🪄 Zoom-variation**. Knappen och input blir disabled (`setZoomButtonsDisabled(true)`).
6. Statusrad `#bfl-zoom-status` under knapparna visar `startar N bilder…` → `genererar… X/N <log>` → `✓ klar — X bilder i local_image_library_stamped/`.
7. Efter ~5 s försvinner statusraden automatiskt. Output-mappen öppnas i Finder.

## Driving it with curl

```bash
# 1. Räkna "före" för music
BEFORE=$(ls local_image_library_stamped/music/ 2>/dev/null | grep -c '_[0-9]\{3\}\.webp$' || echo 0)
echo "music (före): $BEFORE"

# 2. Starta körning
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":5,"categories":["music"]}')
echo "start response: $RESP"
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["runId"])')

# 3. Polla (max 6 min)
for i in $(seq 1 240); do
  S=$(curl -s "http://localhost:7777/api/bfl/zoom-run/$RUNID/status")
  STATUS=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  COUNT=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r.get("imageCount",0))')
  echo "  $(date +%T) status=$STATUS images=$COUNT/5"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 1.5
done

# 4. Verifiera på disk
AFTER=$(ls local_image_library_stamped/music/ 2>/dev/null | grep -c '_[0-9]\{3\}\.webp$' || echo 0)
echo "music (efter): $AFTER  (delta=$((AFTER - BEFORE)))"

# 5. Inspektera metadata
FIRST=$(ls -t local_image_library_stamped/music/zoom_music_*_000.webp.json 2>/dev/null | head -1)
[ -n "$FIRST" ] && python3 -m json.tool < "$FIRST" | head -20
```

**Förväntat:**

| check | förväntat |
|---|---|
| POST returnerar `ok=true` | ja |
| POST returnerar `runId` | ja |
| Status slut `success` eller `failed` | ja |
| `imageCount` ≤ `count` | ja |
| Nya `.webp` på disk = `imageCount` (om state-aware skip inte köpt) | ja |
| Metadata har `stamped`, `zoomId`, `pose`, `light`, `minimax_url`, `cluster_tag` | ja |

## Gotchas

**imageCount har TVÅ skrivare (last-write-wins):** (1) orchestrator räknar `state.log.join('\n').match(/✓ /g).length` från stdout (`bfl-zoom-orchestrate.ts:121-122`); (2) batch skriver `imageCount: okCount` per framgång via `writeRunStateProgress()` (`bfl-zoom-batch.ts:479-483`). Båda skriver till samma `tmp/bfl_runs/zoom_<id>.json` — sista skrivaren vinner. Orchestrator-versionen räknar **alla** `✓ ` i stdout, inklusive från tidigare körningars log-rader om `tmp/bfl_runs/` inte städats. Räkna `.webp`-filer på disk för sanning.

**State-aware skip är ljudlös.** Batch skippar `(tag, zoom, pose, light)`-kombinationer som finns i `state/zoom-coverage.json` utan att skriva `✓ `. `imageCount` ökar därför inte, trots att pipeline "arbetar". UI visar `genererar… 0/N <log>` under hela körningen → kan se ut som bug men är korrekt beteende.

**B3 (status fastnar på "running") — FIXED 2026-10-18.** `finalizeRunState(args, totalOkCount, 'success', 0)` på `bfl-zoom-batch.ts:557` skriver `status='success'` + `finishedAt` när batch-funktionen returnerar, oavsett om orchestrator lever eller inte. Orchestrator-sidans `child.on('close')` (`bfl-zoom-orchestrate.ts:142-156`) bekräftar bara batchens status om batch inte redan satt den. Verifierat: 7 batcher 2026-10-18 avslutades alla med `status: 'success', finishedAt: <iso>`. Workaround (läs state.json manuellt) behövs inte längre.

**B9 (UI-bugg, FIXED 2026-10-19): `imageCount` återställdes till 0 vid varje kategori-byte — UI-räknaren tickade inte upp över hela batchen.** `writeRunStateProgress(args, okCount, ...)` på `bfl-zoom-batch.ts:533` skrev **per-kategori-räknare** (`okCount` nollställs vid varje `for (let i = 0; i < filteredPrompts.length; i++)`-loop). Kombinerat med `writeRunStateProgress(args, 0, ...)` på rad 443 (initial progress vid kategori-start) återställdes UI-räknaren till 0 för varje ny kategori. **Användarens exakta klagomål:** "ofta stog det 0/10 trots att det såg ut som att flera bilder genererades".

**Fix:**
1. `bfl-zoom-batch.ts:443` → `writeRunStateProgress(args, totalOkCount, ...)` (totalt hittills, inte 0).
2. `bfl-zoom-batch.ts:533` → `writeRunStateProgress(args, totalOkCount + okCount, ...)` (totalt över kategorier + denna kats ackumulator).

**Verifierat:** batch 1 (count=10, --reset-state) rapporterade `count=0/10` vid t=0s och tickade monotont `0→1→2→…→7` över 7 bilder på disk (delta=8). Före fixen hade count stannat på 1/10 trots 5+ bilder på disk.

**`count` cap i klienten men inte i API.** `app.js:2926` klipper till `Math.max(1, Math.min(500, count))`. Servern tar emot och kör vad som helst. Skicka `count=9999` via curl → batch försöker generera 9999 bilder. Begränsa i server.ts om du vill ha samma cap.

**Filenamn innehåller runTag.** Slug-pattern: `zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.webp`. `runTag` är batchens `runId.slice(0, 13)` — samma som orchestrator's runId. Två körningar med samma minuts-tidsstämpel kan kollidera i teorin (Math.random-suffix hjälper).

**MiniMax-URL expire.** `minimax_url` i metadata är OSSSignerad och tidsbegränsad. Persistent arkivering sker genom att batch laddar ner binären (vilket den gör).

**Disk: `local_image_library_stamped/` ≠ `local_image_library/`.** Den första har stämplade webp; den andra har raw PNG. Båda skrivs av samma batch.

**M3-cachen kan ge exakt samma prompts som förra körningen.** Rensa `tmp_image_corpus/<cat>_zoom_prompts.json` om du vill ha nya prompts (och därmed variation i bilderna).