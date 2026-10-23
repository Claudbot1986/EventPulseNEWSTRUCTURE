# orchestrator-cron

`scripts/ingestion-cron.ts` — nattlig sekventiell körning av hela discovery-pipelinen. Ägs av launchd (`com.eventpulse.ingestion` plist).

## Sub-features

- Step-lista (`scripts/ingestion-cron.ts:351-611`, **23 steg**): A-directAPI → B-network-api → eventbrite-pagination → tribe-events → sitemap-discovery → subpath-discovery → direct-jsonld → livespot-stockholm → C-htmlGate → D-renderGate → I-pdfExtraction → etag-refresh → api-discovery → luma-stockholm → ra-stockholm → posh-stockholm → reddit-stockholm → D-images → P2C-active-learning → P3A-discovery → P3B-venue-graph-geo → P3C-rss-discovery → **P3D-source-candidate-tests** (ny 2026-10-21)
  - Verifiera listan mot koden, inte mot den här raden:
    ```bash
    grep -n "name: '" scripts/ingestion-cron.ts | sed "s/.*name: '\([^']*\)'.*/\1/" | tr '\n' ' '; echo
    grep -c "name: '" scripts/ingestion-cron.ts   # ska vara 23
    ```
  - **`manual-review-triage` och `pattern-promoter` togs bort ur kedjan 2026-10-21.** Båda körde `runC-pattern-promoter.ts` vars producent (`runC-pattern-validator.ts`) aldrig skrevs → hela kedjan var bruten. Koden ligger kvar på disk; att aktivera den kräver ett eget validator-bygge (se `pattern-promoter.md`).
- Per-step loggar: `runtime/ingestion-cron/steps/<name>-<ISO>.{log,err.log}`
- Chain-overview (JSONL): `runtime/ingestion-cron/chain-overview.log` — `{step-start|step-end|heartbeat|pre-kill|green-skip, ...}`
- Status-singleton: `runtime/ingestion-cron.status.json` — `running, pid, startedAt, lastHeartbeatAt, steps[], totalEventsExtracted`
- Pre-discovery kill-check (2026-10-18, `ingestion-cron.ts:620-719`): dödar levande discovery-processer innan step-loop startar
- Green-skip-gate (2026-10-18, `ingestion-cron.ts:728-795`): läser `runtime/discovery-verification.status.json` för senaste verify-status; skriver skip-fil vid grön korrigering
- Watchdog-output: `runtime/ingestion-cron/watchdog.json` (läs av watchdog-script, ej orchestrator)

## How to get to it (user POV)

Användaren ser cron-orchestratorn indirekt: dashboard 7777 visar pågående steg, totalEventsExtracted ökar, status.json visar `running:true`. Manuell körning: `npx tsx scripts/ingestion-cron.ts --smoke` (~15 min, minimal data).

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Vilka steg kördes i senaste körningen?
jq -r 'select(.event=="step-start") | .step' runtime/ingestion-cron/chain-overview.log | tail -25

# 2. Vilka har step-end?
jq -r 'select(.event=="step-end") | "\(.step)\t\(.exitCode)\t\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -25
# → exit=0 för alla slutförda

# 3. Häng-detektion: stage med step-start men inget step-end och >5 heartbeats
python3 -c "
import json
events = [json.loads(l) for l in open('runtime/ingestion-cron/chain-overview.log')]
last_end_per_step = {}
last_start_per_step = {}
hb_count_per_step = {}
for e in events:
    s = e.get('step')
    if not s: continue
    if e['event']=='step-end': last_end_per_step[s] = e['ts']
    if e['event']=='step-start': last_start_per_step[s] = e['ts']
    if e['event']=='heartbeat': hb_count_per_step[s] = hb_count_per_step.get(s,0)+1
hung = [s for s in last_start_per_step if (not last_end_per_step.get(s) or last_start_per_step[s] > last_end_per_step.get(s,'')) and hb_count_per_step.get(s,0) > 5]
print('HUNG STAGES:', hung)
print('Heartbeat counts:', {s:c for s,c in hb_count_per_step.items() if c>3})
"

# 4. status.json har färsk heartbeat?
python3 -c "
import json, datetime
d=json.load(open('runtime/ingestion-cron.status.json'))
h=d.get('lastHeartbeatAt') or d.get('startedAt')
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(h.replace('Z','+00:00'))).total_seconds()
print(f'heartbeat age={age:.0f}s running={d.get(\"running\")} pid={d.get(\"pid\")} steps={len(d.get(\"steps\",[]))}')
"
# → heartbeat age < 7200 (2h)

