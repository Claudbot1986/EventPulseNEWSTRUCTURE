---
name: verify-eventpulse-ingestion-discovery
description: |
  Verify EventPulse's two production loops END TO END against the real world —
  ingestion (does the chain really persist events?) and discovery (does it
  really find new sources, and do those sources really reach ingestion?).
  Use for /verify-eventpulse-ingestion-discovery, when the nightly chain
  reports green but the event count does not move, when discovery has produced
  nothing for days ("hittar discovery nya källor?"), when a promoted source
  never appears in the app, before trusting a green night, or before changing
  anything in 07-Discovery/, 09-DiscoveryAgent/, 02-Ingestion/ or
  scripts/ingestion-cron.ts. Runs the real chain and the real A/B/C/D gates —
  no simulated extraction, no file-only checks. Covers: preflight (is the
  world alive?), chain-live (do events reach Supabase?), discovery-handoff
  (candidates → test queue → real gate → promoted source), and mini-ingestion
  (ingestion over exactly the discovered sources, where only N changes).
disable-model-invocation: false
---

# verify-eventpulse-ingestion-discovery

EventPulse har två produktionsloopar som ska bevisa sig var för sig:

- **Ingestion** — kedjan i `scripts/ingestion-cron.ts` (27 steg) ska hämta
  evenemang och skriva dem till Supabase.
- **Discovery** — P3A/P3B/P3C hittar nya kandidatkällor, P3D testar dem med
  den riktiga A/B/C/D-gaten och promote:ar de som håller → de ska sedan köas
  av ingestion.

Den här skillen **startar riktiga körningar**. Det är hela poängen: nattkörningen
2026-10-31 var grön i sin helhet — P3A skrev 93 nya kandidater, P3D gick exit
0 på 746 ms — och **testade noll kandidater**. Orsaken var en trasig länk
(testkön matades aldrig), inte ett nätverksproblem. Filkontroller kan inte
fånga det; bara riktiga körningar mot riktig infrastruktur kan det.

## Launch

**Det finns ingen server att starta.** EventPulses "app" är två batch-kedjor
mot levande Redis/Supabase/Scrapingbee/Exa. "Launch" = köra kedjan och vänta
på att den är klar. Kedjan skriver till `runtime/ingestion-cron/status.json`
och `runtime/ingestion-cron/chain-overview.log` (en JSON-rad per steg).

**Före start — kontrollera att ingen annan kedje-körning pågår.** Två
processer som båda skriver samma statusfiler ger läsbara men falska resultat.

```bash
cd /Users/claudgashi/EventPulse
ps auxww | grep -E "ingestion-cron|runDaily|drainQueue|runSourceCandidate" | grep -v grep
# → tomt = fritt att köra
```

Är det inte tomt: vänta, eller avsluta den pågående körningen med dess eget
kommando (aldrig `kill -9` — se **Cleanup**).

**Ordning — och varför:**

| # | Gate | Kommando | Tid |
|---|---|---|---|
| 1 | Världen lever? | `node scripts/verify-preflight.mjs` | ~15 s |
| 2 | .env går att source:a | `node scripts/verify-env-integrity.mjs` | ~2 s |
| 3 | **Ingestion** producerar + persisterar events | `node scripts/verify-chain-live.mjs --limit 200` | 30–60 min |
| 4 | **Discovery** hittar, testar och promotar källor | `node scripts/verify-discovery-handoff.mjs --limit 5` | 10–25 min |
| 5 | **Mini-ingestion** över discovery-källorna | `node scripts/verify-mini-ingestion.mjs` | 30–60 min |

Steg 3 före 4 före 5 är ordningen användaren fastställde 2026-10-31:
ingestion ska först bevisas fungera på egen hand, sedan ska discovery hitta
nya källor, och till sist ska en **mini-ingestion** köras över just de
källorna. Mini-ingestionen får bara ändra **antalet källor (N)** — aldrig
sättet ingestion sker.

## Doctor

