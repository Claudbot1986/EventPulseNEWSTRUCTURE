# concurrency-guard — feature #4 (live)

Speglar `09-ScrapingSupervisor/dashboard/server.ts` (`findAdaptiveRuns()`,
`adaptiveLockOwner()`, `POST /api/bfl/adaptive-run`) och
`scripts/adaptive_image_gen.ts` (`acquireLock()`).

Skydden som gör att bara **en** bildgenerering kör åt gång.

## Sub-features

- **Serverguard (HTTP 409)** — innan spawn scannar servern efter pågående
  `adaptive_image_gen.ts`-processer (`ps -ax -o pid=,comm=,args=`). Matchningen
  kräver att `comm` (det körbara programmet) är **node** — en ren
  substring-sökning på args gav falska träffar: varje rad som *nämner* både
  "node" och "adaptive_image_gen.ts" (bash-rad, grep, editor) sågs som en
  pågående körning (fix 2026-10-29).
  Feltext: `"en bildgenerering körs redan (pid <pid>) — MiniMax-taket är 10
  bilder/min, så två körningar samtidigt skulle ge 429-fel"`.
- **Run.json-scan** — servern läser dessutom `runtime/adaptive-image-gen/runs/*/run.json`
  och nekar om någon av dem har ett **levande pid**. Det täcker fönstret
  mellan två samtidiga POST-anrop, där process-scanen ännu inte ser den andra
  processen (fix 2026-10-29).
- **Låsfil** — `runtime/adaptive-image-gen/run.lock` innehåller `{pid, startedAt}`.
  Servern läser den som en tredje kontroll. Sökvägen är **absolut från
  projektroten** (uträknad från skriptets placering), inte cwd-relativ — annars
  skulle en körning från en annan katalog skriva låset någon annanstans än
  servern tittar (fix 2026-10-29).
- **Processlås** — `scripts/adaptive_image_gen.ts` tar låset med `openSync(path,'wx')`
  vid start och släpper det vid exit **och vid SIGINT/SIGTERM**. Om ägarens
  PID inte lever längre tas låset över (stale PID).
- **Per-process RPM** — `RpmGuard` i generatorn tillåter 9 anrop/min
  (MiniMax tak 10, marginal 1). Det gäller `image_generation`. M3-granskningen
  (`/chat/completions`, 3 anrop per bild) går **utan** RPM-tak.

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
| Låset efter SIGTERM mot körningen | borttaget (inte kvar som stale) |

## Gotchas

- **Process-scanen matchar på `comm`, inte på hela args-raden.** Ett skal-kommando
  som *nämner* "node" och "adaptive_image_gen.ts" triggade tidigare en falsk
  409 (fix 2026-10-29, verifierat med `bash -c 'sleep 30 # node scripts/adaptive_image_gen.ts'`).
- **Låset är globalt, inte per run-mapp.** Två körningar i olika mappar skulle
  annars kunna köra samtidigt. Sökvägen är projektrot-relativ → samma fil
  oavsett vilken katalog kommandot startades från.
- **Stale lås tas över automatiskt** om PID inte lever. Låset kan därför inte
  blockera en ny körning efter en hård kill.
- **Serverns process-scan är en ögonblicksbild.** Run.json-scanen täcker
  fönstret mellan två samtidiga POST-anrop; låset i generatorn fångar resten
  (andra processen avbryter med exit 2).
- **Ett script som startas utanför dashboarden** (t.ex. direkt i terminalen)
  håller låset → dashboardens knapp vägrar. Process-scanen träffar först, så
  feltexten blir "en bildgenerering körs redan (pid X)" — inte
  "låset är taget av pid X". Den senare texten syns bara när process-scanen
  missar processen.
- **Avbrytning av en körning**: `kill <pid>` (pid finns i `run.json`).
  SIGINT/SIGTERM släpper låset (fix 2026-10-29). SIGKILL kan inte fångas →
  låsfilen blir stale och tas över av nästa start.
- **PID-återanvändning**: både låskontrollen och serverns pid-kontroll
  använder bara `process.kill(pid, 0)`. En återanvänd pid kan därför blockera
  en körning. Detta är en känd kvarvarande begränsning.
