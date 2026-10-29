---
name: verify-bfl-adaptive-fill
description: |
  Drive the Scraping Supervisor dashboard's adaptive image-fill button
  ("MiniMax image-01", port 7777) end-to-end: real UI click → POST
  /api/bfl/adaptive-run → detached scripts/adaptive_image_gen.ts run →
  progress-bar → 3:2 WebP files with XMP compliance → upload/register →
  image_library → events in the app. Use for /verify-bfl-adaptive-fill, when
  the fill button, its progress bar, the adaptive-run endpoints, the run lock
  or scripts/adaptive_image_gen.ts regress, when a changed number of images
  must be proven on disk and in the app, or before/after any change to
  scripts/adaptive_image_gen.ts, 08-Agent/tools/ai_compliance.ts,
  08-Agent/utils/imageLibrary.ts, the upload/prune/repair scripts, or
  dashboard/public/{index.html,app.js,style.css}. Feature map:
  features/README.md.
disable-model-invocation: false
---

# verify-bfl-adaptive-fill

Verifies the **adaptive fill** button in the Scraping Supervisor Dashboard header on
`http://localhost:7777` — the button that fills EventPulse's image library with new
AI-generated event images.

```
dashboard header
  ├─ #btn-bfl-compare-minimax (orange) → POST /api/bfl/adaptive-run {count:N}
  │                                     → spawn scripts/adaptive_image_gen.ts
  ├─ #bfl-adaptive-count    (input)   → antal nya bilder (1–800)
  ├─ #bfl-adaptive-progress (bar)     → aria-valuenow + "X / N"
  └─ #bfl-adaptive-status   (rad)     → "startar…" / "genererar…" / "✓ klar"
```

**Changed meaning 2026-10-29.** This button used to be a *model-compare test*
(3 throwaway images → `tmp/bfl_model_compare_*/`). It now runs the **production
adaptive fill**: the same pipeline as the long-running background job
(`scripts/adaptive_image_gen.ts`) — quota plan → MiniMax `image-01` generation →
M3 vision review (3 votes) → accept/reject gate → 3:2 WebP with XMP compliance
stamping → upload → `image_library` → events in the app.

The old compare-test flow still exists for the **BFL flux-2-pro** button and is
covered by `verify-bfl-zoom-pipeline`. Do not confuse the two.

## Pipeline (recap)

```
#btn-bfl-compare-minimax (click)
  → POST /api/bfl/adaptive-run {count:N}          server.ts (adaptive-run endpoint)
    ├─ guard: no other adaptive_image_gen.ts process (RPM is per process)
    ├─ guard: runtime/adaptive-image-gen/run.lock not held
    ├─ spawn (detached, unref'd): node --env-file=.env --import tsx
    │        scripts/adaptive_image_gen.ts
    │          --run-dir=runtime/adaptive-image-gen/runs/<runId>
    │          --extra=N --max-total=N --start=32 --max-rounds=60
    │          --concurrency=8 --reset
    │    → plan = quota deficit (20 + ceil((events-600)/30) per category)
    │             + --extra (distributed by category event count)
    │    → per round: generate → M3 review ×3 votes → gate (size ×2 / ÷2)
    │    → writes progress.json after EVERY image
    └─ writes run.json (pid, count, runDir, logPath)
  → GET /api/bfl/adaptive-run/<runId>/status      (polled every 1.5 s by app.js)
  → local_image_library_stamped_v2/<category>/zoom_<cat>_<slug>_<pose>_<light>_adp_<idx>.webp
                                                   + .webp.json sidecar
  → (separate step) scripts/_upload_stamped_to_storage.ts --src=local_image_library_stamped_v2 --register --apply
  → scripts/prune_dangling_library_rows.ts --apply
  → scripts/repair_broken_event_images.ts --apply
  → events.image_url points at a live object in the `event-posters` bucket
  → the Expo app renders the image
```

## Pre-conditions

| Requirement | Check |
|---|---|
| `.env` has `MINIMAX_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `grep -cE '^(MINIMAX_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env` → 3 |
| Dashboard on :7777 | `lsof -i :7777 \| grep LISTEN` |
| No other image generation running | `pgrep -f adaptive_image_gen.ts` → empty (see Gotchas) |
| Prompt clusters exist per category | `ls BFL-generator/tmp/cluster_*.json \| wc -l` → ≥ 1 |
| tsx loader present | `ls node_modules/tsx/dist/loader.mjs` |
| Playwright + chromium available | `ls ~/Library/Caches/ms-playwright/chromium-*` |

## Launch

The dashboard is a single Node process. It does **not** hot-reload — restart it
after every change to `server.ts`, `public/index.html`, `public/app.js` or
`public/style.css`.