```bash
cd /Users/claudgashi/EventPulse

# Lever världen? (hårda kontroller: Redis, Supabase; mjuka: Exa, Scrapingbee)
node scripts/verify-preflight.mjs

# Är .env parsbar? (krävs av alla kedjesteg)
node scripts/verify-env-integrity.mjs

# Står det kandidater i testkön som går att claima? (ingen körning)
node scripts/verify-discovery-handoff.mjs --state-only

# Vad står i preA-kön just nu?
npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --status
```

Om preflight fallerar är resten av gaten meningslös — fixa världen först.

## Drive

Harness: **batchkommandon mot den riktiga infrastrukturen**. Inga mocks, ingen
simulerad extraction. Varje gate har en negativ kontroll som gör att en gate
inte kan passera "av misstag".

### Gate 1–2: världen och env

`scripts/verify-preflight.mjs` + `scripts/verify-env-integrity.mjs`.

### Gate 3: ingestion — producerar och persisterar events

```bash
node scripts/verify-chain-live.mjs --limit 200
```

Kör **hela kedjan** och mäter före/efter i samma process: importen köar
N > 0 events, drainen slutför M > 0 jobb med 0 misslyckade, `events_public`
minskar inte, och ledgerbeviset skrivs.

*Negativ kontroll inbyggd:* gaten tvingar produktion genom att ta bort
ledgerposter för källor som har framtida events (annars är importen
idempotent och gaten alltid röd).

### Gate 4: discovery — hittar, testar och promotar källor

```bash
node scripts/verify-discovery-handoff.mjs --limit 5
```

Kör P3D mot den **riktiga** A/B/C/D-gaten
(`Alltools-E2E/e2e.py --from-preA --limit 1 --apply`).

| Gate | Krav | Negativ kontroll |
|---|---|---|
| D1a | pending Stockholm-kandidater finns i `source_candidates` | — |
| D1b | ingen pending-kandidat saknas i testkön | ✅ kandidat utanför kön = trasig länk |
| D1c | kön har claimbara rader (`pending` + `city='Stockholm'`) | ✅ 0 claimbara = samma fel som 2026-10-31 |
| D2a | P3D claimade minst en kandidat | ✅ 0 claimade = samma fel som 2026-10-31 |
| D2b | testerna körde `e2e.py` | ✅ rad utan `e2e.py` = simulering, förbjuden |
| D3 | beslut sparades i `source_candidate_test_decisions` | — |
| D4a | promote-mekanismen har skrivit källfiler (senaste 24 h) | ✅ rött betyder "mekanismen är trasig" — INTE "denna körning råkade inte hitta någon promote" (reject är ett legitimt utfall) |
| D4b | filen bär `city=Stockholm` | ✅ saknad city → A-gatens `isInScope` kastar bort källan |
| D4c | kandidaten är `verified` i kandidattabellen | — |
| D4d | promote finns i `runtime/discovery-ui-queue.jsonl` | — |

### Gate 5: mini-ingestion — bara N ändras

```bash
node scripts/verify-mini-ingestion.mjs
```

Kör **hela kedjan** med `--limit N`, där N = antalet discovery-källor som ska
köas. Mekanismen är den befintliga: `runA.ts --add <id> <reason>` lägger källan
i `runtime/preA-queue.jsonl`, som A-gaten läser **först** (A-gatens urval är
annars preA → api-adapter → rss → never_run, så en ny discovery-källa —
`never_run` — skulle hamna sist och klippas bort av `--limit N`).

| Gate | Krav |
|---|---|
| M1 | Det finns discovery-källor att köa |
| M2 | Alla ligger i preA-kön |
| M3 | Kedjan avslutades exit 0 |
| M4 | A-gaten körde **N** källor — mätt ur stegloggen, inte antaget |
| M5 | Varje källa gav events i `events_public` **eller** registrerade ett routing-skäl |

### Stoppreglerna

**Om en gate blir röd: stoppa, starta inte om.** Kedjan ska inte fortsätta
lika tyst som förut — det var exakt det som gjorde att den brutna länken i
discovery gömde sig i sex dagar.

1. **Stäng av cron-jobben** (reversibelt):
   `launchctl bootout gui/$(id -u)/com.eventpulse.ingestion` och
   `... com.eventpulse.post-ingest`.
2. **Döda aldrig med SIGKILL** — annars lämnas preA-rader låsta i "processing"
   i 30 minuter. Använd kedjans egen avslutningsväg.