# 5. Pre-kill + green-skip har körts?
jq -c 'select(.event=="pre-kill" or .event=="green-skip")' \
  runtime/ingestion-cron/chain-overview.log | tail -5
# → förväntat lång lista efter 2026-10-18 (varje cron-start loggar pre-kill)
```

Bevis: `chain-overview.log` + `status.json` + `steps/<stage>-<ISO>.log`.

**Green = alla steg har `step-end` med exit=0 + `heartbeat age < 2h` (om körning pågår). `totalEventsExtracted` korrekt summerat över de steg vars adapter skriver en tolkbar totalrad (parser i `ingestion-cron.ts:parseStepCounts`).** Stödda steg: tribe-events, sitemap-discovery, direct-jsonld, eventbrite-pagination, livespot-stockholm, luma-stockholm, posh-stockholm, ra-stockholm. Övriga steg rapporterar `eventsExtracted: null` ("vet inte" — antingen skriver steget eget JSON-format eller persisterar inte).

**`ok: true` i skip-filen styrs av `totalExit === 0`** (`ingestion-cron.ts:800`, else-gren rad 815-832). Vid röd körning skrivs `ok:false` + `failedSteps` + bevarad `lastGreenAt`. En tidigare grön fil lever alltså kvar som `lastGreenAt`-fältet även efter en misslyckad körning.

**Radnummer i den här filen kan bli gamla.** De ovan är kontrollerade 2026-10-23
mot `scripts/ingestion-cron.ts`. Hitta alltid symbolen i stället för raden:
```bash
grep -n "totalExit === 0\|event: 'pre-kill'\|discovery-verification.status.json" scripts/ingestion-cron.ts
```

## Gotchas

**Heartbeat fortsätter även vid häng.** En steg som fastnat i retry-loop genererar heartbeats var 60s — det betyder INTE att steget gör framsteg. Kör hung-detect-grepet ovan för att se om ett steg har `step-start` utan `step-end`.

**Pre-discovery kill-check (2026-10-18) dödar processer vars cmdline matchar `/scripts\/ingest-[\w-]+\.m?js|/scripts\/discover-[\w-]+\.m?js|/07-Discovery\/src\//` eller innehåller `geoExpansion`/`rssDiscovery`/`discoverySearch`.** Andra typer (t.ex., `node 09-ScrapingSupervisor/dashboard/server.ts`) överlever.

**Green-skip-gate (2026-10-18) skriver till `runtime/discovery-verification.status.json`** med `{ok, lastGreenAt, runId, totalEventsExtracted, durationMs}`. Hoppar INTE över cron-körningen själv — cron ÄR det som körs. Skippet låter bara framtida verify-skill-körningar skippa sig själva om allt är grönt <24h.

**Smoke-flaggorna är INTE enhetliga — kontrollera per steg i koden.**

| Steg | `--smoke` | Produktion |
|---|---|---|
| A / B / D / I-pdf / etag | `--limit 1` (`effectiveLimit`, rad 251) | `--limit <limit>` |
| `D-images` | `--limit 3` | `--limit <limit>` |
| P3A | `--queries 1 --per-query 1 --min-exa 1` | `--queries 10 --per-query 10 --min-exa 1` |
| P3B-geo | `--limit 5 --geo-radius-m 500 --city Stockholm` | `--limit 50` (samma rad) |
| P3C-rss | `--limit 5 --concurrency 2` **+ `--dry-run`** | `--limit 100 --concurrency 5` |
| P3D | `--phase=smoke --limit=1` | `--phase=smoke --limit=20` |

P3C-rss i smoke är den enda som får `--dry-run` — och det är en
**presence-flagga** (`...(smoke ? ['--dry-run'] : [])`, rad 571), inte
`--dry-run=true`. Skriv `=`-formen och du får flaggan ändå; skriv
`--dry-run=false` och du får den också. P3D däremot kräver `=`-formen för
`--limit` (`--limit=${...}`, rad 610) — mellanslagsform tyst ignoreras.

`--min-exa 1` är samma värde i båda lägena, så Exa-gaten är lika aggressiv
i smoke som i produktion.

**`--skip-images` dödar både `D-images` och `P2C-active-learning`.** De ligger bakom `if (!skipImages)` i cron-scriptet.

**launchd-plisten sätter `EVENTPULSE_PROJECT_ROOT`** — orchestratorn läser den i `dotenv.config({ path: ... resolve(PROJECT_ROOT, '.env') })` (runDaily.ts:29, men cron läser här den via env i spawn()). Manuell körning behöver `cd /Users/claudgashi/EventPulse`.

**`runtime/ingestion-cron.status.json` blir stale om cron-processen dör utan att skriva slutstatus.** Lösning = watchdog upptäcker stale och launchd startar en ny.