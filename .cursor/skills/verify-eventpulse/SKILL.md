---
name: verify-eventpulse
description: |
  Verify the EventPulse ingestion gates (02-Ingestion A-directAPI,
  B-JSON-feedGate, C-htmlGate, D-renderGate, I-pdfExtraction), the queue drain
  and the Normalizer worker (03-Queue/startWorker.ts) by driving the real CLI
  entry points against a sandbox root and reading what they write.
  Use when a gate reports success but persists nothing, when a queue
  (preA/preB/postB-preC/postTestC-D) is unexpectedly empty, when
  runtime/sources_status.jsonl disagrees with reality, when the bullmq worker
  stops draining raw_events, or when a change to runA.ts/run-dynamic-pool.ts/
  runB.ts needs proof before it ships. Surface is batch CLI + JSONL queues +
  one long-lived Redis worker — there is no UI for the gates. This skill DOES
  start real runs (in an isolated EVENTPULSE_SANDBOX_ROOT), unlike
  verify-eventpulse-discovery which only reads launchd-produced artefacts.
disable-model-invocation: false
---

# verify-eventpulse

Ingestion-gates är CLI:ar, inte en UI. Varje gate är ett eget program som läser
en JSONL-kö, gör nätanrop och skriver nästa kö. Den här skillen **kör dem
själv**, i en sandbox, och läser resultatet.

Discovery-skillen (`verify-eventpulse-discovery`) gör motsatsen: den läser
bara filer som launchd redan producerat. Här är du rätt; där är du fel.

## Launch

Det finns ingen server att starta. "Launch" = bygga en sandbox och köra gateen
i den.

**Sandbox-root.** Gate A, C, D och `runB-parallel.ts` läser
`process.env.EVENTPULSE_SANDBOX_ROOT` och använder den i stället för
repo-roten. Sätt den alltid:

```bash
cd /Users/claudgashi/EventPulse
export SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,03-Queue/03-extractedevents}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"
echo "$SANDBOX"          # spara — Cleanup behöver den
```

**Styckningen är inte enhetlig — detta är den viktigaste gotcha i skillen:**

| Entrypoint | Ärar `EVENTPULSE_SANDBOX_ROOT`? | Bevis |
|---|---|---|
| `02-Ingestion/A-directAPI-networkGate/runA.ts` | **ja** | `runA.ts:39-41` |
| `02-Ingestion/B-JSON-feedGate/runB-parallel.ts` | **ja** | `runB-parallel.ts:49-52` |
| `02-Ingestion/B-JSON-feedGate/runB.ts` | **NEJ** | `runB.ts:42` hårdkodar `__dirname/../../runtime` |
| `02-Ingestion/C-htmlGate/run-dynamic-pool.ts` | **ja** | `:60-62` (och `REPORTS_DIR` → `$SANDBOX/07-Discovery/testResults/…`) |
| `02-Ingestion/D-renderGate/runD-scrapingbee.ts` | **ja** | `:63-70` |
| `02-Ingestion/I-pdfExtraction/pdfExtractor.ts` | **NEJ** | `:37-39` hårdkodar `PROJECT_ROOT` |
| `03-Queue/startWorker.ts` | **NEJ** | läser bullmq, inte filer |

Kör `runB.ts` eller `pdfExtractor.ts` med satt sandbox-variabel och du
skriver riktiga `runtime/`-kön i repot. Använd `runB-parallel.ts` i stället,
eller kör utan sandbox och räkna med att live-filer rörs.

**Cron kör inte i sandbox.** `scripts/ingestion-cron.ts:29` hårdkodar
`RUNTIME_DIR` — den ser inte `EVENTPULSE_SANDBOX_ROOT`. Vill du köra hela
kedjan i cron måste du antingen köra gateerna direkt eller koppla bort cron
för tiden. Se `features/orchestrator.md`.

**Ready = processen avslutas.** Alla fem gatearna avslutas när de är klara
(bortsett från workern, se nedan). Ingen gate har en "startup-logg — nu är
jag redo"-signal. Kör med `scripts/timed.sh` så en hängande gate inte äger
shellen — macOS har varken `timeout` eller `gtimeout`:

```bash
cd /Users/claudgashi/EventPulse
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"
sh "$TIMED" 300 npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit 1 --workers 1
echo "exit=$?"     # 0 = klar, 124 = tidsgräns nådd, annat = gateens eget fel
```

## Doctor

Read-only. Svarar på "är den här instansen värd att köra?".

```bash
cd /Users/claudgashi/EventPulse
bash .cursor/skills/verify-eventpulse/scripts/doctor-ingestion.sh
```

Skriptet gör fyra saker och skriver JSON till
`runtime/verification-reports/ingestion-doctor-<TS>.json`. Om det inte
skriver ut, läs `scripts/doctor-ingestion.sh` — det är kort.