```bash
cd /Users/claudgashi/EventPulse
lsof -t -i:7777 | xargs kill -9 2>/dev/null
nohup node --require ./node_modules/tsx/dist/preflight.cjs \
  --import file:///Users/claudgashi/EventPulse/node_modules/tsx/dist/loader.mjs \
  09-ScrapingSupervisor/dashboard/server.ts > runtime/dashboard.log 2>&1 &
sleep 4
curl -sI http://localhost:7777/ | head -1     # → HTTP/1.1 200 OK
```

Readiness = `GET /api/bfl/adaptive-run/latest` answers `{"ok":true,...}`.

## Doctor

Run before every drive. If any check fails, fix it before driving — a broken
instance produces misleading evidence.

```bash
# 1. Dashboard svarar?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7777/api/bfl/adaptive-run/latest

# 2. Knappen + fälten finns i DOM?
curl -s http://localhost:7777/ | grep -oE 'id="(btn-bfl-compare-minimax|bfl-adaptive-count|bfl-adaptive-progress|bfl-adaptive-status)"' | sort -u

# 3. Ingen annan körning igång (RPM-taket är per process)?
pgrep -fl adaptive_image_gen.ts || echo "ingen körning"

# 4. Låset är fritt?
cat runtime/adaptive-image-gen/run.lock 2>/dev/null || echo "fritt"

# 5. MiniMax svarar?
MINIMAX_KEY=$(grep '^MINIMAX_API_KEY=' .env | cut -d= -f2-)
curl -s -X POST https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}]}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("ok" if "choices" in d else "FAIL")'

# 6. Cluster-filer för kategorierna som ska fyllas?
ls BFL-generator/tmp/cluster_*.json | head

# 7. Hur många bilder finns redan?
find local_image_library_stamped_v2 -name '*.webp' | wc -l
```

## Drive — Playwright-harness (rekommenderad)

Curl + disk-inspection bevisar **kontrakt och resultat**. Playwright bevisar
**klick-beteende, status-rad, progress-bar och disabled-state** — det vill säga
den väg en användare faktiskt går.

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify_bfl_adaptive_fill.mjs --count=3 --timeout=900 --label=smoke
```

Flaggor:

| Flag | Default | Meaning |
|---|---|---|
| `--count=N` | 3 | Antal bilder att fylla på (sätts i `#bfl-adaptive-count`) |
| `--timeout=S` | 900 | Sekunder att vänta på att körningen ska bli klar |
| `--label=X` | `count-N` | Namn på rapportfilen i evidence-mappen |

Exitkod: `0` = alla assertions passerade · `1` = assertionfel · `2` = fatalt fel.
Om servern **nekar** starten (en annan körning är igång) skriver drivern
`skipped: true` i rapporten och avslutar med exit 0 — det är korrekt beteende,
inte ett fel.

### Vad drivern faktiskt gör (och bevisar)

1. Laddar dashboarden och **väntar på att knappen kopplas** (`[data-wired="1"]`).
   Dashboardens init-IIFE awaitar `/api/status` (~3 s) — en fast `sleep` ger
   flakiga körningar.
2. Fyller i `#bfl-adaptive-count` och verifierar att knappens undertext följer med.
3. Klickar med **riktiga pointer-events** (`mouse.down`/`mouse.up`), inte `click()`.
4. Fångar POST-body via `page.on('request')` → verifierar `"count":N`.
5. Läser status-rad + progress-bar under körningen, sparar screenshots.
6. Verifierar sidoeffekten på disk: **nya `.webp`-filer i `local_image_library_stamped_v2`**.

### Playwright-assertions per feature

| Feature | Måste-ha assertion |
|---|---|
| `adaptive-fill-button.md` | POST-body innehåller `"count":N`; knappen `disabled` under körningen; slutstatus `✓ klar`; **nya .webp-filer på disk** |
| `adaptive-count-input.md` | undertext speglar antalet (`"3 bilder · adaptiv fill"`); `aria-valuenow` går 0 → 100 |
| `progress-bar.md` | `#bfl-adaptive-progress` synlig efter klick; `aria-valuenow="100"` vid slut; progress-text `X / N` |
| `concurrency-guard.md` | andra starten → HTTP 409 + statusrad `✗`; ingen ny run-mapp skapas |

## Drive — curl (utan webbläsare)

```bash
# Starta en körning
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":3}')
echo "$RESP" | python3 -m json.tool
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')

# Polla tills klar
for i in $(seq 1 600); do
  S=$(curl -s "http://localhost:7777/api/bfl/adaptive-run/$RUNID/status")
  LINE=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"],r["generated"],"/",r["count"],r["percent"],"%")')
  echo "  $(date +%T) $LINE"
  case "$LINE" in success*|failed*) break;; esac
  sleep 1.5
done

# Verifiera filerna
RUNDIR=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runDir"])')
ls -la "$RUNDIR"
cat "$RUNDIR/progress.json"
```

