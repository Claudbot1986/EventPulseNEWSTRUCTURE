---
name: verify-eventpulse-live
description: |
  Verify the EventPulse NIGHTLY CHAIN end-to-end against real infrastructure —
  Redis, Supabase, Exa, Scrapingbee — with real runs, not file checks.
  Use for /verify-eventpulse-live, when the chain reports "klart" but nothing
  lands in the database, when the queue has thousands of stuck jobs, when a
  step hangs for hours instead of failing fast, when .env is suspected broken,
  or before trusting a green night. Covers preflight (does the chain refuse to
  start on a broken world?), fail-fast (does an unreachable Redis stop in <60s
  instead of hanging?), import-backlog (does the queue actually empty?),
  chain-live (does the chain really produce AND persist events?), env-integrity
  (does .env parse?). Every gate has a negative control. All gates live in
  scripts/verify-{preflight,failfast,chain-live,env-integrity}.mjs.
disable-model-invocation: false
---

# verify-eventpulse-live

## Launch

**Skillen startar riktiga körningar.** Det är hela poängen: kedjan har under
tre nätter loggat "klart" med 0 events, och 103 gröna fil-gates bevisade
ingenting om det. Alla gates här mäter en levande värld.

Skillen **äger inte** kedjan — den startar inte launchd-jobb och dödar inga
processer. Den kör de fyra gate-skripten, som i sin tur startar avgränsade
subprocesser (`ingestion-cron.ts` med `--only`/`--limit`, eller
`importToEventPulse.ts`).

**Innan du kör:** kontrollera att ingen annan kedje-körning pågår. Två
processer som båda skriver `runtime/ingestion-cron.status.json` ger
läsbara men falska resultat.

```bash
cd /Users/claudgashi/EventPulse
ps auxww | grep -E "ingestion-cron|runDaily|drainQueue" | grep -v grep
# → tomt = fritt att köra. Är det inte tomt: vänta, eller avsluta den
#   pågående körningen med dess eget kommando (aldrig SIGKILL).
```

Från och med 2026-10-28 gör `verify-chain-live.mjs` den kontrollen själv:
den vägrar starta kedjan om `liveChainPids()` hittar en annan levande
ingestion-kedja, och avslutar rött med "en annan ingestion-kedja kör
redan (pid …)". Kontrollen sker INNAN barnet startas — annars skulle
kedjan själv matcha mönstret.

**Tidsåtgång:**

| Gate | Kommando | Tid |
|---|---|---|
| L1 preflight | `node scripts/verify-preflight.mjs` | ~15 s |
| L2 fail-fast | `node scripts/verify-failfast.mjs` | ~10 s |
| L3/L4/L5 chain-live | `node scripts/verify-chain-live.mjs --only import-to-eventpulse,worker-drain --limit 50` | ~1–2 min |
| .env | `node scripts/verify-env-integrity.mjs` | ~2 s |

**Ordning:** L1 → L2 → .env → chain-live. L1 först — mot en trasig värld ger
L2 och L3 meningslösa röda resultat (och orsakar onödig last mot död
infrastruktur).

**L4 mät bara EFTER en chain-live-körning.** L2:s negativa kontroll köar
events mot den levande Redis (för att bevisa att den svarar) — de ligger kvar
i kön. `--queue-only` mäter kön som den är, så kör den efter chain-live (som
dränerar kön) eller dränera först.

## Doctor

