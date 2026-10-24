# Orchestrator — `scripts/ingestion-cron.ts`

## Sub-features

- **25 steg, men inte i listordning.** `const steps` (`:399-690`) deklarerar
  dem i A→B→C→D→I-ordning, men en splice (`:626`) flyttar P3A–P3D till
  **förest** vid körning. Ordningen som faktiskt körs:
  `P3A-discovery` (605) → `P3B-venue-graph-geo` (621) → `P3C-rss-discovery` (633)
  → `P3D-source-candidate-tests` (672) → `A-directAPI` (402) → `B-network-api` (407)
  → `eventbrite-pagination` (418) → `tribe-events` (429) → `sitemap-discovery` (438)
  → `subpath-discovery` (447) → `direct-jsonld` (456) → `livespot-stockholm` (465)
  → `C-htmlGate` (471) → `D-renderGate` (484) → `I-pdfExtraction` (493)
  → `etag-refresh` (508) → `api-discovery` (518) → `luma-stockholm` (527)
  → `ra-stockholm` (535) → `posh-stockholm` (543) → `reddit-stockholm` (551)
  → `D-images` (573) → `import-to-eventpulse` (608) → `worker-drain` (630)
  → `P2C-active-learning` (639).

  **Varför flytten (2026-10-23):** en källa som P3D promote:ade var osynlig för
  A-gatet till nästa natt kl 02:00 — upp till 18 timmars latens. Nu promote:ar
  P3D och A-gatet kör samma natt.
- **`import-to-eventpulse` (`:608`) — tillagd 2026-10-23.** Kedjan hade ingen
  väg till `events`-tabellen: A/B/C/D/I skriver *filer* till
  `03-Queue/03-extractedevents/`, och importeraren hade 0 referenser här. Den
  kördes av `com.eventpulse.post-ingest` kl. 04:00, alltså på en klocka
  oberoende av en kedja som startar 02:00 och tar 1,5–2,5 h — så den importerade
  alltid föregående nats filer. Mätt 2026-10-23: 18 spårade källor med 120
  extraherade events och 0 rader i `events`. Ligger före `worker-drain` av
  samma skäl som drainen ligger där. I `--smoke` får den `--dry-run --limit 5`
  så att en smoke inte skriver riktiga events. Räknare:
  `/KLAR\s+│\s+(\d+)\s+events till bullmq/`.
- **`worker-drain` (`:630`)** — det ENDA steget som skriver till Supabase.
  `npx tsx 03-Queue/drainQueue.ts --max-ms <5400000|60000>` (90 min sedan
  2026-10-23, var 15 min); ligger före P2C som läser ur databasen. Placerat här
  för att kedjan annars slutar med jobb liggande i `raw_events`: mätt 2026-10-23
  var 3 548 jobb väntande sedan 2026-10-20 och 0 av nattens 1 147 "funna" events
  persisterade.
  **Processorn ÄR `processRawEvent`** (fix 2026-10-23). Tidigare skickades en
  räknande stub, som markerade varje jobb "completed" utan att persistera en
  rad — se Gotchas.
- **Per-steg-timeout** — `STEP_TIMEOUT_MS` (`:266`), default 2 h, override via
  `INGESTION_STEP_TIMEOUT_MS`. `SIGTERM` → 30 s → `SIGKILL`. Ett avbrutet steg
  loggas som `exitCode: 124` och `timedOut: true`.
- **`--only <steg[,steg2]>`** (tillagd 2026-10-24) — kör ett eller flera
  namngivna steg och inget annat. Okänt stegnamn är ett **fel** (exit 2), inte
  en tyst "inget att göra" — annars kan en typo få verifieringen att se grön ut.
  Utskriften `[ingestion-cron] --only: kör N/M steg: …` visar vad som valdes.
  Används av `scripts/verify-step-timeout.mjs` för att bevisa timeouten på ett
  enda steg.
- **Pre-kill städar bara zombies** (fix 2026-10-24) — logiken ligger i
  `scripts/lib/chain-guard.mjs`. En process med en **levande ingestion-kedja som
  förfader** är levande arbete och lämnas i fred (`event=="pre-kill-skip"`).
  Tidigare dödade pre-kill nattkörningens pågående steg när någon startade
  `ingestion-cron.ts --only …` parallellt med nattkörningen.
- **`P2C-active-learning` laddar `.env` själv** sedan 2026-10-23. Steget körs
  som `tsx --eval "import(...)"` — en inline-`--eval` har ingen fil att härleda
  sökvägar från, så dotenv kördes aldrig och steget dog med
  `Error: supabaseUrl is required` efter 381 ms. Det enskilda steget gjorde
  hela nattens green-fil röd (`ok:false`, `exitCode 1`).
- **18 skip-flaggor** (`:196-215`) — varje steg kan tas bort ur listan
  runtime, så antalet steg varierar mellan körningar.
- **`--limit N`** (default 200), **`--smoke`** (tvingar `effectiveLimit = 1`,
  `static-only` på D, `--concurrency 1`), `SKIP_BFL=1`.
