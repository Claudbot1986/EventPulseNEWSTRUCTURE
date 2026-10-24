---
name: verify-zoom-pipeline
description: |
  Drive the BFL zoom-variation pipeline end-to-end via curl + disk inspection.
  Use for /verify-zoom-pipeline or when changes to BFL-generator/lib/zoom-prompter.ts,
  BFL-generator/bin/bfl-zoom-batch.ts, BFL-generator/bin/bfl-zoom-orchestrate.ts,
  server.ts /api/bfl/zoom-run endpoint, scripts/_check_image_quota_v2.ts, or the
  dashboard zoom-knapp must be verified. Pipeline: M3 (10 zoom × 3 pose × 3 ljus
  prompt-generation) → MiniMax image-01 → AI-generated stamp → local_image_library_stamped/
  Verifies: quota-formula, weighted distribution, M3 cache, MiniMax URL→file, stamp
  presence, metadata sidecars, run-state lifecycle.
disable-model-invocation: false
---

# verify-zoom-pipeline

Verifies the **Alt 2 zoom-variation pipeline** introduced 2026-10-18. Tests are end-to-end and touch real services (Supabase counts, M3 prompt API, MiniMax image API, local sharp stamping).

## Pipeline (recap)

```
dashboard btn-bfl-zoom-run
  → POST /api/bfl/zoom-run (server.ts)
    → spawn bfl-zoom-orchestrate.ts (detached, unref'd)
        → spawn bfl-zoom-batch.ts (detached, unref'd)
            → buildZoomPrompts() from lib/zoom-prompter.ts
            → generateMinimax() — POST https://api.minimax.io/v1/image_generation
            → stampImage() — sharp composite med AI-generated SVG
            → local_image_library_stamped/<cat>/<zoom>_<pose>_<light>_<idx>.webp + .json
```

## Pre-conditions

- `.env` har `MINIMAX_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Dashboard kör på :7777 (`lsof -i :7777`)
- `BFL-generator/tmp/cluster_music.json` finns (eller annan kategori som testas)
- Inga andra zoom-run subprocess kvar från gammal körning

## Smoke-test (10 bilder för music)

Kör från projektroten:

```bash
# 1. Rensa output
rm -rf local_image_library_stamped/_zoom_verify

