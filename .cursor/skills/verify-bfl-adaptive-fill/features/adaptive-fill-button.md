# adaptive-fill-button — feature #1 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` (`#btn-bfl-compare-minimax`)
och `app.js` (`startAdaptiveRun` → `pollAdaptiveRun`).

Knappen fyller EventPulses bildbibliotek med nya AI-genererade evenemangsbilder.
Det är **inte** längre en jämförelsetest — det är produktionspipelinen.

## Sub-features

- **POST `/api/bfl/adaptive-run`** — body `{count:N, extra?, concurrency?, start?}`.
  Svar: `{ok, runId, pid, count, extra, concurrency, runDir}`.
  - `count` (1–800, default 300) = antal bilder som ska genereras.
  - `extra` (0–800, default = `count`) = bilder **utöver** kvotplanen.
  - `concurrency` (1–12, default 8) = parallella workers.
  - `start` (1–64, default 32) = första omgångens storlek.
- **GET `/api/bfl/adaptive-run/:id/status`** → `{status, generated, passed, failed,
  apiErrors, round, target, remaining, percent, lastVerdict, logTail}`.
- **GET `/api/bfl/adaptive-run/latest`** → samma fält för senaste körningen
  (null om ingen körning finns).
- **Spawnad process** — `node --env-file=.env --import tsx
  scripts/adaptive_image_gen.ts --run-dir=… --extra=… --max-total=… --start=…
  --max-rounds=60 --concurrency=… --reset`, `detached: true` + `unref()`.
- **Output** — `local_image_library_stamped_v2/<category>/zoom_<cat>_<slug>_<pose>_<light>_adp_<idx>.webp`
  + `.webp.json`-sidecar (`cluster_tags`, `zoomId`, `pose`, `light`, `prompt`).
  **Inte** i körningsmappen — den innehåller bara tillstånd och loggar.
- **Underkända bilder → karantän** — bilden skrivs till disk FÖRE M3-granskningen.
  En underkänd bild (förvanskat text, artefakter, närbild där helhetsbild skulle
  stå) flyttas till `local_image_library_stamped_v2_quarantine/<category>/` och
  laddas alltså INTE upp. Karantänen ligger utanför `OUT_DIR` med flit, så den
  syns inte i uppladdningen, inventeringen eller kvalitetsgrinden (fix
  2026-10-29 — tidigare laddades underkända bilder upp och räknades som
  "klara" i nästa körning).
- **Compliance** — varje bild är 3:2 (1248×832), har synlig "AI-genererad"-stämpel
  i nedre vänstra hörnet och XMP-paket med maskinläsbar AIGC-märkning.
- **`--extra` fördelas proportionellt** mot kategorins antal framtida events
  (largest-remainder). Det är INTE "N extra bilder ovanpå kvoten" — `extra`
  höjer kategorins *mål*, och bara *deficiten* (`mål - befintligt`) genereras.
  Med `--extra=3` och en dominerande kategori (`community`, ~5 800 events)
  hamnar alla 3 i den kategorin.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Vänta ~3 s (dashboardens init hämtar status; knappen kopplas först sedan).
3. Header-raden: sätt talet i fältet bredvid **🟧 MiniMax image-01**
   (default 300).
4. Klicka **🟧 MiniMax image-01**.
5. Statusraden visar `startar N bilder…` → `genererar… X/N · <senaste verdict>`.
   Progress-baren fylls.
6. Slutstatus: `✓ klar — N bilder (G godkända, U underkända, E API-fel)`.

## Driving it with curl

```bash
# Starta
RESP=$(curl -s -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":3}')
echo "$RESP" | python3 -m json.tool
RUNID=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runId"])')
RUNDIR=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["runDir"])')

# Polla
for i in $(seq 1 600); do
  S=$(curl -s "http://localhost:7777/api/bfl/adaptive-run/$RUNID/status")
  LINE=$(echo "$S" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r["status"],r["generated"],"/",r["count"])')
  echo "  $(date +%T) $LINE"
  case "$LINE" in success*|failed*) break;; esac
  sleep 1.5
done

# Körningsmappen innehåller TILLSTÅND, inte bilder:
ls "$RUNDIR"
# → run.json  progress.json  run.log  state.json  verify.ndjson

# Bilderna ligger i BIBLIOTEKET. Använd en markör — biblioteket är
# kumulativt, så en ren `find` räknar alla tidigare bilder också.
MARKER=$(mktemp /tmp/adpfill.XXXXXX); sleep 1
find local_image_library_stamped_v2 -name '*.webp' -newer "$MARKER" | wc -l
```

**Förväntat:**

| check | förväntat |
|---|---|
| POST svarar `ok=true` + `runId` | ja |
| `runDir` innehåller `run.json`, `progress.json`, `run.log`, `state.json`, `verify.ndjson` | ja |
| Slutstatus | `success` |
| `generated` = beställt antal (minus fel) | ≈ `count` |
| `passed + failed` = `generated` | ja |
| `apiErrors` | 0 (429 betyder parallell körning — ska inte ske) |
| Nya `.webp` i `local_image_library_stamped_v2` (räknat med markör) | ≥ `generated` |
| Underkända bilder | flyttade till `local_image_library_stamped_v2_quarantine/` |
| Bilddimensioner | 1248×832 (3:2) |
| `.webp.json` har `cluster_tags` | ja (annars kan `pickLibraryFallback` inte matcha raden) |

## Gotchas

- **Knappen är låst till en körning åt gång.** Servern svarar 409 om en annan
  `adaptive_image_gen.ts` kör. Det är korrekt beteende (se `concurrency-guard.md`).
- **Kvoten kan vara uppfylld.** Utan `--extra` är planen tom och knappen gör
  ingenting. Endpointen skickar därför `--extra=count` som default, så knappen
  alltid fyller på. `extra` fördelas proportionellt mot kategorins antal
  events — se Sub-features.
- **`percent` räknas mot `count`**, inte mot planens `target`.
- **`generated` räknas per bild**, inte per omgång — talet tickar monotont.
- **Underkända bilder räknas som genererade** (`failed`) och flyttas till
  karantän. Kvoten är därför inte uppfylld för en kategori bara för att 3
  bilder underkändes — nästa körning genererar nya i stället.
- **Filerna genereras INTE i Supabase av knappen.** Knappen fyller diskbiblioteket;
  publiceringen är ett separat, medvetet steg (se `publish-to-app.md`). Det är
  därför appen inte visar de nya bilderna direkt efter knappen.
- **Dashboarden laddar om var 15:e minut.** En pågående körning fortsätter
  (processen är detached), men UI:t återupptar den via `/api/bfl/adaptive-run/latest`.
- **`/latest` och `/:id/status` har samma fältmängd** (14 st i `result`).
- **Initieringen kopplar knappen först efter `/api/status` svarat** (~3 s).
  Ett klick under den tiden gör ingenting — vänta på att knappen blir
  klickbar, eller vänta på `[data-wired="1"]` i Playwright.