Doctor FAIL = **stoppa här.** En gate som kör mot en halvdryv Redis eller mot
en sammanhängande cron-körning ger resultat du inte kan tolka. Fixa doctor
först.

## Drive

Harness = shell + `jq` + `grep` mot JSONL-filer. Inga Playwright. Inga
`supabase remote-query` — projektets Management-API-tokener är ogiltiga;
`DATABASE_URL` + `08-Agent/scripts/apply-migration.ts` är den väg som fungerar.

**Stabila handtag:**

| Signal | Vem skriver | Hur |
|---|---|---|
| `═══ A-RUNNER SUMMARY ═══` + `  Events: N` | `runA.ts:571-575` | stdout |
| `⚠️  Alla N sources misslyckades.` | `runA.ts:577` | stdout |
| `  → wrote N events to extractedevents/` | `runA.ts:355` | stdout |
| `[A-runner] Both preA-queue and sources-main are empty.` | `runA.ts:475` | stdout = **inget att köra** |
| `[B-runner] preB-queue is empty. Nothing to run.` | `runB.ts:378` | stdout = **inget att köra** |
| `[BuildPool] Drained all N sources from postB-preC` | `run-dynamic-pool.ts:801` | stdout |
| `SUMMARY postD-UI: N \| postD-man1: N \| … \| creditsUsed=N` | `runD-scrapingbee.ts:561` | stdout |
| `[worker] Job N completed — "<title>"` | `startWorker.ts:23` | workerns stdout, live |
| `runtime/sources_status.jsonl` | `sourceRegistry.ts:358` | `{"sourceId","status","lastEventsFound",…}` |
| `runtime/ingestion_runs.jsonl` | `runRecorder.ts:53` | `{"ok","totalEventsPersisted"}` |

**Driv-mönster (Ett enda gate, isolerat):**

```bash
cd /Users/claudgashi/EventPulse
SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,03-Queue/03-extractedevents}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"

# Lägg en källa i sandboxen. city MÅSTE vara "Stockholm" — isInScope()
# (sourceRegistry.ts:150) är en enda rad: (source.city ?? '').trim() === 'Stockholm'
cat > "$SANDBOX/sources/_verify-fixture.jsonl" <<'EOF'
{"id":"_verify-fixture","url":"https://www.nalen.com/","name":"Nalen","type":"event_source","city":"Stockholm","discoveredBy":"verification"}
EOF

timeout 300 npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit 1 --workers 1
echo "exit=$?"

# Vad skrev den?
cat "$SANDBOX/runtime/sources_status.jsonl" 2>/dev/null | jq .
ls -la "$SANDBOX/03-Queue/03-extractedevents/"
```

En `sources/*.jsonl`-rad utan `city: "Stockholm"` syns inte för A-gatet alls
och du får `[A-runner] Both preA-queue and sources-main are empty.` Det är
inte ett fel — det är scope-filtret som fungerar.

**Driv-mönster (köstatus — vad finns var?):**

```bash
for f in preA-queue preB-queue postB-queue postB-preC-queue postA-queue; do
  p="runtime/$f.jsonl"
  [ -f "$p" ] && printf '%-20s %s\n' "$f" "$(wc -l < "$p" | tr -d ' ')" || printf '%-20s MISSING\n' "$f"
done
for f in runtime/postTestC-*.jsonl runtime/postD-*.jsonl; do
  [ -f "$f" ] && printf '%-20s %s\n' "$(basename "$f")" "$(wc -l < "$f" | tr -d ' ')"
done
```

`postB-preC-queue.jsonl` med 0 rader är ett **legitimt steady state**, inte
fel. Före 2026-10-21 kastade `run-dynamic-pool.ts` på det.

## Evidence

**Bevisstandard.** Ett bevis är *tre saker tillsammans*, inte en av dem:

1. **Aktionen** — kommandot du körde, med exit code.
2. **Följden i stdout** — gateens egen sammanfattningsrad, med ett tal.
3. **Side effect utanför stdout** — filen eller DB-raden gateen påstår sig
   skriva, verifierad med en separat `ls`/`jq`/`SELECT`.

Gate A som skriver `Events: 12` men lämnar `03-Queue/03-extractedevents/` tomt
har **inte** lyckats, oavsett hur bra loggen ser ut.

Skriv bevis till `runtime/verification-reports/ingestion-<feature>-<TS>.json`.
Det överlever cleanup.

**Sandboxbevis mot live-data:** gate A och C skriver till `events` i Supabase.
Kör dem med `--dry` om du vill verifiera routing utan att persistera. `--dry`
på A ändrar *inte* att den nätar — kontrollera via stdout om den faktiskt
hämtade (`fetched=`-rader) innan du antar att inget skrevs.

**Workern** kräver Redis (`REDIS_URL`, default
`redis://host.docker.internal:6379`) och kör för evigt — den har ingen
`--limit`. Bevis är N `Job N completed`-rader under en mätperiod, inte att
processen startade.

## Cleanup

