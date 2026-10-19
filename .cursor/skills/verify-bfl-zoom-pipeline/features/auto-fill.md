# auto-fill — feature #2 (live, delvis)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` rad 62–68 (`#btn-bfl-zoom-auto`) och dess handler i `app.js` raderna 2948–2970 (`startAutoZoomRun`).

UI-flödet där operatören låter **systemet** räkna ut hur många bilder som behövs för att fylla kvoten, baserat på `1/30-quota + saknade kombinationer`. Samma pipeline som #1 men `count` är beräknat istället för användarvalt.

## Sub-features

- **POST `/api/bfl/zoom-run`** — body: `{auto: true}` (alternativt `{auto: true, categories: ["music"]}`).
- **`computeAutoFillCount()`** — `server.ts:2398`. **B7 (FIXED 2026-10-19): disk är sanningen.**
  - **Användarens pipeline-ordning** (bestämd 2026-10-19):
    1. Ladda state från `state/zoom-coverage.json` (`loadCoverageState`, `server.ts:54`)
    2. **Synka state mot FAKTISKA `.webp.json`-filer på disk** (`reconcileFromDisk`, `BFL-generator/lib/zoom-coverage-state.ts`)
    3. **Persista synkad state** tillbaka till `state/zoom-coverage.json` (så state-filen speglar verkligheten)
    4. Hämta events per kategori (från Supabase)
    5. Räkna `diskMap` (defensiv cross-check mot state.totals)
    6. Beräkna gap + saknade kombos baserat på den SYNKADE staten
  - Tidigare användes `state.combos` rakt av — risken var att state glider ifrån disk (många batcher registrerade inte alla combos), vilket ledde till duplicerade prompts.
  - **Quota-formel** per kategori (`server.ts:2485`): `target = 20 + Math.max(0, Math.ceil((events - 600) / 30))`. Inte ett rent "1/30 events"-kvot — det är en `20 + …`-golv med `(events-600)/30`-lutning.
  - Saknade kombinationer: `missing = Math.max(0, 90 - existingCombos[tag].length)` summerat över alla taggar.
- **Slutlig formel** (`server.ts:2497`): `Math.min(200, totalGap + Math.min(50, totalMissingCombos))`. **Dubbel-cap** — totalt max 200, och "missing combos"-delen max 50.
- **Returnerar** `{ok, runId, pid, count, autoNote}`. `autoNote` är sträng som UI visar, t.ex. ` (auto-fill: count beräknat till 47 baserat på 1/30-quota + saknade kombinationer)`.
- **Startar samma pipeline** som feature #1 — `bfl-zoom-orchestrate.ts` → `bfl-zoom-batch.ts`.
- **Klient visar** först `auto-fill: räknar ut hur många som behövs…` sedan `auto-fill: count=N <autoNote>` sedan `genererar… X/N` (vanlig poll-driven UI).

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Tryck **F5** för färskt state (auto-refresh var 15 min).
3. Klicka **🎯 Auto-fill** (grön knapp, första i `#bfl-zoom-wrap`-blocket).
4. Statusrad visar `auto-fill: count=170 (auto-fill: …)` direkt efter klick.
5. Pipeline kör sedan som vanligt med det beräknade antalet.

## Driving it with curl

```bash
# 1. Räkna ut vad auto-fill väljer (utan att köra själva pipelinen)
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"auto":true}')
echo "auto response:"
echo "$RESP" | python3 -m json.tool

# Förväntat (typiskt för Stockholm-graphen):
# {
#   "ok": true,
#   "runId": "2026-10-18T...",
#   "count": 170,
#   "autoNote": " (auto-fill: count beräknat till 170 baserat på 1/30-quota + saknade kombinationer)"
# }

# 2. Polla
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
for i in $(seq 1 240); do
  S=$(curl -s "http://localhost:7777/api/bfl/zoom-run/$RUNID/status")
  STATUS=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"])')
  COUNT=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r.get("imageCount",0))')
  echo "  $(date +%T) status=$STATUS images=$COUNT"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 1.5
done

# 3. Räkna nya bilder
AFTER=$(find local_image_library_stamped -name 'zoom_*_*.webp' 2>/dev/null | wc -l)
echo "stamped total: $AFTER"

# 4. Inspektera state-coverage efter körning
python3 -c "
import json
d = json.load(open('state/zoom-coverage.json'))
print('totals:', d['totals'])
print('grand total:', sum(d['totals'].values()))
"
```

**Förväntat:**

