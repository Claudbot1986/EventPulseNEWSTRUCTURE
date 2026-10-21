---
name: verify-bfl-zoom-pipeline
description: |
  Drive the BFL image-generation dashboard on port 7777 end-to-end via curl
  + disk inspection. Use for /verify-bfl-zoom-pipeline, when a feature in
  features/README.md regresses, or when changes to BFL-generator/lib/zoom-*.ts,
  BFL-generator/bin/bfl-zoom-*.ts, server.ts /api/bfl/zoom-run* or
  /api/bfl/compare-test* endpoints, tools/bfl-model-compare.mjs, or the
  dashboard header buttons (Zoom-variation, Auto-fill, model-compare,
  count-input) must be verified. Verifies UI-button → HTTP → run-state →
  on-disk image → state-coverage evidence for the parallel BFL pipelines
  introduced 2026-10-18.
disable-model-invocation: false
---

# verify-bfl-zoom-pipeline

Verifies the **header button row** of the Scraping Supervisor Dashboard on `http://localhost:7777`. Five surfaces, three pipelines:

```
dashboard header
  ├─ #btn-bfl-zoom-run    (lila)    → POST /api/bfl/zoom-run {count:N}
  ├─ #btn-bfl-zoom-auto   (grön)    → POST /api/bfl/zoom-run {auto:true}
  ├─ #bfl-zoom-count      (input)   → tal 1–500, klipptes till POST body
  ├─ #btn-bfl-compare-flux2  (blå)  → POST /api/bfl/compare-test {model:"bfl-flux-2-pro"}
  └─ #btn-bfl-compare-minimax (orange) → POST /api/bfl/compare-test {model:"minimax-image-01"}
```

Befintlig `btn-bfl-generate` och dess modal ligger utanför denna skill (äldre pipeline, annan status-rad).

## Pipeline (recap)

```
btn-bfl-zoom-run / btn-bfl-zoom-auto
  → POST /api/bfl/zoom-run  (server.ts:2451)
    → spawn bfl-zoom-orchestrate.ts (detached, unref'd)
        → spawn bfl-zoom-batch.ts  (detached, unref'd, --run-id delad)
            → buildZoomPrompts()    BFL-generator/lib/zoom-prompter.ts
                M3 prompt-rotation (10 zoom × 3 pose × 3 ljus = 90 unika)
            → generateMinimax()      POST api.minimax.io/v1/image_generation
            → stampImage()           sharp composite med SVG: AI-generated
            → local_image_library_stamped/<cat>/zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.webp + .json
            → writeRunStateProgress()  → tmp/bfl_runs/zoom_<runId>.json  (UI-räknare)

btn-bfl-compare-flux2 / btn-bfl-compare-minimax
  → POST /api/bfl/compare-test  (server.ts:2613)
    → spawn tools/bfl-model-compare.mjs  (icke-detached)
        → 3 bilder (3 default-kategorier: music, theatre-drama, community)
        → tmp/bfl_model_compare_<runId>/<model>_<category>_<idx>.png + .json
        → Skriver INTE till image_library / Supabase / local_image_library
```

## Pre-conditions

| Krav | Test |
|---|---|
| `.env` har `MINIMAX_API_KEY`, `BFL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `grep -E '^[A-Z_]+=' .env \| wc -l` ≥ 4 |
| Dashboard kör på :7777 | `lsof -i :7777 \| grep LISTEN` |
| `BFL-generator/tmp/cluster_music.json` (eller annan kategori som testas) finns | `ls -la BFL-generator/tmp/cluster_*.json` |
| Inget gammalt zoom-run subprocess lever kvar | `pgrep -f bfl-zoom-batch` ska vara tomt |
| `state/zoom-coverage.json` läsbar | `python3 -c 'import json;json.load(open("state/zoom-coverage.json"))'` exit 0 |

## Doctor

Kör innan varje drive. Stoppa och reparera om något faller.

```bash
# Dashboard lever?
curl -sI http://localhost:7777/ | head -1
# → förväntat: HTTP/1.1 200 OK

# Header-knapparna finns i DOM?
curl -s http://localhost:7777/ | grep -oE 'id="(btn-bfl-zoom-(run|auto)|btn-bfl-compare-(flux2|minimax)|bfl-zoom-count)"'
# → förväntat: 5 träffar, en per rad

# M3 chat svarar?
MINIMAX_KEY=$(grep '^MINIMAX_API_KEY=' .env | cut -d= -f2-)
curl -s -X POST https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}]}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("ok" if "choices" in d else "fail")'

# MiniMax image svarar?
curl -sI -X POST https://api.minimax.io/v1/image_generation \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"test","width":1024,"height":576}' | head -1

