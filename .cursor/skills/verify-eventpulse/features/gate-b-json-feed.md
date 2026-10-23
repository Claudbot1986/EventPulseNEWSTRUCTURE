# Gate B — JSON / network-feed

## Sub-features

- **Två ingångar, olika sandboxbeteende** — `runB.ts` (sekvent, hårdkodar
  `runtime/` i repot) och `runB-parallel.ts` (worker-pool, läser
  `EVENTPULSE_SANDBOX_ROOT`).
- **RSS-väg** — om källans `metadata.preferredPath === 'rss'` går den
  rakt till RSS-parsning (`runB-parallel.ts:189`), inte nätverksgates.
- **Nätverksgate + kandidatextraktion** — `gate → …` (`runB-parallel.ts:236`)
  följt av `extracted N events from <url>` per kandidat (`:283`).
- **Utdata** — `03-Queue/03-extractedevents/<sourceId>.jsonl` samt köerna
  `postB-queue.jsonl`, `postB-preC-queue.jsonl`, `preUI-queue.jsonl`.
  Cross-queue dedup rensar källan ur de andra tre.
- **Kvarantän** — `[B-skip] <id> (<reason>: <reasonCode>)` hoppar över
  redan fällta källor.
- **`--status`** — skriver `═══ B-RUNNER STATUS ═══` med tre rader och
  avslutar utan att köra. Bästa sättet att inspektera en körning.

## How to get to it (user POV)

Du lägger till en venue som saknar JSON-LD (A-gatet skickade den hit med
`no-jsonld-or-no-events`) men som har en RSS-flöde eller ett
`/api/events`-anrop. Du kör:

```bash
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --limit 5 --workers 5
```

och vill se vilka källor som provades, vilken väg varje tog (RSS vs nät),
hur många events som kom ut, och vart de skickades.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,03-Queue/03-extractedevents}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"

cat > "$SANDBOX/sources/_verify-fixture.jsonl" <<'EOF'
{"id":"_verify-fixture","url":"https://www.nalen.com/","name":"Nalen","type":"event_source","city":"Stockholm","discoveredBy":"verification"}
EOF
# Lägg samma källa i preB — det är B:s enda ingång.
cat > "$SANDBOX/runtime/preB-queue.jsonl" <<'EOF'
{"sourceId":"_verify-fixture","queueReason":"verification fixture"}
EOF

# Tömvyn först — den skriver bara.
sh "$TIMED" 300 npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --status

sh "$TIMED" 300 npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --limit 1 --workers 1
echo "exit=$?"

wc -l "$SANDBOX/runtime/postB-queue.jsonl" "$SANDBOX/runtime/postB-preC-queue.jsonl" \
      "$SANDBOX/runtime/preUI-queue.jsonl" "$SANDBOX/runtime/preB-queue.jsonl" 2>/dev/null
ls -la "$SANDBOX/03-Queue/03-extractedevents/"
cat "$SANDBOX/runtime/logs/runB-parallel-"*.log 2>/dev/null | tail -20

rm -rf "$SANDBOX"
```

## Gotchas

**`runB.ts` skriver till repots riktiga `runtime/`.** `runB.ts:42` hårdkodar
`path.resolve(__dirname, '../../runtime')` — `EVENTPULSE_SANDBOX_ROOT` läses
inte. Kör `runB-parallel.ts` för isolerade körningar.

**Cron kör `runB.ts --workers 20`, men `runB.ts` parsar aldrig flaggan.**
Enda flaggan är `--limit` (default 100, `runB.ts:372`). B är alltså sekvent
i drift, oavsett vad cron skickar.

**`[B-runner] preB-queue is empty. Nothing to run.` är inte ett fel.**
Det är en `return` från `main()` (`runB-parallel.ts:504-506`) och ger
exit=0. Tom preB är steady state, inte fel — A-gatet skickar ingenting dit
när inget misslyckas.

**Tom `postB-preC-queue.jsonl` är också legitimt.** Före 2026-10-21 kastade
C-gatet på den. B-gatet har alltid returnerat tyst.

**`preferredPath: 'rss'` bypassar nätverksgaten helt.** Loggen visar
`→ RSS path (preferredPath=rss)` och ingen `gate →`-rad. Ett "inget"-utfall
från sådan källa betyder "RSS-fältet gav inget", inte "nätet var nere".

**Cross-queue dedup gör att siffror inte summerar.** En källa som gick från
preB till postB-preC har tagits bort från preB. `wc -l` på ingång + utdata
överdriverar alltså. Räkna på utdata ensam.

**`--dry` i B betyder inte att inget nätverk sker** i alla delvägar — kontrollera
stdout efter `→ wrote N events` innan du antar att inget skrevs.