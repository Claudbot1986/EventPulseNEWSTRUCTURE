---
name: verify-eventpulse-discovery
description: |
  Verify the EventPulse discovery pipeline (scripts/ingest-*.mjs, 07-Discovery/src/,
  scripts/ingestion-cron.ts orchestrator) by reading the runtime files it writes.
  Use for /verify-eventpulse-discovery, when a discovery script (tribe-events,
  sitemap-discovery, subpath-discovery, direct-jsonld, livespot, luma, ra, posh,
  reddit, eventbrite-pagination, etag-refresh, P3A-P3C, pattern-promoter,
  manual-review-triage) misbehaves, or when a stage hangs in
  runtime/ingestion-cron/chain-overview.log. Surface is launchd-driven batch
  orchestration (com.eventpulse.ingestion plist) — the skill inspects evidence,
  it does NOT spawn new runs. LLM-driven discovery ranking lives under
  07-Discovery/src/sourceTesting/ (realToolRunner, runner, phases, decision).
disable-model-invocation: false
---

# verify-eventpulse-discovery

## Launch

Discovery-pipelinen ägs av launchd (`com.eventpulse.ingestion` plist) — **aldrig starta en ny pipeline-run inifrån denna skill**. Rör inte `npx tsx scripts/ingestion-cron.ts` eller `npx tsx 09-ScrapingSupervisor/runDaily.ts` i verifieringssyfte.

**Konvention:** behandla en körning som ett *read-only artefakt*. Innan du kan verifiera behöver en körning ha producerat sina filer. Normalt sker det nattetid via launchd; för manuell verifiering kör `npx tsx scripts/ingestion-cron.ts --smoke` EN gång i en separat terminal och låt den slutföras (~15–30 min). `--smoke` sätter `effectiveLimit = 1`, `effectiveDBehavior = 'static-only'`, `--queries 1 --per-query 1`, `--limit 5`, `--dry-run=true` på P3C, `--limit 5` på pattern-promoter/triage — alla på riktiga kodvägar men med minsta datamängd.

Ready-signal = en komplitt `step-end` rad i `runtime/ingestion-cron/chain-overview.log` för **varje** steg i step-listan (se `scripts/ingestion-cron.ts:265–423`). Bekräfta med:

```bash
# Räkna steg-start och steg-end i chain-overview.log
jq -r '.event' /Users/claudgashi/EventPulse/runtime/ingestion-cron/chain-overview.log \
  | sort | uniq -c
# → förväntat (eller fler efter en nattkörning):
#   N  heartbeat        # minst 1 per minut per steg som tar >60s
#   N  step-end         # 1 per slutfört steg
#   N  step-start       # 1 per startat steg
# step-start och step-end ska matcha i antal
```

**Dotenv:** `scripts/ingestion-cron.ts` läser inte .env själv; `dotenv.config(...)` finns i `09-ScrapingSupervisor/runDaily.ts:29`. Manuella körningar behöver env-vars satta i förväg (SB_ACCESS_TOKEN, SUPABASE_*, GOOGLE_CSE_ID, GOOGLE_API_KEY, MINIMAX_API_KEY).

Isolering: en cron-process äger `runtime/ingestion-cron.status.json` åt gången. launchd startar en ny efter att en gammal dör. Döda ALDRIG en cron-process i farten för att "frigöra filen" — låt watchdog göra det (`runtime/watchdog.json`).

## Doctor

En read-only check som svarar på "finns det något värt att verifiera just nu?". Kör alltid först.

```bash
cd /Users/claudgashi/EventPulse

# 1. Lever cron-processen?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7777/api/ingestion/status
# → förväntat: 200 (eller 000 om dashboard inte kör)

# 2. Inga hängda discovery-processer?
ps auxww | grep -E "scripts/ingest-|scripts/discover-|07-Discovery/src|discover-subpaths|discover-hidden" \
  | grep -v grep
# → förväntat: tomt ELLER (en cron-process + watchdog).
#    tribe-events som varit uppe >2h = hängd (se steg 4 i runStep, ingestion-cron.ts:210).

# 3. status.json har färsk heartbeat?
python3 -c "
import json, datetime
s = json.load(open('runtime/ingestion-cron.status.json'))
h = s.get('lastHeartbeatAt') or s.get('startedAt')
age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(h.replace('Z','+00:00'))).total_seconds()
print(f'heartbeat age = {age:.0f}s, running = {s.get(\"running\")}, pid = {s.get(\"pid\")}')
"
# → förväntat: age < 7200 (2h). Annars stale → false positive på running=true.

# 4. watchdog lever?
test -f runtime/watchdog.json && jq -r '.lastCheck, .stalenessMin' runtime/watchdog.json
# → förväntat: lastCheck inom senaste 5 minuterna, stalenessMin < 120
```

