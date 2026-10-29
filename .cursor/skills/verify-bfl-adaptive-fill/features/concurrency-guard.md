# concurrency-guard — feature #4 (live)

Speglar `09-ScrapingSupervisor/dashboard/server.ts` (`findAdaptiveRuns()`,
`adaptiveLockOwner()`, `POST /api/bfl/adaptive-run`) och
`scripts/adaptive_image_gen.ts` (`acquireLock()`).

Skydden som gör att bara **en** bildgenerering kör åt gång.

## Sub-features

- **Serverguard (HTTP 409)** — innan spawn scannar servern efter pågående
  `adaptive_image_gen.ts`-processer (`ps -ax -o pid=,command=`). Hittas någon
  svarar servern **409** med förklaringen:
  `"en bildgenerering körs redan (pid <pid>) — MiniMax-taket är 10 bilder/min,
  så två körningar samtidigt skulle ge 429-fel"`.
- **Låsfil** — `runtime/adaptive-image-gen/run.lock` innehåller `{pid, startedAt}`.
  Servern läser den som en andra kontroll.
- **Processlås** — `scripts/adaptive_image_gen.ts` tar låset med `openSync(path,'wx')`
  vid start och släpper det vid exit. Om ägarens PID inte lever längre tas
  låset över (stale PID).
- **Per-process RPM** — `RpmGuard` i generatorn tillåter 9 anrop/min
  (MiniMax tak 10, marginal 1).

## Why it exists

`RpmGuard` räknar anrop **inom en process**. MiniMax `image_generation` har
10 RPM. Två parallella körningar ger tillsammans upp till 18 anrop/min →
HTTP 429 → bilder saknas utan förklaring. Underkända bilder är dessutom
dyra (de förbrukar samma kredit).

## How to get to it (user POV)

1. Starta en körning med knappen (den går igång direkt).
2. Klicka knappen igen medan den första körningen pågår.
3. Statusraden visar: `✗ en bildgenerering körs redan (pid 51335) — …`.
4. Ingen ny körning startar; ingen ny run-mapp skapas.

## Driving it with curl

```bash
# Starta en körning (kan ta minuter)
curl -s -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":3}' > /tmp/run1.json
cat /tmp/run1.json | python3 -m json.tool

# Försök starta en till direkt
curl -s -o /tmp/run2.json -w "HTTP %{http_code}\n" \
  -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":3}'
cat /tmp/run2.json | python3 -m json.tool
# → HTTP 409
# → {"ok": false, "error": "en bildgenerering körs redan (pid …) …"}

# Låset
cat runtime/adaptive-image-gen/run.lock
```

**Förväntat:**

| check | förväntat |
|---|---|
| Första POST | 200 + `runId` |
| Andra POST (medan första kör) | **409** + `ok:false` + feltext med pid |
| `run.lock` under körning | finns, innehåller pid |
| Antal run-mapper i `runtime/adaptive-image-gen/runs/` | ökar **inte** av det nekade anropet |

## Gotchas

- **Låset är globalt, inte per run-mapp.** Två körningar i olika mappar skulle
  annars kunna köra samtidigt.
- **Stale lås tas över automatiskt** om PID inte lever. Låset kan därför inte
  blockera en ny körning efter en hård kill.
- **Serverns process-scan är en ögonblicksbild.** En körning som startar
  millisekunder efter att servern scannat kan kö parallellt med den gamla.
  Låset i generatorn fångar det fallet (andra processen avbryter med exit 2).
- **Ett script som startas utanför dashboarden** (t.ex. direkt i terminalen)
  håller låset → dashboardens knapp vägrar med "låset är taget av pid X".
- **Avbrytning av en körning**: `kill <pid>` (pid finns i `run.json`).
  Låset släpps då processen dör — men bara om PID inte lever längre, annars
  står låset kvar tills nästa start tar över.