## Drive — publicera till appen (efter att filerna genererats)

Att generera bilder är bara halva jobbet. Bilderna syns i appen först efter
uppladdning + registrering + reparation:

```bash
# 0. Karantän av underkända bilder (M3-granskningen underkände dem).
#    Utan detta laddas underkända bilder upp till appen.
node --env-file=.env --import tsx scripts/quarantine_rejected_images.ts --apply

# 1. Kvalitetsgrind (3:2 + XMP + synlig stämpel + kompositionsmix) — STÄR vid fel
node --import tsx .scratch/xmptest/quality-gate.mts

# 2. Ladda upp + registrera i image_library (cluster_tags måste med)
node --env-file=.env --import tsx scripts/_upload_stamped_to_storage.ts \
  --src=local_image_library_stamped_v2 --register --apply

# 3. Ta bort biblioteksrader som pekar på raderade filer
node --env-file=.env --import tsx scripts/prune_dangling_library_rows.ts --apply

# 4. Peka om events som pekar på döda bilder
node --env-file=.env --import tsx scripts/repair_broken_event_images.ts --apply
```

Steg 3 måste köras **före** steg 4: annars väljer `pickLibraryFallback` de döda
raderna (de har rating 3, de nya har `NULL` — indexet är
`(category_slug, rating DESC NULLS LAST, times_used DESC)`).

Samma kedja finns som ett körande skript: `.scratch/run-publish-chain.sh`
(väntar på att genereringen ska avslutas och kör sedan stegen i ordning).

## Drive — ge nytillkomna events bilder (check/följ)

Ingestion-kedjan kör `D-images` **innan** `import-to-eventpulse`. Events som
importeras under samma körning får därför ingen bild från den passen. Kör en
extra D-images-pass efteråt:

```bash
# 1. Kör ingestion-kedjan
npx tsx scripts/ingestion-cron.ts --limit 30 --skip-bfl

# 2. Ge de nyimporterade eventsen biblioteksbilder
npx tsx --eval "import('./08-Agent/services/imageGen.matchLibraryFirst.ts')
  .then(m => m.matchLibraryFirst({ limit: 500, onlyMissing: true,
    libraryConcurrency: 5, bflConcurrency: 0, skipBflFallback: true }))
  .then(r => console.log(JSON.stringify(r)))"

# 3. Verifiera att de nya eventsen faktiskt har bilder
node --env-file=.env --import tsx -e "
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await db.from('events')
  .select('id, title_sv, source, category_slug, image_url')
  .gte('created_at', '<NY_SEDAN>')
  .order('created_at');
const med = (data ?? []).filter(e => e.image_url && !e.image_url.includes('placeholder.local'));
console.log('nya events:', data?.length ?? 0, '| med levande bild-URL:', med.length);
"
```

**Varför `--skip-bfl`:** biblioteket är fullt; BFL-generering ska inte köras.
`skipBflFallback: true` gör att matchar utan biblioteksbild INTE försöker BFL.

**Förväntat:** `libraryMatched` ≈ antalet nya events, `unmatched` = 0.

**Fynd 2026-10-29:** `scripts/ingest-sitemap-discovery.mjs` skapade events
UTAN `category_slug`. Utan kategori kan `pickLibraryFallback` inte matcha
någon bild (biblioteket har inga NULL-kategori-bilder). 59 events stod därför
kvar utan bild tills kategorin backfillas till `community`
(`scripts/backfill_null_category.ts`). **Kontrollera alltid att nytillkomna
events har en kategori** innan du förväntar dig bilder på dem.

**`--only` på ingestion-cron:** flaggan läses som `--only A,B,C` **eller**
`--only=A,B,C` (båda fungerar sedan fixen 2026-10-29). Ett okänt stegnamn är
ett FEL (exit 2), inte en tyst "inget att göra".

## Evidence-platser

| Bevis | Sökväg |
|---|---|
| Playwright-screenshots + JSON-rapport | `.scratch/evidence/<YYYY-MM-DD>-adaptive-fill/` |
| Slutverifiering i appen (screenshots + rapport) | `.scratch/evidence/<YYYY-MM-DD>-app-images/` |
| Run-metadata (pid, count, logPath) | `runtime/adaptive-image-gen/runs/<runId>/run.json` |
| Progress (skrivs efter varje bild) | `runtime/adaptive-image-gen/runs/<runId>/progress.json` |
| Granskningslogg (en rad per bild) | `runtime/adaptive-image-gen/runs/<runId>/verify.ndjson` |
| Körningslogg (stdout) | `runtime/adaptive-image-gen/runs/<runId>/run.log` |
| Genererade bilder | `local_image_library_stamped_v2/<category>/zoom_*_adp_*.webp` |
| Underkända bilder (karantän) | `local_image_library_stamped_v2_quarantine/<category>/` |
| Metadata per bild | samma filnamn + `.webp.json` |
| Låsfil | `runtime/adaptive-image-gen/run.lock` |

