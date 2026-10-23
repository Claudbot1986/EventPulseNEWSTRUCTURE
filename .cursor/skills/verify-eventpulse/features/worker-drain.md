# Ködränering — bullmq `raw_events` och workern

## Sub-features

- **`03-Queue/startWorker.ts`** — konsumerar bullmq-kön `raw_events`
  (prefix `bull`) via `createNormalizerWorker(processRawEvent)`.
- **Beredskapsrad** — `[worker] Normalizer worker ready, consuming raw_events queue`.
- **Per-jobb-bevis** — `[worker] Job <id> completed — "<title>"` per persisterat
  event (`startWorker.ts:23`).
- **Felväg** — `[worker] Job <id> failed: <msg>` till stderr.
- **Producerande väg** — `phase1ToQueue.ts` läser
  `03-Queue/03-extractedevents/*.jsonl` och enqueue:ar till `raw_events`.
- **Nedströms** — `04-Normalizer` (skriver inga filer i denna väg).

## How to get to it (user POV)

Du har events i `03-Queue/03-extractedevents/` och undrar varför de inte syns
i appen. Du startar workern och vill se den arbeta igenom kön:

```bash
npx tsx 03-Queue/startWorker.ts
```

och vill se `Job N completed` radas upp, en i taget, i takt med att jobben
blir klara.

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

**Workern skriver inga filer.** Den läser inte JSONL och skriver inte JSONL.
Allt bevis är stdout. Väntar du på en sidoeffekt i `runtime/` väntar du för
evigt.

**Kör för evigt.** Det finns ingen `--limit` och ingen avslutning på egen
hand. Om du kör den i en tool-session utan `&` låser du skallen tills du
avbryter. Blanda alltid med `&` + pid-fil.

**Redis är ett hårt beroende.** Default `redis://host.docker.internal:6379`.
I Docker-sammanhang är det rätt; på en ren maskin är `host.docker.internal`
inte uppslagningsbart. Doktorn rapporterar `redis.up` — kontrollera det
innan du skyller på workern.

**`[worker] Job N completed` är ~25 events/min.** En kö på 1000 jobb tar
~40 min. Räkna med det innan du avbryter en mätperiod och drar slutsatsen
"workern fungerar inte".

**Prefixet är `bull`.** Kön heter `bull:raw_events`, inte `raw_events`.

**`03-Queue/workers/` innehåller bara `workers.md`.** Ingen worker-implementation
där — den ligger i `startWorker.ts` i förälderkatalogen.

**Workern är inte sandboxbar.** Den bryr sig inte om
`EVENTPULSE_SANDBOX_ROOT` — den läser bullmq. En sandboxkörning av gate A
lägger *inte* in jobb i kön, eftersom A skriver till extractedevents och
det är `phase1ToQueue.ts` som enqueue:ar. Hela vägen
sandbox(extractedevents) → bullmq → workern går inte att köra isolerat.