- **Per-steg count-parsning** — `STEP_COUNT_RECIPES` (`:80-136`), en regex
  per steg, sista matchen vinner. `STEP_COUNT_EXCLUDED`
  (`reddit-stockholm`, `api-discovery`, `subpath-discovery`) ger `null`.
  **A/B/C/D/I saknar recipe → deras `eventsExtracted` är alltid `null`.**
  `worker-drain` har en recipe: `^\[drain\] avslutar \([^)]*\): completed=(\d+)`.
- **Statusfil** — `runtime/ingestion-cron.status.json`, skrivs efter varje
  steg med `running`, `pid`, `lastHeartbeatAt`, `steps[]`,
  `totalEventsExtracted`, `lastError`, `exitCode`.
- **Green/red** — `runtime/discovery-verification.status.json` skrivs i båda
  grenarna sedan 2026-10-21: vid `totalExit === 0` med `{lastGreenAt, runId,
  ok: true}`, annars `{ok: false, failedSteps, lastRunAt, exitCode, lastError}`
  med `lastGreenAt` **bevarad**. Före fixen skrevs filen bara i lyckad gren,
  så en misslyckad natt lät senaste gröna stå kvar som om allt var ok.
- **`step-end` skrev ingen `pid` fram till 2026-10-23** — `step-start`,
  `step-timeout` och `heartbeat` hade den, `step-end` (`:393`) inte. Effekt:
  263 av `chain-overview.logs rader kunde inte kopplas till någon körning, och
  E2/E4 failade med "körningen saknar steg" trots att stegen fanns. En gate som
  väljer "sista körningen" ur loggen måste filtrera på `pid` — kontrollera att
  den kolumnen finns innan du litar på en sådan gate.

## Källstatus: vem som skriver `runtime/sources_status.jsonl`

`updateSourceStatus` (`02-Ingestion/tools/sourceRegistry.ts:400`) är den enda
skrivaren. Den anropas av **A** (`runA.ts:374`) och **B** (`runB.ts:176,315`).
Den anropas **inte av C före 2026-10-23** och inte av D/I.

**Varför det spelar roll:** B routar en källa till C med
`"toolB(preB): [breadth] unclear"` och sätter då `status=fail`. C extrahterar
senare 138 events från den — men raden står kvar som `fail` för alltid. Mätt
2026-10-23: **42 av 269 `fail`-källor hade events i databasen**
(`livespot-stockholm` 5274, `spelning-se` 797, `dramaten` 298, `songkick` 204 …).
Ursprungsmätningen "42 av 269" gällde bara dem som **inte** var begravda.
Se scope-korrigeringen nedan — rätt siffra för den verkliga defekten är
**26 spårade, obegravda källor / 517 events**.

**Konsekvens som är farligare än siffran:** `classify-dead-sources.ts`,
dashboarden och E5/E6 bygger sina *begravningslistor* på `status=fail`. En
begravning utplånar då källan till tusentals events. Verifiera därför alltid en
begravningslista mot databasen innan något begravs:

```bash
# källor som står som fail men ändå har events
node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs \
  "SELECT source, count(*) n FROM events GROUP BY source ORDER BY n DESC"
```

Fixen (2026-10-23) är ett `updateSourceStatus`-anrop i `routeResult()` när
`outcomeType === 'extract_success'` (`run-dynamic-pool.ts:1356`).

**E10-scopet korrigerades samma dag.** Första versionen av gaten krävde att
*varje* C-extraherad källa stod som `success`, vilket skulle ha tvingat fram en
återväckning av begravda källor. Av 108 C-extraherade källor med fel status var
**64 begravda** (42 kyrkograv + 22 karantän; `ekero` är `permanentlyRetired`
sedan 2026-10-04) och **18 ospårade** (inga `sources/<id>.jsonl` — liseberg,
malmopera, kungliga-operan, från tiden innan scope:n smalnade till Stockholm).
För dessa är `fail` korrekt. Rätt invariant: en källa som är **spårad i
`sources/` och inte begravd** får inte stå som fel. `scripts/backfill-c-extract-status.ts`
rättade de 26 som verkligen var felstaplade (517 events).

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

# Vilka steg avbröts av timeout (ska vara tomt i normal drift)
jq -r 'select(.event=="step-timeout") | "\(.step)\tpid=\(.childPid)\tlimit=\(.limitMs)"' \
  runtime/ingestion-cron/chain-overview.log | tail -10

# Per-steg-loggar — filtrera ALLTID bort .err.log
LATEST=$(ls -t runtime/ingestion-cron/steps/A-directAPI-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
tail -20 "$LATEST"
```

## Gotchas

**Cron läser INTE `EVENTPULSE_SANDBOX_ROOT`.** `RUNTIME_DIR` hårdkodas
(`:29`). En "sandboxad" cron-körning kör mot riktiga köer. Kör gaten
direkt om du vill isolera.

