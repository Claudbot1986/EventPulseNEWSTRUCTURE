# Orchestrator — `scripts/ingestion-cron.ts`

## Sub-features

- **23 steg i ordning** från `runA.ts:351` (`const steps`):
  `A-directAPI` (353) → `B-network-api` (358) → `eventbrite-pagination` (369)
  → `tribe-events` (380) → `sitemap-discovery` (389) → `subpath-discovery` (398)
  → `direct-jsonld` (407) → `livespot-stockholm` (416) → `C-htmlGate` (422)
  → `D-renderGate` (435) → `I-pdfExtraction` (444) → `etag-refresh` (459)
  → `api-discovery` (469) → `luma-stockholm` (478) → `ra-stockholm` (486)
  → `posh-stockholm` (494) → `reddit-stockholm` (502) → `D-images` (513)
  → `P2C-active-learning` (527) → `P3A-discovery` (541)
  → `P3B-venue-graph-geo` (557) → `P3C-rss-discovery` (569)
  → `P3D-source-candidate-tests` (608).
- **18 skip-flaggor** (`:196-215`) — varje steg kan tas bort ur listan
  runtime, så antalet steg varierar mellan körningar.
- **`--limit N`** (default 200), **`--smoke`** (tvingar `effectiveLimit = 1`,
  `static-only` på D, `--concurrency 1`), `SKIP_BFL=1`.
- **Per-steg count-parsning** — `STEP_COUNT_RECIPES` (`:80-136`), en regex
  per steg, sista matchen vinner. `STEP_COUNT_EXCLUDED`
  (`reddit-stockholm`, `api-discovery`, `subpath-discovery`) ger `null`.
  **A/B/C/D/I saknar recipe → deras `eventsExtracted` är alltid `null`.**
- **Statusfil** — `runtime/ingestion-cron.status.json`, skrivs efter varje
  steg (`:772-774`) med `running`, `pid`, `lastHeartbeatAt`, `steps[]`,
  `totalEventsExtracted`, `lastError`, `exitCode`.
- **Green/red** — `runtime/discovery-verification.status.json` skrivs bara
  vid `totalExit === 0` (`:795-820`) med `{lastGreenAt, runId, ok}`.

## How to get to it (user POV)

Du vill veta om nattens körning gick igenom, vilka steg som kördes, vilka
som föll, och hur många events som faktiskt kom in. Du öppnar dashboarden
(port 7777) eller läser `runtime/ingestion-cron.status.json` direkt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

jq '{
  running, pid, startedAt, finishedAt, exitCode,
  lastHeartbeatAt, totalEventsExtracted, lastError,
  steps: [.steps[] | {step, exitCode, eventsExtracted, sourcesProcessed}]
}' runtime/ingestion-cron.status.json

# Steg-följd ur chain-overview.log (JSONL)
jq -r 'select(.event=="step-end") | "\(.step)\texit=\(.exitCode)\t\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -25

# Per-steg-loggar — filtrera ALLTID bort .err.log
LATEST=$(ls -t runtime/ingestion-cron/steps/A-directAPI-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
tail -20 "$LATEST"
```

## Gotchas

**Cron läser INTE `EVENTPULSE_SANDBOX_ROOT`.** `RUNTIME_DIR` hårdkodas
(`:29`). En "sandboxad" cron-körning kör mot riktiga köer. Kör gaten
direkt om du vill isolera.

**`null` och `0` betyder olika saker i `eventsExtracted`.** `null` = steget
kan inte mäta (skriver eget JSON-format, eller persisterar ingenting).
`0` = det kördes och fick inget. Dashboarden ska visa null som "vet inte".
Ett steg som alltid är `null` är inte ett fel — kontrollera
`STEP_COUNT_RECIPES` innan du rapporterar.

**`exitCode` per steg ≠ körningens öde.** I drift ger flera steg
exit=1 varje natt (P2C-active-learning, P3A-discovery är de kända). En
körning kan ha 24/24 steg avslutade och ändå ha producerat noll events.

**Launchd äger filen.** En pågående körning blockerar inte läsning men
skriver över `runtime/ingestion-cron.status.json` medan du läser. Doktorn
flaggar `cron.running` — respektera det.

**`manual-review-triage` och `pattern-promoter` är borta ur listan sedan
2026-10-21.** Gamla `chain-overview.log`-rader kan innehålla dem. De dyker
inte upp i nya körningar. (Koden ligger kvar som dormant.)

**Green-filen styrs av en 24-timmarsregel.** Read-gaten vid `:728` hoppar
 över verifieringskörningar om `ageH < 24 && ok`. Om du manuellt
skriver `ok: false` måste du också sätta `lastGreenAt` till det gamla
värdet — annars förloras beviset på när grönt senast såg ut.

**Cron kör `runB.ts --workers 20`**, men `runB.ts` parsar inte flaggan.
B är sekvent i drift.