3. **Skriv fyndet i vaulten**
   (`00-Vault/01-Projects/EventPulse/02-Operations/06-Verification-Status.md`)
   med `[VERIFIED]`-markering och fil:line-bevis.
4. **Fixa rotorsaken, inte symtomet.** Ett rött läge ska inte "lösas" med att
   köra om kedjan.

## Evidence

| Vad | Var |
|---|---|
| Gate-rapport (gates, fel, per-source-mätning) | `runtime/verification-reports/<gate>-<TS>.json` |
| Kedjans stegloggar | `runtime/ingestion-cron/steps/<steg>-<TS>.log` (+ `.err.log`) |
| Kedjans stegordning, exit-koder, tider | `runtime/ingestion-cron/chain-overview.log` |
| Kedjans sammanfattning | `runtime/ingestion-cron.status.json` |
| Discovery-körningarnas beslut | `source_candidate_test_decisions` (Supabase) |
| Promote:ade källor | `runtime/discovery-ui-queue.jsonl` + `sources/*.jsonl` |
| Körningslogg för gate 3 | `runtime/verification-reports/chain-live-run-<datum>.log` |

**Bevisstandarder**

- Kör den **riktiga** koden. Test-run-raderna i `source_candidate_test_runs`
  ska innehålla `Alltools-E2E/e2e.py` — en rad utanför det är en simulering.
- Fånga **sidoeffekten**, inte bara slutläget: rows i `events_public`, filer i
  `sources/`, rader i `source_candidate_test_decisions`.
- **"Inga events" är inte samma som "trasig".** En källa utan framtida event är
  ett legitimt utfall; gaten M5 skiljer på *inget resultat* (rött) och
  *resultat: inga framtida event, med registrerat skäl* (grönt).
- Rapportera `[VERIFIED]` (körning) och `[UNVERIFIED]` (läst kod) separat.

## Cleanup

- **Döda aldrig med SIGKILL.** Använd kedjans egen avslutningsväg så att
  låsta preA-rader släpps: `node scripts/verify-shutdown-safety.mjs` verifierar
  att avslutandet är säkert.
- Ta bort det körningen skapade: inga temporära servrar, inga portar att
  stänga (kedjan är batch). Preflight startar inga långlivade processer.
- **Bevisen raderas aldrig.** `runtime/verification-reports/` och
  `runtime/ingestion-cron/steps/` finns kvar efter körningen.
- Starta om cron-jobben först när gaten är grön:
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eventpulse.ingestion.plist`
  (verifiera med `launchctl list | grep eventpulse`).

## Helpers

| Skript | Gör | Exit |
|---|---|---|
| `scripts/verify-preflight.mjs` | hårda kontroller mot Redis/Supabase | 0/1 |
| `scripts/verify-env-integrity.mjs` | .env parsas och har rätt format | 0/1 |
| `scripts/verify-chain-live.mjs` | hela kedjan + före/efter-mätning i DB | 0/1 |
| `scripts/verify-discovery-handoff.mjs` | P3D mot riktig A/B/C/D-gate + promote-kontroll | 0/1 |
| `scripts/verify-mini-ingestion.mjs` | hela kedjan med `--limit N` över discovery-källor | 0/1 |

```bash
node scripts/verify-discovery-handoff.mjs --state-only   # bara D1, ingen körning
node scripts/verify-discovery-handoff.mjs --limit 5       # 5 kandidater
node scripts/verify-discovery-handoff.mjs --no-promote    # D4 mjuk
node scripts/verify-mini-ingestion.mjs --limit 3          # N=3 källor
node scripts/verify-mini-ingestion.mjs --source id1,id2   # specifika källor
```

## Korsreferens

- Övriga discovery-steg (filkontroller, inte körningar) → `verify-eventpulse-discovery/`
- Handoff mot DB-sömlen → `verify-eventpulse-handoff/`
- Nattlig kedja, preflight, fail-fast → `verify-eventpulse-live/`
- Dubbletter i appen → `verify-eventpulse-dedup/`
- UI-nivå → `verify-eventpulse-ui/`

Underhåll av den här kartan: `/maintain-verification-skill`.