```bash
cd /Users/claudgashi/EventPulse

# 1. Lever världen? (hårda kontroller — Redis, Supabase, .env)
node scripts/lib/preflight.mjs
# → exit 0 = körbar. exit 69 = trasig värld, kedjan ska inte starta.
#   Tredjepart (Exa/ScrapingBee) är MJUKA kontroller: en outage där stoppar
#   inte kedjan — de stegen faller med sin egen felklass. Med
#   --strict-preflight blir tredjepart hård igen.

# 2. Måste de lokala servrarna vara igång? (7777 supervisor, 7778 analytics)
curl -s -o /dev/null -w "7777=%{http_code}\n" http://localhost:7777/health
curl -s -o /dev/null -w "7778=%{http_code}\n" http://localhost:7778/api/health
# → 7777 och 7778 är MJUKA kontroller i preflight: kedjan klarar sig utan dem.
#   De behövs för dashboard och analytics, inte för ingestion.

# 3. Hur stor är kön?
redis-cli LLEN bull:raw_events:wait
# → 0 = tomt. >0 = jobb som väntar på workern.

# 4. Låg statusfilen status.json ljuga?
jq '{running, pid, exitCode, totalEventsExtracted}' runtime/ingestion-cron.status.json
# → running=true ⇒ pid ska leva. running=false ⇒ kedjan är inte igång.
```

**Doctor-failure** = världen är trasig → kör INTE chain-live. Fixa världen
först, annars mäter du en trasig värld och rapporterar fel.

## Drive

### L1 — preflight fångar nätverksfel under 30 s

```bash
node scripts/verify-preflight.mjs
```

Två delar: (a) den levande världen svarar grönt på alla hårda kontroller,
(b) med nätet simulerat trasigt faller preflight inom 30 s.

Del (b) pekar om `REDIS_URL`/`SUPABASE_URL` mot en död port — samma felbild
som nattet 26–28 okt (`EADDRNOTAVAIL` utan någon HTTP-status).

### L2 — importen fäller snabbt i stället för att hänga

```bash
node scripts/verify-failfast.mjs
```

Del (a): död Redis → importen avslutar inom 60 s med **exit 69**, logg under
50 KB, och loggen innehåller "transport". Del (b) — negativ kontroll — samma
kommando mot den LEVANDE Redis ska lyckas med events köade.

Utan del (b) bevisar gaten bara att "allt är rött".

### .env — går filen att source:a av en shell?

```bash
node scripts/verify-env-integrity.mjs
```

Samma parser som runtime + `bash -c 'set -a; source .env; set +a'`. Fångar
`FLY_API_TOKEN2=FlyV1 fm2_abc` (rad 58, 2026-10-28) — ett ociterat värde
med blanksteg, som bash läser som två ord. Värden skrivs ALDRIG ut, bara
nyckelnamn och längder.

### L3/L4/L5 — kedjan producerar events, kön töms, status ljuger inte

```bash
node scripts/verify-chain-live.mjs --limit 50
```

Mäter före/efter i samma process:
- importens köade events (N) och drainens `completed`/`failed` (M) — det är
  beviset på att kedjan producerar OCH persisterar events
- `events_public`-count (PostgREST `Prefer: count=exact`) — får INTE minska
- ködjup i `bull:raw_events:wait`
- `status.json`-liveness (`running: true` ⇒ pid lever)
- `chain-overview.log` (inga `step-timeout`, `preflight-fail`,
  `silent-transport-error` under körningen)

Bevisfil: `runtime/verification-reports/chain-live-<TS>.json`.

Avgränsa med `--only` (t.ex. `--only import-to-eventpulse,worker-drain`)
eller `--limit N`. `--queue-only` mäter bara kön, `--no-run` mäter utan att
köra något.

## Evidence

| Signal | Källa | Bevisar |
|---|---|---|
| `runtime/verification-reports/chain-live-<TS>.json` | denna skill | före/efter-mätning av events + kö |
| `runtime/ingestion-cron/preflight-<TS>.json` | `scripts/lib/preflight.mjs` | vilka kontroller som föll |
| `runtime/ingestion-cron/chain-overview.log` | ingestion-cron | steg-händelser, timeouts, tysta transportfel |
| `runtime/ingestion-cron.status.json` | ingestion-cron | liveness, `degradedSteps[]` |
| `runtime/import-ledger.jsonl` | `03-Queue/importLedger.mjs` | vilka källor som redan importerats (oförändrade) |
| `runtime/ingestion_runs.jsonl` | runRecorder | summerad körningsstatistik |