Doctor-failure = antingen ingen pågående körning att verifiera (OK — gör inget), eller en stale-flagga (se Dashboard 0/0-noteringen i `verify-eventpulse-agent/features/ingestion-dashboard.md`). Stoppa, låt watchdog eller launchd rätta till, kör doctor igen.

## Drive

Harness = shell + `jq` + Python på JSONL. Inga Playwright/curl mot UI. Inga egna sub-process-spawningar.

**Stabila handtag** att greppa/jq:a mot:

| Signal | Källa | Förväntat |
|---|---|---|
| `runtime/ingestion-cron.status.json` | ingestion-cron skriver | `running`, `pid`, `startedAt`, `lastHeartbeatAt`, `steps[]`, `totalEventsExtracted` |
| `runtime/ingestion-cron/chain-overview.log` | ingestion-cron skriver (JSONL) | `{ts, event: step-start\|step-end\|heartbeat, step, exitCode?, durationMs?}` |
| `runtime/ingestion-cron/steps/<step>-<ISO>.log` | runStep skriver per steg | barnprocessens stdout |
| `runtime/ingestion-cron/steps/<step>-<ISO>.err.log` | runStep skriver per steg | barnprocessens stderr |
| `runtime/ingestion_runs.jsonl` | runDaily + writeIngestionRunSummary | `{runId, triggerSource, startTs, endTs, ok, sourcesAttempted, totalEventsFound, totalEventsPersisted}` |

**Driv-mönster (en discovery-stage verifiering):**

```bash
cd /Users/claudgashi/EventPulse

# 1. Vilka stages kördes i senaste körningen?
jq -r 'select(.event=="step-start") | .step' runtime/ingestion-cron/chain-overview.log \
  | tail -20
# → jämför mot step-listan i scripts/ingestion-cron.ts:265–467

# 2. Vilka stage:ar har step-end?
jq -r 'select(.event=="step-end") | "\(.step)\texit=\(.exitCode)\tduration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -20
# → exit=0 för alla slutförda steg

# 3. Inga hängda heartbeats?
python3 -c "
import json, datetime
# Hitta sista step-start och sista step-end för varje steg
events = [json.loads(l) for l in open('runtime/ingestion-cron/chain-overview.log')]
last_end = max((e['ts'] for e in events if e['event']=='step-end'), default=None)
last_start = max((e['ts'] for e in events if e['event']=='step-start'), default=None)
print(f'last step-end   = {last_end}')
print(f'last step-start = {last_start}')
if last_start and (not last_end or last_start > last_end):
    # Hängd — vilken stage?
    cur = next((e['step'] for e in reversed(events) if e['event']=='step-start'), None)
    print(f'CUR HÄNG-STAGE = {cur}')
"
```

**Driv-mönster (verifiera tribe-events specifikt — senaste häng-incidenten):**

```bash
# Hitta senaste tribe-events-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/tribe-events-*.log 2>/dev/null | head -1)
echo "Latest tribe log: $LATEST"

# Hur lång var körningen?
head -3 "$LATEST"; echo '---'; tail -20 "$LATEST"

# Vad gjorde den skriben?
grep -E "page [0-9]+: (fetched|error|queued|HTTP)" "$LATEST" | tail -10
# → förväntat: 'fetched=N future=N' eller HTTP-fel som inte upprepas.
#    tribe-events hängde 2026-10-18 med upprepade 'page 1: HTTP error'.

# Vilka wp-json URL:er försökte den?
grep -oE 'https://[^ ]+/wp-json/tribe/events/v1/events' "$LATEST" | sort -u
```

**Driv-mönster (P3A-P3C verifiering):**

```bash
# P3A-discovery körs i chain-overview.log
jq -r 'select(.event=="step-end" and .step=="P3A-discovery") | .exitCode' \
  runtime/ingestion-cron/chain-overview.log | tail -3
# → exit=0

# P3B-geo: kolla att supabase geo_candidates ökade
# (använd supabase-cli eller psql mot projektet)
echo "SELECT COUNT(*) FROM geo_candidates WHERE created_at > now() - interval '24 hours';" \
  | supabase db remote-query 2>/dev/null || echo "(supabase remote-query unavailable, skip)"
```

