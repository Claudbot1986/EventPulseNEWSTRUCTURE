# Ködränering — bullmq `raw_events` och workern

## Sub-features

- **`03-Queue/drainQueue.ts`** — dränerar bullmq-kön `raw_events` (prefix `bull`)
  och är det steg i kedjan som skriver till Supabase. Processorn är
  `processRawEvent` via `createNormalizerWorker`.
- **`03-Queue/startWorker.ts`** — konsumenten, utan avslutning på egen hand.
- **Beredskapsrad** — `[worker] Normalizer worker ready, consuming raw_events queue`.
- **Per-jobb-bevis** — `[worker] Job completed — N/5420` per persisterat event.
- **Felväg** — `[worker] Job <id> failed: <msg>` till stderr.
- **Producerande väg** — `03-Queue/importToEventPulse.ts` (kedjesteget
  `import-to-eventpulse`) läser `03-Queue/03-extractedevents/*.jsonl` och
  enqueue:ar till `raw_events`. Den läser INTE från Redis själv — den läser
  filerna. `phase1ToQueue.ts` är den äldre vägen och används inte av kedjan.
- **Nedströms** — `04-Normalizer` (skriver inga filer i denna väg).

## Tvåfas-ledgern (2026-10-28)

`runtime/import-ledger.jsonl` har två faser, och skillnaden är beviset:

| Fas | Betyder | Vem skriver |
|---|---|---|
| `queued` | jobben är KÖADE — de ligger bara i Redis | `importToEventPulse.ts` |
| `persisted` | jobben är SKRIVNA till `events` | `drainQueue.ts` |

**En tom kö är INTE bevis.** Redis kan dö och tömma kön utan att något
persisterats. Dräneringen flippar därför bara till `persisted` när *antalet
körda jobb per kanonisk källa täcker* det importeraren köade för den källan
(`bySource` i ledger-raden). Beviset är alltså **per källa**, inte globalt:
en källa vars jobb förlorades täcker inte sitt antal och står kvar som
`queued` — och importeras igen nästa natt. Legacy-rader utan `bySource`
räknas som `queued` (ingen bevis).

**2026-10-28 — det globala "0 misslyckade"-villkoret togs bort.** Tidigare
fick en ENDA misslyckat försök (som retry räddade) stoppa hela dräneringen
från att flippa en enda rad. Då importerades samma källor varje natt, med
samma ~5 000 jobb i kön. Nu är beviset per källa, och dessutom: flippa får
bara ske när dräneringen avslutades för att kön var TOM (`kö tom`), inte
på maxMs/SIGTERM. Se `03-Queue/drainOutcome.mjs` (testad utan Redis).

**Konsekvens:** en rad som står kvar som `queued` i många nätter är ett
larm, inte en detalj. Läs `state` i ledgerfilen — inte antalet rader.

## How to get to it (user POV)

Du har events i `03-Queue/03-extractedevents/` och undrar varför de inte syns
i appen. Du kör dräneringen och vill se jobben arbeta igenom kön:

```bash
npx tsx 03-Queue/drainQueue.ts --max-ms 300000 --concurrency 20
```

och vill se `Job completed — N/M` radas upp i takt med att jobben blir klara.
Dräneringen avslutas själv efter `--max-ms` — till skillnad från
`startWorker.ts`, som kör för evigt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Finns det jobb att göra? (Redis måste vara uppe — doctor verifierar det)
REDIS_URL=$(grep -E '^REDIS_URL=' .env | cut -d= -f2-)
redis-cli -u "$REDIS_URL" llen bull:raw_events 2>/dev/null \
  || echo "(redis-cli saknas eller auth krävs — se doctor redis.up)"

# 2. Starta workern. Skriv PID med.
npx tsx 03-Queue/startWorker.ts > /tmp/ep-worker.log 2>&1 &
WPID=$!
echo "worker pid=$WPID" > /tmp/ep-worker.pid

# 3. Vänta på beredskapsraden — det är readiness-signalen.
sleep 5
grep -q "Normalizer worker ready" /tmp/ep-worker.log && echo "READY" || echo "NOT READY"

# 4. Bevis = antal färdiga jobb, inte att processen lever.
sleep 60
grep -c "completed" /tmp/ep-worker.log
tail -5 /tmp/ep-worker.log

