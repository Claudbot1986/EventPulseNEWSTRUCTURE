# Kökedjan A → B → C → D → I

## Sub-features

- **Ingångar** — `sources/*.jsonl` (A, I) och `runtime/preA-queue.jsonl` (A).
- **Köer** — `preA` → `preB` → `postB` → `postB-preC` → `preUI` →
  `postA` → `postTestC-{UI,A,B,D,manual-review}` → `postD-*`.
- **Cross-queue dedup** — varje gate som skriver till en kö tar först bort
  källan ur de andra köerna (t.ex. `runA.ts:383-397`,
  `runB-parallel.ts:141-151`). Därför summerar `wc -l` inte.
- **`03-Queue/03-extractedevents/`** — A, B och C skriver
  `<sourceId>.jsonl` här. Det är filbaserad persistens, **inte** bullmq.
- **Bullmq `raw_events`** — en separat väg. Se `worker-drain.md`.

## How to get to it (user POV)

Du vill veta om hela kedjan flyter: en ny venue i `sources/` → A → B → C → D
→ events i databasen. Du lägger till en källa, kör gaten i ordning, och
kollar efter varje steg att nästa kö har vuxit och att den gamla har
minskat.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Kö-översikt — kör före och efter varje gate.
sizes() {
  for f in preA-queue preB-queue postB-queue postB-preC-queue preUI-queue postA-queue; do
    p="runtime/$f.jsonl"
    printf '%-20s %s\n' "$f" "$([ -f "$p" ] && wc -l < "$p" | tr -d ' ' || echo MISSING)"
  done
  for f in runtime/postTestC-*.jsonl runtime/postD-*.jsonl; do
    [ -f "$f" ] && printf '%-20s %s\n' "$(basename "$f")" "$(wc -l < "$f" | tr -d ' ')"
  done
}
sizes

# Persistens — inte bara antal rader i en kö:
ls -la 03-Queue/03-extractedevents/ | tail -5
find 03-Queue/03-extractedevents -name '*.jsonl' -newermt '-1 hour' | head
```

Riktning att verifiera per steg:

| Efter gate | Förväntas ha vuxit | Förväntas ha krympt |
|---|---|---|
| A | `postA-queue.jsonl`, `03-Queue/03-extractedevents/*.jsonl` | `preA-queue.jsonl` |
| A (fail-sökväg) | `preB-queue.jsonl` | `preA-queue.jsonl` |
| B | `postB-queue.jsonl`, `postB-preC-queue.jsonl`, `preUI-queue.jsonl` | `preB-queue.jsonl` |
| C | `postTestC-UI.jsonl` eller `-D.jsonl` eller `-manual-review.jsonl` | `postB-preC-queue.jsonl` |
| D | `postD-UI.jsonl` | `postTestC-D.jsonl` |
| I | `postTestC-UI.jsonl` (append) | — |

## Gotchas

**`postB-preC-queue.jsonl` med 0 rader är ett legitimt steady state.** Varje
natt om A och B inga källor misslyckas med JSON-LD-brist hamnar ingenting
där. Före 2026-10-21 kastade C-gatet på det, så varje körning såg ut att
krascha. `run-dynamic-pool.ts:806` returnerar numera `null`.

**Antal rader i köerna är inte antal events.** En körad är ett resultat per
k-source, inte per event. `postA-queue.jsonl` har id + antal events.

**`preUI-queue.jsonl` har ingen konsument i gaten-kedjan.** B skriver den,
A läser den (`runA.ts:76-77`), men ingen gate skriver tillbaka till den i
den här kedjan. Verifiera den bara om du jagar just den filen.

**Kedjan har ingen sista port — och det är varför C:s events kan fastna.**
A/B/C/D/I skriver till `events`-tabellen via den här vägen aldrig; de skriver
till `03-Queue/03-extractedevents/` (`C/` och `D/` i underkataloger).
Persistensen sker i ett annat lager: `importToEventPulse.ts` → bullmq
`raw_events` → `startWorker.ts` → `04-Normalizer`.

**Importen körs INTE i ingestion-kedjan.** `scripts/ingestion-cron.ts`
(24 steg, launchd 02:00) innehåller noll referenser till
`importToEventPulse`. Importen körs av `com.eventpulse.post-ingest`
(04:00) → `runPostIngest.sh` → `runDaily.ts` → `ingestionPipeline.ts` steg 3.

Mätt 2026-10-23: ingestion-kedjan tar **1,5–2,5 h**, så post-ingest startar
medan C fortfarande extraherar. Senaste import var 02:00 UTC; C skrev 13
extrafiler kl. 12:24 UTC som därför aldrig importerats. Symtom: en källa har
`extract_success` och events i `03-extractedevents/C/<id>.jsonl`, men noll
rader i `events`.

Verifiera om en C-källa faktiskt nått databasen — räkna inte C:s egen
"21 events":

```bash
node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs \
  "SELECT count(*) n FROM events WHERE source='<sourceId>'"
```

**Datumvakten i `importToEventPulse.ts:301` avvisar två olika saker och
loggar dem som ett.** `if (!Number.isFinite(startMs) || startMs < Date.now())`
hoppar över både *förgångna* events och events *utan datum*. C skriver ofta
`date: "unknown"`, vilket ger NaN. Mätt 2026-10-23 över 18 C-källor med 120
events och noll DB-rader: **43 % förgånget datum, 34 % saknat datum, 23 %
giltigt framtida datum**. Bara de 23 % kan nå databasen. `konserthuset-2` är
21/21 utan datum; `junibacken`, `konstfack`, `medeltidsmuseet` är 9/9
förgångna. Att C rapporterar "21 events" betyder alltså inte 21 användbara
events.

**Live-köerna innehåller backup-filer.** `preA-queue.BACKUP-stale-20260819.jsonl`,
`postB-preC-queue.BEFORE-E2E.jsonl` m.fl. finns bredvid de riktiga. En glob
som `runtime/*queue*.jsonl` plockar upp dem. Räkna på exakta filnamn.

**Cross-queue dedup gör att en källa aldrig ligger i två köer samtidigt.**
Om du ser en källa i både `preB` och `postB-preC` har någon gate skrivit
utan att rensa först — det är ett verkligt fel, inte dubbelräkning.