# Chain-live — kedjan producerar events, och status ljuger inte

## Sub-features

- **`scripts/verify-chain-live.mjs`** — gate L3 + L4 + L5 + L7. Mäter före/efter i
  samma process och skriver
  `runtime/verification-reports/chain-live-<TS>.json`.
- **`scripts/lib/ledger-inspect.mjs`** — räknar ledger-radernas tillstånd och
  hittar loggrader som betyder att beviset inte skrevs. Ren modul, testad utan
  Redis (`scripts/lib/ledger-inspect.test.ts`).
- **`scripts/ingestion-cron.ts`** — orchestrator, **27 steg** i ordningen
  P3A → P3B → P3C → P3D → A → B → eventbrite → tribe → sitemap → subpath →
  direct-jsonld → livespot → C-htmlGate → D-renderGate → D-listing-crawl →
  I-pdfExtraction → etag-refresh → api-discovery → luma → ra → posh → reddit →
  D-images → import-to-eventpulse → worker-drain → reconcile-source-status →
  P2C-active-learning.
- **`runtime/ingestion-cron.status.json`** — liveness + `degradedSteps[]`.
- **`runtime/ingestion-cron/chain-overview.log`** — JSONL per steg.

### De fyra gaterna

| Gate | Krav | Mätning |
|---|---|---|
| **L3** | Kedjan producerar events OCH persisterar dem | `events till bullmq` > 0, drainens `completed` > 0 och `failed` == 0, `events_public` minskar inte |
| **L4** | Kön töms efter körningen | `LLEN bull:raw_events:wait` == 0 efter |
| **L5** | `status.json` ljuger inte | `running: true` ⇒ pid lever |
| **L7** | Ledgerbeviset skrevs | Ingen "kunde inte uppdatera/skriva ledger" i loggen, och antalet `queued`-rader växer inte trots slutförda jobb |

`failed` i drainens avslutsrad betyder jobb som **slutade** som misslyckade
(alla retry-försök förbrukade). Misslyckade försök som retry räddade
redovisas som `misslyckade-försök` och skrivs med `DEGRADED`-markören — de
får inte göra kedjan röd.

### Varför L7 finns (2026-10-28, sjunde rundan)

Under tre nätter såg kedjan GRÖN ut medan ledger stod kvar på `queued`.
Orsaken var ett stavnamn i dräneringen: `markPersisted(ledger,
persistedBySource)` när variabeln hette `persistedByFile`. Felet kastades i
en catch som bara loggade, och kedjans klassificering läste loggraden som
`logic` — alltså grönt. **Beviset skrevs aldrig**, och nästa natt hoppade
importen över källorna. Events försvann utan att en enda logg sa något.

Ingen gate tittade på ledger, så ingenting fångade det. L7 tittar nu på två
saker:

1. **Loggen får inte innehålla "kunde inte uppdatera ledger" eller "kunde
   inte skriva ledger"** — de två exakta feltexterna från dräneringens och
   importens catch-blockar.
2. **Antalet `queued`-rader får inte växa** om dräneringen slutförde jobb.
   Jobb som kördes men inte gav bevis betyder att beviset inte skrevs.

Negativa kontroller finns i `scripts/lib/ledger-inspect.test.ts`: den ordagranna
felraden från buggen FÅNGS, medan informationsrader som
`[drain] ledger: 5 källor markerade som persisterade` INTE ger larm.

### Varför (2026-10-28)

`status.json` stod kvar med `running: true` och en död pid (38614) —
watchdogen kallade det "ZOMBIE". Och ingen av rot-GATES.md:s 103 gates
mätte om kedjan producerade events. L3 och L5 är de två saker som var
värst saknade.

### Stegordningen (27 steg, P3 först)

`const steps` deklarerar dem i A→B→C→D-ordning, men en `steps.splice`
(`scripts/ingestion-cron.ts:996`) flyttar **P3A–P3D till först** vid körning.
Ordningen som faktiskt körs:

```
P3A-discovery → P3B-venue-graph-geo → P3C-rss-discovery
→ P3D-source-candidate-tests → A-directAPI → B-network-api
→ eventbrite-pagination → tribe-events → sitemap-discovery
→ subpath-discovery → direct-jsonld → livespot-stockholm → C-htmlGate
→ D-renderGate → D-listing-crawl → I-pdfExtraction → etag-refresh
→ api-discovery → luma-stockholm → ra-stockholm → posh-stockholm
→ reddit-stockholm → D-images → import-to-eventpulse → worker-drain
→ reconcile-source-status → P2C-active-learning
```

**Varför flytten (2026-10-23):** en källa som P3D promote:ade var osynlig för
A-gatet till nästa natt kl 02:00 — upp till 18 timmars latens. Nu promote:ar
P3D och A-gatet kör samma natt.

> `verify-eventpulse/features/orchestrator.md` säger fortfarande "25 steg" och
> listar utan `D-listing-crawl` och `reconcile-source-status`. Uppdatera den
> filen när orchestrator-fixen körs.

**Exit 75 = ofullständig körning.** Dräneringen avslutades innan kön var
tom. Gaten kräver exit 0 — en 75:a innebär att jobben finns kvar och ska
köras igen (nästa natt eller `--only worker-drain`).

**Exit 69 = världen var trasig.** Kedjan startade inte; inga events kan ha
producerats. Kör L1 (preflight) först.

## How to get to it (user POV)

"Kom det in någons nya evenemang ikväll?"

Gaten svarar med ett ja eller nej, baserat på att räkna raderna i databasen
före och efter en riktig körning — inte på att läsa loggar som säger "klart".

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Hel kedjan (L3 + L4 + L5 + L7)
node scripts/verify-chain-live.mjs --limit 50