# 5. Stäng det DU startade.
kill "$WPID"
```

## Gotchas

**Avslutsraden är maskinellt läst.** Formen är fast:

```
[drain] avslutar (kö tom): completed=5420 failed=0 misslyckade-försök=3 kvar=0 active=0 delayed=0
```

- `completed` — jobb som kördes klart.
- `failed` — jobb som **slutade** som misslyckade (alla försök förbrukade).
- `misslyckade-försök` — antal försök som föll, oavsett utfall (BullMQ:s
  `attempts: 3` gör att ett jobb kan ge flera felrader).
- `kvar`/`active`/`delayed` — ködjupet vid avslut.

Receptet i `scripts/ingestion-cron.ts:148` (`worker-drain`) och regexen i
`scripts/verify-chain-live.mjs` läser `completed` respektive `failed` —
ändra inte formatet utan att uppdatera båda.

**Exitkoderna är ärliga (2026-10-28).**

| Exit | Betyder |
|---|---|
| 0 | kön tom, inga terminala fel |
| 69/77/70 | terminala misslyckanden — klassad efter felets art |
| 75 | avslutades innan kön var tom (maxMs/SIGTERM) — kör igen senare |

Före detta avslutade dräneringen **alltid** 0, även när jobb förlorades.
Kedjan klassar steget efter exitkoden, så förlusten var osynlig.

**Misslyckade försök som retry räddar skrivs med `DEGRADED`-markören.**
`[drain] DEGRADED job misslyckades (försök 1/3, försöker igen): …` — annars
skulle kedjans felklassning läsa "fetch failed" i stderr som ett
TRANSPORTFEL, och kedjan gick röd på en körning som persisterade tusentals
events med 0 fel.

**Workern skriver inga filer.** Den läser inte JSONL och skriver inte JSONL.
Allt bevis är stdout. Väntar du på en sidoeffekt i `runtime/` väntar du för
evigt.

**Kör för evigt.** Det finns ingen `--limit` och ingen avslutning på egen
hand. Om du kör den i en tool-session utan `&` låser du skallen tills du
avbryter. Blanda alltid med `&` + pid-fil.

**Redis är ett hårt beroende — och URL:en läses från `REDIS_URL`.**
Standardvärdet är `redis://127.0.0.1:6379` (`03-Queue/redisClient.mjs`).
**Inte** `host.docker.internal` — det gamla värdet gäller inte längre.
Före 2026-10-28 ignorerades `REDIS_URL` helt (BullMQ fick en
`{ getConnection }`-fabrik, som den ignorerar), så kedjan körde mot
`127.0.0.1` även när `.env` pekade någon annanstans. Nu är `url` ett vanligt
option-värde i alla klienter.

**`[worker] Job completed` är ~25 events/min vid concurrency 1.** Med
`--concurrency 20` är taket ~250–350 jobb/min (mätt 2026-10-28: 5 420 jobb
på ~20 min). Räkna med det innan du avbryter en mätperiod och drar
slutsatsen "workern fungerar inte".

**Kedjan dränerar med `--max-ms 5400000` (90 min) och `--concurrency 20`.**
Kön kan växa under tiden — importen köar och dräneringen tar hand om det
inom samma steg.

**Exit 69 = världen trasig, inte steget trasigt.** `drainQueue.ts` fångar
Redis-fel och avslutar med 69 i stället för att hänga. `exitCode: 124` betyder
timeout (90 min), inte fel i steget. **Exit 75 betyder "ofullständig körning"**
— dräneringen avslutades innan kön var tom (maxMs eller SIGTERM) och ska köras
igen. Kedjan ska INTE rapporteras som grön på en 75:a.

**`--status` avslutar rent.** Det importerar `normalizer.ts`, som startar
AI-image-workern — sätt `AI_IMAGE_PIPELINE_ENABLED=0` före importen, annars
öppnas `ai-image-generation`-kön och processen hänger.

**Prefixet är `bull`.** Kön heter `bull:raw_events`, inte `raw_events`.

**`03-Queue/workers/` innehåller bara `workers.md`.** Ingen worker-implementation
där — den ligger i `startWorker.ts` i förälderkatalogen.

**Workern är inte sandboxbar.** Den bryr sig inte om
`EVENTPULSE_SANDBOX_ROOT` — den läser bullmq. En sandboxkörning av gate A
lägger *inte* in jobb i kön, eftersom A skriver till extractedevents och
det är `phase1ToQueue.ts` som enqueue:ar. Hela vägen
sandbox(extractedevents) → bullmq → workern går inte att köra isolerat.