# 2. Räkna "före" — antal bilder i image_library för music
SUPABASE_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
SUPABASE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
BEFORE=$(curl -s "$SUPABASE_URL/rest/v1/image_library?category_slug=eq.music&select=id" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
echo "image_library music (före): $BEFORE"

# 3. Starta körning via dashboard-endpoint
RUNID=$(curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":10,"categories":["music"]}' | python3 -c "import json,sys;print(json.load(sys.stdin)['runId'])")
echo "runId=$RUNID"

# 4. Polla status tills klar (eller timeout 6 min)
for i in $(seq 1 60); do
  STATUS=$(curl -s "http://localhost:7777/api/bfl/zoom-run/$RUNID/status" | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['status'])")
  COUNT=$(curl -s "http://localhost:7777/api/bfl/zoom-run/$RUNID/status" | python3 -c "import json,sys;r=json.load(sys.stdin)['result'];print(r.get('imageCount',0))")
  echo "  $(date +%T) status=$STATUS images=$COUNT"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 5
done

# 5. Verifiera bilder
ls -la local_image_library_stamped/music/ | grep -E "_[0-9]{3}\.webp$" | wc -l   # → 10
cat local_image_library_stamped/music/*_000.webp.json | python3 -m json.tool  # → har zoomId, pose, light, prompt, minimax_url, stamped=true

# 6. Verifiera stämpel — bildens pixel nedre-högra ska ha AI-generated SVG
# (sharp composite test: pixel-inspektion eller bara file size > no-stamp-versionen)
```

## Förväntat resultat

| check | förväntat |
|---|---|
| `status` vid slut | `success` |
| `exitCode` | `0` |
| `.webp`-filer i `local_image_library_stamped/music/` | **10** |
| `.json`-metadata per fil | 10 |
| Metadata har `stamped: true`, `stamp_variant: "legacy"` | ja |
| Metadata har `zoomId` ∈ {EC, CU, MCU, MED, MLS, LS, WIDE, XW, EST, AER} | ja |
| Metadata har `pose` ∈ {still, dynamic, silhouette} | ja |
| Metadata har `light` ∈ {warm tungsten, cool daylight, mixed} | ja |
| `minimax_url` börjar med `http://hailuo-image-algeng-data-us...` | ja |
| `_check_image_quota_v2.ts --only=music` visar | OK (target=151, library=817) |

## Verifiering av quota-formel

```bash
node --env-file=.env --import 'file:///Users/claudgashi/EventPulse/node_modules/tsx/dist/loader.mjs' \
  scripts/_check_image_quota_v2.ts --only=music
# Förväntat:
#   music   4523 events  817 library  target=151  need=0  status=OK
```

## Verifiering av viktning (clusterstorlek)

Kör `--count=50 --categories=music,community,kids` och inspektera `manifest`:

```bash
# Antal bilder per kategori bör vara proportionellt mot events-antal:
# music:    4523 events → ~30-40 bilder
# community:1946 events → ~10-15 bilder
# kids:       98 events → ~1-3 bilder (om gap > 0)
```

## Failure-lägen

| symptom | orsak | fix |
|---|---|---|
| `Cannot find module '../lib/zoom-prompter.js'` | kör utan tsx-loader | använd `--import 'file:///.../tsx/dist/loader.mjs'` |
| `MiniMax status_code=2013 msg=invalid params, prompt length must be less than 1500` | M3 <think>-block | bekräfta att `zoom-prompter.ts` har think-strip + 1200-char cap |
| `state.status` stannar på `running` efter klart | dashboard-omstart dödade orchestrator | bekräfta `detached: true, child.unref()` i server.ts endpoint OCH i orchestrator |
| 0 bilder för kategori med events > 0 | saknar `tmp/cluster_<cat>.json` | kör `tsx BFL-generator/bin/bfl-cluster-real.ts --category=<cat>` först |
| M3 rate-limit | för många kombinationer samtidigt | sänk `concurrency` i bfl-zoom-batch.ts |

## Gotchas

- **Cached prompts**: `tmp_image_corpus/<cat>_zoom_prompts.json` återanvänds. Radera för att tvinga M3-regenerering.
- **Stämpel-nyckelord**: SVG:n använder `STAMP_TEXT='AI-generated'`. Matchar bfl-batch.ts (befintlig pipeline) exakt.
- **MiniMax URL expire**: URLs i metadata är tidsbegränsade (OSSSignerad). För persistent arkivering, ladda ner via URL (vilket bfl-zoom-batch.ts redan gör).
- **Image dimensions**: 1024×576 (16:9), samma som befintlig pipeline.
- **TSX-loader krävs för .ts-filer**: Alla nya scripts är .ts — kör ALLTID via `node --import 'file:///.../tsx/dist/loader.mjs' script.ts` eller via `tsx`.

## Doctor

```bash
# Dashboard lever?
curl -sI http://localhost:7777/ | head -1   # → HTTP/1.1 200 OK

# M3 svarar?
MINIMAX_KEY=$(grep '^MINIMAX_API_KEY=' .env | cut -d= -f2-)
curl -s -X POST https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}]}' | head -c 200

# MiniMax image-gen svarar?
curl -sI -X POST https://api.minimax.io/v1/image_generation \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"test","width":1024,"height":576}' | head -1

# Cluster-fil finns för music?
ls -la BFL-generator/tmp/cluster_music.json  # → ska finnas
```

Doctor-failure innebär att pipeline inte är värd att driva. Stoppa. Investigera.