**Driv-mönster (senaste runDaily summary):**

```bash
tail -5 runtime/ingestion_runs.jsonl | jq -r '"\(.startTs) \(.triggerSource) ok=\(.ok) attempted=\(.sourcesAttempted) found=\(.totalEventsFound)"'
# → förväntat: ok=true attempted>0 found>0 för dagliga körningar
#    (tidigare bugg: 0/0 — fixad 2026-10-18 med parseRunStats i runDaily.ts:47)
```

## Evidence

**Wire-loggar** (read-only bevis):

- `runtime/ingestion-cron/chain-overview.log` — JSONL, varje rad = en steg-start/-end/-heartbeat. watchdog kan tail:a den för att detektera häng.
- `runtime/ingestion-cron/steps/<step>-<ISO>.{log,err.log}` — full stdout/stderr för enskilt steg. När ett steg hänger: läs den senaste filen.
- `runtime/ingestion-cron.status.json` — singleton-state för dashboard 7777.
- `runtime/ingestion_runs.jsonl` — summerade körningar från runDaily + cron (via `02-Ingestion/tools/runRecorder.ts:writeIngestionRunSummary`).

**Supabase side-effects:**

| Tabell | Vad | När |
|---|---|---|
| `events` | nya events från A/B/C/D/P0-steg | per stage |
| `source_candidates` | discovery output från P3A google-cse + Exa | per P3A |
| `geo_candidates` | venue-graph expansion från P3B | per P3B |
| `rss_feeds` | P3C RSS-prenumerationer | per P3C |
| `venue_graph` | venue-cluster från 07-Discovery | per geo-expansion |

`COUNT(*) WHERE created_at > now() - interval '24 hours'` före/efter en discovery-run.

**Verifieringsprovenok:** kör mot riktig Supabase-instans eller filer som producerats av riktig kodväg (inte syntetiska fixtures). Drives ska granska `chain-overview.log`, inte en mock-JSONL. När watchdog eller status.json visar stale: rapportera `verified-stale` med konkret här pid-anledning (hängd tribe-script, network-error, etc.).

## Cleanup

Denna skill startar inga processer och dödar inga processer. launchd + watchdog äger lifecycle.

**Om du av någon anledning startade en `--smoke`-körning manuellt:** låt den slutföras. Avbryt inte — `step-end` saknas → status.json blir stale → dashboard visar false-röd.

Bevis (chain-overview.log, status.json, jsonl, supabase counts) lämnas intakta. `runtime/ingestion-cron/` är gitignored sedan tidigare — den töms inte.

## Helpers

- `scripts/doctor-discovery.sh` — kör Doctor-blocket, skriver `runtime/verification-reports/discovery-doctor-<TS>.json`.
- `scripts/discovery-snapshot.sh` — kör Doctor + driver alla 5 steg-mönster (latest-stage, tribe-events, p3a-p3c, runDaily), skriver `runtime/verification-reports/discovery-snapshot-<TS>.json`. Kör denna som standalone evidence-capture efter en nattkörning.

## Gotchas

**Launchd har en 10-minuters hard-timeout per steg via watchdog.** Om ett steg tar >10 min dödas den av `runtime/watchdog.json`-logiken, men cron-processen lever vidare. Heartbeat fortsätter — `step-end` kommer aldrig. **Alltid** kolla `runtime/watchdog.json` för stage som har `stalenessMin > 10` (det betyder watchdog flaggade men inte kunde döda).

**`scripts/ingest-*.mjs` är .mjs, inte .ts** — `npx tsx` används bara på .ts-steg (A/B/C/D/I/pdf/etag/P3A). Cron-skriptet använder `node` för .mjs och `npx tsx` för .ts. Förväxla inte — Stage-listans `cmd:` i `ingestion-cron.ts:265–467` visar vilken som gäller.

**`tribe-events` har en känd häng-pattern (2026-10-18):** wp-json endpoint svarar med 5xx utan att lämna retry-loopen. Hjälp-pattern: i `scripts/ingest-tribe-events.mjs`, varje page gör `await fetchWithRetry(...)` med för många retries på 5xx-svar — processen sitter fast i samma URL i timmar. Watchdog-flagga = `heartbeat age > 2h` på step `tribe-events`. **Kontroll-pattern:** leta efter samma URL i step-loggen >5 ggr i rad = häng.