**`subpath-discovery` tar 70 min i median och 75 min som värsta uppmätta fall.**
Det är den längsta legitima stegtiden och den sätter golvet för
`STEP_TIMEOUT_MS`. Sänker du gränsen under 2 timmar riskerar du att döda ett
steg som bara är långsamt. Kör du om med låg gräns för att testa timeouten,
sätt `INGESTION_STEP_TIMEOUT_MS` och var beredd på `exit=124` i loggen.

**`null` och `0` betyder olika saker i `eventsExtracted`.** `null` = steget
kan inte mäta (skriver eget JSON-format, eller persisterar ingenting).
`0` = det kördes och fick inget. Dashboarden ska visa null som "vet inte".
Ett steg som alltid är `null` är inte ett fel — kontrollera
`STEP_COUNT_RECIPES` innan du rapporterar.

**`exitCode` per steg ≠ körningens öde.** I drift ger flera steg
exit=1 varje natt (P2C-active-learning, P3A-discovery är de kända). En
körning kan ha 24/24 steg avslutade och ändå ha producerat noll events.

**`exitCode: 124` betyder timeout, inte fel i steget.** Kolla
`event=="step-timeout"` i chain-overview.log för att skilja "steget hängde"
från "steget kraschade".

**Watchdog dödar ingenting.** `scripts/cron/ingestion-watchdog.ts` loggar en
ALERT-rad och avslutar alltid exit=0. Före 2026-10-23 var dess tröskel 90 min
oberoende av cron, så en 116-timmars hängning bara producerade en loggrad.
Nu läser den `INGESTION_STEP_TIMEOUT_MS` — men den är fortfarande en reporter,
inte en räddare. Den enda som faktiskt avslutar ett hängt steg är crons
egen timeout.

**Launchd äger filen.** En pågående körning blockerar inte läsning men
skriver över `runtime/ingestion-cron.status.json` medan du läser. Doktorn
flaggar `cron.running` — respektera det.

**Starta INTE `--only`-körningar medan nattkörningen är igång.** `ps auxww`
och `liveChainPids()` i `scripts/lib/chain-guard.mjs` avgör om en kedja lever.
En parallell `--only`-körning mäter inte steget — den krockar med nattkörningens
steg (och dödade dem med den äldre pre-kill-logiken, se ovan).

**`manual-review-triage` och `pattern-promoter` är borta ur listan sedan
2026-10-21.** Gamla `chain-overview.log`-rader kan innehålla dem. De dyker
inte upp i nya körningar. (Koden ligger kvar som dormant.)

**Green-filen styrs av en 24-timmarsregel.** Read-gaten hoppar över
verifieringskörningar om `ageH < 24 && ok`. Om du manuellt skriver
`ok: false` måste du också sätta `lastGreenAt` till det gamla värdet —
annars förloras beviset på när grönt senast såg ut.

**Cron kör `runB.ts --workers 20`**, men `runB.ts` parsar inte flaggan.
B är sekvent i drift.

**`worker-drain` räknar bara om den riktiga normalizern kördes.** En gång
skickade `drainQueue.ts` en stub som processor: `async () => { completed++ }`.
BullMQ markerade jobbet "completed", `[worker] Job completed`-rader skrevs, och
`countWorkerCompletions()` i `verify-fixes.mjs` (gate E3) räknade dem — grönt
på noll persisterade events. Kontrollera därför ALLTID en ändring av drainens
processor mot databasen, inte mot loggen: `events.updated_at` måste röra sig.

**Import av `normalizer.ts` startar AI-image-workern** (`normalizer.ts:28`).
Varje CLI som importerar modulen — inklusive en replay-gate — öppnar därför
också `ai-image-generation`-kön. En replay av 500 failed jobb med workern igång
hänge i 30 minuter: 0 events uppdaterade, 17 s CPU. Sätt
`process.env.AI_IMAGE_PIPELINE_ENABLED = '0'` **före** importen, eller stäng
workern direkt.

**`runtime/sources_priority_queue.jsonl` skrivs men dräneras aldrig.**
Producenten är levande: `updateSourceStatus` anropar `addToPriorityQueue`
(`sourceRegistry.ts:673`) för varje ny källa. Konsumenten är död: `getNextInQueue`
och `removeFromQueue` anropas enbart från `02-Ingestion/scheduler.ts:987-1009`,
och ingen launchd-plist, cron-kedja eller `runDaily` kör `scheduler.ts`.

Mätt 2026-10-23: 382 rader, senast skriven 2026-08-25, `sturecompagniet` med
`runsSinceAdd: 0` sedan april. De källor P3D promote:ar i dag syns inte heller
där — `promoteSourceCandidate` (`sandbox.ts`) skriver bara
`sources/<slug>.jsonl`, aldrig `updateSourceStatus`. Det är därför filen inte
växer trots 15 nya källor samma dag.

Följden är **visande, inte dataförlust**: filen läses för display av
`collect_state.ts:145`, men ingen gate agerar på den. Lägg stucka källor i
`postB-preC-queue.jsonl` i stället — det är den enda köen C-htmlGate faktiskt
dränerar.

*(Tidigare version av den här noten sa att `addToPriorityQueue` bara anropades
från `scheduler.ts`. Det var fel — anropet finns i `updateSourceStatus`.)*