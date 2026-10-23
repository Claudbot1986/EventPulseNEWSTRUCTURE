# Gate A — direct API / JSON-LD

## Sub-features

- **Batch-val** — `getNextABatch(limit)` (`runA.ts:251-288`): först
  `runtime/preA-queue.jsonl` (varje entry pekar på en `sourceId`), sedan
  `sources/*.jsonl` filtrerat på `status === 'never_run'`. Dubbletter
  (samma id i båda) tas bara från preA.
- **Utdata per källa** — `03-Queue/03-extractedevents/<sourceId>.jsonl` under
  `DATA_ROOT` (`runA.ts:351-354`). Detta är **inte** bullmq-kön; `queueEvents`
  importeras men anropas inte.
- **Routing på utfall** — success + ≥1 event → `postA-queue.jsonl`;
  annars → `preB-queue.jsonl` (`runA.ts:383-397`). Båda fallen rensar först
  källan ur *alla* andra köer (cross-queue dedup).
- **DAI-hook** — utebliven JSON-LD (`error === 'no-jsonld-or-no-events'`)
  lägger källan i D-AI-kön så render-gate-hooken kan hitta strukturen.
- **Per-körningslogg** — `runtime/logs/runA-<ISO>.log`.
- **DAI-flagga** — `--auto-dai` kör `runDaiForQueue()` efter att ha kört
  A-batchen.

## How to get to it (user POV)

Du lägger till en ny venue i Stockholm och vill veta om EventPulse plockar
upp evenemangen utan att betala för rendering. Du kör:

```bash
npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit 5 --workers 5
```

och vill se en lista över vilka källor som provades, hur många events
varje gav, och en `═══ A-RUNNER SUMMARY ═══` längst ner.

Från ett *nytt* discovery-fynd ser det ut så här: filen hamnar i
`sources/<slug>.jsonl`, och nästa A-körning plockar upp den automatiskt
eftersom den saknar rad i `sources_status.jsonl` (= `never_run`).

## Driving it

```bash
cd /Users/claudgashi/EventPulse
SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,03-Queue/03-extractedevents}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"

# Fixture. city MÅSTE vara "Stockholm" (isInScope, sourceRegistry.ts:150).
cat > "$SANDBOX/sources/_verify-fixture.jsonl" <<'EOF'
{"id":"_verify-fixture","url":"https://www.nalen.com/","name":"Nalen","type":"event_source","city":"Stockholm","discoveredBy":"verification"}
EOF

sh "$TIMED" 300 npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit 1 --workers 1
echo "exit=$?"

# 1. Aktionens utfall i stdout
#    → "═══ A-RUNNER SUMMARY ═══" / "  Total:  1" / "  Events: N"
#
# 2. Sidoeffekt: skrev den filen den påstår?
ls -la "$SANDBOX/03-Queue/03-extractedevents/"
wc -l "$SANDBOX/03-Queue/03-extractedevents/_verify-fixture.jsonl" 2>/dev/null
#
# 3. Routing: vart skickades källan?
wc -l "$SANDBOX/runtime/postA-queue.jsonl" "$SANDBOX/runtime/preB-queue.jsonl" 2>/dev/null
#
# 4. Statusrad
jq -c 'select(.sourceId=="_verify-fixture")' "$SANDBOX/runtime/sources_status.jsonl"

rm -rf "$SANDBOX"
```

Mot en *befintlig* Stockholm-källa med känd `never_run`-status (kräver att
`runtime/sources_status.jsonl` i repot saknar raden — kontrollera först):

```bash
jq -c 'select(.status=="never_run" and .lastEventsFound==0)' runtime/sources_status.jsonl | head -3
# → sourceId:n du kan köra mot. Kopiera en till sandboxens sources/.
```

## Gotchas

**Gate A avslutas alltid exit=0.** Det finns ingen fel-exitväg. En körning där
alla källor failar skriver `⚠️  Alla N sources misslyckades.` och avslutar 0.
Läs summary-raden; exit-koden bevisar ingenting för A.

**`[A-runner] Both preA-queue and sources-main are empty. Nothing to run.`**
(`runA.ts:475`) betyder inte "inget finns i repot" — det betyder att inget
matchar filtret. Två vanliga orsaker: (1) sandboxen har inga `sources/*.jsonl`,
(2) källan saknar `city: "Stockholm"` så `isInScope()` filtrerar bort den.
Båda ser identiska ut i loggen. Kontrollera `ls $SANDBOX/sources/` först.

**`fail`-källor körs aldrig igen.** Filtret är exakt
`status === 'never_run'` (`runA.ts:259-262`). 256 av 332 källor har status
`fail` från tidigare nätter och är permanent ute ur A. Det är medvetet
(planen avsäger att köra om dem) — inte en bugg som ska rapporteras.

**`sources_status.jsonl` skrivs om hela, inte append.** `writeStatusFile`
(`sourceRegistry.ts:358-361`). En rad som finns i `sources_audit.jsonl` är
inte samma sak.

**`--workers` har default 50** (`runA.ts:11,497`). I en sandbox med en källa
spelar det ingen roll; mot live-data med många källor är 50 för aggressivt
för nätverket.

**`.env` laddas från `process.cwd()`** (`runA.ts:30`). Kör från repo-roten
eller `SUPABASE_URL` saknas.

**`runA-extract.ts` och `runA-dai-hook.ts` är egna entrypoints**, inte
importer. `runA.ts` anropar dem aldrig utom `--auto-dai` → `daiHook.ts:210`.

**Kör inte mot live `sources/` för att "bara testa".** Gate A skriver
`sources_status.jsonl` och flyttar källor mellan köerna. Det är inte en
läsning, det är en mutation. Använd sandboxen.