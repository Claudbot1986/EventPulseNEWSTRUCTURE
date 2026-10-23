# Gate C — htmlGate

## Sub-features

- **Pool-batch** — drar upp till 50 källor från `postB-preC-queue.jsonl` till
  `reports/batch-<N>/pool-state.json`. Kör `--max-rounds` (default 3) rundor
  av discovery → extraktion → routing.
- **Routing på utfall** — events → `postTestC-UI.jsonl`; A/B/D-signal →
  `postTestC-{A,B,D}.jsonl`; 3 rundor utan events →
  `postTestC-manual-review.jsonl`.
- **C4-analys** — `--no-c4` stänger av AI-analysen efter extraktion.
- **Rapportdir omdirigeras i sandbox** — `REPORTS_DIR` pekar då på
  `$SANDBOX/07-Discovery/testResults/source-candidates/c-htmlGate`
  (`:95-98`), inte repots `reports/`.
- **Run-lock** — `acquireRunLock()` (`:2942`) hindrar två samtidiga C-körningar.
- **Wrapper** — `runC-one-time-only.ts` är en 25-radig `spawn`-wrapper som
  kör `run-dynamic-pool.ts --max-rounds 1 --no-c4` plus argumenten vidare.
  Samma kodväg, annan flaggsättning.

## How to get to it (user POV)

Du har en venue som A och B inte kunde hämta events från (JS-renderad sida,
bild-tabell, HTML-tabeller). Du kör:

```bash
npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts --workers 5 --max-rounds 200
```

och vill se vilka interna sidor den letade igenom, vad den extraherade, och
vilken av köerna källan hamnade i — särskilt `postTestC-D.jsonl`, som betyder
"jag hittade en JS-sida, betala för rendering".

## Driving it

```bash
cd /Users/claudgashi/EventPulse
SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,07-Discovery/testResults/source-candidates/c-htmlGate}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"

cat > "$SANDBOX/sources/_verify-fixture.jsonl" <<'EOF'
{"id":"_verify-fixture","url":"https://www.nalen.com/","name":"Nalen","type":"event_source","city":"Stockholm","discoveredBy":"verification"}
EOF
cat > "$SANDBOX/runtime/postB-preC-queue.jsonl" <<'EOF'
{"sourceId":"_verify-fixture","sourceName":"Nalen","sourceUrl":"https://www.nalen.com/"}
EOF

# Utan --no-c4 för att se hela vägen; med för att snabba.
sh "$TIMED" 900 npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts --workers 1 --max-rounds 1 --no-c4
echo "exit=$?"

# Vart hamnade källan?
for q in UI A B D manual-review; do
  f="$SANDBOX/runtime/postTestC-$q.jsonl"
  [ -f "$f" ] && printf '%-14s %s\n' "$q" "$(wc -l < "$f" | tr -d ' ')"
done

# Pool-state + rapporter (sandboxdir, inte repo-reports/)
ls -la "$SANDBOX/07-Discovery/testResults/source-candidates/c-htmlGate/"
cat "$SANDBOX/runtime/logs/runC-dynamic-pool-"*.log 2>/dev/null | tail -30

rm -rf "$SANDBOX"
```

## Gotchas

**Tom `postB-preC-queue.jsonl` ger exit=0, inte en kast.** `buildInitialPool`
returnerar `null` vid `selected.length === 0` (`:806`) och entrypointen
avslutar alltid 0 på resolve (`:2954-2955`). Exit 1 reserveras för
`Fatal error:`. Detta ändrades 2026-10-21 — tidigare `throw`ade det, vilket
gjorde varje natt ser ut att krascha trots att läget var korrekt.

**I drift är `--max-rounds 200` och tidig avslutning på pool-state sannolikare
än tomma kön.** `batchAlreadyComplete` är den vanliga tidiga utvägen — samma
batch-nummer som förra körningen, `pool-state.json` säger färdig.

**Rapporter hamnar i en annan katalog i sandbox.** `REPORTS_DIR` =
`$SANDBOX/07-Discovery/testResults/source-candidates/c-htmlGate` (`:95-98`).
Letar du i repots `reports/` hittar du inget efter en sandboxkörning.

**`runC-scrapingbee.ts` är INTE den kanoniska ingången.** Det är ett äldre,
separat ScB-verktyg (`postB-preC` → `postTestC-*`) som kräver
`SCRAPINGBEE_API_KEY` annars `process.exit(1)` vid `:92-94`. Det körs inte i
cron. Använd `run-dynamic-pool.ts`.

**Run-locken gör en andra samtidig C-körning till en no-op.** Om du kör två
C-gates parallellt (t.ex. cron + P3D:s `RealAbcdSourceCandidateRunner`)
avslutar den ena direkt utan felmeddelande. Kolla `runtime/logs/` före.

**C har ingen count-recipe i cron-parsern.** `STEP_COUNT_RECIPES` saknar
post för A/B/C/D/I, så deras `eventsExtracted` i
`runtime/ingestion-cron.status.json` är alltid `null`. `null` betyder "vet
inte", inte "noll" — läs gateens egen stdout.