Döda **det du startade**, via pid — aldrig via processnamn.

```bash
# Sandbox bort (om du inte vill behålla beviset i den):
rm -rf "$SANDBOX"

# Workern: du startade den, du stoppar den. Skriv pid när du startade.
kill <pid_du_startade_worker_med>
```

Sandboxen är i `/tmp` — den överlever inte i sig, och inget i repot rörs om
alla gatear var sandboxade. Om du körde `runB.ts` eller `pdfExtractor.ts`
så är live-`runtime/` rörd: säg det i rapporten, och kör inte två sådana
körningar parallellt.

Bevisfiler under `runtime/verification-reports/` lämnas kvar.

## Helpers

- `scripts/doctor-ingestion.sh` — hela Doctor-blocket, skriver JSON.
- `scripts/timed.sh <sekunder> <kommando>` — tidsgräns. macOS saknar
  `timeout`/`gtimeout`; detta wrapper via `perl -e 'alarm …; exec …'`.
  Exit 124 = tidsgränsen nåddes.

Båda är körbara och deras invocation visas i skill-texten. En helper som
måste läsas för att förstås är inte en helper.

## Gotchas

**Gate A avslutas alltid exit=0.** `runA.ts` har ingen fel-exitväg — en
körning där alla källor failar skriver
`⚠️  Alla N sources misslyckades.` och avslutar 0. Läs alltid summary-raden;
exit-koden bevisar ingenting för A.

**`--workers` skickas till runB men ignoreras.** `scripts/ingestion-cron.ts`
kör `runB.ts --workers 20`; `runB.ts` parsar aldrig flaggan (`--limit` är det
enda flaggan den läser, default 100). Om du förväntar dig parallellhet i B
får du ingen — det är sekvent.

**`runB.ts` skriver till repots riktiga `runtime/`.** Ingen sandbox. Använd
`runB-parallel.ts` för isolerade körningar, eller var beredd på att
`preB-queue.jsonl`/`postB-preC-queue.jsonl` i repot ändras.

**Workern skriver inga filer alls.** `startWorker.ts` konsumerar bullmq-kön
`raw_events` och skickar vidare till `04-Normalizer`. Om du väntar dig en
JSONL-sidoeffekt kommer du att vänta för evigt. Beviset är stdout.

**`totalEventsPersisted: 0` betyder inte "noll events".** Fältet är
`number | null` (`runRecorder.ts:38-42`). `null` betyder att skrivaren inte
kan mäta. En hårdkodad 0 är den bugg som fixades 2026-10-21 — lägg inte
tillbaka den.

**`sources_status.jsonl` är hela filen, inte en append.** `writeStatusFile`
(`sourceRegistry.ts:358-361`) skriver om. `sources_audit.jsonl` är en
separat quarantine-logg och räknar inte som status.

**`getSourceStatus` hittar ingen rad → `status: 'never_run'`.** Det är
standardfallet, inte ett fel. A-gatets `getNextABatch()` filtrerar på
exakt `status === 'never_run'` (`runA.ts:246-287`) — 256 fail-källor körs
inte igen, och det är medvetet.

**D-gatet bränner credits.** `runD-scrapingbee.ts --behavior=premium-only`
kostar pengar per render. Börja med `--dry`, eller `--behavior=static-only`.
Cron tvingar `static-only` under `--smoke`.

**Cron äger `runtime/ingestion-cron.status.json`.** En pågående körning
(blockerad på gammal state) gör att dina gate-körningar konkurrerar om
samma köfiler. Kontrollera `running: true` i doctor innan du kör.

## Feature map

Se `features/README.md` för index.

| Feature | Feature-fil | Entrypoint |
|---|---|---|
| Gate A | `gate-a-directapi.md` | `runA.ts` |
| Gate B | `gate-b-json-feed.md` | `runB.ts` / `runB-parallel.ts` |
| Gate C | `gate-c-html.md` | `run-dynamic-pool.ts` |
| Gate D | `gate-d-render.md` | `runD-scrapingbee.ts` |
| Gate I | `gate-i-pdf.md` | `pdfExtractor.ts` |
| Kökedjan | `queue-chain.md` | — (filer) |
| Ködränering + workern | `worker-drain.md` | `startWorker.ts` |
| Källstatus och scope | `source-status.md` | `sourceRegistry.ts` |
| Orchestrator | `orchestrator.md` | `scripts/ingestion-cron.ts` |

## Maintenance

Kör `/maintain-verification-skill` när:
- En gate byter filnamn, flaggor eller stdout-token → uppdatera tabellen i
  Drive och feature-filen.
- `EVENTPULSE_SANDBOX_ROOT` börjar/kör sluta äras av någon ingång → tabellen
  i Launch är felaktig och kommer att skriva till live-data.
- En ny queue-fil tillkommer i kedjan → `queue-chain.md`.
- Ny gate tillkommer i `scripts/ingestion-cron.ts` → ny feature-fil + README.