| check | förväntat |
|---|---|
| POST returnerar `ok=true` | ja |
| POST returnerar `count` (0 ≤ count ≤ 200 pga cap) | ja |
| POST returnerar `autoNote` (icke-tom sträng) | ja |
| POST returnerar `pid` (orchestrator child PID) | ja |
| Om state-fullt: `count` är stor (1/30-quota summerat) men `imageCount` blir 0 | ja |
| Om state-tomt: nya bilder ≈ `count` | ja |
| Status-coverage `grand total` växer med nya bilder | ja |

## Gotchas

**B1 (UX-bugg, FIXED 2026-10-18): `btn-bfl-zoom-auto` är inte disabled under körning.** `setZoomButtonsDisabled()` i `app.js:2885–2890` togglade bara `btn-bfl-zoom-run` + `#bfl-zoom-count`. Auto-knappen var klickbar → dubbelklick → två körningar parallellt → dubbel MiniMax-kredit. **Fix:** lade till `btnAuto.disabled = disabled` i `setZoomButtonsDisabled()`. Verifierat via Playwright: `btnAutoDisabled=true` genom alla 8 samples × 1.5 s under hela körningen.

**B2 (UX-bugg): count=N stor men 0 skapat = "inget händer" för användaren.** När state är fullt returnerar `computeAutoFillCount()` ett stort N (summera 1/30-quota för alla kategorier), men pipeline skippar allt via state-aware skip. UI visar `genererar… 0/N` under hela körningen. Användaren uppfattar det som "knappen fungerar inte".

Två tänkbara fixar (utanför denna skill):
1. **Smart auto-fill**: returnera `count=0` om alla saknade kombinationer är täckta av 1/30-quota.
2. **Tydligare UI-status**: visa `0/N — alla N kombinationer finns redan` istället för bara `0/N`.

**B5 (CSS-bugg, FIXED 2026-10-18): status-rad kan hamna off-screen.** `#bfl-zoom-status` var `position: absolute; top: 100%` utan positionerad förälder (`.bfl-zoom-wrap` var `position: static`), så `top: 100%` blev 100% av `<html>`/viewport-höjden — status-raden renderades längst ner på sidan, inte under knappen. Användaren klickade uppe vid headern och såg ingenting. Verifierades med Playwright (status-rad vid `top:904, bottom:924` på viewport.height=900). **Fix:** `position: relative` på `.bfl-zoom-wrap` + flytta `#bfl-zoom-status` in i `.bfl-zoom-wrap`. Efter fix: `bottom: 196/900` ✓.

**B7 (data-bugg, FIXED 2026-10-19): state glider ifrån disk — auto-fill genererar duplicerade prompts.** Tidigare läste `computeAutoFillCount()` state rakt av och antog att `state.totals[cat]` reflekterade disk-antalet. Men `image_library`-tabellen i Supabase är ofullständig (många zoom-pipeline-filer registrerades aldrig där), och state-filen är en cache som _kan_ hamna ur synk om tidigare körningar inte `registerCombo`-ade alla genererade filer. Resultat: `state.totals.community=3` medan disk har 108 `.webp`-filer, varför gap-formeln underskattar och auto-fill skickar duplicerade prompts till MiniMax.

**Fix:** `reconcileFromDisk(state)` körs som steg 2 i `computeAutoFillCount()` (efter `loadCoverageState`, före gap-beräkning). Den skannar `local_image_library_stamped/**/*.webp.json`, parsar `category/cluster_tag/zoomId/pose/light`, kallar `registerCombo(... 'disk-reconcile')` (no-op om combo redan finns). Efter sync persistas state till `state/zoom-coverage.json`. **Verifierat:** state.totals gick från `{community:3, exhibition:2, music:4, circus:1}` (10 unika combos) → `{community:20, exhibition:3, music:12, circus:2, classical:3, theatre-comedy:2, theatre-drama:4, workshop:7}` (53 unika combos) efter en auto-fill-`POST` med `maxCount=1`. Batch direkt efteråt med `maxCount=3` returnerade `imageCount=1` — bekräftar att state-aware skip nu faktiskt skip:ar (inte duplicerar) eftersom combo redan fanns i state efter sync.

**Auto-fill kan inte begränsa medelvärde per kategori.** Den summerar bara `quota_per_cat + missing_per_cat`. Om 7 kategorier × 30 saknade = 210 skulle användaren teoretiskt få 210 bilder, men `Math.min(200, …)`-capen begränsar slutvärdet till **200**. Försumbart för MiniMax-kredit men UI-räknaren snurrar länge.

**`categories`-filter i auto-fill respekteras bara om satt.** Default = alla kategorier i `state/zoom-coverage.json`. Skicka `{auto: true, categories: ["music"]}` för att begränsa.

**Auto-fill kör ALLTID** — även om `count=0` (då blir det 0 bilder på 0 sekunder). UI ska inte låtsas att något händer.