# Fail-fast — fel fälls i stället för att hänga

## Sub-features

- **`scripts/lib/net-error.mjs`** — felklassning: `transport | auth | http |
  empty | logic`. Exporterar `classifyError(err)` och `classifyMessage(text)`
  (för att klassa en barnprocess' stderr).
- **`03-Queue/redisClient.mjs`** — EN central options-källa för IORedis.
  Producer: `maxRetriesPerRequest:1`, `enableOfflineQueue:false`,
  `connectTimeout:5000`. Worker: `maxRetriesPerRequest:null` (BullMQ
  tvingar det), `enableOfflineQueue:false`.
- **`03-Queue/queue.ts`** — plain RedisOptions (BullMQ ignorerar
  `{ getConnection }`-fabriken; `url` MÅSTE ligga i options).
- **`03-Queue/importToEventPulse.ts`** — `withTimeout(enqueueRawEvent(raw),
  15_000)` per event, felrader samlas (max 3), exit 70 om inget köades.
- **`03-Queue/drainQueue.ts`** — timeout runt `depth()`/`getJobCounts()`.
- **`scripts/ingestion-cron.ts`** — `classifyStepFailure(exitCode, stderr)`
  → `errorClass` + `degraded`. `totalExit` får **aldrig** bli 0 om ett steg
  haft `errorClass:'transport'`.
- **`scripts/verify-failfast.mjs`** — gate L2.

### Varför (2026-10-28)

Nattköningen 2026-10-26 hängde i två timmar (exit=124) med 583 KB
identiska felrader och 0 events köade. Två lager gjorde det möjligt:

1. **BullMQ ignorerade `REDIS_URL`.** Kopplingsfabriken
   `{ getConnection }` behandlades som vanliga RedisOptions
   (`redis-connection.js:151`) → anslutningen gick mot `127.0.0.1:6379`
   i alla lägen, även när `REDIS_URL` pekade någon annanstans.
2. **ioredis default `enableOfflineQueue: true`.** Kommandon som skickades
   medan Redis var dött läger i offline-kön i stället för att rejecta —
   därför "hängen" i stället för ett fel.

Med `enableOfflineQueue:false` blir ett dött Redis ett **fel** (exit 69,
~3 s) i stället för en hängning.

### Felklassningen

| Klass | Betyder | Exit | Källa |
|---|---|---|---|
| `transport` | Nätet/Redis når inte fram | 69 | `ECONNREFUSED`, `EADDRNOTAVAIL`, `ENOTFOUND`, `ETIMEDOUT`, `fetch failed` |
| `auth` | Nyckel saknas/ogiltig | 77 | `unauthorized`, `forbidden`, `invalid api key`, HTTP 401/403 |
| `http` | Servern svarade, men fel | 1 | HTTP 4xx/5xx som inte är 401/403 |
| `empty` | Servern svarade men hittade inget | 0 | reddit 0 kandidater, tomma feeds |
| `logic` | Programfel | 1 | allt annat |

**`empty` får exit 0** — "sökningen gav inget" är ett legitimt resultat.
**`transport` får aldrig exit 0** — det är exakt det "gröna som ljög" som
slag ut tre natter.

## How to get to it (user POV)

"Natten gick igenom men det finns inget i appen."

Nu svarar kedjan i stället: "nätverket gick ner i steg X kl 03:14" — i stället
för "klar, 0 events". Och när nätet är nere tar det tre sekunder att veta
det, inte två timmar.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Gate L2 — död Redis + levande Redis (negativ kontroll)
node scripts/verify-failfast.mjs

# Bara en del
node scripts/verify-failfast.mjs --only dead
node scripts/verify-failfast.mjs --only live
```

**Förväntad utdata (död Redis):**

```
[verify-failfast] DEAD — importen pekas mot en död Redis
  exit=69  duration=3473ms  log=9.5 KB
  OK: fel fälls snabbt, klassas och ger exit 69
```

**Förväntad utdata (levande Redis):**

```
[verify-failfast] LIVE — importen mot den levande Redis
  exit=0  duration=410ms  log=1.2 KB
  OK: 9 events köade utan fel
```

**Toleranser i gaten:** ≤ 60 000 ms, ≤ 50 KB logg, exit exakt 69, loggen
ska innehålla "transport".

### Verifiera klassningen i en child-process

```bash
# Kör ett steg mot en död Redis och se hur kedjan rapporterar det.
# --force-import-sources tvingar fram en riktig import — annars hoppar
# ledger-skivan över källan och inget når Redis (exit 0, inget att mäta).
npx tsx scripts/ingestion-cron.ts --only import-to-eventpulse \
  --force-import-sources 3arena
jq '{exitCode, degradedSteps}' runtime/ingestion-cron.status.json
# → exitCode: 69 (aldrig 0 för ett transportfel)
```

## Gotchas

**`maxRetriesPerRequest:null` för workern, `1` för producenten.** BullMQ
**kastar** om ett ioredis-instance har ett sant `maxRetriesPerRequest`
(`redis-connection.js:71`), och blockerande anslutningar kräver `null`
(`:37`). `Queue` har `blocking:false` så producenten klarar `1`.

**`url` måste ligga i RedisOptions.** `{ getConnection }` fungerar inte.

**"401" i stderr är inte alltid en HTTP-status.** Det kan vara ett antal.
`AUTH_PATTERN` kräver därför kontext (`HTTP 401`, `status=403`) eller en
explicit fras (`unauthorized`, `invalid api key`).

**Retry-rader ska inte klassas.** `classifyStepFailure` filtrerar bort rader
som matchar `retry|retrying|försök(ar) igen|will retry` — annars skulle ett
steg som lyckas efter två försök felklassisas som transportfel.

**`empty` är inte ett fel.** Reddit som ger 0 kandidater har exit 0 och
errorClass `empty` — det ska räknas som grönt.

**`ingestion-cron.ts` sätter `totalExit = 69` även för exit=0 med
transportfel.** Utan den regeln kunde ett steg som skrev "fetch failed" i
stderr och avslutade med exit 0 lämna kedjan grön.

**Ledger-skivan gör "exit 0" betydningslöst för gaten.** Importen hoppar över
källor med oförändrat innehåll — nattkörningen ska göra det, men en gate
måste kunna bevisa att Redis NÅS. Båda gaterna (L2, L3) importerar därför
med `--force` (importörarens flagga) via `--force-import-sources` på cron.
**Rör inte ledgerfilen** — att ta bort poster ur den gör nästa nattliga
körning importera om allt, och posterna kommer inte tillbaka om importen
fallerar.

**`DEGRADED` = rapporterad försämring, inte fel.** En del som äger ett
per-item-fel (t.ex. Editorial Engines LLM-anrop) skriver `DEGRADED` på raden.
Kedjan räknar den som `degradedSteps[]`, inte som transportfel. Utan
markören slog kedjan röd på en körning som persisterade 5 402 events.