**`subpath-discovery` och `sitemap-discovery` är de två tyngsta discovery-stegen.** ~10 min runtime vardera i `--limit 200`-läge. Förvänta 10+ heartbeats vardera. Om heartbeat-loggen visar <5 heartbeats för dessa steg men `step-end` finns → steget startade nyss, för tidigt att döma.

**`P3A-discovery` är no-op utan `GOOGLE_CSE_ID` + `GOOGLE_API_KEY`.** Kolla `.env` före verifiering. `07-Discovery/src/searchEngines/discoverySearch.ts` försöker Exa först (om `EXA_API_KEY` är riktig), annars Google CSE. Om båda saknas → 0 URLs i output → stage slutförs på ~5s med exit=0.

**`pattern-promoter` (manual-review-triage) är ett C-htmlGate-steg i förklädnad.** Det kör `02-Ingestion/C-htmlGate/runC-pattern-promoter.ts` med `--dry-run --limit 20`. Stages i chain-overview.log heter `manual-review-triage`, inte `pattern-promoter`.

**`ingestion_runs.jsonl` har två skribenter:** runDaily (`09-ScrapingSupervisor/runDaily.ts:209`) och ingestion-cron (via `--smoke` eller `--limit`). triggerSource i jsonl avgör vilken — `daily` eller `cron`. Filtrera på det om du jämför körningar.

**Green = skip.** När en körning producerar alla `step-end` med `exitCode=0` och `totalEventsFound>0`: skriv `runtime/discovery-verification.status.json: {lastGreenAt, lastRunId, ok:true, durationMs}`. `scripts/ingestion-cron.ts` läser filen och hoppar över en verifierings-körning om grön <24h gammal.

## Maintenance

Kör `/maintain-verification-skill` när något händer:
- Ny `scripts/ingest-*.mjs` läggs till → feature-fil + stage-lista i doctor.
- `07-Discovery/src/` får ny modul (t.ex., discoverySearch → vectorSearch) → ny feature-fil.
- `scripts/ingestion-cron.ts:265–467` lägger till/tar bort steg → uppdatera step-listan + relevant feature.
- Wire-format i chain-overview.log ändras (`appendChainOverview`) → uppdatera drives som steg i jq.
- Status-format ändras (`writeStatus` / `StatusFile` interface) → uppdatera doctor.

## Feature map

Spegel av discovery-pipeline-stegen. Se `features/README.md` för index.

| Steg | Source | Feature-fil |
|---|---|---|
| `A-directAPI`, `B-network-api` | `02-Ingestion/A,B/` | proximity-feed under `verify-eventpulse-agent` |
| `eventbrite-pagination` | `scripts/ingest-eventbrite-stockholm.mjs` | `eventbrite-pagination.md` |
| `tribe-events` | `scripts/ingest-tribe-events.mjs` | `tribe-events.md` |
| `sitemap-discovery` | `scripts/ingest-sitemap-discovery.mjs` | `sitemap-discovery.md` |
| `subpath-discovery` | `scripts/discover-subpaths.mjs` | `subpath-discovery.md` |
| `direct-jsonld` | `scripts/ingest-direct-jsonld.mjs` | `direct-jsonld.md` |
| `livespot-stockholm` | `scripts/ingest-livespot-stockholm.mjs` | `livespot.md` |
| `C-htmlGate`, `D-renderGate`, `I-pdfExtraction` | `02-Ingestion/C,D,I/` | `c-html-gate.md` |
| `etag-refresh` | `02-Ingestion/tools/etagRefresh.ts` | `etag-refresh.md` |
| `api-discovery` | `scripts/discover-hidden-apis.mjs` | `api-discovery.md` |
| `luma`, `ra`, `posh`, `reddit` | `scripts/ingest-{luma,ra,posh,reddit}-*.mjs` | `community-platforms.md` |
| `manual-review-triage` (pattern-promoter) | `02-Ingestion/C-htmlGate/runC-pattern-promoter.ts` | `pattern-promoter.md` |
| `P3A-discovery`, `P3B-geo`, `P3C-rss` | `07-Discovery/src/{searchEngines,venueGraph}/` | `p3-discovery-stages.md` |
| orchestrator | `scripts/ingestion-cron.ts` | `orchestrator-cron.md` |
| orchestrator | `09-ScrapingSupervisor/runDaily.ts` | `orchestrator-rundaily.md` (cross-ref till verify-eventpulse-agent) |