**Rensa aldrig bevisen.** Cleanup får ta bort processer och scratch-state, men
inte `.scratch/evidence/`.

## Failure-lägen

| Symptom | Orsak | Fix |
|---|---|---|
| `POST /api/bfl/adaptive-run` → 404 | dashboarden startades före server.ts-ändringen | `lsof -t -i:7777 \| xargs kill -9` + starta om (Launch) |
| 409 "en bildgenerering körs redan" | en annan `adaptive_image_gen.ts` kör | vänta ut den, eller `pgrep -f adaptive_image_gen.ts` för att se vilken |
| Knappen gör ingenting i UI:t | init-IIFE:n awaitar `/api/status` (~3 s) | vänta på `[data-wired="1"]`, inte på en fast sleep |
| `run.log` slutar efter "bygger prompts" | M3 svarar inte | kontrollera `MINIMAX_API_KEY` (Doctor steg 5) |
| `status` stannar på `running` | processen dog utan att skriva `done` | läs `run.log` i körningsmappen + `pgrep -f adaptive_image_gen.ts` |
| `generated` stiger men inga filer på disk | filerna skrivs efter stämplingen | vänta; mät `find local_image_library_stamped_v2 -name '*.webp' \| wc -l` |
| Bilder syns inte i appen | inte uppladdade / inte registrerade | kör publiceringsstegen ovan (Drive — publicera) |
| `pickLibraryFallback` hittar ingen rad | `cluster_tags` saknas i `image_library` | registrera med `--register` (steg 2) |
| 429 från MiniMax | två körningar samtidigt (RPM är per process) | låset + serverns guard ska hindra detta |

## Gotchas

- **RPM-taket är per process, inte globalt.** `RpmGuard` i
  `scripts/adaptive_image_gen.ts` räknar anrop inom en process. Två parallella
  körningar ger tillsammans upp till 18 anrop/min mot MiniMax taket 10/min →
  429. Därför finns både ett globalt låst (`run.lock`) och en process-scan i
  serverns endpoint.
- **`--extra` lägger till bilder UTÖVER kvotplanen.** Kvoten är
  `20 + ceil((events-600)/30)` per kategori. Utan `--extra` är planen tom när
  kvoten är uppfylld, och knappen skulle göra ingenting.
- **`--max-total` är taket på ANTAL genererade bilder**, inte på planen. Den
  sista omgången kan inte överskrida taket (batchstorleken klipps).
- **`percent` räknas mot `count`** (det beställda antalet), inte mot planens
  `target`. De kan skilja sig när kvoten redan är uppfylld.
- **`state.json` per körning.** Varje körning har sin egen `--run-dir`; den
  gamla bakgrundskörningens state ligger i `runtime/adaptive-image-gen/state.json`
  och ska inte röras.
- **Progress skrivs efter varje bild**, inte per omgång — baren rör sig jämnt.
- **Bilder expirerar.** MiniMax-URL:erna i `.webp.json` (`minimax_url`) är
  tidsbegränsade; filerna själva är lokala kopior.
- **Dashboarden laddar om automatiskt var 15:e minut.** Sidans JS-minne
  (`compareBtnState.sharedOutDir`) tömms då. Körningar som startats via UI:t
  lever kvar (processen är detached), men statusraden återupptas via
  `/api/bfl/adaptive-run/latest` vid sidladdning.

## Maintenance

1. Efter substantiella ändringar i `scripts/adaptive_image_gen.ts`,
   `09-ScrapingSupervisor/dashboard/server.ts` (adaptive-run-endpoints),
   `dashboard/public/{index.html,app.js,style.css}` eller publiceringsskripten:
   kör `/maintain-verification-skill verify-bfl-adaptive-fill`.
2. Maintenance-passet uppdaterar `features/README.md` om en feature lagts till
   eller tagits bort, och per-feature-filen om kontrakt ändrats.
3. Kör om smoke-testet efteråt för att bevisa att skill:en fortfarande matchar
   verkligheten.

Relaterade skills: `verify-bfl-zoom-pipeline` (header-radens övriga knappar),
`verify-eventpulse-ui` (Appen), `verify-eventpulse-live` (live-API).