# Cluster-filer finns för de kategorier som testas?
ls -la BFL-generator/tmp/cluster_*.json
# → minst cluster_music.json ska finnas för smoke-test

# Run-state-dir finns och är skrivbar?
ls -ld tmp/bfl_runs/

# State-coverage laddar?
python3 -c 'import json;d=json.load(open("state/zoom-coverage.json"));print("cats:",len(d["totals"]),"combos:",sum(d["totals"].values()))'
```

Doctor-failure innebär att drivet inte är värt att köra. Stoppa, fixa orsaken, kör doctor igen.

## Playwright-harness (UI-beteende — när curl inte räcker)

Curl + disk-inspection fångar **kontrakt och pipeline-resultat** men inte **klick-beteende och visuell positionering**. För det behövs en riktig webbläsare. Webbläsardrivern finns redan (`node_modules/playwright`) och chromium cachas under `~/Library/Caches/ms-playwright/`.

**När curl räcker:**
- Endpoint-kontrakt (request/response shapes).
- Run-state på disk (`tmp/bfl_runs/`).
- State-coverage växer.
- Pipeline avslutas korrekt (`status: success`).

**När Playwright krävs:**
- Verifiera att status-radens `boundingBox` ligger inom synligt viewport efter klick (inte off-screen pga `position: absolute` utan positionerad förälder).
- Verifiera hela kedjan knapp → fetch → status-uppdatering i riktig webbläsare.
- Regression-test för CSS-buggar (t.ex. status-rad som hamnar 700px under knappen — se `auto-fill.md` §B5).
- Verifiera att disabled-tillstånd på rätt knappar/input faktiskt fungerar visuellt.

**Referensdriver** (`scripts/verify_bfl_buttons.mjs` eller motsvarande i repo):

```javascript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:7777/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// Inspektera före klick
const statusBefore = await page.locator('#bfl-zoom-status').evaluate((el) => ({
  hidden: el.classList.contains('bfl-ingestion-status--hidden'),
  text: el.textContent,
  rect: el.getBoundingClientRect(),
  position: getComputedStyle(el).position,
  parentPosition: getComputedStyle(el.parentElement).position,
}));

// Klicka auto-fill
await page.locator('#btn-bfl-zoom-auto').click();
await page.waitForTimeout(800);

// Inspektera efter klick
const statusAfter = await page.locator('#bfl-zoom-status').evaluate((el) => ({
  hidden: el.classList.contains('bfl-ingestion-status--hidden'),
  text: el.textContent.trim(),
  rect: el.getBoundingClientRect(),
  inViewport: el.getBoundingClientRect().bottom <= window.innerHeight,
}));

await page.screenshot({ path: 'evidence/auto-fill-after.png' });
console.log('statusAfter:', statusAfter);
await browser.close();
```

**Playwright-assertions per feature:**

| Feature | Måste-ha assertion |
|---|---|
| `zoom-variation.md` | `statusRect.bottom <= viewport.height`; text innehåller `genererar… X/N` |
| `auto-fill.md` | `statusRect.bottom <= viewport.height`; text innehåller `auto-fill: count=N` |
| `zoom-count-input.md` | input-värde `9999` → POST body `count=500` (network assertion via `page.on('request')`) |
| `model-compare-flux2.md` | `#bfl-compare-status` inom viewport; text innehåller modellnamn |
| `model-compare-minimax.md` | andra klick i samma parent-dir (verifiera via `fs.readdir`) |

## Drive — minimal smoke (5 bilder)

Kör från projekt-roten. Syfte: bevisa att **varje del av kedjan fungerar** utan att bränna för mycket MiniMax-kredit. Byt ut `music` mot valfri kategori som finns i `state/zoom-coverage.json` om `music` saknar cluster-fil.

```bash
# 0. Räkna "före" — antal bilder på disk för music
BEFORE=$(ls local_image_library_stamped/music/ 2>/dev/null | grep -c '_[0-9]\{3\}\.webp$' || echo 0)
echo "music webp (före): $BEFORE"

# 1. Starta körning via dashboard-endpoint
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":5,"categories":["music"]}')
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
echo "runId=$RUNID"

# 2. Polla status tills klar (eller timeout 6 min = 240 försök × 1.5s)
for i in $(seq 1 240); do
  S=$(curl -s "http://localhost:7777/api/bfl/zoom-run/$RUNID/status")
  STATUS=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  COUNT=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r.get("imageCount",0))')
  echo "  $(date +%T) status=$STATUS images=$COUNT/$5"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 1.5
done

# 3. Verifiera bilder på disk
AFTER=$(ls local_image_library_stamped/music/ 2>/dev/null | grep -c '_[0-9]\{3\}\.webp$' || echo 0)
echo "music webp (efter): $AFTER  (delta=$((AFTER - BEFORE)))"

# 4. Inspektera första .json-metadata
FIRST=$(ls local_image_library_stamped/music/zoom_music_*_000.webp.json 2>/dev/null | head -1)
if [ -n "$FIRST" ]; then
  python3 -c "
import json
d = json.load(open('$FIRST'))
print('zoomId:', d.get('zoomId'))
print('pose:', d.get('pose'))
print('light:', d.get('light'))
print('stamped:', d.get('stamped'))
print('minimax_url:', (d.get('minimax_url') or '')[:50] + '...')
print('category:', d.get('category'))
print('cluster_tag:', d.get('cluster_tag'))
"
fi
```