# Avgränsa till import + dränering
node scripts/verify-chain-live.mjs --only import-to-eventpulse,worker-drain --limit 50

# Bara mäta kön
node scripts/verify-chain-live.mjs --queue-only

# Mäta utan att köra något
node scripts/verify-chain-live.mjs --no-run

# Mät utan att tvinga fram produktion (ren observation)
node scripts/verify-chain-live.mjs --only import-to-eventpulse,worker-drain --exercise 0
```

**Bevisfilen** (`runtime/verification-reports/chain-live-<TS>.json`):

```json
{
  "stamp": "2026-10-28T06-29-30-209Z",
  "eventsPublicBefore": 17351,
  "eventsPublicAfter": 17351,
  "queueBefore": 0,
  "queueAfter": 0,
  "queueKey": "bull:raw_events:wait",
  "steps": ["[ingestion-cron] ✓ worker-drain: exit=0 ..."],
  "chainExitCode": 0,
  "chainDurationMs": 539136,
  "durationMs": 539200,
  "overview": { "preflightFail": 0, "stepTimeout": 0, "silentTransport": 0, "lines": 12 },
  "liveness": { "running": false, "pid": 48000, "alive": false, "ok": true, "detail": "running=false (pid 48000)" },
  "ledgerBefore": { "total": 184, "persisted": 184, "queued": 0, "empty": 0, "failed": 0 },
  "ledgerAfter": { "total": 184, "persisted": 184, "queued": 0, "empty": 0, "failed": 0 },
  "ledgerFailures": [],
  "enqueued": 3737,
  "drainCompleted": 3729,
  "drainFailed": 0,
  "eventsCreatedDuringRun": 0,
  "exercisedSources": ["momentsapp-stockholm(3089 framtida)", "sthlmlist(338 framtida)", "stockholmlive-evenemang(241 framtida)"],
  "ok": true
}
```

**Kedjan körs med `--force-import-sources`** när gaten tvingar fram
produktion. Flaggan `--force` på `03-Queue/importToEventPulse.ts` gör att
importeraren ignorerar ledger-skivan för de angivna källorna.

**`events_public` mäts via PostgREST** `GET {SUPABASE_URL}/rest/v1/events_public?select=id`
med `Prefer: count=exact` och `Range: 0-0` — antalet läses ur
`content-range`-headern.

**`status.json`-liveness**: `running: true` ⇒ `process.kill(pid, 0)` ska
inte kasta `ESRCH`. `running: false` ⇒ inget att kontrollera.

**`chain-overview.log` kontrolleras för de rader som tillkom under körningen**:
`step-timeout`, `preflight-fail` och `silent-transport-error` fäller gaten.

## Gotchas

**`events_public` växer inte för varje körning — och det är RÄTT.** Dedup
mappar varje återimporterat event mot en befintlig rad. En korrekt kedja kan
alltså skriva 5 402 rader till `events` och ändå lämna `events_public`
oförändrat. Kräv därför INTE "nya rader i events_public" — mät persisteringen
via drainens `completed`/`failed` i stället. Varje jobb som drainen slutför
har skrivit en rad (normalizern kastar annars, och jobbet räknas som failed).

**Import-ledgern gör omkörningar tomma.** `runtime/import-ledger.jsonl`
hoppar över källor med oförändrat innehåll, så en andra körning importerar 0
events. Gaten tvingar därför fram produktion: kedjan körs med
`--force-import-sources <id,...>` för källor som har **framtida** events
(importens datumvakt kastar bort förgångna). Flaggan `--force` på
importeraren gör att ledgern ignoreras — **ledgern röds inte**, till skillnad
från att ta bort poster ur den (det gör nästa nattliga körning importera om
allt). Sätt `--exercise 0` för att mäta utan att tvinga.

**`events_public` kan INTE minska.** Om antalet går ned är något raderat
events — rapportera, ignorera inte.

**En pågående launchd-körning krockar.** Kontrollera `ps` före — två
processer som skriver `status.json` ger orimliga mätvärden. Sedan
2026-10-28 vägrar gaten själv köra om en annan ingestion-kedja lever
(`liveChainPids()` från `scripts/lib/chain-guard.mjs`): den säger
"en annan ingestion-kedja kör redan (pid …)" och avslutar rött. Det
kontrolleras INNAN barnet startas — annars skulle kedjan själv matcha
mönstret.

**`--limit 50` är per steg**, inte totalt.

**Exit 69 i gaten betyder världen var trasig.** Då startade kedjan inte, och
`events_public` kan inte ha växt — kör L1 först.

**`countEventsPublic()` returnerar `null` (inte 0) om Supabase inte
svarar.** `null` = "vet inte". Gaten skiljer på "vet inte" och "noll".

**Ködjupet mäts via ioredis, inte `redis-cli`.** Det gör att REDIS_URL med
lösenord hanteras korrekt och att auth-fel inte går obemärkt.

**En förlorad avslutsrad gör `worker-drain` omätbar.** Kedjan parsar
`[drain] avslutar (…): completed=N failed=M` ur dräneringens stdout. På macOS
är skrivning till en pipe asynkron, och `process.exit()` kastar skrivbufferten
— mätt: 20 MB genom en långsam läsare → exakt 65 536 byte (pipens buffert).
Dräneringen.flushar därför stdout innan den avslutar
(`03-Queue/stdoutFlush.mjs`, testad i `03-Queue/stdoutFlush.test.ts` med en
negativ kontroll som visar att raden försvinner UTAN flushen). Om du ser
`events=n/a` för `worker-drain` är avslutsraden inte framme — kontrollera
step-loggen, och kör inte om kedjan förr raden är tillbaka.