**Inga hemligheter i bevisen.** `.env`-värden skrivs aldrig ut — bara nyckelnamn
och längder.

## Cleanup

Denna skill dödar inga processer och rader inga runtime-filer. Den startar
subprocesser som avslutas själva (importen, preflight, `--only`-körningar).

**Undantag:** `verify-chain-live.mjs` med `--only worker-drain` startar en
worker som dränerar kön. Den avslutas av sig själv efter `--max-ms`.

`runtime/ingestion-cron/` och `runtime/verification-reports/` är gitignored
och töms inte.

## Gotchas

**`events_public` växer INTE för varje körning — och det är RÄTT.** Dedup
mappar varje återimporterat event mot en befintlig rad, så en korrekt kedja
kan skriva tusentals rader till `events` och ändå lämna `events_public`
oförändrat. Kräv därför INTE "nya rader i events_public". L3 mäter i stället
importerad N och persisterad M (drainens `completed`/`failed`).

**Ledger-skivan gör omkörningar tomma.** `runtime/import-ledger.jsonl`
hoppar över källor med oförändrat innehåll, så en andra körning importerar 0
events. Gaten tvingar därför fram produktion med `--force-import-sources`
(kedjan) respektive `--force --source <id>` (importöraren). **Rör inte
ledgerfilen** — att ta bort poster ur den gör nästa nattliga körning
importera om allt, och posterna kommer inte tillbaka om importen fallerar.

**Ledger har TVÅ faser — "köad" är inte "persisterad".** En rad är `queued`
när importören har köat jobben (de ligger bara i Redis) och blir `persisted`
först när dräneringen har skrivit dem till databasen. Bara `persisted`
hoppas över. Rader som saknar bevis (gamla rader utan `bySource`, eller en
källa vars jobb inte alla kördes) stannar i `queued` och importeras om — det
är avsiktligt: jobben kan ha försvunnit med en död Redis. **Lita inte på att
"kön var tom" betyder "jobbena finns i databasen"** — kontrollera `state` i
ledgerfilen.

**Kön kan växa under en körning.** `import-to-eventpulse` köar jobb, och
workern dränerar dem — men bara inom `worker-drain`-steget. Ett steg som
avslutas efter importen (t.ex. `--only import-to-eventpulse`) lämnar kön
fylld. Använd `--only import-to-eventpulse,worker-drain` för att mäta båda.

**En pågående launchd-körning krockar.** Om `com.eventpulse.ingestion` startar
kl 02:00 medan du kör chain-live, skriver båda till `status.json` och mätningen
blir orimlig. Kontrollera med `ps` före — chain-live-gaten vägrar dessutom
själv köra om en annan kedja lever.

**`--limit 50` betyder 50 per steg**, inte 50 totalt. Kedjan har 27 steg.

**Exit 69 i ett gate betyder "världen trasig", inte "gaten trasig".** L1 ger
69 → världen; L2 ger 69 → fail-fast fungerar korrekt.

## Maintenance

Kör `/maintain-verification-skill` när:
- `scripts/lib/preflight.mjs` får en ny kontroll → uppdatera `features/preflight.md`.
- `03-Queue/importLedger.mjs` ändrar ledger-format → uppdatera `features/import-backlog.md`.
- `scripts/ingestion-cron.ts` lägger till/tar bort steg → uppdatera `features/chain-live.md` och `verify-eventpulse/features/orchestrator.md`.
- Nya felklasser införs i `scripts/lib/net-error.mjs` → uppdatera `features/fail-fast.md`.

## Feature map

| Feature | Gate | Fil |
|---|---|---|
| Preflight | L1 | `features/preflight.md` |
| Fail-fast | L2 | `features/fail-fast.md` |
| Import-backlog | L4 | `features/import-backlog.md` |
| Chain-live | L3 + L5 | `features/chain-live.md` |
| Env-integrity | — | `features/env-integrity.md` |

Se `features/README.md` för index.