## Förväntat resultat (smoke)

| check | förväntat |
|---|---|
| `result.status` vid slut | `success` |
| `result.exitCode` | `0` |
| `result.imageCount` | ≥ 0 (kan vara 0 om alla kombinationer redan finns i state) |
| `imageCount > 0` ⇒ antal nya `.webp` på disk | = `imageCount` |
| Metadata har `stamped: true` | ja |
| Metadata har `zoomId` ∈ {EC, CU, MCU, MED, MLS, LS, WIDE, XW, EST, AER} | ja |
| Metadata har `pose` ∈ {still, dynamic, silhouette} | ja |
| Metadata har `light` ∈ {warm tungsten, cool daylight, mixed} | ja |
| `minimax_url` börjar med `http://` | ja |
| Filename slutar med `<slug>_<pose>_<light>_<runTag>_<idx>.webp` | ja |

## Drive — auto-fill smoke

```bash
# 1. Räkna ut vad auto-fill skulle välja (utan att köra)
curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"auto":true}' | python3 -m json.tool
# → förväntat: {"ok":true, "runId":"...", "count":<N>, "autoNote":" (auto-fill: count beräknat till N ...)"}
```

Auto-fill kör **inte** själva pipelinen — den **startar** den med `count=N`. Det betyder:
- Om `state/zoom-coverage.json` redan har alla kombinationer för alla kategorier kan `N` bli stort (alla 1/30-quota-bidrag) men `imageCount` blir 0 eftersom state-aware skip hoppar över allt.
- Detta är **förväntat beteende**, inte en bug. UI ska visa `0/N → klar`.

Om `N=0` returneras är state fullt för den valda kvoten — UI ska visa "auto-fill: count=0" och inte starta något.

## Drive — model-compare smoke

```bash
# 1. flux-2-pro
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/compare-test \
  -H "Content-Type: application/json" \
  -d '{"model":"bfl-flux-2-pro"}')
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
OUTDIR=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["outDir"])')
echo "flux-2-pro runId=$RUNID outDir=$OUTDIR"

# 2. Polla tills klar
for i in $(seq 1 60); do
  STATUS=$(curl -s "http://localhost:7777/api/bfl/compare-test/$RUNID/status" \
    | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  echo "  $(date +%T) status=$STATUS"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done

# 3. Verifiera 3 .png i ut-mappen
find "$OUTDIR" -name 'bfl-flux-2-pro_*.png' | wc -l
# → förväntat: 3 (3 default-kategorier × 1 bild)
```

Upprepa med `minimax-image-01`. Båda körningar bör hamna i **samma** parent-mapp om klienten skickar samma `outDir` (UI:n gör detta automatiskt via `compare-test/out-dir`-endpointen).

## Verifiering av quota-formel (zoom-pipeline)

```bash
npx --env-file=.env --import 'file:///Users/claudgashi/EventPulse/node_modules/tsx/dist/loader.mjs' \
  scripts/_check_image_quota_v2.ts --only=music
# Förväntat:
#   music   4523 events  817 library  target=151  need=0  status=OK
```

Formel: `target = 20 + max(0, ceil((events - 600) / 30))`. Verifiera att scriptets utdata matchar formeln för minst 3 kategorier.

## Failure-lägen

| symptom | trolig orsak | fix |
|---|---|---|
| `curl POST /api/bfl/zoom-run` → 404 | Dashboard-TS-modulen inte omstartad efter server.ts-ändring | `kill -9 $(lsof -t -i:7777); nohup npx tsx .../server.ts &` |
| `Cannot find module '../lib/zoom-prompter.js'` | kör utan tsx-loader | använd `--import 'file:///.../tsx/dist/loader.mjs'` |
| `MiniMax status_code=2013 msg=invalid params, prompt length must be less than 1500` | M3 <think>-block ej strippad | bekräfta att `zoom-prompter.ts` har think-strip + 1200-char cap |
| `state.status` stannar på `running` efter klart | dashboard-omstart dödade orchestrator | bekräfta `detached: true, child.unref()` i server.ts endpoint OCH i orchestrator |
| 0 bilder för kategori med events > 0 | saknar `tmp/cluster_<cat>.json` | kör `tsx BFL-generator/bin/bfl-cluster-real.ts --category=<cat>` först |
| Auto-fill returnerar count=0 | state fullt för alla kategorier (alla 1/30-quota-bidrag + alla 90 combos) | detta är korrekt, ingen åtgärd |
| Auto-fill returnerar count > 200 | servern har redan cap på 200 (`server.ts:2439`: `Math.min(200, totalGap + Math.min(50, totalMissingCombos))`) | inte ett problem |
| `imageCount` från status ökar inte över tid | batch subprocess dog mitt i | läs `log[]` i run-state, felet syns där |
| Modell-compare knapp öppnar fel mapp | `outDir` delades inte mellan knapparna | UI ska hämta `/api/bfl/compare-test/out-dir` efter första klick |

## Gotchas

- **`imageCount` ≠ "nya bilder"**. Räknaren kommer från `state.log.join('\n').match(/✓ /g)` i orchestrator (rad 121–122 i `bfl-zoom-orchestrate.ts`). Den räknar alla `✓` i stdout — inklusive eventuella tidigare log-rader som inte hunnit rensas. **Lita inte blint på `imageCount` — räkna `.webp`-filer på disk istället.**
- **Auto-fill kan ge stort N utan att skapa nya bilder**. UI ska tydligt visa att 0/N betyder "alla kombinationer fanns redan", inte "inget hände".
- **`/api/bfl/zoom-run/latest` returnerar null** om inga körningar gjorts senaste 24h. UI ska hantera null gracefult (statusrad gömd).
- **Cached prompts**: `tmp_image_corpus/<cat>_zoom_prompts.json` återanvänds av M3. Radera för att tvinga regenerering.
- **MiniMax URL expire**: URLs i metadata är OSSSignerade och tidsbegränsade. Persistent arkivering sker genom att batch-filen laddar ner via URL (vilket `bfl-zoom-batch.ts` redan gör).
- **TSX-loader krävs för .ts-filer**: Alla nya scripts är .ts — kör ALLTID via `node --import 'file:///.../tsx/dist/loader.mjs' script.ts` eller via `tsx`.
- **`btn-bfl-zoom-auto` är INTE disabled under körning** (bara `btn-bfl-zoom-run` + input disablas av `setZoomButtonsDisabled()` i app.js:2885). Användaren kan dubbelklicka → två körningar parallellt. Verifiera om det är önskat beteende.
- **Dashboard autorestart kräver manuell kick** — `tsx` laddar inte om server.ts automatiskt vid filändring. Efter server.ts-edits: `lsof -t -i:7777 | xargs kill -9` och starta om via auto-restart-scriptet.

## Evidence-platser

| Bevis | Sökväg |
|---|---|
| Run-state per körning | `tmp/bfl_runs/zoom_<runId>.json` |
| Run-state per compare-körning | `tmp/bfl_runs/compare_<runId>.json` |
| Genererade bilder (stämplade) | `local_image_library_stamped/<cat>/zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.webp` |
| Genererade bilder (raw PNG) | `local_image_library/<cat>/zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.png` |
| Metadata per bild | `local_image_library_stamped/<cat>/zoom_<cat>_..._<idx>.webp.json` |
| Coverage state | `state/zoom-coverage.json` |
| Quota-check output | stdout från `scripts/_check_image_quota_v2.ts` |

## Maintenance

Denna skill har en maintenance-loop:

1. Efter substantiella ändringar i någon av filerna under `BFL-generator/lib/zoom-*.ts`, `BFL-generator/bin/bfl-zoom-*.ts`, `tools/bfl-model-compare.mjs`, `server.ts /api/bfl/zoom-run*` eller `/api/bfl/compare-test*`, eller i `dashboard/public/{index.html,app.js,style.css}` för header-radens BFL-knappar: kör `/maintain-verification-skill verify-bfl-zoom-pipeline`.
2. Maintenance-passet uppdaterar `features/README.md` om en feature lagts till/togs bort, och per-feature `.md`-filen om sub-features eller kontrakt ändrats.
3. Efter uppdatering: kör smoke-testet igen för att bevisa att skill:en fortfarande matchar verkligheten.

Se `.cursor/skills/verify-eventpulse-ui/SKILL.md` för ett äldre exempel på samma mönster.